import type { Pool, Client } from "../db.js";
import { decodeInstructions } from "../dialects.js";
import { nameTemplate } from "../naming.js";
import { decodeBytes, deskId, extractProgram, fillId, legId, opcodeSequence, strategyId, templateId } from "../aqua.js";
import { rpcHead, streamAquaBlocks, type AquaBlock, type DockedEvent, type LegEvent, type ShippedEvent } from "../substreams.js";

// The Substreams lane: replays the Aqua registry events of one chain into the same tables the
// subgraph lanes fill (strategies, templates, fills, legs), with the same ids and the same rules
// as subgraphs/aqua/src/mapping.ts. Runs from the saved stream cursor to a lag behind the head.

export const HEAD_LAG_BLOCKS = 1000;   // about two minutes on Robinhood Chain; reorgs never reach that deep
const COMMIT_EVERY_BLOCKS = 200;

// A first read of a chain spans tens of millions of blocks while the provider builds its cache; each
// pass gives the stream this long, commits the cursor, and lets the rest of the loop run.
export interface AquaLaneConfig { chain: string; endpoint: string; token: string; packagePath: string; startBlock: number; rpc: string; budgetSeconds?: number }
export interface AquaLaneStats { blocks: number; shipped: number; docked: number; legs: number; cursor: number; head: number }

export async function syncAqua(pool: Pool, cfg: AquaLaneConfig): Promise<AquaLaneStats> {
  const head = await rpcHead(cfg.rpc);
  const { rows: [c] } = await pool.query(`SELECT substreams_cursor, fills_cursor_block FROM chains WHERE name = $1`, [cfg.chain]);
  const stats: AquaLaneStats = { blocks: 0, shipped: 0, docked: 0, legs: 0, cursor: Number(c.fills_cursor_block), head };
  const stopBlock = head - HEAD_LAG_BLOCKS;
  if (stats.cursor >= stopBlock) return stats;

  const client = await pool.connect();
  const deadline = Date.now() + (cfg.budgetSeconds ?? 600) * 1000;
  let inTx = false;
  let pending = 0;
  let lastCursor: string | null = null;
  const commit = async () => {
    if (!inTx) return;
    await client.query(`UPDATE chains SET substreams_cursor = $2, fills_cursor_block = $3, subgraph_head = $4, updated_at = now() WHERE name = $1`,
      [cfg.chain, lastCursor, stats.cursor, head]);
    await client.query("COMMIT");
    inTx = false; pending = 0;
  };
  try {
    // an async generator cannot be returned while it awaits the network, so the cut goes through an
    // abort: the request is cancelled, the pending next() rejects and is swallowed, and the loop leaves
    const controller = new AbortController();
    const stream = streamAquaBlocks({
      endpoint: cfg.endpoint, token: cfg.token, packagePath: cfg.packagePath,
      startBlock: Math.max(cfg.startBlock, stats.cursor + 1), stopBlock, startCursor: c.substreams_cursor, signal: controller.signal,
    });
    const it = stream[Symbol.asyncIterator]();
    let cut = false;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) { cut = true; break; }
      let timer: NodeJS.Timeout | undefined;
      const nextPromise = it.next();
      const next = await Promise.race([nextPromise, new Promise<"timeout">((r) => { timer = setTimeout(() => r("timeout"), remaining); })]);
      clearTimeout(timer);
      if (next === "timeout") { cut = true; nextPromise.catch(() => {}); controller.abort(); break; }
      if (next.done) break;
      const block = next.value;
      if (!inTx) { await client.query("BEGIN"); inTx = true; }
      const r = new Replayer(client, cfg.chain);
      await r.apply(block);
      stats.blocks += 1; stats.shipped += r.shipped; stats.docked += r.docked; stats.legs += r.legs;
      stats.cursor = block.number; lastCursor = block.cursor;
      if (++pending >= COMMIT_EVERY_BLOCKS) await commit();
    }
    if (!inTx) { await client.query("BEGIN"); inTx = true; }
    // a stream that ran to its stop block read every block up to it, events or not
    if (!cut) stats.cursor = Math.max(stats.cursor, stopBlock - 1);
    await commit();
  } catch (err) {
    if (inTx) await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return stats;
}

type Ordered = { ordinal: number } & ({ kind: "shipped"; e: ShippedEvent } | { kind: "docked"; e: DockedEvent } | { kind: "pushed" | "pulled"; e: LegEvent });

class Replayer {
  shipped = 0; docked = 0; legs = 0;
  constructor(private readonly client: Client, private readonly chain: string) {}

  async apply(block: AquaBlock): Promise<void> {
    const ordered: Ordered[] = [];
    for (const e of block.events.shipped ?? []) ordered.push({ kind: "shipped", e, ordinal: Number(e.at.ordinal ?? 0) });
    for (const e of block.events.docked ?? []) ordered.push({ kind: "docked", e, ordinal: Number(e.at.ordinal ?? 0) });
    for (const e of block.events.pushed ?? []) ordered.push({ kind: "pushed", e, ordinal: Number(e.at.ordinal ?? 0) });
    for (const e of block.events.pulled ?? []) ordered.push({ kind: "pulled", e, ordinal: Number(e.at.ordinal ?? 0) });
    ordered.sort((a, b) => a.ordinal - b.ordinal);
    for (const o of ordered) {
      if (o.kind === "shipped") await this.ship(o.e, block);
      else if (o.kind === "docked") await this.dock(o.e, block);
      else await this.leg(o.e, block, o.kind === "pushed");
    }
  }

