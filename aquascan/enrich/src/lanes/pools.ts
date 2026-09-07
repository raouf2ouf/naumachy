import type { Gateway } from "../gateway.js";
import type { Pool } from "../db.js";
import { upsertRows } from "../db.js";
import type { DexConfig } from "../config.js";
import { planNextPage } from "../paging.js";
import { MAJOR_SYMBOLS, STABLE_SYMBOLS } from "../rollup.js";
import { bestPool, chooseRoute, orient, type PoolCandidate } from "../routes.js";

interface SubToken { id: string; symbol: string; decimals: string }
interface SubPool { id: string; feeTier: string; token0: SubToken; token1: SubToken; poolDayData: { date: string; txCount: string; volumeUSD: string }[] }
interface PoolsData { _meta: { block: { number: string } }; a: SubPool[]; b: SubPool[] }
interface SwapRow { id: string; timestamp: string; amount0: string; amount1: string }
interface SwapsData { _meta: { block: { number: string } }; swaps: SwapRow[] }

const POOLS_QUERY = `query Pools($x: String!, $y: String!, $since: Int!) {
  _meta { block { number } }
  a: pools(where: { token0: $x, token1: $y }, first: 10) { id feeTier token0 { id symbol decimals } token1 { id symbol decimals } poolDayData(first: 40, orderBy: date, orderDirection: desc, where: { date_gte: $since }) { date txCount volumeUSD } }
  b: pools(where: { token0: $y, token1: $x }, first: 10) { id feeTier token0 { id symbol decimals } token1 { id symbol decimals } poolDayData(first: 40, orderBy: date, orderDirection: desc, where: { date_gte: $since }) { date txCount volumeUSD } }
}`;
const SWAPS_QUERY = `query Swaps($pool: String!, $after: BigInt!, $first: Int!) {
  _meta { block { number } }
  swaps(first: $first, orderBy: timestamp, orderDirection: asc, where: { pool: $pool, timestamp_gt: $after }) { id timestamp amount0 amount1 }
}`;
const SWAPS_AT_QUERY = `query SwapsAt($pool: String!, $at: BigInt!, $first: Int!, $skip: Int!) {
  _meta { block { number } }
  swaps(first: $first, skip: $skip, where: { pool: $pool, timestamp: $at }) { id timestamp amount0 amount1 }
}`;

const DAY = 86400;
const ROUTE_TTL_S = 24 * 3600;             // routes are re-decided daily
const PAGES_PER_POOL_PER_PASS = 60;        // a deep pool backfills over a few passes
const BACKFILL_DAYS = 32;

export interface PoolsStats { routed: number; pools: number; swaps: number; calls: number }

// Decides routes for every pair of the last 30 days on chains that have a DEX subgraph, then
// pages the swaps of every routed pool. Routes older than a day are decided again.
export async function syncPools(pool: Pool, gateway: Gateway, dexes: DexConfig[], pageSize: number): Promise<PoolsStats> {
  const stats: PoolsStats = { routed: 0, pools: 0, swaps: 0, calls: 0 };
  for (const dex of dexes) {
    const { rows: [fresh] } = await pool.query(`SELECT count(*) AS n FROM pair_routes WHERE chain = $1 AND decided_at > now() - interval '1 second' * $2`, [dex.chain, ROUTE_TTL_S]);
    if (Number(fresh.n) === 0) stats.routed += await routePairs(pool, gateway, dex, stats);
    const { rows: pools } = await pool.query(`
      SELECT p.id, p.cursor_ts FROM pools p
      JOIN (SELECT pool, max(volume_30d_usd) AS served FROM pair_routes WHERE chain = $1 AND pool IS NOT NULL GROUP BY pool) r ON r.pool = p.id
      WHERE p.chain = $1 ORDER BY r.served DESC`, [dex.chain]);
    for (const p of pools) {
      stats.pools += 1;
      try {
        stats.swaps += await syncSwaps(pool, gateway, dex, p.id, Number(p.cursor_ts), pageSize, stats);
      } catch (err) {
        // one pool's indexer trouble must not stop the others; its cursor resumes next pass
        console.log(new Date().toISOString(), `pools: ${dex.chain} ${p.id} ${String(err).slice(0, 160)}`);
      }
    }
  }
  return stats;
}

