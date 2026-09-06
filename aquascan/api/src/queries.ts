import type pg from "pg";
import { priced, windowSeconds, type Priced } from "./provenance.js";

type Pool = pg.Pool;
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"];

// A chain filter is passed as a nullable parameter: `($n::text IS NULL OR chain = $n)`.
function chainParam(chain: string | null): string | null {
  return chain && CHAINS.includes(chain) ? chain : null;
}

async function rollupAt(pool: Pool): Promise<Date> {
  const { rows } = await pool.query(`SELECT ran_at FROM rollups WHERE name = 'derived'`);
  return rows[0]?.ran_at ?? new Date(0);
}

export async function health(pool: Pool) {
  const { rows } = await pool.query(`
    SELECT c.name AS chain, c.fills_cursor_block AS cursor, c.subgraph_head AS head, c.updated_at,
           (SELECT count(*) FROM fills f WHERE f.chain = c.name AND f.economic) AS economic_fills,
           (SELECT count(*) FROM fill_values v WHERE v.chain = c.name) AS valued_fills,
           (SELECT count(*) FILTER (WHERE v.priced) FROM fill_values v WHERE v.chain = c.name) AS priced_fills
    FROM chains c ORDER BY c.name`);
  const at = await rollupAt(pool);
  return {
    rollup_at: at.toISOString(),
    chains: rows.map((r) => ({
      chain: r.chain, cursor: Number(r.cursor), subgraph_head: r.head === null ? null : Number(r.head),
      blocks_behind: r.head === null ? null : Number(r.head) - Number(r.cursor), updated_at: r.updated_at,
      economic_fills: Number(r.economic_fills), priced_ratio: Number(r.valued_fills) ? Number(r.priced_fills) / Number(r.valued_fills) : 0,
    })),
  };
}

// The pulse: one hero claim, a handful of numbers, the top desks in the window, the latest ships.
export async function overview(pool: Pool, window: string | null, chain: string | null) {
  const w = windowSeconds(window); const at = await rollupAt(pool); const c = chainParam(chain);
  const since = w.seconds ? Math.floor(Date.now() / 1000) - w.seconds : 0;
  const { rows: [h] } = await pool.query(`
    SELECT count(*) AS fills, count(DISTINCT strategy_id) AS strategies,
           sum(volume_usd) FILTER (WHERE priced) AS volume, sum(edge_usd) FILTER (WHERE priced) AS edge,
           sum(markout_1h_usd) AS markout_1h, sum(markout_24h_usd) AS markout_24h,
           (count(*) FILTER (WHERE priced))::float4 / greatest(count(*), 1)::float4 AS priced_ratio
    FROM fill_values WHERE ts >= $1 AND ($2::text IS NULL OR chain = $2)`, [since, c]);
  const { rows: top } = await pool.query(`
    SELECT s.chain, s.desk, s.maker, s.template, count(*) AS fills,
           sum(v.volume_usd) FILTER (WHERE v.priced) AS volume, sum(v.edge_usd) FILTER (WHERE v.priced) AS edge,
           sum(v.markout_1h_usd) AS markout_1h,
           (count(*) FILTER (WHERE v.priced))::float4 / count(*)::float4 AS priced_ratio
    FROM fill_values v JOIN strategy_stats s ON s.chain = v.chain AND s.strategy_id = v.strategy_id
    WHERE v.ts >= $1 AND ($2::text IS NULL OR v.chain = $2)
    GROUP BY s.chain, s.desk, s.maker, s.template ORDER BY volume DESC NULLS LAST LIMIT 5`, [since, c]);
  const { rows: ships } = await pool.query(`
    SELECT chain, id, maker, desk, template, registry, shipped_at, shipped_tx, status FROM strategies
    WHERE ($1::text IS NULL OR chain = $1) ORDER BY shipped_at DESC LIMIT 8`, [c]);
  const { rows: [tot] } = await pool.query(`SELECT count(*) AS strategies, count(*) FILTER (WHERE status = 'LIVE') AS live, count(DISTINCT desk) AS desks, count(DISTINCT maker) AS makers FROM strategies WHERE ($1::text IS NULL OR chain = $1)`, [c]);
  return {
    window: w.name, chain: c ?? "all", rollup_at: at.toISOString(),
    hero: {
      economic_fills: Number(h.fills), strategies_active: Number(h.strategies),
      volume_usd: priced(h.volume, h.priced_ratio, at), edge_usd: priced(h.edge, h.priced_ratio, at),
      markout_1h_usd: priced(h.markout_1h, h.priced_ratio, at), markout_24h_usd: priced(h.markout_24h, h.priced_ratio, at),
    },
    totals: { strategies: Number(tot.strategies), live: Number(tot.live), desks: Number(tot.desks), makers: Number(tot.makers) },
    top_desks: top.map((d) => ({ chain: d.chain, desk: d.desk, maker: d.maker, template: d.template, fills: Number(d.fills),
      volume_usd: priced(d.volume, d.priced_ratio, at), edge_usd: priced(d.edge, d.priced_ratio, at), markout_1h_usd: priced(d.markout_1h, d.priced_ratio, at) })),
    latest_ships: ships.map((s) => ({ chain: s.chain, id: s.id, maker: s.maker, desk: s.desk, template: s.template, registry: s.registry, shipped_at: Number(s.shipped_at), shipped_tx: s.shipped_tx, status: s.status })),
  };
}

