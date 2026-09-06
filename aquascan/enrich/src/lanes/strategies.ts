import type { Gateway } from "../gateway.js";
import type { Pool } from "../db.js";
import { upsertRows } from "../db.js";
import { planNextPage } from "../paging.js";

interface StrategyRow {
  id: string; registry: string; strategyHash: string;
  maker: { id: string }; app: { id: string }; desk: { id: string }; template: { id: string };
  program: string; parsed: boolean; tokens: string[]; amounts: string[];
  shippedAt: string; shippedTx: string; dockedAt: string | null; dockedTx: string | null; status: string;
}
interface StrategiesData { _meta: { block: { number: string } }; strategies: StrategyRow[] }

const FIELDS = `id registry strategyHash maker { id } app { id } desk { id } template { id }
  program parsed tokens amounts shippedAt shippedTx dockedAt dockedTx status`;

const SHIPS_QUERY = `query Ships($after: BigInt!, $first: Int!, $skip: Int!) {
  _meta { block { number } }
  strategies(first: $first, skip: $skip, orderBy: shippedAt, orderDirection: asc, where: { shippedAt_gt: $after }) { ${FIELDS} }
}`;
const DOCKS_QUERY = `query Docks($after: BigInt!, $first: Int!, $skip: Int!) {
  _meta { block { number } }
  strategies(first: $first, skip: $skip, orderBy: dockedAt, orderDirection: asc, where: { dockedAt_gt: $after }) { ${FIELDS} }
}`;
const KEY_QUERY = (field: "shippedAt" | "dockedAt") => `query Key($key: BigInt!, $first: Int!, $skip: Int!) {
  _meta { block { number } }
  strategies(first: $first, skip: $skip, where: { ${field}: $key }) { ${FIELDS} }
}`;

export interface LaneStats { pages: number; rows: number; cursor: number; head: number }

// Two passes over the same entity: new ships by shippedAt, and docks by dockedAt, because a
// dock changes a strategy whose shippedAt the ships cursor has already passed. A re-shipped
// key gets a new shippedAt and comes back through the ships pass.
export async function syncStrategies(pool: Pool, gateway: Gateway, chain: string, subgraphId: string, pageSize: number): Promise<{ ships: LaneStats; docks: LaneStats }> {
  const ships = await pass(pool, gateway, chain, subgraphId, pageSize, "shippedAt", "ships_cursor_ts", SHIPS_QUERY);
  const docks = await pass(pool, gateway, chain, subgraphId, pageSize, "dockedAt", "docks_cursor_ts", DOCKS_QUERY);
  return { ships, docks };
}

async function pass(pool: Pool, gateway: Gateway, chain: string, subgraphId: string, pageSize: number,
  field: "shippedAt" | "dockedAt", cursorColumn: string, query: string): Promise<LaneStats> {
  const { rows: [c] } = await pool.query(`SELECT ${cursorColumn} AS cursor FROM chains WHERE name = $1`, [chain]);
  let cursor = Number(c.cursor);
  const stats: LaneStats = { pages: 0, rows: 0, cursor, head: 0 };
  for (;;) {
    const { data, block } = await gateway.query<StrategiesData>(subgraphId, query, { after: String(cursor), first: pageSize, skip: 0 });
    stats.pages += 1; stats.head = block;
    const rows = data.strategies;
    await store(pool, chain, rows);
    stats.rows += rows.length;
    const plan = planNextPage(rows.map((r) => Number(r[field])), pageSize, cursor);
    if (plan.overflowKey !== undefined) {
      // more than a page shares one timestamp: read that key with skip paging, then move past it
      for (let skip = pageSize; ; skip += pageSize) {
        const more = await gateway.query<StrategiesData>(subgraphId, KEY_QUERY(field), { key: String(plan.overflowKey), first: pageSize, skip });
        stats.pages += 1;
        await store(pool, chain, more.data.strategies);
        stats.rows += more.data.strategies.length;
        if (more.data.strategies.length < pageSize) break;
      }
    }
    cursor = plan.cursor;
    await pool.query(`UPDATE chains SET ${cursorColumn} = $2, subgraph_head = $3, updated_at = now() WHERE name = $1`, [chain, cursor, block]);
    stats.cursor = cursor;
    if (plan.done) return stats;
  }
}

async function store(pool: Pool, chain: string, rows: StrategyRow[]): Promise<void> {
  if (rows.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertRows(client, "strategies",
      ["chain", "id", "strategy_hash", "registry", "maker", "app", "desk", "template", "program", "parsed", "tokens", "amounts", "shipped_at", "shipped_tx", "docked_at", "docked_tx", "status"],
      ["chain", "id"],
      rows.map((r) => [chain, r.id, r.strategyHash, r.registry, r.maker.id, r.app.id, r.desk.id, r.template.id,
        Buffer.from(r.program.slice(2), "hex"), r.parsed, r.tokens, r.amounts, r.shippedAt, r.shippedTx, r.dockedAt, r.dockedTx, r.status]));
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
