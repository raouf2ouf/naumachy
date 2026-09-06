import type { Pool } from "./db.js";

// Symbols treated as the numeraire when a strategy touches them. Upper case; matched on token symbol.
export const STABLE_SYMBOLS = [
  "USDC", "USDT", "DAI", "USDS", "USDE", "FRAX", "GHO", "LUSD", "CRVUSD", "PYUSD", "USD1", "USDBC", "USDT0",
  "FDUSD", "TUSD", "USDP", "BUSD", "SUSD", "USDC.E", "USDT.E", "DAI.E", "EURC", "EURE", "EURS", "AGEUR",
];

export interface RollupStats { durationMs: number; fills: number; strategies: number; desks: number }

// Derives fill values, pair marks, strategy and desk stats, and daily stats from the landed
// fills, legs and prices. Runs as one transaction; every table is fully recomputed.
export async function rollup(pool: Pool): Promise<RollupStats> {
  const started = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. fill values: legs valued at the fill hour, plus one hour and one day later
    await client.query(`
      INSERT INTO fill_values (chain, fill_id, strategy_id, ts, hour, legs, priced_legs, priced, volume_usd, edge_usd, markout_1h_usd, markout_24h_usd)
      SELECT v.chain, v.fill_id, v.strategy_id, v.ts, v.hour, v.legs, v.priced_legs, v.legs = v.priced_legs,
             CASE WHEN v.legs = v.priced_legs THEN v.volume_usd END,
             CASE WHEN v.legs = v.priced_legs THEN v.edge_usd END,
             CASE WHEN v.legs = v.priced_legs AND v.legs = v.priced_1h THEN v.markout_1h_usd END,
             CASE WHEN v.legs = v.priced_legs AND v.legs = v.priced_24h THEN v.markout_24h_usd END
      FROM (
        SELECT f.chain, f.id AS fill_id, f.strategy_id, f.ts, (f.ts / 3600) * 3600 AS hour,
               count(*) AS legs,
               count(p0.usd) FILTER (WHERE t.decimals IS NOT NULL) AS priced_legs,
               count(p1.usd) FILTER (WHERE t.decimals IS NOT NULL) AS priced_1h,
               count(p24.usd) FILTER (WHERE t.decimals IS NOT NULL) AS priced_24h,
               sum(CASE WHEN l.net > 0 THEN l.net::float8 / power(10::float8, t.decimals) * p0.usd ELSE 0 END) AS volume_usd,
               sum(l.net::float8 / power(10::float8, t.decimals) * p0.usd) AS edge_usd,
               sum(l.net::float8 / power(10::float8, t.decimals) * (p1.usd - p0.usd)) AS markout_1h_usd,
               sum(l.net::float8 / power(10::float8, t.decimals) * (p24.usd - p0.usd)) AS markout_24h_usd
        FROM fills f
        JOIN legs l ON l.chain = f.chain AND l.fill_id = f.id
        LEFT JOIN tokens t ON t.chain = l.chain AND t.address = l.token
        LEFT JOIN prices p0 ON p0.chain = l.chain AND p0.token = l.token AND p0.hour = (f.ts / 3600) * 3600
        LEFT JOIN prices p1 ON p1.chain = l.chain AND p1.token = l.token AND p1.hour = (f.ts / 3600) * 3600 + 3600
        LEFT JOIN prices p24 ON p24.chain = l.chain AND p24.token = l.token AND p24.hour = (f.ts / 3600) * 3600 + 86400
        WHERE f.economic
        GROUP BY f.chain, f.id, f.strategy_id, f.ts
      ) v
      ON CONFLICT (chain, fill_id) DO UPDATE SET
        legs = EXCLUDED.legs, priced_legs = EXCLUDED.priced_legs, priced = EXCLUDED.priced,
        volume_usd = EXCLUDED.volume_usd, edge_usd = EXCLUDED.edge_usd,
        markout_1h_usd = EXCLUDED.markout_1h_usd, markout_24h_usd = EXCLUDED.markout_24h_usd`);

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
    await client.query(`DELETE FROM strategy_stats`);
    await client.query(`
      INSERT INTO strategy_stats (chain, strategy_id, maker, desk, template, registry, status, fills, first_fill_ts, last_fill_ts,
        volume_usd, edge_usd, markout_1h_usd, markout_24h_usd, priced_fills, priced_ratio, quote_token, pnl_quote, pnl_quote_coverage,
        mark_age_s, pnl_usd_marked, takers, top_taker_share, self_fills)
      SELECT s.chain, s.id, s.maker, s.desk, s.template, s.registry, s.status,
             count(fv.fill_id), min(fv.ts), max(fv.ts),
             sum(fv.volume_usd) FILTER (WHERE fv.priced), sum(fv.edge_usd) FILTER (WHERE fv.priced),
             sum(fv.markout_1h_usd), sum(fv.markout_24h_usd),
             count(*) FILTER (WHERE fv.priced), (count(*) FILTER (WHERE fv.priced))::float4 / count(fv.fill_id)::float4,
             sq.quote_token, p.pnl_quote, ((p.bases_marked + 1)::float4 / (p.bases + 1)::float4),
             CASE WHEN p.oldest_mark_ts IS NOT NULL THEN extract(epoch FROM now())::bigint - p.oldest_mark_ts END,
             p.pnl_usd_marked, coalesce(tk.takers, 0), tk.top_taker_share, coalesce(tk.self_fills, 0)
      FROM strategies s
      JOIN fill_values fv ON fv.chain = s.chain AND fv.strategy_id = s.id
      LEFT JOIN s_quote sq ON sq.chain = s.chain AND sq.strategy_id = s.id
      LEFT JOIN s_pnl p ON p.chain = s.chain AND p.strategy_id = s.id
      LEFT JOIN s_takers tk ON tk.chain = s.chain AND tk.strategy_id = s.id
      GROUP BY s.chain, s.id, s.maker, s.desk, s.template, s.registry, s.status, sq.quote_token,
               p.pnl_quote, p.bases, p.bases_marked, p.oldest_mark_ts, p.pnl_usd_marked, tk.takers, tk.top_taker_share, tk.self_fills`);

    // 5. desk stats: every desk, including desks with no economic fill yet
    await client.query(`DELETE FROM desk_stats`);
    await client.query(`
      INSERT INTO desk_stats (chain, desk, maker, template, strategies, live, fills, volume_usd, edge_usd, markout_1h_usd, markout_24h_usd,
        pnl_usd_marked, priced_ratio, first_seen, last_seen)
      SELECT s.chain, s.desk, s.maker, s.template, count(DISTINCT s.id), count(DISTINCT s.id) FILTER (WHERE s.status = 'LIVE'),
             coalesce(sum(st.fills), 0), sum(st.volume_usd), sum(st.edge_usd), sum(st.markout_1h_usd), sum(st.markout_24h_usd),
             sum(st.pnl_usd_marked),
             CASE WHEN sum(st.fills) > 0 THEN sum(st.priced_fills)::float4 / sum(st.fills)::float4 ELSE 0 END,
             min(s.shipped_at), greatest(max(s.shipped_at), max(st.last_fill_ts), max(s.docked_at))
      FROM strategies s
      LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id
      GROUP BY s.chain, s.desk, s.maker, s.template`);

    // 6. daily stats
    await client.query(`DELETE FROM daily_stats`);
    await client.query(`
      INSERT INTO daily_stats (chain, strategy_id, day, fills, volume_usd, edge_usd, markout_1h_usd)
      SELECT chain, strategy_id, (ts / 86400)::int, count(*), sum(volume_usd) FILTER (WHERE priced), sum(edge_usd) FILTER (WHERE priced), sum(markout_1h_usd)
      FROM fill_values GROUP BY chain, strategy_id, (ts / 86400)::int`);

    const durationMs = Date.now() - started;
    await client.query(`INSERT INTO rollups (name, ran_at, duration_ms) VALUES ('derived', now(), $1)
      ON CONFLICT (name) DO UPDATE SET ran_at = EXCLUDED.ran_at, duration_ms = EXCLUDED.duration_ms`, [durationMs]);
    const { rows: [c] } = await client.query(`SELECT (SELECT count(*) FROM fill_values) AS fills, (SELECT count(*) FROM strategy_stats) AS strategies, (SELECT count(*) FROM desk_stats) AS desks`);
    await client.query("COMMIT");
    return { durationMs, fills: Number(c.fills), strategies: Number(c.strategies), desks: Number(c.desks) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
