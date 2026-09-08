import type { Pool } from "./db.js";

// Symbols treated as the numeraire when a strategy touches them. Upper case; matched on token symbol.
export const STABLE_SYMBOLS = [
  "USDC", "USDT", "DAI", "USDS", "USDE", "FRAX", "GHO", "LUSD", "CRVUSD", "PYUSD", "USD1", "USDBC", "USDT0",
  "FDUSD", "TUSD", "USDP", "BUSD", "SUSD", "USDC.E", "USDT.E", "DAI.E", "EURC", "EURE", "EURS", "AGEUR",
];
// Majors that serve as the quote side of a pair when no stable is involved.
export const MAJOR_SYMBOLS = ["WETH", "ETH", "WBTC", "CBBTC", "WSTETH", "STETH", "WEETH", "WBNB", "WMATIC", "WPOL"];

// Tape reference windows in minutes. At fill time the window is centred on the fill minute with the
// given half-width, other makers and other takers only, narrowest window with a print wins. At a
// horizon the window starts at the horizon and runs forward for the given length, other makers only,
// so a later reference never looks back at the fill. A window still open at rollup time yields NULL.
export const REF_WINDOWS = { at: [0, 2, 15], m5: [2, 15], h1: [5, 60], d1: [30, 360] };
// A print too far from its pair's yardstick for the hour (the hourly dollar ratio when both tokens are
// priced, else the pair's own median print) is not a market price and does not enter the reference
// tape; it is still scored itself. The tolerance follows the pair: half a percent between two stables,
// two percent between majors, five otherwise. A reference needs at least two prints and must sit
// within REF_BAND of the fill's own price.
export const PRINT_OUTLIER_BY_RANK = { stable: 0.005, major: 0.02, other: 0.05 };
export const REF_MIN_PRINTS = 2;
export const REF_BAND = 1.4;

export interface RollupStats { durationMs: number; fills: number; tapeFills: number; strategies: number; desks: number }

const scaled = (col: string) => `${col}::float8 / power(10::float8, t.decimals)`;
// A protocol fee pull: the program carries a protocol fee instruction and the fill pulled a sliver
// (under a percent) of what it pushed on the same token. Without the instruction, a pull is a round trip.
const isFeePull = `(sf.protocol_fee_kind IS NOT NULL AND l.pushed > 0 AND l.pulled > 0 AND l.pulled * 100 < l.pushed)`;

// Cumulative print lookups: a leg's running sums at the last minute <= `minute`, on the pair tape
// (Aqua fills, src tape) or on a pool's swaps (src pool), and on the maker's own tape.
const cum = (alias: string, leg: 1 | 2, minute: string) =>
  `LEFT JOIN LATERAL (SELECT pc.cum_a, pc.cum_b, pc.cum_n FROM pair_cum pc
     WHERE pc.chain = tf.chain AND pc.a = tf.l${leg}a AND pc.b = tf.l${leg}b AND pc.src = tf.l${leg}s AND pc.minute <= ${minute}
     ORDER BY pc.minute DESC LIMIT 1) ${alias} ON true`;
const cumOwn = (alias: string, leg: 1 | 2, minute: string) =>
  `LEFT JOIN LATERAL (SELECT pc.cum_a, pc.cum_b, pc.cum_n FROM pair_maker_cum pc
     WHERE tf.l${leg}s = 'tape' AND pc.chain = tf.chain AND pc.a = tf.l${leg}a AND pc.b = tf.l${leg}b AND pc.maker = tf.maker AND pc.minute <= ${minute}
     ORDER BY pc.minute DESC LIMIT 1) ${alias} ON true`;
// Sums over the minutes [from, to] of one leg as a difference of two cumulative lookups, all
// makers, or with the fill's own maker taken out (a no-op on a pool leg, whose prints have no maker).
function span(name: string, leg: 1 | 2, from: string, to: string, ownMaker = false) {
  const hi = `${name}_hi`; const lo = `${name}_lo`; const ohi = `${name}_ohi`; const olo = `${name}_olo`;
  const diff = (col: string, zero: string) => ownMaker
    ? `(coalesce(${hi}.${col}, ${zero}) - coalesce(${lo}.${col}, ${zero}) - coalesce(${ohi}.${col}, ${zero}) + coalesce(${olo}.${col}, ${zero}))`
    : `(coalesce(${hi}.${col}, ${zero}) - coalesce(${lo}.${col}, ${zero}))`;
  return {
    joins: [cum(hi, leg, to), cum(lo, leg, `${from} - 60`), ...(ownMaker ? [cumOwn(ohi, leg, to), cumOwn(olo, leg, `${from} - 60`)] : [])].join("\n"),
    a: diff("cum_a", "0::numeric"), b: diff("cum_b", "0::numeric"), n: diff("cum_n", "0"),
  };
}
// The fill's own side of the tape around fill time: the same maker or the same taker. Tape legs only:
// a pool leg has no prints of the maker, and subtracting tape quantities from pool sums is nonsense.
const own = (name: string, leg: 1 | 2, w: number) =>
  `LEFT JOIN LATERAL (SELECT coalesce(sum(pm.q_a), 0::numeric) AS q_a, coalesce(sum(pm.q_b), 0::numeric) AS q_b, coalesce(sum(pm.n), 0) AS n FROM pair_mt pm
     WHERE tf.l${leg}s = 'tape' AND pm.chain = tf.chain AND pm.a = tf.l${leg}a AND pm.b = tf.l${leg}b AND pm.minute BETWEEN tf.minute - ${w * 60} AND tf.minute + ${w * 60}
       AND (pm.maker = tf.maker OR pm.taker = tf.taker)) ${name} ON true`;

