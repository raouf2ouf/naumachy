export type ChainName = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "bsc";

export interface ChainConfig {
  name: ChainName;
  subgraphId: string;
}

export interface Config {
  apiKey: string;
  chains: ChainConfig[];
  databaseUrl: string;
  gatewayCallsPerMinute: number;
  llamaCallsPerMinute: number;
  llamaCallsPerPass: number;
  rpcByChain: Record<string, string | undefined>;
  pollSeconds: number;
  pageSize: number;
}

const ENV_SUFFIX: Record<ChainName, string> = {
  ethereum: "ETHEREUM",
  base: "BASE",
  arbitrum: "ARBITRUM",
  optimism: "OPTIMISM",
  polygon: "POLYGON",
  bsc: "BSC",
};

export const CHAIN_NAMES = Object.keys(ENV_SUFFIX) as ChainName[];

// One subgraph id per chain, taken from GRAPH_SUBGRAPH_ID_<CHAIN>. A chain without an id is skipped.
export function loadConfig(env: NodeJS.ProcessEnv = process.env, only?: ChainName[]): Config {
  const apiKey = env.GRAPH_API_KEY;
  if (!apiKey) throw new Error("GRAPH_API_KEY is not set (gateway query key from Subgraph Studio)");
  const chains: ChainConfig[] = [];
  for (const name of CHAIN_NAMES) {
    if (only && !only.includes(name)) continue;
    const subgraphId = env[`GRAPH_SUBGRAPH_ID_${ENV_SUFFIX[name]}`];
    if (subgraphId) chains.push({ name, subgraphId });
  }
  if (chains.length === 0) throw new Error("no GRAPH_SUBGRAPH_ID_<CHAIN> is set");
  return {
    apiKey,
    chains,
    databaseUrl: env.AQUASCAN_DATABASE_URL ?? "postgres://aquascan:aquascan@localhost:5433/aquascan",
    gatewayCallsPerMinute: Number(env.GATEWAY_CALLS_PER_MINUTE ?? 30),
    llamaCallsPerMinute: Number(env.LLAMA_CALLS_PER_MINUTE ?? 30),
    llamaCallsPerPass: Number(env.LLAMA_CALLS_PER_PASS ?? 200),
    rpcByChain: Object.fromEntries(CHAIN_NAMES.map((name) => [name, env[`RPC_${ENV_SUFFIX[name]}`]])),
    pollSeconds: Number(env.ENRICH_POLL_SECONDS ?? 300),
    pageSize: 1000,
  };
}
