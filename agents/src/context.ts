import { existsSync, readFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { REPO_ROOT, type Config } from "@naumachy/arena/config";

// What a gladiator gets to read before it writes its program: the generations so far with their
// entries and attested scores, every desk's verdict on the gym Aquascan, and the pool's recent
// behaviour. Everything here is public on the gym's subgraphs and API; rivals see the same.
// The attested score (what the lanista wrote on chain at close) is the verdict of record; the
// Aquascan numbers beside it are live and keep moving while a program stays shipped.
export interface Verdict { gladiator: string; name: string; strategyHash: Hex; knobs: Record<string, unknown> | null; attested: { scoreUsd: number; seUsd: number; fills: number } | null; scoreUsd: number | null; bps: number | null; seBps: number | null; fills: number; volume: number | null; edgeUsd: number | null; feeBps: number | null }
export interface GenerationView { number: number; closed: boolean; champion: string | null; verdicts: Verdict[] }
export interface Context { generations: GenerationView[]; pool: { priceNow: number; movesPerMinute: number; realizedVolBps: number; prints: number }; me: { address: Address; name: string; lastKnobs: unknown | null; lastRationale: string | null; lastVerdict: Verdict | null } }

// A rival's knobs are public: its program is bytes on chain and the archetype decodes them. Its
// rationale is not. The generation files hold both; the context shows knobs to everyone and the
// rationale only to the gladiator that wrote it.
export function generationFile(generation: number, address: string): { knobs: Record<string, unknown>; rationale: string | null } | null {
  const f = `${REPO_ROOT}infra/data/gym/generations/${generation}-${address.toLowerCase()}.json`;
  if (!existsSync(f)) return null;
  const { knobs } = JSON.parse(readFileSync(f, "utf8")) as { knobs: Record<string, unknown> & { rationale?: string } };
  const { rationale, ...rest } = knobs;
  return { knobs: rest, rationale: rationale ?? null };
}

async function gql<T>(url: string, query: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error(`subgraph: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.data;
}
const name = (hex: string) => Buffer.from(hex.slice(2), "hex").toString("utf8").replace(/\0+$/, "");

export async function gatherContext(cfg: Config, api: string, me: Address, myName: string): Promise<Context> {
  const arena = cfg.gymSubgraph.replace("aqua-gym", "arena-gym"); const pools = cfg.gymSubgraph.replace("aqua-gym", "pools-gym");
  const g = await gql<{ generations: { number: number; closedAt: string | null; champion: { id: string } | null; entries: { gladiator: { id: string; name: string }; strategyHash: Hex; score: { scoreQuote: string; seQuote: string; fills: number } | null }[] }[] }>(
    arena, `{ generations(orderBy: number, orderDirection: asc) { number closedAt champion { id } entries { gladiator { id name } strategyHash score { scoreQuote seQuote fills } } } }`);
  const generations: GenerationView[] = [];
  for (const gen of g.generations) {
    const verdicts: Verdict[] = [];
    for (const e of gen.entries) {
      const strategyId = (e.gladiator.id + cfg.router.slice(2) + e.strategyHash.slice(2)).toLowerCase();
      const attested = e.score ? { scoreUsd: Number(e.score.scoreQuote) / 1e6, seUsd: Number(e.score.seQuote) / 1e6, fills: e.score.fills } : null;
      let v: Verdict = { gladiator: e.gladiator.id, name: name(e.gladiator.name), strategyHash: e.strategyHash, knobs: generationFile(gen.number, e.gladiator.id)?.knobs ?? null, attested, scoreUsd: null, bps: null, seBps: null, fills: 0, volume: null, edgeUsd: null, feeBps: null };
      try {
        const res = await fetch(`${api}/api/strategy/base/${encodeURIComponent(strategyId)}?limit=1`);
        if (res.ok) {
          const d = (await res.json()) as { fees: { maker_fee_bps: number | null } | null; stats: { fills: number; volume_usd: { value: number | null }; edge_usd: { value: number | null }; markout_5m_usd: { value: number | null }; markout_5m_bps: { bps: number; se: number | null } | null } | null };
          if (d.stats) v = { ...v, scoreUsd: d.stats.markout_5m_usd.value, bps: d.stats.markout_5m_bps?.bps ?? null, seBps: d.stats.markout_5m_bps?.se ?? null, fills: d.stats.fills, volume: d.stats.volume_usd.value, edgeUsd: d.stats.edge_usd.value, feeBps: d.fees?.maker_fee_bps ?? null };
        }
      } catch { /* a strategy Aquascan has not rolled up yet stays unscored */ }
      verdicts.push(v);
    }
    generations.push({ number: gen.number, closed: gen.closedAt !== null, champion: gen.champion?.id ?? null, verdicts });
  }
  // the pool's last hour: price now, prints per minute, realized volatility of the print prices
  const p = await gql<{ swaps: { timestamp: string; amount0: string; amount1: string }[] }>(pools, `{ swaps(first: 1000, orderBy: timestamp, orderDirection: desc, where: { pool: "${cfg.pool.toLowerCase()}" }) { timestamp amount0 amount1 } }`);
  const prices = p.swaps.filter((s) => Number(s.amount0) !== 0).map((s) => ({ t: Number(s.timestamp), px: Math.abs(Number(s.amount1) / Number(s.amount0)) })).reverse();
  const rets: number[] = []; for (let i = 1; i < prices.length; i += 1) rets.push(Math.log(prices[i].px / prices[i - 1].px));
  const vol = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length) * 1e4 : 0;
  const span = prices.length > 1 ? Math.max(60, prices[prices.length - 1].t - prices[0].t) : 60;
  const myLast = [...generations].reverse().flatMap((x) => x.verdicts).find((v) => v.gladiator.toLowerCase() === me.toLowerCase()) ?? null;
  const myLastGen = [...generations].reverse().find((x) => x.verdicts.some((v) => v.gladiator.toLowerCase() === me.toLowerCase()));
  const mine = myLastGen ? generationFile(myLastGen.number, me) : null;
  return { generations, pool: { priceNow: prices.length ? prices[prices.length - 1].px : 0, movesPerMinute: prices.length / (span / 60), realizedVolBps: vol, prints: prices.length }, me: { address: me, name: myName, lastKnobs: mine?.knobs ?? null, lastRationale: mine?.rationale ?? null, lastVerdict: myLast } };
}
