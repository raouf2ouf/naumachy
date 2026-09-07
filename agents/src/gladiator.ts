import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, REPO_ROOT, type Config } from "@naumachy/arena/config";
import { anchoredProgram, ARCHETYPE_ANCHORED } from "@naumachy/arena/program";
import { ship, dock } from "@naumachy/arena/ship";
import { liveGladiators } from "@naumachy/arena/orders";
import { gladiator as registry, arenaAbi } from "@naumachy/arena/lanista";
import { routerAbi, takerDataAbi } from "@naumachy/arena/abi";
import { gatherContext } from "./context.js";
import { decide, type Knobs } from "./mind.js";
import { graphSetup } from "./tools.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

export interface GladiatorRun { name: string; key: Hex; address: Address; knobs: Knobs; strategyHash: Hex; generation: number }

const gymChain = (cfg: Config, rpc = cfg.rpc) => ({ id: cfg.chainId, name: "gym", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }) as const;

// One gladiator, one generation: read, decide, validate the draft on a private fork, dock the old
// program, ship the new one, enter. Knobs, program, rationale and what the gladiator saw are kept
// under infra/data/gym/generations, so two generations of a line differ by one small diff.
export async function runGladiator(cfg: Config, client: Anthropic, key: Hex, myName: string, api: string, arena: Address, ledger: [bigint, bigint]): Promise<GladiatorRun> {
  const chain = gymChain(cfg);
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ chain, transport: http(cfg.rpc), account });
  const generation = Number(await pub.readContract({ address: arena, abi: arenaAbi, functionName: "currentGeneration" }).catch(() => { throw new Error("no generation is open; the lanista opens one first"); }));
  const dir = `${REPO_ROOT}infra/data/gym/generations`; mkdirSync(dir, { recursive: true });

  const ctx = await gatherContext(cfg, api, account.address, myName);
  const graph = graphSetup(cfg);
  const { knobs, transcript, mode, usage } = await decide(client, ctx, graph, api);
  if (transcript.length) log(`   ${myName} read ${transcript.length} things first (${mode}): ${transcript.map((t) => t.tool).join(", ")}`);
  if (usage.calls) log(`   tokens: ${usage.input} in, ${usage.output} out, ${usage.cache_read} cached, over ${usage.calls} calls`);
  log(`${myName} decides: fee ${knobs.feeBaseBps} bps (slope ${knobs.feeSlopeBps}, max ${knobs.feeMaxBps}, window ${knobs.windowSeconds}s), depth ${knobs.depth}x, cap ${knobs.capBps} bps, parent ${knobs.parent ?? "none"}`);
  log(`   ${knobs.rationale}`);

  const program = anchoredProgram({ capBps: knobs.capBps, feeBaseBps: knobs.feeBaseBps, feeSlopeBps: knobs.feeSlopeBps, feeMaxBps: knobs.feeMaxBps, windowSeconds: knobs.windowSeconds, depth: knobs.depth,
    oracle: cfg.oracle, base: cfg.weth, oracleDecimals: 18, baseDecimals: 18, quoteDecimals: 6, maxStaleness: 0, salt: BigInt(keccak256(toHex(`${myName}-${generation}-${Date.now()}`))) });
  const draft = await validateOnPrivateFork(cfg, key, program, ledger);
  log(`   on a private fork the draft prices WETH at ${(Number(draft.usdcFor1Weth) / 1e6).toFixed(2)} USDC selling and ${(1e21 / Number(draft.wethFor1000Usdc)).toFixed(2)} USDC buying`);

  // the previous programs of this wallet go; the taker engine only sees the new one
  const mine = (await liveGladiators(cfg.gymSubgraph, cfg.router)).filter((g) => g.maker.toLowerCase() === account.address.toLowerCase());
  for (const g of mine) { await dock(pub, wallet, cfg.aqua, cfg.router, g.strategyHash, [cfg.weth, cfg.usdc]); log(`   docked ${g.strategyHash.slice(0, 12)}`); }
  const shipped = await ship(pub, wallet, cfg.aqua, cfg.router, program, [cfg.weth, cfg.usdc], ledger);
  await registry.register(pub, wallet, arena, stringToHex(myName, { size: 32 }), "0x0000000000000000000000000000000000000000").catch(() => null);   // already registered: fine
  await registry.enter(pub, wallet, arena, shipped.strategyHash, ARCHETYPE_ANCHORED);
  writeFileSync(`${dir}/${generation}-${account.address.toLowerCase()}.json`, JSON.stringify({ generation, name: myName, address: account.address, mind: mode, model: process.env.GLADIATOR_MODEL ?? null, effort: process.env.GLADIATOR_EFFORT ?? null, usage, knobs, transcript, program, blob: shipped.blob, strategyHash: shipped.strategyHash, draft: { usdcFor1Weth: draft.usdcFor1Weth.toString(), wethFor1000Usdc: draft.wethFor1000Usdc.toString() }, context: ctx }, null, 1));
  log(`${myName} shipped ${shipped.strategyHash.slice(0, 12)} and entered generation ${generation}`);
  return { name: myName, key, address: account.address, knobs, strategyHash: shipped.strategyHash, generation };
}