export async function desks(pool: Pool, chain: string | null, sort: string | null, limit: number, minVolume: number) {
  const at = await rollupAt(pool); const c = chainParam(chain);
  const order: Record<string, string> = { volume: "volume_usd DESC NULLS LAST", edge: "edge_usd DESC NULLS LAST", fills: "fills DESC", markout: "markout_1h_usd ASC NULLS LAST", recent: "last_seen DESC" };
  const by = order[sort ?? "volume"] ?? order.volume;
  const { rows } = await pool.query(`SELECT * FROM desk_stats WHERE coalesce(volume_usd, 0) >= $2 AND ($3::text IS NULL OR chain = $3) ORDER BY ${by} LIMIT $1`, [limit, minVolume, c]);
  return rows.map((d) => deskRow(d, at));
}

function deskRow(d: Record<string, unknown>, at: Date) {
  const pr = d.priced_ratio as number;
  return {
    chain: d.chain, desk: d.desk, maker: d.maker, template: d.template, strategies: Number(d.strategies), live: Number(d.live), fills: Number(d.fills),
    volume_usd: priced(d.volume_usd as number, pr, at), edge_usd: priced(d.edge_usd as number, pr, at),
    markout_1h_usd: priced(d.markout_1h_usd as number, pr, at), markout_24h_usd: priced(d.markout_24h_usd as number, pr, at),
    pnl_usd_marked: priced(d.pnl_usd_marked as number, pr, at),
    first_seen: d.first_seen === null ? null : Number(d.first_seen), last_seen: d.last_seen === null ? null : Number(d.last_seen),
  };
}

