export type ChainName = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "bsc" | "robinhood";

export interface ChainConfig {
  name: ChainName;
  source: "subgraph" | "substreams";
  subgraphId: string;        // network id or URL of the subgraph; for a Substreams chain, the endpoint
  startBlock?: number;       // Substreams chains: where the registry starts
}

export interface SubstreamsConfig {
  token: string | undefined;   // SUBSTREAMS_API_TOKEN, from `substreams auth` on The Graph Market
  packagePath: string;         // SUBSTREAMS_PACKAGE: local .spkg or URL of naumachy-aqua
}

export interface DexConfig {
  chain: ChainName;
  protocol: string;
  subgraphId: string;
  hubs: Record<string, string>;   // symbol -> address of the tokens a hop may pass through
}

export interface Config {
  apiKey: string;
  chains: ChainConfig[];
  databaseUrl: string;
  gatewayCallsPerMinute: number;
  llamaCallsPerMinute: number;
  llamaCallsPerPass: number;
  rpcByChain: Record<string, string | undefined>;
  substreams: SubstreamsConfig;
  pollSeconds: number;
  pageSize: number;
  dexes: DexConfig[];
  dexCallsPerMinute: number;
}

// Published DEX subgraphs with the Uniswap v3 schema (pools, swaps, poolDayData), one per chain,
// overridable with DEX_SUBGRAPH_ID_<CHAIN>. Chains without one keep hourly references.
const DEX_DEFAULTS: Partial<Record<ChainName, { protocol: string; subgraphId: string | null; hubs: Record<string, string> }>> = {
  base: { protocol: "naumachy-pools", subgraphId: null,   // our own pools subgraph; id or Studio URL in DEX_SUBGRAPH_ID_BASE until published
    hubs: { WETH: "0x4200000000000000000000000000000000000006", USDC: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", USDBC: "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", USDT: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2" } },
  ethereum: { protocol: "uniswap-v3", subgraphId: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
    hubs: { WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7" } },
  bsc: { protocol: "uniswap-v3", subgraphId: "G5MUbSBM7Nsrm9tH2tGQUiAF4SZDGf2qeo1xPLYjKr7K",
    hubs: { WBNB: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", USDT: "0x55d398326f99059ff775485246999027b3197955", USDC: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d" } },
};

// Chains The Graph Network reaches only through Firehose: Aquascan reads them with the Substreams
// package in substreams/aqua, from the canonical registry's deployment block. Enabled by
// SUBSTREAMS_ENDPOINT_<CHAIN>; a chain with a subgraph id keeps the subgraph.
const SUBSTREAMS_DEFAULTS: Partial<Record<ChainName, { endpoint: string; startBlock: number }>> = {
  robinhood: { endpoint: "https://mainnet.robinhood.streamingfast.io:443", startBlock: 13888204 },
};

const ENV_SUFFIX: Record<ChainName, string> = {
  ethereum: "ETHEREUM",
  base: "BASE",
  arbitrum: "ARBITRUM",
  optimism: "OPTIMISM",
  polygon: "POLYGON",
  bsc: "BSC",
  robinhood: "ROBINHOOD",
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
    const endpoint = env[`SUBSTREAMS_ENDPOINT_${ENV_SUFFIX[name]}`];
    if (subgraphId) chains.push({ name, source: "subgraph", subgraphId });
    else if (endpoint) {
      const d = SUBSTREAMS_DEFAULTS[name];
      chains.push({ name, source: "substreams", subgraphId: endpoint === "default" && d ? d.endpoint : endpoint, startBlock: Number(env[`SUBSTREAMS_START_BLOCK_${ENV_SUFFIX[name]}`] ?? d?.startBlock ?? 0) });
    }
  }
  if (chains.length === 0) throw new Error("no GRAPH_SUBGRAPH_ID_<CHAIN> or SUBSTREAMS_ENDPOINT_<CHAIN> is set");
  return {
    apiKey,
    chains,
    databaseUrl: env.AQUASCAN_DATABASE_URL ?? "postgres://aquascan:aquascan@localhost:5433/aquascan",
    gatewayCallsPerMinute: Number(env.GATEWAY_CALLS_PER_MINUTE ?? 30),
    llamaCallsPerMinute: Number(env.LLAMA_CALLS_PER_MINUTE ?? 30),
    llamaCallsPerPass: Number(env.LLAMA_CALLS_PER_PASS ?? 200),
    rpcByChain: Object.fromEntries(CHAIN_NAMES.map((name) => [name, env[`RPC_${ENV_SUFFIX[name]}`]])),
    substreams: { token: env.SUBSTREAMS_API_TOKEN, packagePath: env.SUBSTREAMS_PACKAGE ?? new URL("../../../substreams/aqua/naumachy-aqua-v0.1.0.spkg", import.meta.url).pathname },
    pollSeconds: Number(env.ENRICH_POLL_SECONDS ?? 300),
    pageSize: 1000,
    dexes: chains.flatMap((c) => {
      const d = DEX_DEFAULTS[c.name];
      const id = env[`DEX_SUBGRAPH_ID_${ENV_SUFFIX[c.name]}`] ?? d?.subgraphId ?? undefined;
      return id && d ? [{ chain: c.name, protocol: d.protocol, subgraphId: id, hubs: d.hubs }] : [];
    }),
    dexCallsPerMinute: Number(env.DEX_CALLS_PER_MINUTE ?? 120),
  };
}
