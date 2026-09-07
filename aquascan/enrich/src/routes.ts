// Choosing how a pair is priced. Pure decisions, so they can be tested without a database.

export const TAPE_MIN_PER_HOUR = 10;      // a pair's own prints per hour that make its tape the reference
export const POOL_MIN_SWAPS_30D = 120;    // the least a pool may trade in 30 days to serve as a reference

export interface PoolCandidate { id: string; token0: string; token1: string; swaps30d: number; volume30dUsd: number; feeTier: number | null }
export interface Leg { a: string; b: string; src: "tape" | "pool"; inv: boolean }
export interface Route { kind: "tape" | "pool" | "hop" | "hourly"; leg1?: Leg; leg2?: Leg; pool?: string; hub?: string }

// The rollup orients a pair as (base a, quote b) by a rank: stables first, then majors, then the
// higher address. `orient` returns the pair in that orientation with a flag when the input was flipped.
export function orient(x: string, rankX: number, y: string, rankY: number): { a: string; b: string; flipped: boolean } {
  const xIsA = rankX > rankY || (rankX === rankY && x < y);
  return xIsA ? { a: x, b: y, flipped: false } : { a: y, b: x, flipped: true };
}

export function bestPool(candidates: PoolCandidate[]): PoolCandidate | null {
  let best: PoolCandidate | null = null;
  for (const c of candidates) if (c.swaps30d >= POOL_MIN_SWAPS_30D && (!best || c.swaps30d > best.swaps30d)) best = c;
  return best;
}

// Routes pair (a, b), already oriented. `tapePerHour(x, y)` reports the tape density of any pair,
// `directPool` the best pool of the exact pair, `hubPool(hub, other)` the best pool of a hub against a token.
export function chooseRoute(
  a: string, b: string, rank: (t: string) => number,
  tapePerHour: (x: string, y: string) => number,
  directPool: PoolCandidate | null,
  hubs: string[],
  hubPool: (hub: string, other: string) => PoolCandidate | null,
): Route {
  const ok = (p: PoolCandidate | null) => (p && p.swaps30d >= POOL_MIN_SWAPS_30D ? p : null);
  if (tapePerHour(a, b) >= TAPE_MIN_PER_HOUR) return { kind: "tape", leg1: { a, b, src: "tape", inv: false } };
  const direct = ok(directPool);
  if (direct) return { kind: "pool", leg1: { a, b, src: "pool", inv: false }, pool: direct.id };
  for (const h of hubs) {
    if (h === a || h === b) continue;
    // price(a in b) = price(a in h) * price(h in b): the dense tape leg first, the pool leg second
    const ah = orient(a, rank(a), h, rank(h)); const hb = orient(h, rank(h), b, rank(b));
    if (tapePerHour(ah.a, ah.b) >= TAPE_MIN_PER_HOUR) {
      const p = ok(hubPool(h, b));
      if (p) return { kind: "hop", hub: h, pool: p.id, leg1: { a: ah.a, b: ah.b, src: "tape", inv: ah.flipped }, leg2: { a: hb.a, b: hb.b, src: "pool", inv: hb.flipped } };
    }
    if (tapePerHour(hb.a, hb.b) >= TAPE_MIN_PER_HOUR) {
      const p = ok(hubPool(h, a));
      if (p) return { kind: "hop", hub: h, pool: p.id, leg1: { a: ah.a, b: ah.b, src: "pool", inv: ah.flipped }, leg2: { a: hb.a, b: hb.b, src: "tape", inv: hb.flipped } };
    }
  }
  return { kind: "hourly" };
}
