import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { makeServer } from "./server.js";
// Aquascan over Streamable HTTP, stateless: one URL to add in a client, nothing to install.
// MCP_PORT (3110), MCP_PATH (/mcp), AQUASCAN_API (the local API when hosted beside it).
const api = process.env.AQUASCAN_API ?? "http://127.0.0.1:3100";
const port = Number(process.env.MCP_PORT ?? 3110); const path = process.env.MCP_PATH ?? "/mcp";
const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);
createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== path) { res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "no such route", mcp: path })); return; }
  if (req.method === "GET" && !(req.headers.accept ?? "").includes("text/event-stream")) { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: "aquascan", transport: "streamable-http", endpoint: path, tools: ["aquascan_overview", "aquascan_leaderboard", "aquascan_bleeding_makers", "aquascan_maker", "aquascan_strategy", "aquascan_takers", "aquascan_search", "arena_generations"] })); return; }
  try {
    const server = makeServer(api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    log(`mcp error: ${String(err).slice(0, 200)}`);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "internal" }));
  }
}).listen(port, "127.0.0.1", () => log(`aquascan mcp on http://127.0.0.1:${port}${path} -> ${api}`));
