import type pg from "pg";
import { priced, refSource, windowSeconds, type Priced } from "./provenance.js";

type Pool = pg.Pool;
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "robinhood"];
const HOURLY = "defillama hourly";
const FEE_RATE = "program fee rate applied to volume";

// A chain filter is passed as a nullable parameter: `($n::text IS NULL OR chain = $n)`.
function chainParam(chain: string | null): string | null {
  return chain && CHAINS.includes(chain) ? chain : null;
}

export async function rollupAt(pool: Pool): Promise<Date> {
  const { rows } = await pool.query(`SELECT ran_at FROM rollups WHERE name = 'derived'`);
  return rows[0]?.ran_at ?? new Date(0);
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const ratio = (part: unknown, whole: unknown) => (Number(whole) ? Number(part) / Number(whole) : 0);
// The reference behind one fill's numbers.
const fillSource = (f: { ref_kind: string | null; ref_fills: unknown; ref_window_min: unknown }) => {
  const win = Number(f.ref_window_min) === 0 ? "the minute" : `${Number(f.ref_window_min)} min`;
  if (f.ref_kind === "tape") return `venue tape, ${Number(f.ref_fills)} other fills within ${win}`;
  if (f.ref_kind === "pool") return `same-chain pool, ${Number(f.ref_fills)} swaps within ${win}`;
  if (f.ref_kind === "hop") return `venue tape through a hub pool, ${Number(f.ref_fills)} prints within ${win}`;
  return HOURLY;
};

// Volume-weighted markout in bps and its standard error by the delta method, over a set of fills.
const ratioBps = (col: string, alias: string, vol = "volume_usd") => `
  sum(${col}) / nullif(sum(${vol}) FILTER (WHERE ${col} IS NOT NULL), 0) * 1e4 AS ${alias},
  sqrt(greatest(0, sum(${col} * ${col}) - 2 * (sum(${col}) / nullif(sum(${vol}) FILTER (WHERE ${col} IS NOT NULL), 0)) * sum(${col} * ${vol})
    + power(sum(${col}) / nullif(sum(${vol}) FILTER (WHERE ${col} IS NOT NULL), 0), 2) * sum(${vol} * ${vol}) FILTER (WHERE ${col} IS NOT NULL)))
    / nullif(sum(${vol}) FILTER (WHERE ${col} IS NOT NULL), 0) * 1e4 AS ${alias}_se`;
// A rate with its band, in basis points of volume: {bps, se} or null when there is nothing to measure.
export const band = (bps: unknown, se: unknown) => (bps === null || bps === undefined ? null : { bps: Number(bps), se: se === null || se === undefined ? null : Number(se) });

// The scored numbers of one row (desk, strategy, hero), each with its own provenance.
export function scored(r: Record<string, unknown>, pr: number, tape: number, at: Date) {
  const ref = refSource(tape);
  return {
    volume_usd: priced(r.volume_usd as number, pr, at, HOURLY),
    edge_usd: priced(r.edge_usd as number, pr, at, ref),
    markout_5m_usd: priced(r.markout_5m_usd as number, pr, at, "venue tape or same-chain pools, by the minute"),
    markout_1h_usd: priced(r.markout_1h_usd as number, pr, at, ref),
    markout_24h_usd: priced(r.markout_24h_usd as number, pr, at, ref),
    drift_1h_usd: priced(r.drift_1h_usd as number, pr, at, ref),
    drift_24h_usd: priced(r.drift_24h_usd as number, pr, at, ref),
    protocol_fee_usd: priced(r.protocol_fee_usd as number, pr, at, HOURLY),
    maker_fee_usd: priced(r.maker_fee_usd as number, pr, at, FEE_RATE),
    tape_ratio: tape,
    markout_5m_bps: band(r.markout_5m_bps, r.markout_5m_bps_se),
    markout_1h_bps: band(r.markout_1h_bps, r.markout_1h_bps_se),
  };
}

export async function health(pool: Pool) {
  const { rows } = await pool.query(`
    SELECT c.name AS chain, c.fills_cursor_block AS cursor, c.subgraph_head AS head, c.updated_at,
           (SELECT count(*) FROM fills f WHERE f.chain = c.name AND f.economic) AS economic_fills,
           (SELECT count(*) FROM fill_values v WHERE v.chain = c.name) AS valued_fills,
           (SELECT count(*) FILTER (WHERE v.priced) FROM fill_values v WHERE v.chain = c.name) AS priced_fills,
           (SELECT count(*) FILTER (WHERE v.ref_kind = 'tape') FROM fill_values v WHERE v.chain = c.name) AS tape_fills
    FROM chains c ORDER BY c.name`);
  const at = await rollupAt(pool);
  return {
    rollup_at: at.toISOString(),
    chains: rows.map((r) => ({
      chain: r.chain, cursor: Number(r.cursor), subgraph_head: r.head === null ? null : Number(r.head),
      blocks_behind: r.head === null ? null : Number(r.head) - Number(r.cursor), updated_at: r.updated_at,
      economic_fills: Number(r.economic_fills), priced_ratio: ratio(r.priced_fills, r.valued_fills), tape_ratio: ratio(r.tape_fills, r.priced_fills),
    })),
  };
}

// The pulse: one hero claim, a handful of numbers, the fee picture, the top desks in the window, the latest ships.
export async function overview(pool: Pool, window: string | null, chain: string | null) {
  const w = windowSeconds(window); const at = await rollupAt(pool); const c = chainParam(chain);
  const since = w.seconds ? Math.floor(Date.now() / 1000) - w.seconds : 0;
  const { rows: [cnt] } = await pool.query(`SELECT count(*) AS fills, count(DISTINCT strategy_id) AS strategies, count(*) FILTER (WHERE priced) AS priced FROM fill_values WHERE ts >= $1 AND ($2::text IS NULL OR chain = $2)`, [since, c]);
  const { rows: [h] } = await pool.query(`
    SELECT count(*) AS fills, count(DISTINCT strategy_id) AS strategies,
           sum(volume_usd) FILTER (WHERE priced) AS volume_usd, sum(edge_usd) FILTER (WHERE priced) AS edge_usd,
           sum(markout_5m_usd) AS markout_5m_usd, sum(markout_1h_usd) AS markout_1h_usd, sum(markout_24h_usd) AS markout_24h_usd,
           sum(drift_1h_usd) AS drift_1h_usd, sum(drift_24h_usd) AS drift_24h_usd,
           sum(protocol_fee_usd) AS protocol_fee_usd, sum(maker_fee_usd) AS maker_fee_usd,
           (count(*) FILTER (WHERE priced))::float4 / greatest(count(*), 1)::float4 AS priced_ratio,
           (count(*) FILTER (WHERE ref_kind = 'tape'))::float4 / greatest(count(*) FILTER (WHERE priced), 1)::float4 AS tape_ratio,
           ${ratioBps("markout_5m_usd", "markout_5m_bps")}, ${ratioBps("markout_1h_usd", "markout_1h_bps")}
    FROM fill_values WHERE ts >= $1 AND ($2::text IS NULL OR chain = $2) AND priced AND volume_usd > 0`, [since, c]);
  const { rows: tiers } = await pool.query(`
    SELECT sf.maker_fee_bps, sf.maker_fee_kind, count(DISTINCT v.strategy_id) AS strategies, sum(v.volume_usd) AS volume
    FROM fill_values v JOIN strategy_fees sf ON sf.chain = v.chain AND sf.strategy_id = v.strategy_id
    WHERE v.priced AND v.ts >= $1 AND ($2::text IS NULL OR v.chain = $2)
    GROUP BY sf.maker_fee_bps, sf.maker_fee_kind ORDER BY volume DESC NULLS LAST LIMIT 6`, [since, c]);
  const { rows: recipients } = await pool.query(`
    SELECT sf.protocol_fee_to AS recipient, sf.protocol_fee_kind AS kind, min(sf.protocol_fee_bps) AS bps_min, max(sf.protocol_fee_bps) AS bps_max,
           sum(v.protocol_fee_usd) AS fee_usd, sum(v.volume_usd) AS volume
    FROM fill_values v JOIN strategy_fees sf ON sf.chain = v.chain AND sf.strategy_id = v.strategy_id
    WHERE v.priced AND v.ts >= $1 AND ($2::text IS NULL OR v.chain = $2)
    GROUP BY sf.protocol_fee_to, sf.protocol_fee_kind HAVING sum(v.volume_usd) >= 100 ORDER BY fee_usd DESC NULLS LAST LIMIT 4`, [since, c]);
  const { rows: top } = await pool.query(`
    SELECT v.chain, s.maker, lb.label AS maker_label, count(*) AS fills,
           sum(v.volume_usd) FILTER (WHERE v.priced) AS volume_usd, sum(v.edge_usd) FILTER (WHERE v.priced) AS edge_usd,
           sum(v.markout_5m_usd) FILTER (WHERE v.priced) AS markout_5m_usd, sum(v.markout_1h_usd) FILTER (WHERE v.priced) AS markout_1h_usd,
           sum(v.markout_24h_usd) FILTER (WHERE v.priced) AS markout_24h_usd, sum(v.drift_1h_usd) FILTER (WHERE v.priced) AS drift_1h_usd,
           sum(v.drift_24h_usd) FILTER (WHERE v.priced) AS drift_24h_usd,
           sum(v.protocol_fee_usd) FILTER (WHERE v.priced) AS protocol_fee_usd, sum(v.maker_fee_usd) FILTER (WHERE v.priced) AS maker_fee_usd, m.maker_fee_bps,
           (count(*) FILTER (WHERE v.priced))::float4 / count(*)::float4 AS priced_ratio,
           (count(*) FILTER (WHERE v.ref_kind = 'tape'))::float4 / greatest(count(*) FILTER (WHERE v.priced), 1)::float4 AS tape_ratio,
           ${ratioBps("v.markout_5m_usd", "markout_5m_bps", "v.volume_usd")}, ${ratioBps("v.markout_1h_usd", "markout_1h_bps", "v.volume_usd")}
    FROM fill_values v JOIN strategies s ON s.chain = v.chain AND s.id = v.strategy_id
    LEFT JOIN maker_stats m ON m.chain = s.chain AND m.maker = s.maker
    LEFT JOIN labels lb ON (lb.chain = '*' OR lb.chain = s.chain) AND lb.address = s.maker
    WHERE v.ts >= $1 AND ($2::text IS NULL OR v.chain = $2)
    GROUP BY v.chain, s.maker, lb.label, m.maker_fee_bps ORDER BY volume_usd DESC NULLS LAST LIMIT 5`, [since, c]);
  const { rows: ships } = await pool.query(`
    SELECT s.chain, s.id, s.maker, s.desk, s.template, tp.name AS template_name, s.registry, s.shipped_at, s.shipped_tx, s.status FROM strategies s
    LEFT JOIN templates tp ON tp.chain = s.chain AND tp.id = s.template
    WHERE ($1::text IS NULL OR s.chain = $1) ORDER BY s.shipped_at DESC LIMIT 8`, [c]);
  const { rows: [tot] } = await pool.query(`SELECT count(*) AS strategies, count(*) FILTER (WHERE status = 'LIVE') AS live, count(DISTINCT desk) AS desks, count(DISTINCT maker) AS makers FROM strategies WHERE ($1::text IS NULL OR chain = $1)`, [c]);
  const { rows: chains } = await pool.query(`
    SELECT chain, count(*) AS fills, sum(volume_usd) FILTER (WHERE priced) AS volume, sum(edge_usd) FILTER (WHERE priced) AS edge, sum(markout_1h_usd) AS markout_1h,
           (count(*) FILTER (WHERE priced))::float4 / count(*)::float4 AS priced_ratio,
           (count(*) FILTER (WHERE ref_kind = 'tape'))::float4 / greatest(count(*) FILTER (WHERE priced), 1)::float4 AS tape_ratio
    FROM fill_values WHERE ts >= $1 GROUP BY chain ORDER BY volume DESC NULLS LAST`, [since]);
  const feeVolume = tiers.reduce((s, t) => s + Number(t.volume ?? 0), 0);
  const weighted = tiers.filter((t) => t.maker_fee_bps !== null).reduce((s, t) => s + Number(t.maker_fee_bps) * Number(t.volume ?? 0), 0);
  const weightedVolume = tiers.filter((t) => t.maker_fee_bps !== null).reduce((s, t) => s + Number(t.volume ?? 0), 0);
  const topPairs = await makerPairs(pool, top.map((d) => ({ chain: d.chain as string, maker: d.maker as string })));
  const topTemplates = await makerTemplates(pool, top.map((d) => ({ chain: d.chain as string, maker: d.maker as string })));
  return {
    window: w.name, chain: c ?? "all", rollup_at: at.toISOString(),
    hero: { economic_fills: Number(cnt.fills), strategies_active: Number(cnt.strategies), ...scored(h, ratio(cnt.priced, cnt.fills), Number(h.tape_ratio), at) },
    fees: {
      maker_fee_bps: weightedVolume > 0 ? weighted / weightedVolume : null,
      tiers: tiers.map((t) => ({ maker_fee_bps: num(t.maker_fee_bps), kind: t.maker_fee_kind ?? null, strategies: Number(t.strategies), volume_usd: num(t.volume), share: feeVolume > 0 ? Number(t.volume ?? 0) / feeVolume : 0 })),
      protocol: recipients.map((r) => ({ recipient: r.recipient ?? null, kind: r.kind ?? null, bps_min: num(r.bps_min), bps_max: num(r.bps_max), fee_usd: num(r.fee_usd), volume_usd: num(r.volume) })),
    },
    totals: { strategies: Number(tot.strategies), live: Number(tot.live), desks: Number(tot.desks), makers: Number(tot.makers) },
    chains: chains.map((r) => ({ chain: r.chain, fills: Number(r.fills), volume_usd: priced(r.volume, r.priced_ratio, at, HOURLY), edge_usd: priced(r.edge, r.priced_ratio, at, refSource(r.tape_ratio)), markout_1h_usd: priced(r.markout_1h, r.priced_ratio, at, refSource(r.tape_ratio)) })),
    top_makers: top.map((d) => ({ chain: d.chain, maker: d.maker, maker_label: d.maker_label ?? null, fills: Number(d.fills), pairs: topPairs.get(`${d.chain}:${d.maker}`) ?? [], templates: topTemplates.get(`${d.chain}:${d.maker}`) ?? [],
      maker_fee_bps: num(d.maker_fee_bps), ...scored(d, d.priced_ratio, Number(d.tape_ratio), at) })),
    latest_ships: ships.map((s) => ({ chain: s.chain, id: s.id, maker: s.maker, desk: s.desk, template: s.template, template_name: s.template_name ?? null, registry: s.registry, shipped_at: Number(s.shipped_at), shipped_tx: s.shipped_tx, status: s.status })),
  };
}

// Daily series for the window: fills, volume, edge, markouts, fees per day, all chains or one.
export async function series(pool: Pool, window: string | null, chain: string | null) {
  const w = windowSeconds(window); const at = await rollupAt(pool); const c = chainParam(chain);
  const sinceDay = w.seconds ? Math.floor((Date.now() / 1000 - w.seconds) / 86400) : 0;
  const { rows } = await pool.query(`
    SELECT day, sum(fills) AS fills, sum(volume_usd) AS volume, sum(edge_usd) AS edge, sum(markout_5m_usd) AS markout_5m, sum(markout_1h_usd) AS markout_1h,
           sum(drift_1h_usd) AS drift_1h, sum(protocol_fee_usd) AS protocol_fee, sum(maker_fee_usd) AS maker_fee
    FROM daily_stats WHERE day >= $1 AND ($2::text IS NULL OR chain = $2) GROUP BY day ORDER BY day`, [sinceDay, c]);
  return { window: w.name, chain: c ?? "all", rollup_at: at.toISOString(), source: "venue tape or same-chain pools by the minute where the pair has prints, defillama hourly otherwise",
    days: rows.map((r) => ({ day: Number(r.day), date: new Date(Number(r.day) * 86400 * 1000).toISOString().slice(0, 10), fills: Number(r.fills),
      volume_usd: num(r.volume), edge_usd: num(r.edge), markout_5m_usd: num(r.markout_5m), markout_1h_usd: num(r.markout_1h), drift_1h_usd: num(r.drift_1h),
      protocol_fee_usd: num(r.protocol_fee), maker_fee_usd: num(r.maker_fee) })) };
}

const DESK_SORTS: Record<string, string> = {
  volume: "volume_usd DESC NULLS LAST", edge: "edge_usd DESC NULLS LAST", fills: "fills DESC", recent: "last_seen DESC",
  markout: "markout_1h_usd ASC NULLS LAST", adverse: "drift_1h_usd ASC NULLS LAST", fees: "maker_fee_usd DESC NULLS LAST",
};

export async function desks(pool: Pool, chain: string | null, sort: string | null, limit: number, minVolume: number) {
  const at = await rollupAt(pool); const c = chainParam(chain);
  const by = DESK_SORTS[sort ?? "volume"] ?? DESK_SORTS.volume;
  const { rows } = await pool.query(`SELECT d.*, tp.name AS template_name, tp.kind AS template_kind, lb.label AS maker_label FROM desk_stats d
    LEFT JOIN templates tp ON tp.chain = d.chain AND tp.id = d.template
    LEFT JOIN labels lb ON (lb.chain = '*' OR lb.chain = d.chain) AND lb.address = d.maker
    WHERE coalesce(d.volume_usd, 0) >= $2 AND ($3::text IS NULL OR d.chain = $3) ORDER BY ${by} LIMIT $1`, [limit, minVolume, c]);
  const pairs = await deskPairs(pool, rows.map((d) => ({ chain: d.chain as string, desk: d.desk as string })));
  return rows.map((d) => ({ ...deskRow(d, at), pairs: pairs.get(`${d.chain}:${d.desk}`) ?? [] }));
}

export interface DeskPair { base_token: string; quote_token: string; base_symbol: string | null; quote_symbol: string | null; fills: number; share: number }

// The top pairs of each desk in a list, by priced volume, with each pair's share of the desk's priced volume.
export async function deskPairs(pool: Pool, keys: { chain: string; desk: string }[], top = 3): Promise<Map<string, DeskPair[]>> {
  const out = new Map<string, DeskPair[]>();
  if (!keys.length) return out;
  const { rows } = await pool.query(`
    SELECT p.chain, p.desk, p.base_token, p.quote_token, p.fills, p.volume_usd, tb.symbol AS base_symbol, tq.symbol AS quote_symbol
    FROM desk_pairs p
    LEFT JOIN tokens tb ON tb.chain = p.chain AND tb.address = p.base_token
    LEFT JOIN tokens tq ON tq.chain = p.chain AND tq.address = p.quote_token
    WHERE (p.chain || ':' || p.desk) = ANY($1::text[])
    ORDER BY p.volume_usd DESC NULLS LAST, p.fills DESC`, [keys.map((k) => `${k.chain}:${k.desk}`)]);
  const totals = new Map<string, number>();
  for (const r of rows) { const k = `${r.chain}:${r.desk}`; totals.set(k, (totals.get(k) ?? 0) + Number(r.volume_usd ?? 0)); }
  for (const r of rows) {
    const k = `${r.chain}:${r.desk}`; const list = out.get(k) ?? [];
    if (list.length >= top) continue;
    const total = totals.get(k) ?? 0;
    list.push({ base_token: r.base_token, quote_token: r.quote_token, base_symbol: r.base_symbol ?? null, quote_symbol: r.quote_symbol ?? null, fills: Number(r.fills), share: total > 0 ? Number(r.volume_usd ?? 0) / total : 0 });
    out.set(k, list);
  }
  return out;
}

export interface MakerTemplate { template: string; name: string | null; kind: string | null; strategies: number; live: number; volume_usd: number | null; instructions?: string[] | null }

// The templates each maker in a list runs on its chain, largest volume first.
export async function makerTemplates(pool: Pool, keys: { chain: string; maker: string }[]): Promise<Map<string, MakerTemplate[]>> {
  const out = new Map<string, MakerTemplate[]>();
  if (!keys.length) return out;
  const { rows } = await pool.query(`
    SELECT d.chain, d.maker, d.template, tp.name, tp.kind, d.strategies, d.live, d.volume_usd
    FROM desk_stats d LEFT JOIN templates tp ON tp.chain = d.chain AND tp.id = d.template
    WHERE (d.chain || ':' || d.maker) = ANY($1::text[]) ORDER BY d.volume_usd DESC NULLS LAST, d.strategies DESC`, [keys.map((k) => `${k.chain}:${k.maker}`)]);
  for (const r of rows) {
    const k = `${r.chain}:${r.maker}`; const list = out.get(k) ?? [];
    list.push({ template: r.template, name: r.name ?? null, kind: r.kind ?? null, strategies: Number(r.strategies), live: Number(r.live), volume_usd: num(r.volume_usd) });
    out.set(k, list);
  }
  return out;
}

// The top pairs of each maker on its chain, by priced volume, with each pair's share of the maker's priced volume.
export async function makerPairs(pool: Pool, keys: { chain: string; maker: string }[], top = 3): Promise<Map<string, DeskPair[]>> {
  const out = new Map<string, DeskPair[]>();
  if (!keys.length) return out;
  const { rows } = await pool.query(`
    SELECT p.chain, p.maker, p.base_token, p.quote_token, sum(p.fills) AS fills, sum(p.volume_usd) AS volume_usd, tb.symbol AS base_symbol, tq.symbol AS quote_symbol
    FROM desk_pairs p
    LEFT JOIN tokens tb ON tb.chain = p.chain AND tb.address = p.base_token
    LEFT JOIN tokens tq ON tq.chain = p.chain AND tq.address = p.quote_token
    WHERE (p.chain || ':' || p.maker) = ANY($1::text[])
    GROUP BY p.chain, p.maker, p.base_token, p.quote_token, tb.symbol, tq.symbol
    ORDER BY volume_usd DESC NULLS LAST, fills DESC`, [keys.map((k) => `${k.chain}:${k.maker}`)]);
  const totals = new Map<string, number>();
  for (const r of rows) { const k = `${r.chain}:${r.maker}`; totals.set(k, (totals.get(k) ?? 0) + Number(r.volume_usd ?? 0)); }
  for (const r of rows) {
    const k = `${r.chain}:${r.maker}`; const list = out.get(k) ?? [];
    if (list.length >= top) continue;
    const total = totals.get(k) ?? 0;
    list.push({ base_token: r.base_token, quote_token: r.quote_token, base_symbol: r.base_symbol ?? null, quote_symbol: r.quote_symbol ?? null, fills: Number(r.fills), share: total > 0 ? Number(r.volume_usd ?? 0) / total : 0 });
    out.set(k, list);
  }
  return out;
}

function makerRow(m: Record<string, unknown>, at: Date) {
  const pr = m.priced_ratio as number;
  const tape = ratio(m.tape_fills, Number(m.fills) * pr);
  return {
    chain: m.chain, maker: m.maker, maker_label: (m.maker_label as string | null) ?? null,
    templates_count: Number(m.templates), strategies: Number(m.strategies), live: Number(m.live), fills: Number(m.fills),
    ...scored(m, pr, tape, at),
    pnl_usd_marked: priced(m.pnl_usd_marked as number, pr, at, "latest defillama prices"),
    maker_fee_bps: num(m.maker_fee_bps), maker_fee_bps_min: num(m.maker_fee_bps_min), maker_fee_bps_max: num(m.maker_fee_bps_max),
    first_seen: num(m.first_seen), last_seen: num(m.last_seen),
  };
}

// Makers on a chain, the unit of judgement: the wallet that holds the inventory, across every template and strategy it shipped there.
export async function makers(pool: Pool, chain: string | null, sort: string | null, limit: number, minVolume: number) {
  const at = await rollupAt(pool); const c = chainParam(chain);
  const by = (DESK_SORTS[sort ?? "volume"] ?? DESK_SORTS.volume).replace(/\bd\./g, "m.");
  const { rows } = await pool.query(`SELECT m.*, lb.label AS maker_label FROM maker_stats m
    LEFT JOIN labels lb ON (lb.chain = '*' OR lb.chain = m.chain) AND lb.address = m.maker
    WHERE coalesce(m.volume_usd, 0) >= $2 AND ($3::text IS NULL OR m.chain = $3) ORDER BY ${by} LIMIT $1`, [limit, minVolume, c]);
  const keys = rows.map((m) => ({ chain: m.chain as string, maker: m.maker as string }));
  const pairs = await makerPairs(pool, keys); const templates = await makerTemplates(pool, keys);
  return rows.map((m) => ({ ...makerRow(m, at), pairs: pairs.get(`${m.chain}:${m.maker}`) ?? [], templates: templates.get(`${m.chain}:${m.maker}`) ?? [] }));
}

export async function maker(pool: Pool, chain: string, address: string, offset = 0, limit = 50) {
  const at = await rollupAt(pool); const a = address.toLowerCase();
  const { rows: [m] } = await pool.query(`SELECT m.*, lb.label AS maker_label FROM maker_stats m
    LEFT JOIN labels lb ON (lb.chain = '*' OR lb.chain = m.chain) AND lb.address = m.maker
    WHERE m.chain = $1 AND m.maker = $2`, [chain, a]);
  if (!m) return null;
  const key = `${chain}:${a}`;
  const pairs = (await makerPairs(pool, [{ chain, maker: a }], 6)).get(key) ?? [];
  const { rows: tps } = await pool.query(`
    SELECT d.*, tp.name AS template_name, tp.kind AS template_kind, tp.instructions FROM desk_stats d
    LEFT JOIN templates tp ON tp.chain = d.chain AND tp.id = d.template
    WHERE d.chain = $1 AND d.maker = $2 ORDER BY d.volume_usd DESC NULLS LAST, d.strategies DESC`, [chain, a]);
  const { rows: [fees] } = await pool.query(`
    SELECT count(*) FILTER (WHERE sf.decoded) AS decoded, count(*) AS strategies,
           array_agg(DISTINCT sf.maker_fee_kind) FILTER (WHERE sf.maker_fee_kind IS NOT NULL) AS maker_kinds,
           array_agg(DISTINCT sf.maker_fee_side) FILTER (WHERE sf.maker_fee_side IS NOT NULL) AS maker_sides,
           min(sf.protocol_fee_bps) AS protocol_bps_min, max(sf.protocol_fee_bps) AS protocol_bps_max,
           array_agg(DISTINCT sf.protocol_fee_to) FILTER (WHERE sf.protocol_fee_to IS NOT NULL) AS protocol_recipients,
           array_agg(DISTINCT sf.protocol_fee_kind) FILTER (WHERE sf.protocol_fee_kind IS NOT NULL) AS protocol_kinds
    FROM strategies s LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
    WHERE s.chain = $1 AND s.maker = $2`, [chain, a]);
  const { rows: strategies } = await pool.query(`
    SELECT s.id, s.strategy_hash, s.registry, s.status, s.shipped_at, s.docked_at, s.template, tp.name AS template_name, st.fills, st.volume_usd, st.edge_usd, st.markout_5m_usd, st.markout_1h_usd, st.drift_1h_usd,
           st.protocol_fee_usd, st.maker_fee_usd, st.tape_fills, st.priced_fills, sf.maker_fee_bps, sf.protocol_fee_bps,
           st.markout_5m_bps, st.markout_5m_bps_se, st.markout_1h_bps, st.markout_1h_bps_se,
           st.pnl_quote, st.quote_token, tq.symbol AS quote_symbol, st.pnl_quote_coverage, st.priced_ratio, st.takers, st.top_taker_share, st.self_fills
    FROM strategies s LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
    LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
    LEFT JOIN templates tp ON tp.chain = s.chain AND tp.id = s.template
    LEFT JOIN tokens tq ON tq.chain = st.chain AND tq.address = st.quote_token
    WHERE s.chain = $1 AND s.maker = $2 ORDER BY s.shipped_at DESC LIMIT $3 OFFSET $4`, [chain, a, limit, offset]);
  const { rows: fills } = await pool.query(`
    SELECT f.id, f.tx, f.block, f.ts, f.taker, f.shape, v.volume_usd, v.edge_usd, v.markout_5m_usd, v.markout_1h_usd, v.priced, v.ref_kind, v.ref_window_min, v.ref_fills
    FROM fills f JOIN strategies s ON s.chain = f.chain AND s.id = f.strategy_id
    LEFT JOIN fill_values v ON v.chain = f.chain AND v.fill_id = f.id
    WHERE f.chain = $1 AND s.maker = $2 AND f.economic ORDER BY f.ts DESC LIMIT 50`, [chain, a]);
  return {
    ...makerRow(m, at), pairs,
    templates: tps.map((d) => ({ template: d.template, name: (d.template_name as string | null) ?? null, kind: (d.template_kind as string | null) ?? null, instructions: (d.instructions as string[] | null) ?? null,
      strategies: Number(d.strategies), live: Number(d.live), fills: Number(d.fills), ...scored(d, d.priced_ratio, ratio(d.tape_fills, Number(d.fills) * Number(d.priced_ratio)), at), maker_fee_bps: num(d.maker_fee_bps) })),
    strategies_total: Number(m.strategies),
    fees: {
      decoded: Number(fees.decoded), strategies: Number(fees.strategies),
      maker_fee_bps: num(m.maker_fee_bps), maker_fee_bps_min: num(m.maker_fee_bps_min), maker_fee_bps_max: num(m.maker_fee_bps_max),
      maker_kinds: fees.maker_kinds ?? [], maker_sides: fees.maker_sides ?? [],
      protocol_fee_bps_min: num(fees.protocol_bps_min), protocol_fee_bps_max: num(fees.protocol_bps_max),
      protocol_recipients: fees.protocol_recipients ?? [], protocol_kinds: fees.protocol_kinds ?? [],
    },
    strategies: strategies.map((s) => ({ id: s.id, strategy_hash: s.strategy_hash, registry: s.registry, status: s.status, shipped_at: Number(s.shipped_at), docked_at: num(s.docked_at), template: s.template, template_name: (s.template_name as string | null) ?? null,
      fills: Number(s.fills ?? 0), ...scored(s, s.priced_ratio, ratio(s.tape_fills, s.priced_fills), at), maker_fee_bps: num(s.maker_fee_bps), protocol_fee_bps: num(s.protocol_fee_bps),
      pnl_quote: s.pnl_quote === null ? null : { value: Number(s.pnl_quote), quote_token: s.quote_token, quote_symbol: s.quote_symbol ?? null, coverage: Number(s.pnl_quote_coverage), source: "own fills, 24h VWAP marks" },
      takers: Number(s.takers ?? 0), top_taker_share: num(s.top_taker_share), self_fills: Number(s.self_fills ?? 0) })),
    recent_fills: fills.map((f) => fillRow(f, at)),
  };
}

function deskRow(d: Record<string, unknown>, at: Date) {
  const pr = d.priced_ratio as number;
  const tape = ratio(d.tape_fills, Number(d.fills) * pr);
  return {
    chain: d.chain, desk: d.desk, maker: d.maker, maker_label: (d.maker_label as string | null) ?? null, template: d.template, template_name: (d.template_name as string | null) ?? null, template_kind: (d.template_kind as string | null) ?? null,
    strategies: Number(d.strategies), live: Number(d.live), fills: Number(d.fills),
    ...scored(d, pr, tape, at),
    pnl_usd_marked: priced(d.pnl_usd_marked as number, pr, at, "latest defillama prices"),
    maker_fee_bps: num(d.maker_fee_bps), maker_fee_bps_min: num(d.maker_fee_bps_min), maker_fee_bps_max: num(d.maker_fee_bps_max),
    first_seen: num(d.first_seen), last_seen: num(d.last_seen),
  };
}

export async function desk(pool: Pool, chain: string, id: string, offset = 0, limit = 50) {
  const at = await rollupAt(pool);
  const { rows: [d] } = await pool.query(`SELECT d.*, tp.name AS template_name, tp.kind AS template_kind, tp.instructions, lb.label AS maker_label FROM desk_stats d
    LEFT JOIN templates tp ON tp.chain = d.chain AND tp.id = d.template
    LEFT JOIN labels lb ON (lb.chain = '*' OR lb.chain = d.chain) AND lb.address = d.maker
    WHERE d.chain = $1 AND d.desk = $2`, [chain, id]);
  if (!d) return null;
  const pairs = (await deskPairs(pool, [{ chain, desk: id }], 6)).get(`${chain}:${id}`) ?? [];
  const { rows: [fees] } = await pool.query(`
    SELECT count(*) FILTER (WHERE sf.decoded) AS decoded, count(*) AS strategies,
           array_agg(DISTINCT sf.maker_fee_kind) FILTER (WHERE sf.maker_fee_kind IS NOT NULL) AS maker_kinds,
           array_agg(DISTINCT sf.maker_fee_side) FILTER (WHERE sf.maker_fee_side IS NOT NULL) AS maker_sides,
           min(sf.protocol_fee_bps) AS protocol_bps_min, max(sf.protocol_fee_bps) AS protocol_bps_max,
           array_agg(DISTINCT sf.protocol_fee_to) FILTER (WHERE sf.protocol_fee_to IS NOT NULL) AS protocol_recipients,
           array_agg(DISTINCT sf.protocol_fee_kind) FILTER (WHERE sf.protocol_fee_kind IS NOT NULL) AS protocol_kinds
    FROM strategies s LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
    WHERE s.chain = $1 AND s.desk = $2`, [chain, id]);
  const { rows: strategies } = await pool.query(`
    SELECT s.id, s.strategy_hash, s.registry, s.status, s.shipped_at, s.docked_at, st.fills, st.volume_usd, st.edge_usd, st.markout_5m_usd, st.markout_1h_usd, st.drift_1h_usd,
           st.protocol_fee_usd, st.maker_fee_usd, st.tape_fills, st.priced_fills, sf.maker_fee_bps, sf.protocol_fee_bps,
           st.markout_5m_bps, st.markout_5m_bps_se, st.markout_1h_bps, st.markout_1h_bps_se,
           st.pnl_quote, st.quote_token, tq.symbol AS quote_symbol, st.pnl_quote_coverage, st.priced_ratio, st.takers, st.top_taker_share, st.self_fills
    FROM strategies s LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
    LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
    LEFT JOIN tokens tq ON tq.chain = st.chain AND tq.address = st.quote_token
    WHERE s.chain = $1 AND s.desk = $2 ORDER BY s.shipped_at DESC LIMIT $3 OFFSET $4`, [chain, id, limit, offset]);
  const { rows: fills } = await pool.query(`
    SELECT f.id, f.tx, f.block, f.ts, f.taker, f.shape, v.volume_usd, v.edge_usd, v.markout_5m_usd, v.markout_1h_usd, v.priced, v.ref_kind, v.ref_window_min, v.ref_fills
    FROM fills f JOIN strategies s ON s.chain = f.chain AND s.id = f.strategy_id
    LEFT JOIN fill_values v ON v.chain = f.chain AND v.fill_id = f.id
    WHERE f.chain = $1 AND s.desk = $2 AND f.economic ORDER BY f.ts DESC LIMIT 50`, [chain, id]);
  return {
    ...deskRow(d, at), pairs,
    instructions: (d.instructions as string[] | null) ?? null,
    strategies_total: Number(d.strategies),
    fees: {
      decoded: Number(fees.decoded), strategies: Number(fees.strategies),
      maker_fee_bps: num(d.maker_fee_bps), maker_fee_bps_min: num(d.maker_fee_bps_min), maker_fee_bps_max: num(d.maker_fee_bps_max),
      maker_kinds: fees.maker_kinds ?? [], maker_sides: fees.maker_sides ?? [],
      protocol_fee_bps_min: num(fees.protocol_bps_min), protocol_fee_bps_max: num(fees.protocol_bps_max),
      protocol_recipients: fees.protocol_recipients ?? [], protocol_kinds: fees.protocol_kinds ?? [],
    },
    strategies: strategies.map((s) => ({ id: s.id, strategy_hash: s.strategy_hash, registry: s.registry, status: s.status, shipped_at: Number(s.shipped_at), docked_at: num(s.docked_at),
      fills: Number(s.fills ?? 0), ...scored(s, s.priced_ratio, ratio(s.tape_fills, s.priced_fills), at), maker_fee_bps: num(s.maker_fee_bps), protocol_fee_bps: num(s.protocol_fee_bps),
      pnl_quote: s.pnl_quote === null ? null : { value: Number(s.pnl_quote), quote_token: s.quote_token, quote_symbol: s.quote_symbol ?? null, coverage: Number(s.pnl_quote_coverage), source: "own fills, 24h VWAP marks" },
      takers: Number(s.takers ?? 0), top_taker_share: num(s.top_taker_share), self_fills: Number(s.self_fills ?? 0) })),
    recent_fills: fills.map((f) => fillRow(f, at)),
  };
}

function fillRow(f: Record<string, unknown>, at: Date) {
  const pr = f.priced ? 1 : 0; const src = fillSource(f as { ref_kind: string | null; ref_fills: unknown; ref_window_min: unknown });
  return { id: f.id, tx: f.tx, block: Number(f.block), ts: Number(f.ts), taker: f.taker, shape: f.shape, legs: f.legs,
    volume_usd: priced(f.volume_usd as number, pr, at, HOURLY), edge_usd: priced(f.edge_usd as number, pr, at, src),
    markout_5m_usd: priced(f.markout_5m_usd as number, pr, at, src), markout_1h_usd: priced(f.markout_1h_usd as number, pr, at, src),
    drift_1h_usd: priced(f.drift_1h_usd as number, pr, at, src), protocol_fee_usd: priced(f.protocol_fee_usd as number, pr, at, HOURLY),
    ref_kind: (f.ref_kind as string | null) ?? null, ref_window_min: num(f.ref_window_min), ref_fills: num(f.ref_fills) };
}

export async function strategy(pool: Pool, chain: string, id: string, offset = 0, limit = 50) {
  const at = await rollupAt(pool);
  const { rows: [s] } = await pool.query(`
    SELECT s.*, encode(s.program, 'hex') AS program_hex, tp.name AS template_name, tp.kind AS template_kind, tp.instructions, la.label AS app_label, lm.label AS maker_label,
           st.fills, st.first_fill_ts, st.last_fill_ts, st.volume_usd, st.edge_usd, st.markout_5m_usd, st.markout_1h_usd, st.markout_24h_usd, st.drift_1h_usd, st.drift_24h_usd,
           st.protocol_fee_usd, st.maker_fee_usd, st.tape_fills, st.priced_fills,
           st.markout_5m_bps, st.markout_5m_bps_se, st.markout_1h_bps, st.markout_1h_bps_se,
           st.priced_ratio, st.quote_token, st.pnl_quote, st.pnl_quote_coverage, st.mark_age_s, st.pnl_usd_marked, st.takers, st.top_taker_share, st.self_fills,
           sf.maker_fee_bps, sf.maker_fee_side, sf.maker_fee_kind, sf.protocol_fee_bps, sf.protocol_fee_to, sf.protocol_fee_kind, sf.protocol_fee_provider, sf.decoded AS fees_decoded
    FROM strategies s LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
    LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
    LEFT JOIN templates tp ON tp.chain = s.chain AND tp.id = s.template
    LEFT JOIN labels la ON (la.chain = '*' OR la.chain = s.chain) AND la.address = s.app
    LEFT JOIN labels lm ON (lm.chain = '*' OR lm.chain = s.chain) AND lm.address = s.maker
    WHERE s.chain = $1 AND (s.id = $2 OR s.strategy_hash = $2) LIMIT 1`, [chain, id]);
  if (!s) return null;
  const { rows: marks } = await pool.query(`SELECT m.base_token, m.quote_token, m.vwap_raw, m.fills, m.mark_ts, tb.symbol AS base_symbol, tb.decimals AS base_decimals, tq.symbol AS quote_symbol, tq.decimals AS quote_decimals
    FROM strategy_marks m LEFT JOIN tokens tb ON tb.chain = m.chain AND tb.address = m.base_token LEFT JOIN tokens tq ON tq.chain = m.chain AND tq.address = m.quote_token
    WHERE m.chain = $1 AND m.strategy_id = $2`, [chain, s.id]);
  const { rows: fills } = await pool.query(`
    SELECT f.id, f.tx, f.block, f.ts, f.taker, f.shape, v.volume_usd, v.edge_usd, v.markout_5m_usd, v.markout_1h_usd, v.drift_1h_usd, v.protocol_fee_usd, v.priced, v.ref_kind, v.ref_window_min, v.ref_fills,
           json_agg(json_build_object('token', l.token, 'symbol', t.symbol, 'decimals', t.decimals, 'net', l.net::text, 'pushed', l.pushed::text, 'pulled', l.pulled::text) ORDER BY l.token) AS legs
    FROM fills f LEFT JOIN fill_values v ON v.chain = f.chain AND v.fill_id = f.id
    JOIN legs l ON l.chain = f.chain AND l.fill_id = f.id LEFT JOIN tokens t ON t.chain = l.chain AND t.address = l.token
    WHERE f.chain = $1 AND f.strategy_id = $2 AND f.economic
    GROUP BY f.id, f.tx, f.block, f.ts, f.taker, f.shape, v.volume_usd, v.edge_usd, v.markout_5m_usd, v.markout_1h_usd, v.drift_1h_usd, v.protocol_fee_usd, v.priced, v.ref_kind, v.ref_window_min, v.ref_fills
    ORDER BY f.ts DESC LIMIT $3 OFFSET $4`, [chain, s.id, limit, offset]);
  const { rows: [tq] } = await pool.query(`SELECT symbol, decimals FROM tokens WHERE chain = $1 AND address = $2`, [chain, s.quote_token ?? ""]);
  const tape = ratio(s.tape_fills, s.priced_fills);
  return {
    chain, id: s.id, strategy_hash: s.strategy_hash, registry: s.registry, maker: s.maker, maker_label: s.maker_label ?? null, app: s.app, app_label: s.app_label ?? null,
    desk: s.desk, template: s.template, template_name: s.template_name ?? null, template_kind: s.template_kind ?? null, instructions: s.instructions ?? null, fills_total: Number(s.fills ?? 0),
    program: "0x" + s.program_hex, parsed: s.parsed, tokens: s.tokens, amounts: s.amounts, shipped_at: Number(s.shipped_at), shipped_tx: s.shipped_tx,
    docked_at: num(s.docked_at), docked_tx: s.docked_tx, status: s.status,
    fees: s.fees_decoded === null ? null : {
      decoded: Boolean(s.fees_decoded), maker_fee_bps: num(s.maker_fee_bps), maker_fee_side: s.maker_fee_side ?? null, maker_fee_kind: s.maker_fee_kind ?? null,
      protocol_fee_bps: num(s.protocol_fee_bps), protocol_fee_to: s.protocol_fee_to ?? null, protocol_fee_kind: s.protocol_fee_kind ?? null, protocol_fee_provider: s.protocol_fee_provider ?? null,
    },
    stats: s.fills === null ? null : {
      fills: Number(s.fills), first_fill_ts: Number(s.first_fill_ts), last_fill_ts: Number(s.last_fill_ts),
      ...scored(s, s.priced_ratio, tape, at),
      pnl_usd_marked: priced(s.pnl_usd_marked, s.priced_ratio, at, "latest defillama prices"),
      pnl_quote: s.pnl_quote === null ? null : { value: Number(s.pnl_quote), quote_token: s.quote_token, quote_symbol: tq?.symbol ?? null, coverage: Number(s.pnl_quote_coverage), mark_age_s: num(s.mark_age_s), source: "own fills, 24h VWAP marks" },
      takers: Number(s.takers), top_taker_share: num(s.top_taker_share), self_fills: Number(s.self_fills),
    },
    marks: marks.map((m) => ({ base_token: m.base_token, base_symbol: m.base_symbol, quote_token: m.quote_token, quote_symbol: m.quote_symbol,
      price: m.base_decimals !== null && m.quote_decimals !== null ? Number(m.vwap_raw) * 10 ** (m.base_decimals - m.quote_decimals) : null, vwap_raw: Number(m.vwap_raw), fills: Number(m.fills), mark_ts: Number(m.mark_ts) })),
    fills: fills.map((f) => fillRow(f, at)),
  };
}

export async function search(pool: Pool, q: string) {
  const term = q.trim().toLowerCase();
  if (term.length < 3) return { makers: [], strategies: [] };
  const like = term + "%";
  const { rows: makers } = await pool.query(`SELECT chain, maker, fills, strategies, live FROM maker_stats WHERE maker LIKE $1 ORDER BY volume_usd DESC NULLS LAST LIMIT 10`, [like]);
  const { rows: strategies } = await pool.query(`SELECT chain, id, strategy_hash, maker, status FROM strategies WHERE strategy_hash LIKE $1 OR id LIKE $1 LIMIT 10`, [like]);
  return { makers: makers.map((m) => ({ ...m, fills: Number(m.fills), strategies: Number(m.strategies), live: Number(m.live) })), strategies };
}

export type { Priced };
