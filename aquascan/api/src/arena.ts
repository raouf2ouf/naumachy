import type pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scored, rollupAt } from "./queries.js";

type Pool = pg.Pool;
// The arena, as the registry's subgraph tells it, joined with what Aquascan measured for every
// entry's strategy. ARENA_SUBGRAPH is the gym graph-node URL or a network subgraph id;
// GENERATIONS_DIR holds what each gladiator wrote (knobs, rationale, reads); ARENA_CHAIN is the
// chain the strategies live on in Aquascan.
const SUBGRAPH = process.env.ARENA_SUBGRAPH ?? null;
const CHAIN = process.env.ARENA_CHAIN ?? "base";
const DIR = process.env.GENERATIONS_DIR ?? new URL("../../../infra/data/gym/generations/", import.meta.url).pathname;

async function gql<T>(query: string): Promise<T> {
  if (!SUBGRAPH) throw new Error("ARENA_SUBGRAPH is not set");
  const url = SUBGRAPH.startsWith("http") ? SUBGRAPH : `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH}`;
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "naumachy-aquascan" };
  if (!SUBGRAPH.startsWith("http") && process.env.GRAPH_API_KEY) headers.authorization = `Bearer ${process.env.GRAPH_API_KEY}`;
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ query }) });
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (!body.data) throw new Error(`arena subgraph: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.data;
}
const name = (hex: string | null | undefined) => (hex ? Buffer.from(hex.slice(2), "hex").toString("utf8").replace(/\0+$/, "") : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

interface GenFile { knobs: Record<string, unknown> & { rationale?: string; parent?: string | null }; mind?: string; transcript?: unknown[]; draft?: unknown; program?: string; blob?: string; strategyHash?: string; listing?: string[]; pairs?: string[]; rejected?: string[] }
function genFile(generation: number, address: string): GenFile | null {
  const f = join(DIR, `${generation}-${address.toLowerCase()}.json`);   // DIR with or without a trailing slash
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")) as GenFile; } catch { return null; }
}
const publicKnobs = (k: GenFile["knobs"] | undefined) => { if (!k) return null; const { rationale: _r, ...rest } = k; return rest; };

interface SgGladiator { id: string; name: string; generationBorn: number; parent: { id: string; name: string } | null; registeredAt?: string }
interface SgEntry { gladiator: SgGladiator; strategyHash: string; archetype: string; enteredAt: string; score: { scoreQuote: string; seQuote: string; fills: number; quoteToken: string; attestedAt: string } | null }
interface SgGeneration { number: number; tape: string; openedAt: string; closedAt: string | null; champion: { id: string; name: string } | null; championStrategy: string | null; championScore: string | null; entries: SgEntry[] }
const GEN_FIELDS = `number tape openedAt closedAt champion { id name } championStrategy championScore entries(orderBy: enteredAt) { gladiator { id name generationBorn parent { id name } } strategyHash archetype enteredAt score { scoreQuote seQuote fills quoteToken attestedAt } }`;

// Aquascan's live numbers for a set of strategy hashes on the arena's chain.
async function liveByHash(pool: Pool, hashes: string[], at: Date) {
  if (hashes.length === 0) return new Map<string, unknown>();
  const { rows } = await pool.query(`
    SELECT s.id, s.strategy_hash, s.maker, s.status, s.desk, st.fills, st.volume_usd, st.edge_usd, st.markout_5m_usd, st.markout_1h_usd, st.markout_24h_usd, st.drift_1h_usd, st.drift_24h_usd,
           st.protocol_fee_usd, st.maker_fee_usd, st.tape_fills, st.priced_fills, st.priced_ratio, st.markout_5m_bps, st.markout_5m_bps_se, st.markout_1h_bps, st.markout_1h_bps_se, sf.maker_fee_bps
    FROM strategies s LEFT JOIN strategy_stats st ON st.chain = s.chain AND st.strategy_id = s.id LEFT JOIN strategy_fees sf ON sf.chain = s.chain AND sf.strategy_id = s.id
    WHERE s.chain = $1 AND s.strategy_hash = ANY($2)`, [CHAIN, hashes.map((h) => h.toLowerCase())]);
  const out = new Map<string, unknown>();
  for (const r of rows) out.set(r.strategy_hash, { strategy_id: r.id, desk: r.desk, status: r.status, live: r.fills === null ? null : { fills: Number(r.fills), maker_fee_bps: num(r.maker_fee_bps), ...scored(r, r.priced_ratio, Number(r.priced_fills) ? Number(r.tape_fills) / Number(r.priced_fills) : 0, at) } });
  return out;
}
async function decimalsOf(pool: Pool, token: string | null): Promise<number> {
  if (!token) return 6;
  const { rows } = await pool.query(`SELECT decimals FROM tokens WHERE chain = $1 AND address = $2`, [CHAIN, token.toLowerCase()]);
  return rows[0]?.decimals ?? 6;
}

function entryRow(gen: SgGeneration, e: SgEntry, live: Map<string, unknown>, decimals: number) {
  const f = genFile(gen.number, e.gladiator.id);
  const scale = 10 ** decimals;
  return {
    gladiator: e.gladiator.id, name: name(e.gladiator.name), generation_born: e.gladiator.generationBorn, parent: e.gladiator.parent ? { address: e.gladiator.parent.id, name: name(e.gladiator.parent.name) } : null,
    strategy_hash: e.strategyHash, archetype: name(e.archetype), entered_at: Number(e.enteredAt),
    attested: e.score ? { score_quote: e.score.scoreQuote, se_quote: e.score.seQuote, fills: e.score.fills, quote_token: e.score.quoteToken, score_usd: Number(e.score.scoreQuote) / scale, se_usd: Number(e.score.seQuote) / scale, attested_at: Number(e.score.attestedAt) } : null,
    champion: gen.champion?.id.toLowerCase() === e.gladiator.id.toLowerCase() && gen.championStrategy?.toLowerCase() === e.strategyHash.toLowerCase(),
    knobs: publicKnobs(f?.knobs), mind: f?.mind ?? (f?.knobs?.rationale?.startsWith("Heuristic") ? "heuristic" : f?.knobs?.rationale?.startsWith("Seeded") ? "seed" : f ? "unknown" : null), parent_choice: f?.knobs?.parent ?? null,
    ...((live.get(e.strategyHash.toLowerCase()) as object | undefined) ?? { strategy_id: null, desk: null, status: null, live: null }),
  };
}

export async function arena(pool: Pool) {
  if (!SUBGRAPH) return { chain: CHAIN, configured: false, generations: [], gladiators: [], promotions: [] };
  const at = await rollupAt(pool);
  const d = await gql<{ generations: SgGeneration[]; gladiators: SgGladiator[]; promotions: { gladiator: { id: string; name: string }; strategyHash: string; chainId: string; bankroll: string; at: string; tx: string }[] }>(
    `{ generations(orderBy: number, orderDirection: desc, first: 100) { ${GEN_FIELDS} } gladiators(first: 200, orderBy: registeredAt) { id name generationBorn parent { id name } registeredAt } promotions(first: 50, orderBy: at, orderDirection: desc) { gladiator { id name } strategyHash chainId bankroll at tx } }`);
  const hashes = d.generations.flatMap((g) => g.entries.map((e) => e.strategyHash));
  const live = await liveByHash(pool, hashes, at);
  const decimals = await decimalsOf(pool, d.generations.find((g) => g.entries.some((e) => e.score))?.entries.find((e) => e.score)?.score?.quoteToken ?? null);
  const wins = new Map<string, number>();
  for (const g of d.generations) if (g.champion) wins.set(g.champion.id.toLowerCase(), (wins.get(g.champion.id.toLowerCase()) ?? 0) + 1);
  return {
    chain: CHAIN, configured: true, rollup_at: at,
    generations: d.generations.map((g) => ({
      number: g.number, tape: g.tape, opened_at: Number(g.openedAt), closed_at: g.closedAt === null ? null : Number(g.closedAt),
      champion: g.champion ? { address: g.champion.id, name: name(g.champion.name), strategy_hash: g.championStrategy, score_usd: g.championScore === null ? null : Number(g.championScore) / 10 ** decimals } : null,
      entries: g.entries.map((e) => entryRow(g, e, live, decimals)),
    })),
    gladiators: d.gladiators.map((x) => ({ address: x.id, name: name(x.name), generation_born: x.generationBorn, parent: x.parent ? { address: x.parent.id, name: name(x.parent.name) } : null, registered_at: Number(x.registeredAt), entries: d.generations.reduce((n, g) => n + g.entries.filter((e) => e.gladiator.id === x.id).length, 0), wins: wins.get(x.id.toLowerCase()) ?? 0 })),
    promotions: d.promotions.map((p) => ({ gladiator: p.gladiator.id, name: name(p.gladiator.name), strategy_hash: p.strategyHash, chain_id: Number(p.chainId), bankroll: p.bankroll, at: Number(p.at), tx: p.tx })),
  };
}

export async function generation(pool: Pool, number: number) {
  if (!SUBGRAPH) return null;
  const at = await rollupAt(pool);
  const d = await gql<{ generations: SgGeneration[] }>(`{ generations(where: { number: ${number} }) { ${GEN_FIELDS} } }`);
  const g = d.generations[0]; if (!g) return null;
  const live = await liveByHash(pool, g.entries.map((e) => e.strategyHash), at);
  const decimals = await decimalsOf(pool, g.entries.find((e) => e.score)?.score?.quoteToken ?? null);
  const closed = g.closedAt !== null;
  return {
    chain: CHAIN, number: g.number, tape: g.tape, opened_at: Number(g.openedAt), closed_at: closed ? Number(g.closedAt) : null, rollup_at: at,
    champion: g.champion ? { address: g.champion.id, name: name(g.champion.name), strategy_hash: g.championStrategy, score_usd: g.championScore === null ? null : Number(g.championScore) / 10 ** decimals } : null,
    entries: g.entries.map((e) => {
      const f = genFile(g.number, e.gladiator.id);
      // the line it continues: the parent it named in the previous generation, or its own previous program
      const parentAddress = (f?.knobs?.parent as string | null | undefined) || e.gladiator.id;
      const parentFile = g.number > 0 ? genFile(g.number - 1, parentAddress) : null;
      return {
        ...entryRow(g, e, live, decimals),
        parent_line: parentFile ? { address: parentAddress, generation: g.number - 1, knobs: publicKnobs(parentFile.knobs) } : null,
        rationale: closed ? f?.knobs?.rationale ?? null : null,
        transcript: closed ? f?.transcript ?? [] : [],
        draft: f?.draft ?? null, program: f?.program ?? null,
        listing: f?.listing ?? null, pairs: f?.pairs ?? null, rejected: closed ? f?.rejected ?? [] : [],
      };
    }),
  };
}
