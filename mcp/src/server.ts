import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Aquascan's questions as MCP tools, over the read-only JSON API (naumachy.xyz/api by default).
// Every priced number the API returns carries its source; the tools keep the values and say the
// sources once, so an answer can be reasoned over without a wall of provenance. Nothing here
// touches the database or the chain: a thin layer that names the questions.
const CHAINS = ["all", "ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "robinhood"] as const;
const WINDOWS = ["1d", "7d", "30d", "all"] as const;
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const HEX_DROP = new Set(["program", "blob", "instructions_raw"]);

// provenance objects {value, source, at, confidence} become their value; sources are collected
function slim(v: Json, sources: Set<string>, depth = 0): Json {
  if (Array.isArray(v)) return v.map((x) => slim(x, sources, depth + 1));
  if (v && typeof v === "object") {
    const o = v as { [k: string]: Json };
    if ("value" in o && "source" in o && Object.keys(o).every((k) => ["value", "source", "at", "confidence"].includes(k))) { if (typeof o.source === "string") sources.add(o.source); return o.value; }
    const out: { [k: string]: Json } = {};
    for (const [k, x] of Object.entries(o)) { if (HEX_DROP.has(k)) continue; out[k] = slim(x, sources, depth + 1); }
    return out;
  }
  return v;
}
// a maker row, the fields a reader needs: result, fees, when, what it trades
const ROW = ["chain", "maker", "maker_label", "live", "strategies", "fills", "volume_usd", "edge_usd", "markout_5m_usd", "markout_1h_usd", "markout_24h_usd", "maker_fee_usd", "protocol_fee_usd", "markout_5m_bps", "pnl_usd_marked", "pnl", "maker_fee_bps", "first_seen", "last_seen"];
function makerRow(r: Json): Json {
  if (!r || typeof r !== "object" || Array.isArray(r)) return r;
  const o = r as { [k: string]: Json }; const out: { [k: string]: Json } = {};
  for (const k of ROW) if (k in o) out[k] = o[k];
  if (Array.isArray(o.pairs)) out.pairs = (o.pairs as { [k: string]: Json }[]).slice(0, 4).map((p) => `${p.base_symbol}/${p.quote_symbol} ${Math.round(Number(p.share ?? 0) * 100)}%`);
  if (Array.isArray(o.templates)) out.templates = (o.templates as { [k: string]: Json }[]).slice(0, 3).map((t) => t.template_name ?? t.name ?? t.template);
  return out;
}
const text = (data: Json, sources: Set<string>) => ({ content: [{ type: "text" as const, text: JSON.stringify(sources.size ? { sources: [...sources], data } : data) }] });
const fail = (msg: string) => ({ content: [{ type: "text" as const, text: msg }], isError: true });

export function makeServer(api: string): McpServer {
  const server = new McpServer({ name: "aquascan", version: "0.1.0" }, { instructions: "Aquascan keeps score for 1inch Aqua strategies on seven chains: what each program does, what its fills returned once the market re-priced (edge at fill, 5-minute, 1-hour and 24-hour markouts), what each maker made (fees, realised and unrealised P&L, rewards), and the Naumachy arena where AI-authored programs fight on Base. Numbers are USD unless a field says bps. Markouts are the maker's side: negative means the flow was informed. Chains: ethereum, base, arbitrum, optimism, polygon, bsc, robinhood, or all. Windows: 1d, 7d, 30d, all." });
  const get = async (path: string): Promise<Json> => {
    const res = await fetch(`${api}/api/${path}`, { signal: AbortSignal.timeout(30_000), headers: { "user-agent": "aquascan-mcp/0.1" } });
    if (!res.ok) throw new Error(`Aquascan answered ${res.status} for /api/${path}`);
    return (await res.json()) as Json;
  };
  const wrap = <T,>(f: () => Promise<T>) => f().catch((e) => fail(String((e as Error).message ?? e)));
  const idOf = async (chain: string, idOrHash: string): Promise<string> => {
    if (/^0x[0-9a-fA-F]{64}$/.test(idOrHash)) {
      const s = (await get(`search?q=${idOrHash}`)) as { strategies: { id: string; chain: string }[] };
      const hit = s.strategies.find((x) => x.chain === chain) ?? s.strategies[0];
      if (!hit) throw new Error(`no strategy with hash ${idOrHash}`);
      return hit.id;
    }
    return idOrHash;
  };

  server.registerTool("aquascan_overview", {
    title: "Aquascan overview", description: "The venue in four numbers for a chain and window: economic fills, strategies active, volume, and the makers' result at every horizon (edge at fill, 5-minute, 1-hour, 24-hour markouts), plus fees taken. Start here.",
    inputSchema: { chain: z.enum(CHAINS).default("all"), window: z.enum(WINDOWS).default("7d") },
  }, async ({ chain, window }) => wrap(async () => {
    const s = new Set<string>(); const d = slim(await get(`overview?chain=${chain}&window=${window}`), s) as { [k: string]: Json };
    const out: { [k: string]: Json } = { window: d.window, chain: d.chain, rollup_at: d.rollup_at, hero: d.hero, fees: d.fees, totals: d.totals, chains: d.chains };
    if (Array.isArray(d.top_makers)) out.top_makers = d.top_makers.map(makerRow);
    if (Array.isArray(d.latest_ships)) out.latest_ships = (d.latest_ships as { [k: string]: Json }[]).slice(0, 5).map((x) => ({ chain: x.chain, maker: x.maker, template_name: x.template_name, shipped_at: x.shipped_at, status: x.status }));
    return text(out, s);
  }));

  server.registerTool("aquascan_leaderboard", {
    title: "Makers ranked", description: "Makers on a chain ranked by a metric over a window. sort: edge (what they made at fill), markout (5-minute markout, the score), fees, volume, fills. Each row: fills, volume, edge, markouts at 5m/1h/24h, fees, first and last seen, and the pairs traded. Use limit small; the answer is trimmed.",
    inputSchema: { chain: z.enum(CHAINS).default("all"), window: z.enum(WINDOWS).default("7d"), sort: z.enum(["edge", "markout", "fees", "volume", "fills"]).default("edge"), limit: z.number().int().min(1).max(50).default(10), minVolumeUsd: z.number().min(0).default(1000) },
  }, async ({ chain, window, sort, limit, minVolumeUsd }) => wrap(async () => { const s = new Set<string>(); const rows = (await get(`leaderboard?chain=${chain}&window=${window}&sort=${sort}&limit=${limit}&minVolume=${minVolumeUsd}`)) as Json[]; return text((slim(rows.slice(0, limit), s) as Json[]).map(makerRow), s); }));

  server.registerTool("aquascan_bleeding_makers", {
    title: "Makers that are bleeding", description: "Makers whose fills lost money once the market re-priced: negative 5-minute (or 1-hour) markout over the window, worst first, with the evidence (fills, volume, edge at fill, markouts, fees). This is adverse selection: the flow knew something the program did not.",
    inputSchema: { chain: z.enum(CHAINS).default("all"), window: z.enum(WINDOWS).default("7d"), horizon: z.enum(["5m", "1h"]).default("5m"), limit: z.number().int().min(1).max(50).default(10), minVolumeUsd: z.number().min(0).default(1000) },
  }, async ({ chain, window, horizon, limit, minVolumeUsd }) => wrap(async () => {
    const s = new Set<string>();
    const rows = slim(await get(`makers?chain=${chain}&window=${window}&sort=markout&limit=200&minVolume=${minVolumeUsd}`), s) as { [k: string]: Json }[];
    const key = horizon === "5m" ? "markout_5m_usd" : "markout_1h_usd";
    const bleeding = rows.filter((r) => typeof r[key] === "number" && (r[key] as number) < 0).sort((a, b) => (a[key] as number) - (b[key] as number)).slice(0, limit);
    return text({ horizon, count_considered: rows.length, bleeding: bleeding.map(makerRow) }, s);
  }));

  server.registerTool("aquascan_maker", {
    title: "What a maker made", description: "One maker on one chain, where its inventory lives: fills, volume, edge, markouts, fees charged, realised and unrealised P&L (average cost), 'versus holding', rewards from the 1inch programme, pairs traded, templates used, its strategies (live and docked) and recent fills.",
    inputSchema: { chain: z.enum(CHAINS.filter((c) => c !== "all") as unknown as [string, ...string[]]), address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), fills: z.number().int().min(0).max(50).default(10) },
  }, async ({ chain, address, fills }) => wrap(async () => { const s = new Set<string>(); const d = slim(await get(`maker/${chain}/${address}?limit=${fills}`), s) as { [k: string]: Json };
    if (Array.isArray(d.recent_fills)) d.recent_fills = d.recent_fills.slice(0, fills);
    if (Array.isArray(d.strategies)) d.strategies = (d.strategies as { [k: string]: Json }[]).slice(0, 20).map((x) => ({ id: x.id, strategy_hash: x.strategy_hash, status: x.status, template_name: x.template_name, fills: x.fills, volume_usd: x.volume_usd, markout_5m_usd: x.markout_5m_usd, shipped_at: x.shipped_at, docked_at: x.docked_at }));
    return text(d, s); }));

  server.registerTool("aquascan_strategy", {
    title: "What a strategy does", description: "One shipped program read back instruction by instruction (the card: guards, fees, curve, with the numbers in plain words), its declared ledger, fees, status, its result (fills, volume, edge, markouts) and recent fills with their markouts. id is Aquascan's strategy id (maker + router + strategy hash) or a bare 0x strategy hash.",
    inputSchema: { chain: z.enum(CHAINS.filter((c) => c !== "all") as unknown as [string, ...string[]]), id: z.string().min(10), fills: z.number().int().min(0).max(50).default(10) },
  }, async ({ chain, id, fills }) => wrap(async () => { const s = new Set<string>(); const d = slim(await get(`strategy/${chain}/${await idOf(chain, id)}?limit=${fills}`), s) as { [k: string]: Json }; if (Array.isArray(d.fills)) d.fills = d.fills.slice(0, fills); return text(d, s); }));

  server.registerTool("aquascan_takers", {
    title: "Who fills a strategy", description: "The takers of one strategy, from its recent fills: how many fills and how much volume each taker account did, and the markout it inflicted on the maker. Concentration tells whether one counterparty is picking the maker off.",
    inputSchema: { chain: z.enum(CHAINS.filter((c) => c !== "all") as unknown as [string, ...string[]]), id: z.string().min(10), sample: z.number().int().min(10).max(200).default(200) },
  }, async ({ chain, id, sample }) => wrap(async () => {
    const s = new Set<string>();
    const d = slim(await get(`strategy/${chain}/${await idOf(chain, id)}?limit=${sample}`), s) as { fills?: { [k: string]: Json }[]; fills_total?: Json };
    const by = new Map<string, { taker: string; fills: number; volume_usd: number; markout_5m_usd: number; edge_usd: number }>();
    for (const f of d.fills ?? []) {
      const t = String(f.taker ?? "unknown"); const r = by.get(t) ?? { taker: t, fills: 0, volume_usd: 0, markout_5m_usd: 0, edge_usd: 0 };
      r.fills += 1; r.volume_usd += Number(f.volume_usd ?? 0); r.markout_5m_usd += Number(f.markout_5m_usd ?? 0); r.edge_usd += Number(f.edge_usd ?? 0); by.set(t, r);
    }
    const takers = [...by.values()].sort((a, b) => b.fills - a.fills);
    return text({ fills_sampled: d.fills?.length ?? 0, fills_total: d.fills_total ?? null, takers }, s);
  }));

  server.registerTool("aquascan_search", {
    title: "Search", description: "Find makers and strategies by address, strategy hash, label or template name.",
    inputSchema: { q: z.string().min(2) },
  }, async ({ q }) => wrap(async () => { const s = new Set<string>(); return text(slim(await get(`search?q=${encodeURIComponent(q)}`), s), s); }));

  server.registerTool("arena_generations", {
    title: "The arena's record", description: "Naumachy's arena on Base: generations with their entries (gladiator, strategy hash, archetype), the scores the lanista attested (5-minute markout sum in USDC with its band and fill count), the champion of each closed generation, the gladiators with their lineage, and promotions (a champion granted a real bankroll after a tap on a Ledger). Verdict of record = the attested score; live Aquascan figures keep moving.",
    inputSchema: { generations: z.number().int().min(1).max(50).default(5) },
  }, async ({ generations }) => wrap(async () => {
    const s = new Set<string>(); const d = slim(await get("arena"), s) as { [k: string]: Json };
    if (Array.isArray(d.generations)) d.generations = d.generations.slice(0, generations);
    return text(d, s);
  }));

  server.registerTool("arena_promotion", {
    title: "Who the arena would pay", description: "The season's standing and the promotion an agent may propose: the last closed generations of Naumachy's arena on Base, champions ranked by wins then by attested score, and the exact wallet-cli command that pays the champion from a Ledger account. Read-only. This tool never signs and never sends: a human runs the command and confirms the recipient and the amount on the Ledger device; only once the transfer is mined does the lanista record promote() on the registry.",
    inputSchema: { generations: z.number().int().min(1).max(50).default(8), prize_usdc: z.number().positive().default(30), account: z.string().min(1).max(40).default("base-1") },
  }, async ({ generations, prize_usdc, account }) => wrap(async () => {
    const d = (await get("arena")) as { generations?: { number: number; closed_at: number | null; champion: { address: string; name: string; strategy_hash: string; score_usd: number | null } | null }[] };
    const closed = (d.generations ?? []).filter((g) => g.closed_at).sort((a, b) => b.number - a.number).slice(0, generations);
    const tally = new Map<string, { name: string; address: string; strategy_hash: string; wins: number; attested_usd: number; generations_won: number[] }>();
    for (const g of closed) {
      if (!g.champion) continue;
      const k = g.champion.address.toLowerCase();
      const t = tally.get(k) ?? { name: g.champion.name, address: g.champion.address, strategy_hash: g.champion.strategy_hash, wins: 0, attested_usd: 0, generations_won: [] };
      t.wins += 1; t.attested_usd += g.champion.score_usd ?? 0; t.generations_won.push(g.number); tally.set(k, t);
    }
    const ranking = [...tally.values()].sort((a, b) => b.wins - a.wins || b.attested_usd - a.attested_usd).map((r) => ({ ...r, attested_usd: +r.attested_usd.toFixed(6) }));
    const champion = ranking[0] ?? null;
    return text({
      season: { generations: closed.map((g) => g.number), without_champion: closed.filter((g) => !g.champion).map((g) => g.number) },
      ranking, champion,
      proposal: champion ? {
        pay: `${prize_usdc} USDC`, from: `Ledger account ${account}`, to: champion.address, chain: "base",
        command: `wallet-cli send --account ${account} --to ${champion.address} --amount '${prize_usdc} USDC'`,
        then: "yarn workspace @naumachy/arena promote  (waits for the transfer, then the lanista writes promote() on ArenaRegistry)",
      } : null,
      boundary: "agents propose, a human approves on the device, hardware signs; nothing in the arena holds the prize or a signer",
    }, new Set(["ArenaRegistry on Base, as attested by the lanista and indexed by the arena subgraph"]));
  }));

  return server;
}