// Every pair of the last 30 days with at least $1K of priced volume, its own print density, and
// the density of every pair on the chain (hops look up pairs the routed pair is not part of).
async function routePairs(pool: Pool, gateway: Gateway, dex: DexConfig, stats: PoolsStats): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - 30 * DAY;
  const { rows: tokens } = await pool.query(`SELECT address, symbol FROM tokens WHERE chain = $1 AND decimals IS NOT NULL`, [dex.chain]);
  const rank = new Map<string, number>();
  for (const t of tokens) {
    const sym = (t.symbol ?? "").toUpperCase();
    rank.set(t.address, STABLE_SYMBOLS.includes(sym) ? 0 : MAJOR_SYMBOLS.includes(sym) ? 1 : 2);
  }
  const rankOf = (t: string) => rank.get(t) ?? 2;
  const { rows: pairs } = await pool.query(`
    WITH p AS (
      SELECT l.chain, l.fill_id, array_agg(l.token ORDER BY l.token) AS toks
      FROM legs l JOIN fills f ON f.chain = l.chain AND f.id = l.fill_id
      WHERE l.chain = $1 AND f.economic AND f.shape = 'TWO_SIDED' AND f.ts >= $2 AND l.net <> 0
      GROUP BY l.chain, l.fill_id HAVING count(*) = 2)
    SELECT p.toks[1] AS x, p.toks[2] AS y, count(*) AS fills, coalesce(sum(fv.volume_usd) FILTER (WHERE fv.priced), 0) AS volume
    FROM p LEFT JOIN fill_values fv ON fv.chain = p.chain AND fv.fill_id = p.fill_id
    GROUP BY p.toks[1], p.toks[2]`, [dex.chain, since]);
  const density = new Map<string, number>();
  for (const r of pairs) {
    const o = orient(r.x, rankOf(r.x), r.y, rankOf(r.y));
    density.set(`${o.a}|${o.b}`, Number(r.fills) / (30 * 24));
  }
  const tapePerHour = (x: string, y: string) => density.get(`${x}|${y}`) ?? 0;
  const poolCache = new Map<string, PoolCandidate | null>();
  const poolMeta = new Map<string, SubPool>();
  const lookup = async (x: string, y: string): Promise<PoolCandidate | null> => {
    const key = x < y ? `${x}|${y}` : `${y}|${x}`;
    if (poolCache.has(key)) return poolCache.get(key)!;
    const { data } = await gateway.query<PoolsData>(dex.subgraphId, POOLS_QUERY, { x, y, since });
    stats.calls += 1;
    const candidates: PoolCandidate[] = [...data.a, ...data.b].map((sp) => {
      poolMeta.set(sp.id, sp);
      return { id: sp.id, token0: sp.token0.id, token1: sp.token1.id, feeTier: Number(sp.feeTier),
        swaps30d: sp.poolDayData.reduce((s, d) => s + Number(d.txCount), 0), volume30dUsd: sp.poolDayData.reduce((s, d) => s + Number(d.volumeUSD), 0) };
    });
    const best = bestPool(candidates);
    poolCache.set(key, best);
    return best;
  };
  const hubs = Object.values(dex.hubs);
  const routes: unknown[][] = []; const chosenPools = new Set<string>();
  for (const r of pairs) {
    if (Number(r.volume) < 1000) continue;
    const o = orient(r.x, rankOf(r.x), r.y, rankOf(r.y));
    const dense = tapePerHour(o.a, o.b);
    let route = chooseRoute(o.a, o.b, rankOf, tapePerHour, null, [], () => null);
    if (route.kind !== "tape") {
      const direct = await lookup(o.a, o.b);
      const hubPools = new Map<string, PoolCandidate | null>();
      for (const h of hubs) {
        if (h === o.a || h === o.b) continue;
        hubPools.set(`${h}|${o.b}`, await lookup(h, o.b));
        hubPools.set(`${h}|${o.a}`, await lookup(h, o.a));
      }
      route = chooseRoute(o.a, o.b, rankOf, tapePerHour, direct, hubs, (h, other) => hubPools.get(`${h}|${other}`) ?? null);
    }
    if (route.pool) chosenPools.add(route.pool);
    routes.push([dex.chain, o.a, o.b, route.kind, dense, Number(r.volume),
      route.leg1?.a ?? null, route.leg1?.b ?? null, route.leg1?.src ?? null, route.leg1?.inv ?? null,
      route.leg2?.a ?? null, route.leg2?.b ?? null, route.leg2?.src ?? null, route.leg2?.inv ?? null,
      route.pool ?? null, route.hub ?? null, new Date()]);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await upsertRows(client, "pair_routes", ["chain", "a", "b", "kind", "tape_per_hour", "volume_30d_usd", "leg1_a", "leg1_b", "leg1_src", "leg1_inv", "leg2_a", "leg2_b", "leg2_src", "leg2_inv", "pool", "hub", "decided_at"], ["chain", "a", "b"], routes);
    const poolRows: unknown[][] = []; const tokenRows: unknown[][] = [];
    for (const id of chosenPools) {
      const sp = poolMeta.get(id)!;
      poolRows.push([dex.chain, id, dex.protocol, dex.subgraphId, sp.token0.id, sp.token1.id, Number(sp.feeTier),
        sp.poolDayData.reduce((s, d) => s + Number(d.txCount), 0), sp.poolDayData.reduce((s, d) => s + Number(d.volumeUSD), 0), new Date()]);
      for (const t of [sp.token0, sp.token1]) tokenRows.push([dex.chain, t.id, t.symbol, Number(t.decimals), "dex subgraph"]);
    }
    await upsertRows(client, "pools", ["chain", "id", "protocol", "subgraph", "token0", "token1", "fee_tier", "swaps_30d", "volume_30d_usd", "updated_at"], ["chain", "id"], poolRows);
    // pool tokens the price lane has not met yet: symbol and decimals from the DEX subgraph
    for (const t of tokenRows) {
      await client.query(`INSERT INTO tokens (chain, address, symbol, decimals, source) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (chain, address) DO UPDATE SET decimals = coalesce(tokens.decimals, EXCLUDED.decimals), symbol = coalesce(tokens.symbol, EXCLUDED.symbol)`, t);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return routes.length;
}

// Pages one pool's swaps from its cursor (or 32 days back), a bounded number of pages per pass.
async function syncSwaps(pool: Pool, gateway: Gateway, dex: DexConfig, id: string, cursorTs: number, pageSize: number, stats: PoolsStats): Promise<number> {
  let cursor = cursorTs || Math.floor(Date.now() / 1000) - BACKFILL_DAYS * DAY;
  let rows = 0;
  for (let page = 0; page < PAGES_PER_POOL_PER_PASS; page += 1) {
    const { data } = await gateway.query<SwapsData>(dex.subgraphId, SWAPS_QUERY, { pool: id, after: String(cursor), first: pageSize });
    stats.calls += 1;
    await storeSwaps(pool, dex.chain, id, data.swaps);
    rows += data.swaps.length;
    const plan = planNextPage(data.swaps.map((s) => Number(s.timestamp)), pageSize, cursor);
    if (plan.overflowKey !== undefined) {
      for (let skip = pageSize; ; skip += pageSize) {
        const more = await gateway.query<SwapsData>(dex.subgraphId, SWAPS_AT_QUERY, { pool: id, at: String(plan.overflowKey), first: pageSize, skip });
        stats.calls += 1;
        await storeSwaps(pool, dex.chain, id, more.data.swaps);
        rows += more.data.swaps.length;
        if (more.data.swaps.length < pageSize) break;
      }
    }
    cursor = plan.cursor;
    await pool.query(`UPDATE pools SET cursor_ts = $3, swaps_loaded = swaps_loaded + $4, updated_at = now() WHERE chain = $1 AND id = $2`, [dex.chain, id, cursor, data.swaps.length]);
    if (plan.done) break;
  }
  return rows;
}

async function storeSwaps(pool: Pool, chain: string, id: string, swaps: SwapRow[]): Promise<void> {
  if (swaps.length === 0) return;
  const client = await pool.connect();
  try {
    await upsertRows(client, "pool_swaps", ["chain", "id", "pool", "ts", "amount0", "amount1"], ["chain", "id"],
      swaps.map((s) => [chain, s.id, id, Number(s.timestamp), s.amount0, s.amount1]));
  } finally {
    client.release();
  }
}
