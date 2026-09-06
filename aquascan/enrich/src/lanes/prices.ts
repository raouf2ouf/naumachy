import type { Pool } from "../db.js";
import { upsertRows } from "../db.js";
import { batchTargets, Llama, type PriceTarget } from "../llama.js";

export interface PriceLaneStats { targets: number; calls: number; priced: number; missed: number }

const MAX_TRIES = 5;             // after this many misses the hour is a permanent miss
const RETRY_AFTER_HOURS = 24;    // hours older than this become permanent on the first miss

// Every economic fill needs, for each of its leg tokens, a dollar price at the fill hour,
// one hour later and one day later (the markout references). This enumerates the hours
// not yet priced or given up on, fetches them from DefiLlama, and records both outcomes.
export async function syncPrices(pool: Pool, llama: Llama, budgetCalls: number): Promise<PriceLaneStats> {
  const { rows } = await pool.query<PriceTarget & { hour: string }>(`
    WITH need AS (
      SELECT DISTINCT l.chain, l.token, ((f.ts / 3600) * 3600 + h.shift) AS hour
      FROM fills f
      JOIN legs l ON l.chain = f.chain AND l.fill_id = f.id
      CROSS JOIN (VALUES (0), (3600), (86400)) AS h(shift)
      WHERE f.economic
    )
    SELECT n.chain, n.token, n.hour
    FROM need n
    LEFT JOIN prices p ON p.chain = n.chain AND p.token = n.token AND p.hour = n.hour
    LEFT JOIN price_misses m ON m.chain = n.chain AND m.token = n.token AND m.hour = n.hour
    WHERE p.chain IS NULL
      AND (m.chain IS NULL OR (NOT m.permanent AND m.last_try < now() - interval '1 hour'))
      AND n.hour <= extract(epoch FROM now())::bigint
    ORDER BY n.chain, n.token, n.hour
    LIMIT $1`, [budgetCalls * 80]);
  const targets: PriceTarget[] = rows.map((r) => ({ chain: r.chain, token: r.token, hour: Number(r.hour) }));
  const stats: PriceLaneStats = { targets: targets.length, calls: 0, priced: 0, missed: 0 };
  for (const batch of batchTargets(targets)) {
    if (stats.calls >= budgetCalls) break;
    const { points, misses } = await llama.batchHistorical(batch);
    stats.calls += 1;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await upsertRows(client, "prices", ["chain", "token", "hour", "usd", "source", "source_ts", "confidence"], ["chain", "token", "hour"],
        points.map((p) => [p.chain, p.token, p.hour, p.usd, "defillama", p.sourceTs, p.confidence]));
      const meta = new Map<string, { symbol?: string; decimals?: number }>();
      for (const p of points) if (p.decimals !== undefined) meta.set(`${p.chain}:${p.token}`, { symbol: p.symbol, decimals: p.decimals });
      if (meta.size) {
        await client.query(`INSERT INTO tokens (chain, address, symbol, decimals, source) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[])
          ON CONFLICT (chain, address) DO UPDATE SET symbol = COALESCE(tokens.symbol, EXCLUDED.symbol), decimals = COALESCE(tokens.decimals, EXCLUDED.decimals), source = COALESCE(tokens.source, EXCLUDED.source), updated_at = now()`,
          [[...meta.keys()].map((k) => k.split(":")[0]), [...meta.keys()].map((k) => k.split(":")[1]), [...meta.values()].map((m) => m.symbol ?? null), [...meta.values()].map((m) => m.decimals ?? null), [...meta.keys()].map(() => "defillama")]);
      }
      const nowSec = Math.floor(Date.now() / 1000);
      for (const m of misses) {
        const old = nowSec - m.hour > RETRY_AFTER_HOURS * 3600;
        await client.query(`INSERT INTO price_misses (chain, token, hour, tries, permanent) VALUES ($1, $2, $3, 1, $4)
          ON CONFLICT (chain, token, hour) DO UPDATE SET tries = price_misses.tries + 1, last_try = now(),
          permanent = price_misses.permanent OR $4 OR price_misses.tries + 1 >= $5`, [m.chain, m.token, m.hour, old, MAX_TRIES]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    stats.priced += points.length; stats.missed += misses.length;
  }
  return stats;
}
