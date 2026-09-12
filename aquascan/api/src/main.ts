import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowSeconds } from "./provenance.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { health, overview, series, desks, desk, makers, maker, strategy, search, rollupAt } from "./queries.js";
import { arena, generation } from "./arena.js";

const pool = new pg.Pool({ connectionString: process.env.AQUASCAN_DATABASE_URL ?? "postgres://aquascan:aquascan@localhost:5433/aquascan", max: 8 });
const port = Number(process.env.AQUASCAN_API_PORT ?? 3100);

// The overview aggregates the whole window of fills on every call, seconds on the big chains, and
// its answer only changes when the rollup runs. So it is computed once per rollup per (window,
// chain) and served from memory. Three rules keep a visitor from ever waiting for it:
//   1. stale while revalidating: a cached answer from the previous rollup is served at once and
//      recomputed in the background, one computation per key at a time;
//   2. the warmer recomputes every window and chain after each rollup, the landing page first;
//   3. the cache is written to disk after each warm and read back at boot, so a restart serves the
//      last answers immediately instead of a cold seven seconds.
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "robinhood"];
const WINDOWS_WARM = ["30d", "7d", "all", "24h"];   // the landing page's window first
const cacheFile = process.env.AQUASCAN_CACHE ?? join(tmpdir(), "aquascan-overview-cache.json");
const overviewCache = new Map<string, { rollup: number; body: unknown }>();
const inflight = new Map<string, Promise<unknown>>();
let lastRollup = 0;
const keyOf = (window: string | null, chain: string | null) => `${windowSeconds(window).name}|${chain && chain !== "all" ? chain : ""}`;
function compute(key: string, window: string | null, chain: string | null, at: number): Promise<unknown> {
  const running = inflight.get(key); if (running) return running;
  const p = overview(pool, window, chain === "all" ? null : chain).then((body) => { overviewCache.set(key, { rollup: at, body }); return body; }).finally(() => inflight.delete(key));
  inflight.set(key, p); return p;
}
async function cachedOverview(window: string | null, chain: string | null, rollup?: number): Promise<unknown> {
  const at = rollup ?? (await rollupAt(pool)).getTime();
  const key = keyOf(window, chain);
  const hit = overviewCache.get(key);
  if (hit && hit.rollup === at) return hit.body;
  if (hit) { void compute(key, window, chain, at).catch(() => undefined); return hit.body; }   // stale, served now, refreshed behind
  return compute(key, window, chain, at);
}
async function warm() {
  try {
    const at = (await rollupAt(pool)).getTime();
    if (at === lastRollup) return;
    lastRollup = at;
    const t0 = Date.now();
    for (const window of WINDOWS_WARM) for (const chain of [null, ...CHAINS]) await cachedOverview(window, chain, at);
    console.log(new Date().toISOString(), `overview warmed for rollup ${new Date(at).toISOString()} in ${Date.now() - t0} ms`);
    try { writeFileSync(cacheFile, JSON.stringify([...overviewCache.entries()])); } catch (err) { console.error(new Date().toISOString(), "cache write", String(err).slice(0, 120)); }
  } catch (err) { console.error(new Date().toISOString(), "warm", String(err).slice(0, 200)); }
}
try {
  if (existsSync(cacheFile)) { for (const [k, v] of JSON.parse(readFileSync(cacheFile, "utf8")) as [string, { rollup: number; body: unknown }][]) overviewCache.set(k, v); console.log(new Date().toISOString(), `overview cache read back: ${overviewCache.size} views`); }
} catch (err) { console.error(new Date().toISOString(), "cache read", String(err).slice(0, 120)); }

type Handler = (url: URL, params: string[]) => Promise<unknown>;
const routes: [RegExp, Handler][] = [
  [/^\/api\/health$/, () => health(pool)],
  [/^\/api\/overview$/, (u) => cachedOverview(u.searchParams.get("window"), u.searchParams.get("chain"))],
  [/^\/api\/series$/, (u) => series(pool, u.searchParams.get("window"), u.searchParams.get("chain"))],
  [/^\/api\/desks$/, (u) => desks(pool, u.searchParams.get("chain"), u.searchParams.get("sort"), Math.min(200, Number(u.searchParams.get("limit") ?? 50)), Number(u.searchParams.get("minVolume") ?? 0))],
  [/^\/api\/leaderboard$/, (u) => makers(pool, u.searchParams.get("chain"), u.searchParams.get("sort") ?? "edge", Math.min(200, Number(u.searchParams.get("limit") ?? 50)), Number(u.searchParams.get("minVolume") ?? 1000))],
  [/^\/api\/makers$/, (u) => makers(pool, u.searchParams.get("chain"), u.searchParams.get("sort"), Math.min(200, Number(u.searchParams.get("limit") ?? 50)), Number(u.searchParams.get("minVolume") ?? 0))],
  [/^\/api\/maker\/([a-z]+)\/(0x[0-9a-fA-F]{40})$/, (u, [chain, address]) => maker(pool, chain, address, Number(u.searchParams.get("offset") ?? 0), Math.min(200, Number(u.searchParams.get("limit") ?? 50)))],
  [/^\/api\/desk\/([a-z]+)\/([^/]+)$/, (u, [chain, id]) => desk(pool, chain, decodeURIComponent(id), Number(u.searchParams.get("offset") ?? 0), Math.min(200, Number(u.searchParams.get("limit") ?? 50)))],
  [/^\/api\/strategy\/([a-z]+)\/([^/]+)$/, (u, [chain, id]) => strategy(pool, chain, decodeURIComponent(id), Number(u.searchParams.get("offset") ?? 0), Math.min(200, Number(u.searchParams.get("limit") ?? 50)))],
  [/^\/api\/search$/, (u) => search(pool, u.searchParams.get("q") ?? "")],
  [/^\/api\/arena$/, () => arena(pool)],
  [/^\/api\/arena\/generation\/(\d+)$/, (_u, [n]) => generation(pool, Number(n))],
];

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=15" });
  res.end(JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method !== "GET") return send(res, 405, { error: "GET only" });
  for (const [pattern, handler] of routes) {
    const m = url.pathname.match(pattern);
    if (!m) continue;
    try {
      const body = await handler(url, m.slice(1));
      return body === null ? send(res, 404, { error: "not found" }) : send(res, 200, body);
    } catch (err) {
      console.error(new Date().toISOString(), url.pathname, err);
      return send(res, 500, { error: "internal" });
    }
  }
  send(res, 404, { error: "no such route" });
}

createServer((req, res) => { void handle(req, res); }).listen(port, "127.0.0.1", () => {
  console.log(new Date().toISOString(), `aquascan api on http://127.0.0.1:${port}`);
  void warm(); setInterval(() => void warm(), 30_000);
});
