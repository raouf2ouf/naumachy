import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { health, overview, series, desks, desk, makers, maker, strategy, search, rollupAt } from "./queries.js";
import { arena, generation } from "./arena.js";

const pool = new pg.Pool({ connectionString: process.env.AQUASCAN_DATABASE_URL ?? "postgres://aquascan:aquascan@localhost:5433/aquascan", max: 8 });
const port = Number(process.env.AQUASCAN_API_PORT ?? 3100);

// The overview aggregates the whole window of fills on every call, seconds on the big chains, and
// its answer only changes when the rollup runs. So it is computed once per rollup per (window,
// chain) and served from memory; a warmer recomputes the common views right after each rollup,
// so the first visitor after a rollup does not pay for it either.
const CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"];
const overviewCache = new Map<string, { rollup: number; body: unknown }>();
let lastRollup = 0;
async function cachedOverview(window: string | null, chain: string | null, rollup?: number): Promise<unknown> {
  const at = rollup ?? (await rollupAt(pool)).getTime();
  const key = `${window ?? ""}|${chain ?? ""}`;
  const hit = overviewCache.get(key);
  if (hit && hit.rollup === at) return hit.body;
  const body = await overview(pool, window, chain);
  overviewCache.set(key, { rollup: at, body });
  return body;
}
async function warm() {
  try {
    const at = (await rollupAt(pool)).getTime();
    if (at === lastRollup) return;
    lastRollup = at;
    const t0 = Date.now();
    for (const chain of [null, ...CHAINS]) await cachedOverview(null, chain, at);
    console.log(new Date().toISOString(), `overview warmed for rollup ${new Date(at).toISOString()} in ${Date.now() - t0} ms`);
  } catch (err) { console.error(new Date().toISOString(), "warm", String(err).slice(0, 200)); }
}

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
