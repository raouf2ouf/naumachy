import { existsSync, readFileSync } from "node:fs";
import type { Address, Hex } from "viem";
import { REPO_ROOT, type Config } from "@naumachy/arena/config";
import { disassemble, type ProgramSpec } from "@naumachy/arena/program";

// What a gladiator gets to read before it writes its program: the generations so far with their
// entries, programs and attested scores, every desk's verdict on the gym Aquascan, and the pool's
// recent behaviour. Everything here is public on the gym's subgraphs and API; rivals see the same.
// The attested score (what the lanista wrote on chain at close) is the verdict of record; the
// Aquascan numbers beside it are live and keep moving while a program stays shipped.
export interface Verdict { gladiator: string; name: string; strategyHash: Hex; spec: ProgramSpec | null; listing: string[] | null; summary: Record<string, unknown> | null; attested: { scoreUsd: number; seUsd: number; fills: number } | null; liveNote: string; scoreUsd: number | null; bps: number | null; seBps: number | null; fills: number | null; volume: number | null; feeBps: number | null }
export interface GenerationView { number: number; closed: boolean; champion: string | null; verdicts: Verdict[] }
export interface Context { generations: GenerationView[]; pool: { priceNow: number; movesPerMinute: number; realizedVolBps: number; prints: number }; me: { address: Address; name: string; lastSpec: ProgramSpec | null; lastListing: string[] | null; lastRationale: string | null; lastGeneration: number | null }; gym?: GymRecord }

// The record of the training seasons, present when the arena is live: what each line shipped on
// the fork, generation by generation, and what it attested. GYM_RECORD names the file.
export interface GymRecord { note: string; generations: { generation: number; champion: string | null; field: { name: string; champion: boolean; attested: { scoreUsd: number; seUsd: number; fills: number } | null; spec: ProgramSpec | null }[] }[] }
export function gymRecord(env: NodeJS.ProcessEnv = process.env): GymRecord | undefined {
  const f = env.GYM_RECORD; if (!f || !existsSync(f)) return undefined;
  const r = JSON.parse(readFileSync(f, "utf8")) as { source: string; generations: { generation: number; closed: boolean; champion: string | null; field: { name: string; champion: boolean; attested: { scoreUsd: number; seUsd: number; fills: number } | null; spec: ProgramSpec | null }[] }[] };
  return {
    note: `Training seasons (${r.source}). Attested 5-minute markout sums in USDC per generation; ledgers there were about a hundred times larger than the live ones, and the flow carried a foresight taker the live arena does not have.`,
    generations: r.generations.filter((g) => g.closed).map((g) => ({ generation: g.generation, champion: g.champion, field: g.field.map((x) => ({ name: x.name, champion: x.champion, attested: x.attested, spec: x.spec ? { pairs: x.spec.pairs, capBps: x.spec.capBps, ops: x.spec.ops } : null })) })),
  };
}

export interface GenFile { spec?: ProgramSpec; listing?: string[]; program?: Hex; knobs: Record<string, unknown> & { rationale?: string; parent?: string | null } }

// A rival's program is public: its bytes are on chain and the dialect reads them. Its rationale is
// not. The generation files hold both; the context shows programs to everyone and the rationale
// only to the gladiator that wrote it.
export function generationFile(generation: number, address: string): GenFile | null {
  const f = `${process.env.GENERATIONS_DIR ?? `${REPO_ROOT}infra/data/gym/generations`}/${generation}-${address.toLowerCase()}.json`;
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")) as GenFile;
}
const publicSpec = (f: GenFile | null): ProgramSpec | null => (f?.spec ? { pairs: f.spec.pairs, capBps: f.spec.capBps, ops: f.spec.ops } : null);
const publicSummary = (f: GenFile | null): Record<string, unknown> | null => { if (!f?.knobs) return null; const { rationale: _r, ...rest } = f.knobs; return rest; };