type Sums = { a: string; b: string; n: string };
// A leg's price from its sums, inverted when the route says so; the pair's reference is the
// product of its legs (a direct route has one leg, a hop has two).
const legPrice = (leg: 1 | 2, s: Sums) => `(CASE WHEN tf.l${leg}i THEN ${s.a}::float8 / nullif(${s.b}::float8, 0) ELSE ${s.b}::float8 / nullif(${s.a}::float8, 0) END)`;
const refPrice = (s1: Sums, s2: Sums) => `(${legPrice(1, s1)} * CASE WHEN tf.l2a IS NULL THEN 1 ELSE ${legPrice(2, s2)} END)`;
const refPrints = (s1: Sums, s2: Sums) => `(CASE WHEN tf.l2a IS NULL THEN ${s1.n} ELSE least(${s1.n}, ${s2.n}) END)`;
const usable = (s1: Sums, s2: Sums) => `${refPrints(s1, s2)} >= ${REF_MIN_PRINTS} AND ${refPrice(s1, s2)} BETWEEN tf.pfill / ${REF_BAND} AND tf.pfill * ${REF_BAND}`;

// Builds the reference query: one row per two-sided fill on a routed pair with the reference
// price (quote units per base unit) at fill time and at each horizon, plus the window that produced it.
function tapeQuery(): string {
  const joins: string[] = [];
  const at = REF_WINDOWS.at.map((w) => {
    const t1 = span(`t${w}l1`, 1, `tf.minute - ${w * 60}`, `tf.minute + ${w * 60}`); const t2 = span(`t${w}l2`, 2, `tf.minute - ${w * 60}`, `tf.minute + ${w * 60}`);
    joins.push(t1.joins, t2.joins, own(`o${w}l1`, 1, w), own(`o${w}l2`, 2, w));
    const s1: Sums = { a: `(${t1.a} - o${w}l1.q_a)`, b: `(${t1.b} - o${w}l1.q_b)`, n: `(${t1.n} - o${w}l1.n)` };
    const s2: Sums = { a: `(${t2.a} - o${w}l2.q_a)`, b: `(${t2.b} - o${w}l2.q_b)`, n: `(${t2.n} - o${w}l2.n)` };
    return { w, s1, s2 };
  });
  const pick = (f: (x: typeof at[number]) => string) => `CASE ${at.map((x) => `WHEN ${usable(x.s1, x.s2)} THEN ${f(x)}`).join(" ")} END`;
  const p0 = pick((x) => refPrice(x.s1, x.s2));
  const w0 = pick((x) => `${x.w}`);
  const n0 = pick((x) => `${refPrints(x.s1, x.s2)}::int`);
  const horizon = (name: string, offset: number, lengths: number[]) => {
    const ws = lengths.map((w) => {
      const s1 = span(`${name}${w}l1`, 1, `tf.minute + ${offset}`, `tf.minute + ${offset} + ${w * 60}`, true);
      const s2 = span(`${name}${w}l2`, 2, `tf.minute + ${offset}`, `tf.minute + ${offset} + ${w * 60}`, true);
      joins.push(s1.joins, s2.joins); return { w, s1, s2 };
    });
    // a window still open at rollup time is not a reference yet
    return `CASE ${ws.map((x) => `WHEN tf.minute + ${offset} + ${x.w * 60} <= $1 AND ${usable(x.s1, x.s2)} THEN ${refPrice(x.s1, x.s2)}`).join(" ")} END`;
  };
  const p5 = horizon("m", 300, REF_WINDOWS.m5);
  const p60 = horizon("h", 3600, REF_WINDOWS.h1);
  const p1440 = horizon("d", 86400, REF_WINDOWS.d1);
  return `CREATE TEMP TABLE tv ON COMMIT DROP AS
    SELECT tf.chain, tf.fill_id, tf.kind, tf.net_a::float8 AS net_a, tf.net_b::float8 AS net_b, tf.usd_b,
           ${p0} AS p0, ${w0} AS w0, ${n0} AS n0, ${p5} AS p5, ${p60} AS p60, ${p1440} AS p1440
    FROM tf
    ${joins.join("\n")}`;
}