export async function desk(pool: Pool, chain: string, id: string) {
  const at = await rollupAt(pool);
  const { rows: [d] } = await pool.query(`SELECT * FROM desk_stats WHERE chain = $1 AND desk = $2`, [chain, id]);
  if (!d) return null;
  const { rows: strategies } = await pool.query(`
    SELECT s.id, s.strategy_hash, s.registry, s.status, s.shipped_at, s.docked_at, st.fills, st.volume_usd, st.edge_usd, st.markout_1h_usd, st.pnl_quote, st.quote_token, st.pnl_quote_coverage, st.priced_ratio, st.takers, st.top_taker_share, st.self_fills
    FROM strategies s LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
    WHERE s.chain = $1 AND s.desk = $2 ORDER BY s.shipped_at DESC`, [chain, id]);
  const { rows: fills } = await pool.query(`
    SELECT f.id, f.tx, f.block, f.ts, f.taker, f.shape, v.volume_usd, v.edge_usd, v.markout_1h_usd, v.priced
    FROM fills f JOIN strategies s ON s.chain = f.chain AND s.id = f.strategy_id
    LEFT JOIN fill_values v ON v.chain = f.chain AND v.fill_id = f.id
    WHERE f.chain = $1 AND s.desk = $2 AND f.economic ORDER BY f.ts DESC LIMIT 50`, [chain, id]);
  return {
    ...deskRow(d, at),
    strategies: strategies.map((s) => ({ id: s.id, strategy_hash: s.strategy_hash, registry: s.registry, status: s.status, shipped_at: Number(s.shipped_at), docked_at: s.docked_at === null ? null : Number(s.docked_at),
      fills: Number(s.fills ?? 0), volume_usd: priced(s.volume_usd, s.priced_ratio, at), edge_usd: priced(s.edge_usd, s.priced_ratio, at), markout_1h_usd: priced(s.markout_1h_usd, s.priced_ratio, at),
      pnl_quote: s.pnl_quote === null ? null : { value: Number(s.pnl_quote), quote_token: s.quote_token, coverage: Number(s.pnl_quote_coverage), source: "own fills, 24h VWAP marks" },
      takers: Number(s.takers ?? 0), top_taker_share: s.top_taker_share === null ? null : Number(s.top_taker_share), self_fills: Number(s.self_fills ?? 0) })),
    recent_fills: fills.map((f) => ({ id: f.id, tx: f.tx, block: Number(f.block), ts: Number(f.ts), taker: f.taker, shape: f.shape,
      volume_usd: priced(f.volume_usd, f.priced ? 1 : 0, at), edge_usd: priced(f.edge_usd, f.priced ? 1 : 0, at), markout_1h_usd: priced(f.markout_1h_usd, f.priced ? 1 : 0, at) })),
  };
}

