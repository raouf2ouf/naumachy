import type { Gateway } from "../gateway.js";
import type { Pool } from "../db.js";
import { upsertRows } from "../db.js";
import { planNextPage } from "../paging.js";
import type { LaneStats } from "./strategies.js";

interface LegRow { id: string; token: string; net: string; pushed: string; pulled: string }
interface FillRow {
  id: string; registry: string; strategy: { id: string }; tx: string; block: string; timestamp: string;
  taker: string | null; shape: string; economic: boolean; legCount: number; legs: LegRow[];
}
interface FillsData { _meta: { block: { number: string } }; fills: FillRow[] }

const FIELDS = `id registry strategy { id } tx block timestamp taker shape economic legCount legs { id token net pushed pulled }`;
const FILLS_QUERY = `query Fills($after: BigInt!, $first: Int!) {
  _meta { block { number } }
  fills(first: $first, orderBy: block, orderDirection: asc, where: { block_gt: $after }) { ${FIELDS} }
}`;
const BLOCK_QUERY = `query FillsInBlock($block: BigInt!, $first: Int!, $skip: Int!) {
  _meta { block { number } }
  fills(first: $first, skip: $skip, where: { block: $block }) { ${FIELDS} }
}`;

// Pages fills by block, with their legs, from the fills cursor to the subgraph head.
export async function syncFills(pool: Pool, gateway: Gateway, chain: string, subgraphId: string, pageSize: number): Promise<LaneStats> {
  const { rows: [c] } = await pool.query(`SELECT fills_cursor_block AS cursor FROM chains WHERE name = $1`, [chain]);
  let cursor = Number(c.cursor);
  const stats: LaneStats = { pages: 0, rows: 0, cursor, head: 0 };
  for (;;) {
    const { data, block } = await gateway.query<FillsData>(subgraphId, FILLS_QUERY, { after: String(cursor), first: pageSize });
    stats.pages += 1; stats.head = block;
    await store(pool, chain, data.fills);
    stats.rows += data.fills.length;
    const plan = planNextPage(data.fills.map((f) => Number(f.block)), pageSize, cursor);
    if (plan.overflowKey !== undefined) {
      for (let skip = pageSize; ; skip += pageSize) {
        const more = await gateway.query<FillsData>(subgraphId, BLOCK_QUERY, { block: String(plan.overflowKey), first: pageSize, skip });
        stats.pages += 1;
        await store(pool, chain, more.data.fills);
        stats.rows += more.data.fills.length;
        if (more.data.fills.length < pageSize) break;
      }
    }
    cursor = plan.cursor;
    await pool.query(`UPDATE chains SET fills_cursor_block = $2, subgraph_head = $3, updated_at = now() WHERE name = $1`, [chain, cursor, block]);
    stats.cursor = cursor;
    if (plan.done) return stats;
  }
}

async function store(pool: Pool, chain: string, fills: FillRow[]): Promise<void> {
  if (fills.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertRows(client, "fills",
      ["chain", "id", "strategy_id", "registry", "tx", "block", "ts", "taker", "shape", "economic", "leg_count"],
      ["chain", "id"],
      fills.map((f) => [chain, f.id, f.strategy.id, f.registry, f.tx, f.block, f.timestamp, f.taker, f.shape, f.economic, f.legCount]));
    const legs: unknown[][] = [];
    for (const f of fills) for (const l of f.legs) legs.push([chain, l.id, f.id, l.token, l.net, l.pushed, l.pulled]);
    await upsertRows(client, "legs", ["chain", "id", "fill_id", "token", "net", "pushed", "pulled"], ["chain", "id"], legs);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
