import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import pg from "pg";
import { health, overview, desks, desk, strategy, search } from "./queries.js";

const pool = new pg.Pool({ connectionString: process.env.AQUASCAN_DATABASE_URL ?? "postgres://aquascan:aquascan@localhost:5433/aquascan", max: 8 });
const port = Number(process.env.AQUASCAN_API_PORT ?? 3100);

type Handler = (url: URL, params: string[]) => Promise<unknown>;
const routes: [RegExp, Handler][] = [
  [/^\/api\/health$/, () => health(pool)],
  [/^\/api\/overview$/, (u) => overview(pool, u.searchParams.get("window"), u.searchParams.get("chain"))],
  [/^\/api\/desks$/, (u) => desks(pool, u.searchParams.get("chain"), u.searchParams.get("sort"), Math.min(200, Number(u.searchParams.get("limit") ?? 50)), Number(u.searchParams.get("minVolume") ?? 0))],
  [/^\/api\/leaderboard$/, (u) => desks(pool, u.searchParams.get("chain"), u.searchParams.get("sort") ?? "edge", Math.min(200, Number(u.searchParams.get("limit") ?? 50)), Number(u.searchParams.get("minVolume") ?? 1000))],
  [/^\/api\/desk\/([a-z]+)\/([^/]+)$/, (_u, [chain, id]) => desk(pool, chain, decodeURIComponent(id))],
  [/^\/api\/strategy\/([a-z]+)\/([^/]+)$/, (_u, [chain, id]) => strategy(pool, chain, decodeURIComponent(id))],
  [/^\/api\/search$/, (u) => search(pool, u.searchParams.get("q") ?? "")],
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
});