export async function strategy(pool: Pool, chain: string, id: string) {
  const at = await rollupAt(pool);
  const { rows: [s] } = await pool.query(`
    SELECT s.*, encode(s.program, 'hex') AS program_hex, st.fills, st.first_fill_ts, st.last_fill_ts, st.volume_usd, st.edge_usd, st.markout_1h_usd, st.markout_24h_usd,
           st.priced_ratio, st.quote_token, st.pnl_quote, st.pnl_quote_coverage, st.mark_age_s, st.pnl_usd_marked, st.takers, st.top_taker_share, st.self_fills
    FROM strategies s LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
    WHERE s.chain = $1 AND (s.id = $2 OR s.strategy_hash = $2) LIMIT 1`, [chain, id]);
  if (!s) return null;
  const { rows: marks } = await pool.query(`SELECT m.base_token, m.quote_token, m.vwap_raw, m.fills, m.mark_ts, tb.symbol AS base_symbol, tb.decimals AS base_decimals, tq.symbol AS quote_symbol, tq.decimals AS quote_decimals
    FROM strategy_marks m LEFT JOIN tokens tb ON tb.chain = m.chain AND tb.address = m.base_token LEFT JOIN tokens tq ON tq.chain = m.chain AND tq.address = m.quote_token
    WHERE m.chain = $1 AND m.strategy_id = $2`, [chain, s.id]);
  const { rows: fills } = await pool.query(`
    SELECT f.id, f.tx, f.block, f.ts, f.taker, f.shape, v.volume_usd, v.edge_usd, v.markout_1h_usd, v.priced,
           json_agg(json_build_object('token', l.token, 'symbol', t.symbol, 'decimals', t.decimals, 'net', l.net::text, 'pushed', l.pushed::text, 'pulled', l.pulled::text) ORDER BY l.token) AS legs
    FROM fills f LEFT JOIN fill_values v ON v.chain = f.chain AND v.fill_id = f.id
    JOIN legs l ON l.chain = f.chain AND l.fill_id = f.id LEFT JOIN tokens t ON t.chain = l.chain AND t.address = l.token
    WHERE f.chain = $1 AND f.strategy_id = $2 AND f.economic
    GROUP BY f.id, f.tx, f.block, f.ts, f.taker, f.shape, v.volume_usd, v.edge_usd, v.markout_1h_usd, v.priced
    ORDER BY f.ts DESC LIMIT 100`, [chain, s.id]);
  const { rows: [tq] } = await pool.query(`SELECT symbol, decimals FROM tokens WHERE chain = $1 AND address = $2`, [chain, s.quote_token ?? ""]);
  return {
    chain, id: s.id, strategy_hash: s.strategy_hash, registry: s.registry, maker: s.maker, app: s.app, desk: s.desk, template: s.template,
    program: "0x" + s.program_hex, parsed: s.parsed, tokens: s.tokens, amounts: s.amounts, shipped_at: Number(s.shipped_at), shipped_tx: s.shipped_tx,
    docked_at: s.docked_at === null ? null : Number(s.docked_at), docked_tx: s.docked_tx, status: s.status,
    stats: s.fills === null ? null : {
      fills: Number(s.fills), first_fill_ts: Number(s.first_fill_ts), last_fill_ts: Number(s.last_fill_ts),
      volume_usd: priced(s.volume_usd, s.priced_ratio, at), edge_usd: priced(s.edge_usd, s.priced_ratio, at),
      markout_1h_usd: priced(s.markout_1h_usd, s.priced_ratio, at), markout_24h_usd: priced(s.markout_24h_usd, s.priced_ratio, at),
      pnl_usd_marked: priced(s.pnl_usd_marked, s.priced_ratio, at),
      pnl_quote: s.pnl_quote === null ? null : { value: Number(s.pnl_quote), quote_token: s.quote_token, quote_symbol: tq?.symbol ?? null, coverage: Number(s.pnl_quote_coverage), mark_age_s: s.mark_age_s === null ? null : Number(s.mark_age_s), source: "own fills, 24h VWAP marks" },
      takers: Number(s.takers), top_taker_share: s.top_taker_share === null ? null : Number(s.top_taker_share), self_fills: Number(s.self_fills),
    },
    marks: marks.map((m) => ({ base_token: m.base_token, base_symbol: m.base_symbol, quote_token: m.quote_token, quote_symbol: m.quote_symbol,
      price: m.base_decimals !== null && m.quote_decimals !== null ? Number(m.vwap_raw) * 10 ** (m.base_decimals - m.quote_decimals) : null, vwap_raw: Number(m.vwap_raw), fills: Number(m.fills), mark_ts: Number(m.mark_ts) })),
    fills: fills.map((f) => ({ id: f.id, tx: f.tx, block: Number(f.block), ts: Number(f.ts), taker: f.taker, shape: f.shape, legs: f.legs,
      volume_usd: priced(f.volume_usd, f.priced ? 1 : 0, at), edge_usd: priced(f.edge_usd, f.priced ? 1 : 0, at), markout_1h_usd: priced(f.markout_1h_usd, f.priced ? 1 : 0, at) })),
  };
}

export async function search(pool: Pool, q: string) {
  const term = q.trim().toLowerCase();
  if (term.length < 3) return { makers: [], strategies: [], desks: [] };
  const like = term + "%";
  const { rows: makers } = await pool.query(`SELECT DISTINCT chain, maker FROM strategies WHERE maker LIKE $1 LIMIT 10`, [like]);
  const { rows: strategies } = await pool.query(`SELECT chain, id, strategy_hash, desk, status FROM strategies WHERE strategy_hash LIKE $1 OR id LIKE $1 LIMIT 10`, [like]);
  const { rows: desks } = await pool.query(`SELECT chain, desk, maker, fills FROM desk_stats WHERE desk LIKE $1 LIMIT 10`, [like]);
  return { makers, strategies, desks: desks.map((d) => ({ ...d, fills: Number(d.fills) })) };
}

export type { Priced };