// The validator: a private anvil forked from the gym at its head, where the draft is shipped and
// quoted both ways at a probe size. A cap too tight, an empty curve, a bad argument: the quote
// reverts there and nothing reaches the gym. The fork dies either way.
export async function validateOnPrivateFork(cfg: Config, key: Hex, program: Hex, ledger: [bigint, bigint]): Promise<{ usdcFor1Weth: bigint; wethFor1000Usdc: bigint }> {   // prices implied by the probes
  const port = 8600 + Math.floor(Math.random() * 200);
  const rpc = `http://127.0.0.1:${port}`;
  const child = spawn(process.env.ANVIL ?? "anvil", ["--fork-url", cfg.rpc, "--port", String(port), "--chain-id", String(cfg.chainId), "--silent"], { env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` }, stdio: "ignore" });
  try {
    for (let i = 0; ; i += 1) {
      try { await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }); break; }
      catch { if (i > 80) throw new Error("the private fork never answered"); await new Promise((r) => setTimeout(r, 250)); }
    }
    const chain = gymChain(cfg, rpc);
    const pub = createPublicClient({ chain, transport: http(rpc) });
    const wallet = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(key) });
    const shipped = await ship(pub, wallet, cfg.aqua, cfg.router, program, [cfg.weth, cfg.usdc], ledger);
    const td = await pub.readContract({ address: cfg.takerData, abi: takerDataAbi, functionName: "build", args: [cfg.taker, true] });
    // probes at a twentieth of the ledger, well inside any sane cap; a cap tighter than that is a rejection
    const [, usdcOut] = await pub.readContract({ address: cfg.router, abi: routerAbi, functionName: "quote", args: [shipped.order, cfg.weth, cfg.usdc, ledger[0] / 20n, td] });
    const [, wethOut] = await pub.readContract({ address: cfg.router, abi: routerAbi, functionName: "quote", args: [shipped.order, cfg.usdc, cfg.weth, ledger[1] / 25n, td] });
    if (usdcOut === 0n || wethOut === 0n) throw new Error("the draft quotes nothing");
    return { usdcFor1Weth: (usdcOut * 10n ** 18n) / (ledger[0] / 20n), wethFor1000Usdc: (wethOut * 1000n * 10n ** 6n) / (ledger[1] / 25n) };
  } finally {
    child.kill("SIGKILL");
  }
}

// Standalone: one gladiator for the open generation. Env: GLADIATOR_KEY, GLADIATOR_NAME.
if (process.argv[1]?.endsWith("gladiator.ts")) {
  const cfg = loadConfig();
  const client = new Anthropic();
  const key = (process.env.GLADIATOR_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as Hex;
  const arena = (process.env.ARENA ?? JSON.parse(readFileSync(REPO_ROOT + "infra/data/gym/addresses.json", "utf8")).arena) as Address;
  runGladiator(cfg, client, key, process.env.GLADIATOR_NAME ?? "solo", process.env.AQUASCAN_API ?? "http://127.0.0.1:3101", arena, [BigInt(process.env.GEN_LEDGER_WETH ?? "1000000000000000000"), BigInt(process.env.GEN_LEDGER_USDC ?? "2500000000")])
    .catch((err) => { console.error(err); process.exit(1); });
}