  private async ship(e: ShippedEvent, block: AquaBlock): Promise<void> {
    this.shipped += 1;
    const id = strategyId(e.maker, e.app, e.strategyHash);
    const { rows } = await this.client.query(`SELECT status FROM strategies WHERE chain = $1 AND id = $2`, [this.chain, id]);
    if (rows.length) {
      // the same key shipped again: one row, re-armed, live again if it had been docked
      await this.client.query(`UPDATE strategies SET status = 'LIVE', shipped_at = $3, shipped_tx = $4, docked_at = NULL, docked_tx = NULL WHERE chain = $1 AND id = $2`,
        [this.chain, id, block.timestamp, e.at.txHash]);
      return;
    }
    const blob = decodeBytes(e.strategy);
    const program = extractProgram(blob);
    const ops = opcodeSequence(program);
    const tid = templateId(e.app, ops);
    const parsed = ops !== null;
    const instructions = parsed ? decodeInstructions(e.app, ops) : null;
    const named = nameTemplate(instructions, parsed);
    await this.client.query(`
      INSERT INTO templates (chain, id, app, opcodes, instructions, name, kind, strategy_count, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 1, now())
      ON CONFLICT (chain, id) DO UPDATE SET strategy_count = templates.strategy_count + 1, updated_at = now()`,
      [this.chain, tid, e.app, ops ?? [], instructions, named.name, named.kind]);
    await this.client.query(`
      INSERT INTO strategies (chain, id, strategy_hash, registry, maker, app, desk, template, program, parsed, tokens, amounts, shipped_at, shipped_tx, docked_at, docked_tx, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}', '{}', $11, $12, NULL, NULL, 'LIVE')`,
      [this.chain, id, e.strategyHash, e.at.registry, e.maker, e.app, deskId(e.maker, tid, this.chain), tid, Buffer.from(program), parsed, block.timestamp, e.at.txHash]);
  }

  private async dock(e: DockedEvent, block: AquaBlock): Promise<void> {
    this.docked += 1;
    await this.client.query(`UPDATE strategies SET status = 'DOCKED', docked_at = $3, docked_tx = $4 WHERE chain = $1 AND id = $2 AND status <> 'DOCKED'`,
      [this.chain, strategyId(e.maker, e.app, e.strategyHash), block.timestamp, e.at.txHash]);
  }

  // One Pushed or Pulled event is a leg of the fill (tx, strategy); the fill's shape and economic
  // flag are recomputed from its legs after every leg, so the last leg of the transaction settles them.
  private async leg(e: LegEvent, block: AquaBlock, isPush: boolean): Promise<void> {
    this.legs += 1;
    const sid = strategyId(e.maker, e.app, e.strategyHash);
    const { rows } = await this.client.query(`SELECT shipped_tx FROM strategies WHERE chain = $1 AND id = $2`, [this.chain, sid]);
    if (!rows.length) return;
    if (isPush && rows[0].shipped_tx === e.at.txHash) {
      // pushes in the ship transaction are the declared starting inventory, not a fill
      await this.client.query(`UPDATE strategies SET tokens = array_append(tokens, $3), amounts = array_append(amounts, $4::numeric) WHERE chain = $1 AND id = $2`,
        [this.chain, sid, e.token, e.amount]);
      return;
    }
    const fid = fillId(e.at.txHash, sid);
    await this.client.query(`
      INSERT INTO fills (chain, id, strategy_id, registry, tx, block, ts, taker, shape, economic, leg_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 0) ON CONFLICT (chain, id) DO NOTHING`,
      [this.chain, fid, sid, e.at.registry, e.at.txHash, block.number, block.timestamp, e.at.txFrom, isPush ? "PUSH_ONLY" : "PULL_ONLY"]);
    await this.client.query(`
      INSERT INTO legs (chain, id, fill_id, token, net, pushed, pulled) VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric)
      ON CONFLICT (chain, id) DO UPDATE SET pushed = legs.pushed + EXCLUDED.pushed, pulled = legs.pulled + EXCLUDED.pulled, net = legs.net + EXCLUDED.net`,
      [this.chain, legId(fid, e.token), fid, e.token, isPush ? e.amount : `-${e.amount}`, isPush ? e.amount : "0", isPush ? "0" : e.amount]);
    await this.client.query(`
      UPDATE fills f SET leg_count = x.n,
        economic = x.pos > 0 AND x.neg > 0,
        shape = CASE WHEN x.pos > 0 AND x.neg > 0 THEN (CASE WHEN x.n = 2 THEN 'TWO_SIDED' ELSE 'MULTI' END)
                     WHEN x.neg > 0 THEN 'PULL_ONLY' ELSE 'PUSH_ONLY' END
      FROM (SELECT count(*)::int AS n, count(*) FILTER (WHERE net > 0)::int AS pos, count(*) FILTER (WHERE net < 0)::int AS neg
            FROM legs WHERE chain = $1 AND fill_id = $2) x
      WHERE f.chain = $1 AND f.id = $2`, [this.chain, fid]);
  }
}