// Derives fill values, pair marks, strategy and desk stats, and daily stats from the landed
// fills, legs, prices and decoded fees. Runs as one transaction; every table is fully recomputed.
export async function rollup(pool: Pool): Promise<RollupStats> {
  const started = Date.now();
  const nowMinute = Math.floor(Date.now() / 60000) * 60;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1a. hourly valuation of every economic fill: legs at the fill hour, one hour and one day later
    await client.query(`
      CREATE TEMP TABLE hv ON COMMIT DROP AS
      SELECT f.chain, f.id AS fill_id, f.strategy_id, f.ts, (f.ts / 3600) * 3600 AS hour,
             count(*) AS legs,
             count(p0.usd) FILTER (WHERE t.decimals IS NOT NULL) AS priced_legs,
             count(p1.usd) FILTER (WHERE t.decimals IS NOT NULL) AS priced_1h,
             count(p24.usd) FILTER (WHERE t.decimals IS NOT NULL) AS priced_24h,
             sum(CASE WHEN l.net > 0 THEN ${scaled("l.net")} * p0.usd ELSE 0 END) AS volume_usd,
             sum(${scaled("l.net")} * p0.usd) AS edge_usd,
             sum(${scaled("l.net")} * p1.usd) AS markout_1h_usd,
             sum(${scaled("l.net")} * p24.usd) AS markout_24h_usd,
             sum(CASE WHEN ${isFeePull} THEN ${scaled("l.pulled")} * p0.usd ELSE 0 END) AS protocol_fee_usd,
             bool_and(NOT ${isFeePull} OR p0.usd IS NOT NULL) AS fee_priced
      FROM fills f
      JOIN legs l ON l.chain = f.chain AND l.fill_id = f.id
      LEFT JOIN strategy_fees sf ON sf.chain = f.chain AND sf.strategy_id = f.strategy_id
      LEFT JOIN tokens t ON t.chain = l.chain AND t.address = l.token
      LEFT JOIN prices p0 ON p0.chain = l.chain AND p0.token = l.token AND p0.hour = (f.ts / 3600) * 3600
      LEFT JOIN prices p1 ON p1.chain = l.chain AND p1.token = l.token AND p1.hour = (f.ts / 3600) * 3600 + 3600
      LEFT JOIN prices p24 ON p24.chain = l.chain AND p24.token = l.token AND p24.hour = (f.ts / 3600) * 3600 + 86400
      WHERE f.economic
      GROUP BY f.chain, f.id, f.strategy_id, f.ts`);

    // 1b. the pair tape: every two-sided fill as (base a, quote b), the quote being the more
    // money-like side (stable, then major, then the higher address), with the quote's hourly dollar price
    await client.query(`
      CREATE TEMP TABLE tk ON COMMIT DROP AS
      SELECT chain, address, decimals,
             CASE WHEN upper(symbol) = ANY($1::text[]) THEN 0 WHEN upper(symbol) = ANY($2::text[]) THEN 1 ELSE 2 END AS qrank
      FROM tokens WHERE decimals IS NOT NULL`, [STABLE_SYMBOLS, MAJOR_SYMBOLS]);
    await client.query(`
      CREATE TEMP TABLE tf ON COMMIT DROP AS
      SELECT x.*, (-x.net_b / x.net_a)::float8 AS pfill,
             (x.usd_b IS NOT NULL AND abs(x.net_b)::float8 * x.usd_b < 0.5) AS dust,
             coalesce(pr.kind, 'tape') AS kind,
             coalesce(pr.leg1_a, x.a) AS l1a, coalesce(pr.leg1_b, x.b) AS l1b, coalesce(pr.leg1_src, 'tape') AS l1s, coalesce(pr.leg1_inv, false) AS l1i,
             pr.leg2_a AS l2a, pr.leg2_b AS l2b, coalesce(pr.leg2_src, 'tape') AS l2s, coalesce(pr.leg2_inv, false) AS l2i
      FROM (
      SELECT f.chain, f.id AS fill_id, s.maker, f.taker, (f.ts / 60) * 60 AS minute,
             la.token AS a, lb.token AS b,
             la.net / power(10::numeric, ta.decimals) AS net_a,
             lb.net / power(10::numeric, tb.decimals) AS net_b,
             pb.usd AS usd_b
      FROM fills f
      JOIN strategies s ON s.chain = f.chain AND s.id = f.strategy_id
      JOIN legs la ON la.chain = f.chain AND la.fill_id = f.id
      JOIN legs lb ON lb.chain = f.chain AND lb.fill_id = f.id AND lb.token <> la.token
      JOIN tk ta ON ta.chain = f.chain AND ta.address = la.token
      JOIN tk tb ON tb.chain = f.chain AND tb.address = lb.token
      LEFT JOIN prices pb ON pb.chain = f.chain AND pb.token = lb.token AND pb.hour = (f.ts / 3600) * 3600
      WHERE f.economic AND f.shape = 'TWO_SIDED' AND la.net <> 0 AND lb.net <> 0 AND sign(la.net) = -sign(lb.net)
        AND (ta.qrank > tb.qrank OR (ta.qrank = tb.qrank AND la.token < lb.token))
      ) x
      LEFT JOIN pair_routes pr ON pr.chain = x.chain AND pr.a = x.a AND pr.b = x.b`);
    // the yardstick per pair and hour: the hourly dollar ratio when both tokens are priced, else the
    // pair's own median print; the tolerance follows the pair's rank
    const yardstick = (name: string, source: string, priceExpr: string) => `
      CREATE TEMP TABLE ${name} ON COMMIT DROP AS
      SELECT x.chain, x.a, x.b, x.hour,
             coalesce(pa.usd / nullif(pb.usd, 0), x.med) AS yard,
             CASE WHEN ta.qrank = 0 AND tb.qrank = 0 THEN ${PRINT_OUTLIER_BY_RANK.stable} WHEN ta.qrank <= 1 AND tb.qrank <= 1 THEN ${PRINT_OUTLIER_BY_RANK.major} ELSE ${PRINT_OUTLIER_BY_RANK.other} END AS tol
      FROM (SELECT chain, a, b, (ts / 3600) * 3600 AS hour, percentile_cont(0.5) WITHIN GROUP (ORDER BY ${priceExpr}) AS med FROM ${source} GROUP BY chain, a, b, (ts / 3600) * 3600) x
      JOIN tk ta ON ta.chain = x.chain AND ta.address = x.a
      JOIN tk tb ON tb.chain = x.chain AND tb.address = x.b
      LEFT JOIN prices pa ON pa.chain = x.chain AND pa.token = x.a AND pa.hour = x.hour
      LEFT JOIN prices pb ON pb.chain = x.chain AND pb.token = x.b AND pb.hour = x.hour`;
    await client.query(yardstick("pair_yard", "(SELECT chain, a, b, minute AS ts, pfill FROM tf WHERE NOT dust) t", "pfill"));
    await client.query(`
      CREATE TEMP TABLE pair_mt ON COMMIT DROP AS
      SELECT tf.chain, tf.a, tf.b, tf.minute, tf.maker, tf.taker, sum(abs(tf.net_a)) AS q_a, sum(abs(tf.net_b)) AS q_b, count(*) AS n
      FROM tf JOIN pair_yard y ON y.chain = tf.chain AND y.a = tf.a AND y.b = tf.b AND y.hour = (tf.minute / 3600) * 3600
      WHERE NOT tf.dust AND abs(tf.pfill / nullif(y.yard, 0) - 1) <= y.tol
      GROUP BY tf.chain, tf.a, tf.b, tf.minute, tf.maker, tf.taker`);
    await client.query(`CREATE INDEX ON pair_mt (chain, a, b, minute)`);
    // pool prints: every swap of a routed pool, oriented like the tape (amounts come in token units)
    await client.query(`
      CREATE TEMP TABLE pool_swap_px ON COMMIT DROP AS
      SELECT p.chain,
             CASE WHEN t0.qrank > t1.qrank OR (t0.qrank = t1.qrank AND p.token0 < p.token1) THEN p.token0 ELSE p.token1 END AS a,
             CASE WHEN t0.qrank > t1.qrank OR (t0.qrank = t1.qrank AND p.token0 < p.token1) THEN p.token1 ELSE p.token0 END AS b,
             s.ts,
             CASE WHEN t0.qrank > t1.qrank OR (t0.qrank = t1.qrank AND p.token0 < p.token1) THEN abs(s.amount0) ELSE abs(s.amount1) END AS q_a,
             CASE WHEN t0.qrank > t1.qrank OR (t0.qrank = t1.qrank AND p.token0 < p.token1) THEN abs(s.amount1) ELSE abs(s.amount0) END AS q_b
      FROM pool_swaps s
      JOIN pools p ON p.chain = s.chain AND p.id = s.pool
      JOIN tk t0 ON t0.chain = p.chain AND t0.address = p.token0
      JOIN tk t1 ON t1.chain = p.chain AND t1.address = p.token1
      WHERE s.amount0 <> 0 AND s.amount1 <> 0`);
    await client.query(yardstick("pool_yard", "pool_swap_px", "(q_b / q_a)::float8"));
    await client.query(`
      CREATE TEMP TABLE pool_prints ON COMMIT DROP AS
      SELECT x.chain, x.a, x.b, (x.ts / 60) * 60 AS minute, sum(x.q_a) AS q_a, sum(x.q_b) AS q_b, count(*) AS n
      FROM pool_swap_px x JOIN pool_yard y ON y.chain = x.chain AND y.a = x.a AND y.b = x.b AND y.hour = (x.ts / 3600) * 3600
      WHERE abs((x.q_b / x.q_a)::float8 / nullif(y.yard, 0) - 1) <= y.tol
      GROUP BY x.chain, x.a, x.b, (x.ts / 60) * 60`);
    await client.query(`
      CREATE TEMP TABLE pair_cum ON COMMIT DROP AS
      SELECT chain, a, b, src, minute,
             sum(q_a) OVER w AS cum_a, sum(q_b) OVER w AS cum_b, sum(n) OVER w AS cum_n
      FROM (SELECT chain, a, b, 'tape' AS src, minute, sum(q_a) AS q_a, sum(q_b) AS q_b, sum(n) AS n FROM pair_mt GROUP BY 1, 2, 3, 4, 5
            UNION ALL
            SELECT chain, a, b, 'pool' AS src, minute, q_a, q_b, n FROM pool_prints) m
      WINDOW w AS (PARTITION BY chain, a, b, src ORDER BY minute ROWS UNBOUNDED PRECEDING)`);
    await client.query(`CREATE INDEX ON pair_cum (chain, a, b, src, minute)`);
    await client.query(`
      CREATE TEMP TABLE pair_maker_cum ON COMMIT DROP AS
      SELECT chain, a, b, maker, minute,
             sum(q_a) OVER w AS cum_a, sum(q_b) OVER w AS cum_b, sum(n) OVER w AS cum_n
      FROM (SELECT chain, a, b, maker, minute, sum(q_a) AS q_a, sum(q_b) AS q_b, sum(n) AS n FROM pair_mt GROUP BY 1, 2, 3, 4, 5) m
      WINDOW w AS (PARTITION BY chain, a, b, maker ORDER BY minute ROWS UNBOUNDED PRECEDING)`);
    await client.query(`CREATE INDEX ON pair_maker_cum (chain, a, b, maker, minute)`);
    await client.query(`ANALYZE pair_mt; ANALYZE pool_prints; ANALYZE pair_cum; ANALYZE pair_maker_cum; ANALYZE tf`);

    // 1c. tape references per fill
    await client.query(tapeQuery(), [nowMinute]);

    // 1d. fill values: tape numbers when the pair has a reference and a priced quote, hourly numbers otherwise
    await client.query(`
      INSERT INTO fill_values (chain, fill_id, strategy_id, ts, hour, legs, priced_legs, priced, volume_usd, edge_usd,
        markout_5m_usd, markout_1h_usd, markout_24h_usd, drift_1h_usd, drift_24h_usd, ref_kind, ref_window_min, ref_fills, protocol_fee_usd, maker_fee_usd)
      SELECT x.chain, x.fill_id, x.strategy_id, x.ts, x.hour, x.legs, x.priced_legs, x.priced, x.volume_usd, x.edge_usd,
             x.markout_5m_usd, x.markout_1h_usd, x.markout_24h_usd,
             x.markout_1h_usd - x.edge_usd, x.markout_24h_usd - x.edge_usd,
             x.ref_kind, x.ref_window_min, x.ref_fills, x.protocol_fee_usd, x.volume_usd * sf.maker_fee_bps / 1e4
      FROM (
        SELECT hv.chain, hv.fill_id, hv.strategy_id, hv.ts, hv.hour, hv.legs, hv.priced_legs,
               (tape OR hourly) AS priced,
               CASE WHEN tape THEN abs(tv.net_b) * tv.usd_b WHEN hourly THEN hv.volume_usd END AS volume_usd,
               CASE WHEN tape THEN (tv.net_a * tv.p0 + tv.net_b) * tv.usd_b WHEN hourly THEN hv.edge_usd END AS edge_usd,
               CASE WHEN tape THEN (tv.net_a * tv.p5 + tv.net_b) * tv.usd_b END AS markout_5m_usd,
               CASE WHEN tape THEN (tv.net_a * tv.p60 + tv.net_b) * tv.usd_b WHEN hourly AND hv.legs = hv.priced_1h THEN hv.markout_1h_usd END AS markout_1h_usd,
               CASE WHEN tape THEN (tv.net_a * tv.p1440 + tv.net_b) * tv.usd_b WHEN hourly AND hv.legs = hv.priced_24h THEN hv.markout_24h_usd END AS markout_24h_usd,
               CASE WHEN tape THEN tv.kind WHEN hourly THEN 'hourly' END AS ref_kind,
               CASE WHEN tape THEN tv.w0 END AS ref_window_min, CASE WHEN tape THEN tv.n0 END AS ref_fills,
               CASE WHEN hv.fee_priced THEN hv.protocol_fee_usd END AS protocol_fee_usd
        FROM hv
        LEFT JOIN tv ON tv.chain = hv.chain AND tv.fill_id = hv.fill_id,
        LATERAL (SELECT (tv.p0 IS NOT NULL AND tv.usd_b IS NOT NULL AND tv.kind <> 'hourly') AS tape, (hv.legs = hv.priced_legs) AS hourly) k
      ) x
      LEFT JOIN strategy_fees sf ON sf.chain = x.chain AND sf.strategy_id = x.strategy_id
      ON CONFLICT (chain, fill_id) DO UPDATE SET
        legs = EXCLUDED.legs, priced_legs = EXCLUDED.priced_legs, priced = EXCLUDED.priced,
        volume_usd = EXCLUDED.volume_usd, edge_usd = EXCLUDED.edge_usd,
        markout_5m_usd = EXCLUDED.markout_5m_usd, markout_1h_usd = EXCLUDED.markout_1h_usd, markout_24h_usd = EXCLUDED.markout_24h_usd,
        drift_1h_usd = EXCLUDED.drift_1h_usd, drift_24h_usd = EXCLUDED.drift_24h_usd,
        ref_kind = EXCLUDED.ref_kind, ref_window_min = EXCLUDED.ref_window_min, ref_fills = EXCLUDED.ref_fills,
        protocol_fee_usd = EXCLUDED.protocol_fee_usd, maker_fee_usd = EXCLUDED.maker_fee_usd`);

    // 2. numeraire per strategy: a stable if touched (most legs among stables), else the most traded token, tie on address
    await client.query(`
      CREATE TEMP TABLE s_tokens ON COMMIT DROP AS
      SELECT f.chain, f.strategy_id, l.token, count(*) AS legs, t.decimals,
             (t.symbol IS NOT NULL AND upper(t.symbol) = ANY($1::text[])) AS stable
      FROM fills f JOIN legs l ON l.chain = f.chain AND l.fill_id = f.id
      LEFT JOIN tokens t ON t.chain = l.chain AND t.address = l.token
      WHERE f.economic
      GROUP BY f.chain, f.strategy_id, l.token, t.decimals, t.symbol`, [STABLE_SYMBOLS]);
    await client.query(`
      CREATE TEMP TABLE s_quote ON COMMIT DROP AS
      SELECT DISTINCT ON (chain, strategy_id) chain, strategy_id, token AS quote_token, decimals AS quote_decimals
      FROM s_tokens ORDER BY chain, strategy_id, stable DESC, legs DESC, token ASC`);

    // 3. pair marks: 24h VWAP of the strategy's own two-sided fills, per base, anchored at the pair's last fill
    await client.query(`
      CREATE TEMP TABLE pair_fills ON COMMIT DROP AS
      SELECT f.chain, f.strategy_id, f.ts, b.token AS base_token, sq.quote_token,
             abs(b.net) AS b_amt, abs(q.net) AS q_amt
      FROM fills f
      JOIN s_quote sq ON sq.chain = f.chain AND sq.strategy_id = f.strategy_id
      JOIN legs q ON q.chain = f.chain AND q.fill_id = f.id AND q.token = sq.quote_token
      JOIN legs b ON b.chain = f.chain AND b.fill_id = f.id AND b.token <> sq.quote_token
      WHERE f.economic AND f.shape = 'TWO_SIDED' AND b.net <> 0 AND q.net <> 0 AND sign(b.net) = -sign(q.net)`);
    await client.query(`DELETE FROM strategy_marks`);
    await client.query(`
      INSERT INTO strategy_marks (chain, strategy_id, base_token, quote_token, vwap_raw, fills, mark_ts)
      SELECT pf.chain, pf.strategy_id, pf.base_token, pf.quote_token,
             sum(pf.q_amt)::float8 / nullif(sum(pf.b_amt)::float8, 0), count(*), max(pf.ts)
      FROM pair_fills pf
      JOIN (SELECT chain, strategy_id, base_token, max(ts) AS last_ts FROM pair_fills GROUP BY 1, 2, 3) lt
        ON lt.chain = pf.chain AND lt.strategy_id = pf.strategy_id AND lt.base_token = pf.base_token
      WHERE pf.ts >= lt.last_ts - 86400
      GROUP BY pf.chain, pf.strategy_id, pf.base_token, pf.quote_token
      HAVING sum(pf.b_amt) > 0`);

    // 4. strategy stats
    await client.query(`
      CREATE TEMP TABLE s_nets ON COMMIT DROP AS
      SELECT f.chain, f.strategy_id, l.token, sum(l.net) AS net
      FROM fills f JOIN legs l ON l.chain = f.chain AND l.fill_id = f.id
      WHERE f.economic GROUP BY f.chain, f.strategy_id, l.token`);
    await client.query(`
      CREATE TEMP TABLE latest_prices ON COMMIT DROP AS
      SELECT DISTINCT ON (chain, token) chain, token, usd, hour FROM prices ORDER BY chain, token, hour DESC`);
    await client.query(`
      CREATE TEMP TABLE s_pnl ON COMMIT DROP AS
      SELECT n.chain, n.strategy_id,
             sum(CASE WHEN n.token = sq.quote_token THEN n.net::float8
                      WHEN m.vwap_raw IS NOT NULL THEN n.net::float8 * m.vwap_raw END)
               / power(10::float8, coalesce(sq.quote_decimals, 18)) AS pnl_quote,
             count(*) FILTER (WHERE n.token <> sq.quote_token AND n.net <> 0) AS bases,
             count(m.vwap_raw) FILTER (WHERE n.token <> sq.quote_token AND n.net <> 0) AS bases_marked,
             min(m.mark_ts) AS oldest_mark_ts,
             CASE WHEN count(*) = count(lp.usd) FILTER (WHERE t.decimals IS NOT NULL)
                  THEN sum(n.net::float8 / power(10::float8, t.decimals) * lp.usd) END AS pnl_usd_marked
      FROM s_nets n
      JOIN s_quote sq ON sq.chain = n.chain AND sq.strategy_id = n.strategy_id
      LEFT JOIN strategy_marks m ON m.chain = n.chain AND m.strategy_id = n.strategy_id AND m.base_token = n.token
      LEFT JOIN tokens t ON t.chain = n.chain AND t.address = n.token
      LEFT JOIN latest_prices lp ON lp.chain = n.chain AND lp.token = n.token
      GROUP BY n.chain, n.strategy_id, sq.quote_decimals`);
    await client.query(`
      CREATE TEMP TABLE s_takers ON COMMIT DROP AS
      SELECT chain, strategy_id, count(DISTINCT taker) AS takers,
             max(c)::float4 / sum(c)::float4 AS top_taker_share,
             sum(c) FILTER (WHERE is_self) AS self_fills
      FROM (SELECT f.chain, f.strategy_id, f.taker, count(*) AS c, bool_or(f.taker = s.maker) AS is_self
            FROM fills f JOIN strategies s ON s.chain = f.chain AND s.id = f.strategy_id
            WHERE f.economic GROUP BY f.chain, f.strategy_id, f.taker) x
      GROUP BY chain, strategy_id`);
    // precision of the volume-weighted markout, in bps: the ratio sum(markout) / sum(volume) and its
    // standard error by the delta method, sqrt(sum((m - r v)^2)) / sum(v), from the fills' own dispersion
    const ratioStats = (col: string, alias: string) => `
      sum(${col}) / nullif(sum(volume_usd) FILTER (WHERE ${col} IS NOT NULL), 0) * 1e4 AS ${alias},
      sqrt(greatest(0, sum(${col} * ${col}) - 2 * (sum(${col}) / nullif(sum(volume_usd) FILTER (WHERE ${col} IS NOT NULL), 0)) * sum(${col} * volume_usd)
                       + power(sum(${col}) / nullif(sum(volume_usd) FILTER (WHERE ${col} IS NOT NULL), 0), 2) * sum(volume_usd * volume_usd) FILTER (WHERE ${col} IS NOT NULL)))
        / nullif(sum(volume_usd) FILTER (WHERE ${col} IS NOT NULL), 0) * 1e4 AS ${alias}_se`;
    await client.query(`
      CREATE TEMP TABLE s_prec ON COMMIT DROP AS
      SELECT chain, strategy_id, ${ratioStats("markout_5m_usd", "m5")}, ${ratioStats("markout_1h_usd", "m1h")}
      FROM fill_values WHERE priced AND volume_usd > 0 GROUP BY chain, strategy_id`);
    await client.query(`DELETE FROM strategy_stats`);
    await client.query(`
      INSERT INTO strategy_stats (chain, strategy_id, maker, desk, template, registry, status, fills, first_fill_ts, last_fill_ts,
        volume_usd, edge_usd, markout_1h_usd, markout_24h_usd, priced_fills, priced_ratio, quote_token, pnl_quote, pnl_quote_coverage,
        mark_age_s, pnl_usd_marked, takers, top_taker_share, self_fills,
        markout_5m_usd, drift_1h_usd, drift_24h_usd, protocol_fee_usd, maker_fee_usd, tape_fills,
        markout_5m_bps, markout_5m_bps_se, markout_1h_bps, markout_1h_bps_se)
      SELECT s.chain, s.id, s.maker, s.desk, s.template, s.registry, s.status,
             count(fv.fill_id), min(fv.ts), max(fv.ts),
             sum(fv.volume_usd) FILTER (WHERE fv.priced), sum(fv.edge_usd) FILTER (WHERE fv.priced),
             sum(fv.markout_1h_usd), sum(fv.markout_24h_usd),
             count(*) FILTER (WHERE fv.priced), (count(*) FILTER (WHERE fv.priced))::float4 / count(fv.fill_id)::float4,
             sq.quote_token, p.pnl_quote, ((p.bases_marked + 1)::float4 / (p.bases + 1)::float4),
             CASE WHEN p.oldest_mark_ts IS NOT NULL THEN extract(epoch FROM now())::bigint - p.oldest_mark_ts END,
             p.pnl_usd_marked, coalesce(tk.takers, 0), tk.top_taker_share, coalesce(tk.self_fills, 0),
             sum(fv.markout_5m_usd), sum(fv.drift_1h_usd), sum(fv.drift_24h_usd), sum(fv.protocol_fee_usd), sum(fv.maker_fee_usd),
             count(*) FILTER (WHERE fv.ref_kind IN ('tape', 'pool', 'hop')),
             pr.m5, pr.m5_se, pr.m1h, pr.m1h_se
      FROM strategies s
      JOIN fill_values fv ON fv.chain = s.chain AND fv.strategy_id = s.id
      LEFT JOIN s_quote sq ON sq.chain = s.chain AND sq.strategy_id = s.id
      LEFT JOIN s_pnl p ON p.chain = s.chain AND p.strategy_id = s.id
      LEFT JOIN s_takers tk ON tk.chain = s.chain AND tk.strategy_id = s.id
      LEFT JOIN s_prec pr ON pr.chain = s.chain AND pr.strategy_id = s.id
      GROUP BY s.chain, s.id, s.maker, s.desk, s.template, s.registry, s.status, sq.quote_token,
               p.pnl_quote, p.bases, p.bases_marked, p.oldest_mark_ts, p.pnl_usd_marked, tk.takers, tk.top_taker_share, tk.self_fills,
               pr.m5, pr.m5_se, pr.m1h, pr.m1h_se`);

    // 5. desk stats: every desk, including desks with no economic fill yet
    await client.query(`
      CREATE TEMP TABLE d_prec ON COMMIT DROP AS
      SELECT chain, desk, ${ratioStats("markout_5m_usd", "m5")}, ${ratioStats("markout_1h_usd", "m1h")}
      FROM (SELECT fv.*, s.desk FROM fill_values fv JOIN strategies s ON s.chain = fv.chain AND s.id = fv.strategy_id WHERE fv.priced AND fv.volume_usd > 0) x
      GROUP BY chain, desk`);
    await client.query(`DELETE FROM desk_stats`);
    await client.query(`
      INSERT INTO desk_stats (chain, desk, maker, template, strategies, live, fills, volume_usd, edge_usd, markout_1h_usd, markout_24h_usd,
        pnl_usd_marked, priced_ratio, first_seen, last_seen,
        markout_5m_usd, drift_1h_usd, drift_24h_usd, protocol_fee_usd, maker_fee_usd, tape_fills, maker_fee_bps, maker_fee_bps_min, maker_fee_bps_max,
        markout_5m_bps, markout_5m_bps_se, markout_1h_bps, markout_1h_bps_se)
      SELECT s.chain, s.desk, s.maker, s.template, count(DISTINCT s.id), count(DISTINCT s.id) FILTER (WHERE s.status = 'LIVE'),
             coalesce(sum(st.fills), 0), sum(st.volume_usd), sum(st.edge_usd), sum(st.markout_1h_usd), sum(st.markout_24h_usd),
             sum(st.pnl_usd_marked),
             CASE WHEN sum(st.fills) > 0 THEN sum(st.priced_fills)::float4 / sum(st.fills)::float4 ELSE 0 END,
             min(s.shipped_at), greatest(max(s.shipped_at), max(st.last_fill_ts), max(s.docked_at)),
             sum(st.markout_5m_usd), sum(st.drift_1h_usd), sum(st.drift_24h_usd), sum(st.protocol_fee_usd), sum(st.maker_fee_usd),
             coalesce(sum(st.tape_fills), 0),
             CASE WHEN sum(st.volume_usd) FILTER (WHERE sf.maker_fee_bps IS NOT NULL) > 0
                  THEN sum(st.volume_usd * sf.maker_fee_bps) FILTER (WHERE sf.maker_fee_bps IS NOT NULL) / sum(st.volume_usd) FILTER (WHERE sf.maker_fee_bps IS NOT NULL)
                  ELSE min(sf.maker_fee_bps) END,
             min(sf.maker_fee_bps), max(sf.maker_fee_bps),
             dp.m5, dp.m5_se, dp.m1h, dp.m1h_se
      FROM strategies s
      LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
      LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
      LEFT JOIN d_prec dp ON dp.chain = s.chain AND dp.desk = s.desk
      GROUP BY s.chain, s.desk, s.maker, s.template, dp.m5, dp.m5_se, dp.m1h, dp.m1h_se`);

    // 5b. what each desk trades: the pair tape's two-sided fills grouped by desk and pair
    await client.query(`DELETE FROM desk_pairs`);
    await client.query(`
      INSERT INTO desk_pairs (chain, desk, maker, base_token, quote_token, fills, volume_usd)
      SELECT t.chain, s.desk, s.maker, t.a, t.b, count(*), sum(fv.volume_usd) FILTER (WHERE fv.priced)
      FROM tf t
      JOIN fills f ON f.chain = t.chain AND f.id = t.fill_id
      JOIN strategies s ON s.chain = f.chain AND s.id = f.strategy_id
      LEFT JOIN fill_values fv ON fv.chain = t.chain AND fv.fill_id = t.fill_id
      GROUP BY t.chain, s.desk, s.maker, t.a, t.b`);

    // 5c. maker stats: one row per maker and chain, the level where the inventory lives
    await client.query(`
      CREATE TEMP TABLE m_prec ON COMMIT DROP AS
      SELECT chain, maker, ${ratioStats("markout_5m_usd", "m5")}, ${ratioStats("markout_1h_usd", "m1h")}
      FROM (SELECT fv.*, s.maker FROM fill_values fv JOIN strategies s ON s.chain = fv.chain AND s.id = fv.strategy_id WHERE fv.priced AND fv.volume_usd > 0) x
      GROUP BY chain, maker`);
    await client.query(`DELETE FROM maker_stats`);
    await client.query(`
      INSERT INTO maker_stats (chain, maker, templates, strategies, live, fills, volume_usd, edge_usd, markout_1h_usd, markout_24h_usd,
        pnl_usd_marked, priced_ratio, first_seen, last_seen,
        markout_5m_usd, drift_1h_usd, drift_24h_usd, protocol_fee_usd, maker_fee_usd, tape_fills, maker_fee_bps, maker_fee_bps_min, maker_fee_bps_max,
        markout_5m_bps, markout_5m_bps_se, markout_1h_bps, markout_1h_bps_se)
      SELECT s.chain, s.maker, count(DISTINCT s.template), count(DISTINCT s.id), count(DISTINCT s.id) FILTER (WHERE s.status = 'LIVE'),
             coalesce(sum(st.fills), 0), sum(st.volume_usd), sum(st.edge_usd), sum(st.markout_1h_usd), sum(st.markout_24h_usd),
             sum(st.pnl_usd_marked),
             CASE WHEN sum(st.fills) > 0 THEN sum(st.priced_fills)::float4 / sum(st.fills)::float4 ELSE 0 END,
             min(s.shipped_at), greatest(max(s.shipped_at), max(st.last_fill_ts), max(s.docked_at)),
             sum(st.markout_5m_usd), sum(st.drift_1h_usd), sum(st.drift_24h_usd), sum(st.protocol_fee_usd), sum(st.maker_fee_usd),
             coalesce(sum(st.tape_fills), 0),
             CASE WHEN sum(st.volume_usd) FILTER (WHERE sf.maker_fee_bps IS NOT NULL) > 0
                  THEN sum(st.volume_usd * sf.maker_fee_bps) FILTER (WHERE sf.maker_fee_bps IS NOT NULL) / sum(st.volume_usd) FILTER (WHERE sf.maker_fee_bps IS NOT NULL)
                  ELSE min(sf.maker_fee_bps) END,
             min(sf.maker_fee_bps), max(sf.maker_fee_bps),
             mp.m5, mp.m5_se, mp.m1h, mp.m1h_se
      FROM strategies s
      LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
      LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
      LEFT JOIN m_prec mp ON mp.chain = s.chain AND mp.maker = s.maker
      GROUP BY s.chain, s.maker, mp.m5, mp.m5_se, mp.m1h, mp.m1h_se`);

    // 6. daily stats
    await client.query(`DELETE FROM daily_stats`);
    await client.query(`
      INSERT INTO daily_stats (chain, strategy_id, day, fills, volume_usd, edge_usd, markout_1h_usd, markout_5m_usd, drift_1h_usd, protocol_fee_usd, maker_fee_usd)
      SELECT chain, strategy_id, (ts / 86400)::int, count(*), sum(volume_usd) FILTER (WHERE priced), sum(edge_usd) FILTER (WHERE priced),
             sum(markout_1h_usd), sum(markout_5m_usd), sum(drift_1h_usd), sum(protocol_fee_usd), sum(maker_fee_usd)
      FROM fill_values GROUP BY chain, strategy_id, (ts / 86400)::int`);

    const durationMs = Date.now() - started;
    await client.query(`INSERT INTO rollups (name, ran_at, duration_ms) VALUES ('derived', now(), $1)
      ON CONFLICT (name) DO UPDATE SET ran_at = EXCLUDED.ran_at, duration_ms = EXCLUDED.duration_ms`, [durationMs]);
    const { rows: [c] } = await client.query(`SELECT (SELECT count(*) FROM fill_values) AS fills, (SELECT count(*) FROM fill_values WHERE ref_kind IN ('tape', 'pool', 'hop')) AS tape,
      (SELECT count(*) FROM strategy_stats) AS strategies, (SELECT count(*) FROM desk_stats) AS desks`);
    await client.query("COMMIT");
    return { durationMs, fills: Number(c.fills), tapeFills: Number(c.tape), strategies: Number(c.strategies), desks: Number(c.desks) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
