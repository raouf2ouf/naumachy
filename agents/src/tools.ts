import { readFileSync } from "node:fs";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { REPO_ROOT, type Config } from "@naumachy/arena/config";

// What a mind can reach for while it thinks: the schema of a subgraph, a GraphQL query against
// it, and an Aquascan API path. In the gym the subgraphs live on the local graph-node, which no
// hosted MCP can reach, so these tools run the queries; on the network the same GraphQL goes
// through The Graph's Subgraph MCP and the query tool steps aside. Every call is recorded.
export interface ToolCall { tool: string; input: unknown; chars: number; ms: number }
export const SUBGRAPH_NAMES = ["arena", "pools", "aqua"] as const;
export type SubgraphName = (typeof SUBGRAPH_NAMES)[number];

export interface GraphSetup {
  mode: "local" | "mcp";
  urls: Record<SubgraphName, string>;                 // where the query tool posts
  ids: Partial<Record<SubgraphName, string>>;         // network subgraph ids, for the MCP tools and the prompt
  gatewayKey?: string;
}

export function graphSetup(cfg: Config, env: NodeJS.ProcessEnv = process.env): GraphSetup {
  const ids: Partial<Record<SubgraphName, string>> = { arena: env.ARENA_SUBGRAPH_ID, pools: env.POOLS_SUBGRAPH_ID ?? env.DEX_SUBGRAPH_ID_BASE, aqua: env.AQUA_SUBGRAPH_ID };
  const gateway = (id: string) => `https://gateway.thegraph.com/api/subgraphs/id/${id}`;
  const local = (name: string) => cfg.gymSubgraph.replace("aqua-gym", `${name}-gym`);
  const mode = env.GLADIATOR_GRAPH === "mcp" ? "mcp" : "local";
  const urls = { arena: mode === "mcp" && ids.arena ? gateway(ids.arena) : local("arena"), pools: mode === "mcp" && ids.pools ? gateway(ids.pools) : local("pools"), aqua: mode === "mcp" && ids.aqua ? gateway(ids.aqua) : cfg.gymSubgraph };
  return { mode, urls, ids, gatewayKey: env.GRAPH_API_KEY };
}

const clip = (s: string, n = Number(process.env.GLADIATOR_READ_CHARS ?? 3000)) => (s.length > n ? `${s.slice(0, n)}\n…(${s.length - n} more characters cut; ask a narrower query)` : s);

export function makeTools(setup: GraphSetup, api: string, transcript: ToolCall[]) {
  const record = async <T,>(tool: string, input: unknown, f: () => Promise<string>): Promise<string> => {
    const t0 = Date.now();
    try { const out = await f(); transcript.push({ tool, input, chars: out.length, ms: Date.now() - t0 }); return out; }
    catch (err) { const msg = `error: ${String(err).slice(0, 300)}`; transcript.push({ tool, input, chars: msg.length, ms: Date.now() - t0 }); return msg; }
  };
  const getSchema = betaZodTool({
    name: "get_schema",
    description: "The GraphQL schema of one of the arena's subgraphs: 'arena' (gladiators, generations, entries, attested scores, promotions), 'pools' (the reference pool's swaps and daily data), 'aqua' (every strategy shipped to the router and every fill). Read it before writing a query.",
    inputSchema: z.object({ subgraph: z.enum(SUBGRAPH_NAMES) }),
    run: ({ subgraph }) => record("get_schema", { subgraph }, async () => readFileSync(`${REPO_ROOT}subgraphs/${subgraph}/schema.graphql`, "utf8")),
  });
  const query = betaZodTool({
    name: "query_subgraph",
    description: "Run a GraphQL query against one of the arena's subgraphs ('arena', 'pools', 'aqua'). Use first: and orderBy: to keep results small; the answer is cut at a few thousand characters.",
    inputSchema: z.object({ subgraph: z.enum(SUBGRAPH_NAMES), query: z.string().min(5).max(4000) }),
    run: ({ subgraph, query }) => record("query_subgraph", { subgraph, query }, async () => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (setup.urls[subgraph].includes("gateway.thegraph.com") && setup.gatewayKey) { headers.authorization = `Bearer ${setup.gatewayKey}`; headers["user-agent"] = "naumachy"; }
      const res = await fetch(setup.urls[subgraph], { method: "POST", headers, body: JSON.stringify({ query }) });
      return clip(await res.text());
    }),
  });
  const aquascan = betaZodTool({
    name: "aquascan",
    description: "Read the gym's Aquascan API, the scorer. Paths: 'overview?chain=base', 'desks?chain=base&sort=markout', 'leaderboard?chain=base', 'desk/base/<deskId>', 'strategy/base/<maker><router><strategyHash>?limit=20' (fills with their 5-minute markouts), 'search?q=<text>'. Numbers carry their source; the 5-minute markout in bps with its standard error is the score. Desk and leaderboard figures accumulate across generations and fields; the attested per-generation score in your briefing is the record.",
    inputSchema: z.object({ path: z.string().min(1).max(300) }),
    run: ({ path }) => record("aquascan", { path }, async () => {
      if (!/^(overview|series|desks|leaderboard|desk\/[a-z]+\/[^/?]+|strategy\/[a-z]+\/[^/?]+|search)(\?[^\s]*)?$/.test(path)) return "error: path not allowed";
      const res = await fetch(`${api}/api/${path}`);
      return clip(await res.text());
    }),
  });
  // on the network the hosted Subgraph MCP runs the GraphQL; the local query tool is not offered
  return setup.mode === "mcp" ? [getSchema, aquascan] : [getSchema, query, aquascan];
}

export const SUBGRAPH_MCP = { name: "the-graph", url: "https://subgraphs.mcp.thegraph.com/sse", beta: "mcp-client-2025-11-20" };
