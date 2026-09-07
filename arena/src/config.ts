import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// paths are relative to the repo root whatever the working directory (yarn runs scripts inside the package)
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
import type { Address, Hex } from "viem";

export interface Config {
  rpc: string; chainId: number;
  router: Address; oracle: Address; taker: Address; takerData: Address; aqua: Address; weth: Address; usdc: Address; pool: Address;
  swapRouter02: Address;
  gymSubgraph: string;                 // the gym's Aqua subgraph, where live strategies of our router are read
  tapeSubgraph: string | null;         // the network pools subgraph (gateway) that supplies the tape; null = no replay
  graphApiKey: string | undefined;
  engineKey: Hex;                      // an unlocked anvil key: it drives the taker and replays the tape
  tapeMinutes: number; tapeScale: number; tickMs: number;
  probeUsd: number; noiseUsd: number; noiseProbability: number; edgeBps: number;
  toleranceBps: number; poolFeeBps: number;   // uninformed takers: mean tolerance to a worse-than-pool price (exponential, bps); the pool fee a routed taker pays
  poolNoiseProbability: number; poolNoiseUsd: number;   // random swaps through the pool itself when the tape is silent
  informedMinUsd: number;                               // a tape swap at least this large is front-run against the gladiators
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const a = JSON.parse(readFileSync(env.GYM_ADDRESSES ?? REPO_ROOT + "infra/data/gym/addresses.json", "utf8"));
  return {
    rpc: env.GYM_RPC ?? "http://127.0.0.1:8545", chainId: Number(a.chainId ?? 8453),
    router: a.router, oracle: a.oracle, taker: a.taker, takerData: a.takerData, aqua: a.aqua, weth: a.weth, usdc: a.usdc, pool: a.pool,
    swapRouter02: (env.SWAP_ROUTER02 ?? "0x2626664c2603336E57B271c5C0b26F421741e481") as Address,
    gymSubgraph: env.GYM_SUBGRAPH ?? "http://localhost:8100/subgraphs/name/naumachy/aqua-gym",
    tapeSubgraph: env.TAPE_SUBGRAPH ?? (env.DEX_SUBGRAPH_ID_BASE?.startsWith("http") ? null : env.DEX_SUBGRAPH_ID_BASE ?? null),
    graphApiKey: env.GRAPH_API_KEY,
    engineKey: (env.ENGINE_KEY ?? "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a") as Hex,
    tapeMinutes: Number(env.TAPE_MINUTES ?? 60), tapeScale: Number(env.TAPE_SCALE ?? 1), tickMs: Number(env.TICK_MS ?? 2000),
    probeUsd: Number(env.PROBE_USD ?? 200), noiseUsd: Number(env.NOISE_USD ?? 100), noiseProbability: Number(env.NOISE_PROBABILITY ?? 0.15),
    edgeBps: Number(env.EDGE_BPS ?? 5),
    toleranceBps: Number(env.TOLERANCE_BPS ?? 10), poolFeeBps: Number(env.POOL_FEE_BPS ?? 5),
    poolNoiseProbability: Number(env.POOL_NOISE_PROBABILITY ?? 0.2), poolNoiseUsd: Number(env.POOL_NOISE_USD ?? 3000),
    informedMinUsd: Number(env.INFORMED_MIN_USD ?? 20_000),
  };
}