async function gql<T>(url: string, query: string): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error(`subgraph: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.data;
}
const name = (hex: string) => Buffer.from(hex.slice(2), "hex").toString("utf8").replace(/\0+$/, "");

export async function gatherContext(cfg: Config, api: string, me: Address, myName: string): Promise<Context> {
  const arena = cfg.arenaSubgraph; const pools = cfg.poolsSubgraph;
  const g = await gql<{ generations: { number: number; closedAt: string | null; champion: { id: string } | null; entries: { gladiator: { id: string; name: string }; strategyHash: Hex; score: { scoreQuote: string; seQuote: string; fills: number } | null }[] }[] }>(
    arena, `{ generations(orderBy: number, orderDirection: asc) { number closedAt champion { id } entries { gladiator { id name } strategyHash score { scoreQuote seQuote fills } } } }`);
  // the program bytes of every live or past entry, so a listing exists even without a generation file
  const programs = new Map<string, Hex>();
  try {
    const a = await gql<{ strategies: { strategyHash: Hex; program: Hex }[] }>(cfg.gymSubgraph, `{ strategies(first: 500, where: { app: "${cfg.router.toLowerCase()}" }) { strategyHash program } }`);
    for (const s of a.strategies) programs.set(s.strategyHash.toLowerCase(), s.program);
  } catch { /* the listing falls back to the generation file */ }
  const generations: GenerationView[] = [];
  const keep = Number(process.env.CONTEXT_GENERATIONS ?? 6);   // the briefing carries the last few generations; the tools reach the rest
  for (const gen of g.generations.slice(-keep)) {
    const verdicts: Verdict[] = [];
    for (const e of gen.entries) {
      const strategyId = (e.gladiator.id + cfg.router.slice(2) + e.strategyHash.slice(2)).toLowerCase();
      const attested = e.score ? { scoreUsd: Number(e.score.scoreQuote) / 1e6, seUsd: Number(e.score.seQuote) / 1e6, fills: e.score.fills } : null;
      const f = generationFile(gen.number, e.gladiator.id);
      const bytes = programs.get(e.strategyHash.toLowerCase()) ?? f?.program ?? null;
      let listing: string[] | null = f?.listing ?? null;
      if (!listing && bytes) { try { listing = disassemble(bytes, cfg.market); } catch { listing = null; } }
      let v: Verdict = { gladiator: e.gladiator.id, name: name(e.gladiator.name), strategyHash: e.strategyHash, spec: publicSpec(f), listing, summary: publicSummary(f), attested, liveNote: "live Aquascan figures keep moving after close; the attested score is the record", scoreUsd: null, bps: null, seBps: null, fills: null, volume: null, feeBps: null };
      try {
        const res = await fetch(`${api}/api/strategy/base/${encodeURIComponent(strategyId)}?limit=1`);
        if (res.ok) {
          const d = (await res.json()) as { fees: { maker_fee_bps: number | null } | null; stats: { fills: number; volume_usd: { value: number | null }; edge_usd: { value: number | null }; markout_5m_usd: { value: number | null }; markout_5m_bps: { bps: number | null; se: number | null } | null } | null };
          if (d.stats) v = { ...v, scoreUsd: d.stats.markout_5m_usd.value, bps: d.stats.markout_5m_bps?.bps ?? null, seBps: d.stats.markout_5m_bps?.se ?? null, fills: d.stats.fills, volume: d.stats.volume_usd.value, feeBps: d.fees?.maker_fee_bps ?? null };
        }
      } catch { /* a strategy Aquascan has not rolled up yet stays unscored */ }
      verdicts.push(v);
    }
    generations.push({ number: gen.number, closed: gen.closedAt !== null, champion: gen.champion?.id ?? null, verdicts });
  }
  // the WETH/USDC pool's last hour: price now, prints per minute, realized volatility of the print prices
  const p = await gql<{ swaps: { timestamp: string; amount0: string; amount1: string }[] }>(pools, `{ swaps(first: 1000, orderBy: timestamp, orderDirection: desc, where: { pool: "${cfg.pool.toLowerCase()}" }) { timestamp amount0 amount1 } }`);
  const prices = p.swaps.filter((s) => Number(s.amount0) !== 0).map((s) => ({ t: Number(s.timestamp), px: Math.abs(Number(s.amount1) / Number(s.amount0)) })).reverse();
  const rets: number[] = []; for (let i = 1; i < prices.length; i += 1) rets.push(Math.log(prices[i].px / prices[i - 1].px));
  const vol = rets.length > 1 ? Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length) * 1e4 : 0;
  const span = prices.length > 1 ? Math.max(60, prices[prices.length - 1].t - prices[0].t) : 60;
  const myLastGen = [...generations].reverse().find((x) => x.verdicts.some((v) => v.gladiator.toLowerCase() === me.toLowerCase()));
  const mine = myLastGen ? generationFile(myLastGen.number, me) : null;
  const myVerdict = myLastGen?.verdicts.find((v) => v.gladiator.toLowerCase() === me.toLowerCase()) ?? null;
  return {
    generations,
    pool: { priceNow: prices.length ? prices[prices.length - 1].px : 0, movesPerMinute: prices.length / (span / 60), realizedVolBps: vol, prints: prices.length },
    me: { address: me, name: myName, lastSpec: publicSpec(mine), lastListing: mine?.listing ?? myVerdict?.listing ?? null, lastRationale: mine?.knobs?.rationale ?? null, lastGeneration: myLastGen?.number ?? null },
    gym: gymRecord(),
  };
}
