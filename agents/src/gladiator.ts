import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { createPublicClient, createWalletClient, formatUnits, http, keccak256, nonceManager, stringToHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, ledgerFor, REPO_ROOT, type Config } from "@naumachy/arena/config";
import { compile, summarize, ARCHETYPE_AUTHORED, type Compiled, type Pair, type ProgramSpec } from "@naumachy/arena/program";
import { ship, dock } from "@naumachy/arena/ship";
import { liveGladiators } from "@naumachy/arena/orders";
import { gladiator as registry, arenaAbi } from "@naumachy/arena/lanista";
import { routerAbi, takerAbi, takerDataAbi } from "@naumachy/arena/abi";
import { gatherContext } from "./context.js";
import { decide, toSpec, type Program } from "./mind.js";
import { graphSetup } from "./tools.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

export interface GladiatorRun { name: string; key: Hex; address: Address; program: Program; strategyHash: Hex; generation: number }
export interface Draft { pairs: Record<string, { sell: number; buy: number }>; loop: { usdcIn: number; usdcOut: number } | null; sell?: number; buy?: number }

const gymChain = (cfg: Config, rpc = cfg.rpc) => ({ id: cfg.chainId, name: "gym", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }) as const;

// One gladiator, one generation: read, write a program, compile it, validate the draft on a private
// fork, dock the old program, ship the new one, enter. A program the compiler or the validator
// refuses goes back to the mind once with the verdict. Program, listing, rationale and what the
// gladiator saw are kept under infra/data/gym/generations, so two generations of a line differ by
// one readable diff.
export async function runGladiator(cfg: Config, client: Anthropic, key: Hex, myName: string, api: string, arena: Address): Promise<GladiatorRun> {
  const chain = gymChain(cfg);
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const account = privateKeyToAccount(key, { nonceManager });   // the live wallet only: the private fork shares the chain id and must not share the nonce count
  const wallet = createWalletClient({ chain, transport: http(cfg.rpc), account });
  const generation = Number(await pub.readContract({ address: arena, abi: arenaAbi, functionName: "currentGeneration" }).catch(() => { throw new Error("no generation is open; the lanista opens one first"); }));
  const dir = cfg.generationsDir; mkdirSync(dir, { recursive: true });

  const ctx = await gatherContext(cfg, api, account.address, myName);
  const graph = graphSetup(cfg);
  const attempts = Number(process.env.GLADIATOR_ATTEMPTS ?? 2);
  let problem: string | undefined; let chosen: { program: Program; spec: ProgramSpec; compiled: Compiled; amounts: bigint[]; draft: Draft; transcript: unknown[]; mode: string; usage: unknown; rejected: string[] } | null = null;
  const rejected: string[] = [];
  const spent = { input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 };   // every attempt counts, refused ones too
  for (let attempt = 1; attempt <= attempts && !chosen; attempt += 1) {
    const { program, transcript, mode, usage } = await decide(client, ctx, graph, api, problem);
    for (const k of Object.keys(spent) as (keyof typeof spent)[]) spent[k] += (usage as typeof spent)[k] ?? 0;
    if (transcript.length) log(`   ${myName} read ${transcript.length} things first (${mode}): ${transcript.map((t) => t.tool).join(", ")}`);
    const u = usage as { calls: number; input: number; output: number; cache_read: number };
    if (u.calls) log(`   tokens: ${u.input} in, ${u.output} out, ${u.cache_read} cached, over ${u.calls} calls`);
    log(`${myName} writes: ${program.ops.map((o) => o.op).join(" > ")} on ${program.pairs.join(", ")}, cap ${program.capBps} bps, parent ${program.parent ?? "none"}`);
    log(`   ${program.rationale}`);
    try {
      const spec = toSpec(program, BigInt(keccak256(toHex(`${myName}-${generation}-${Date.now()}`))));
      const compiled = compile(spec, cfg.market);
      for (const line of compiled.listing) log(`     ${line}`);
      const amounts = ledgerFor(compiled.tokens);
      const draft = await validateOnPrivateFork(cfg, key, compiled, amounts);
      for (const [pair, px] of Object.entries(draft.pairs)) log(`   on a private fork the draft prices ${pair} at ${px.sell.toFixed(2)} selling and ${px.buy.toFixed(2)} buying`);
      if (draft.loop) log(`   a 50 USDC loop through the three pairs comes back as ${draft.loop.usdcOut.toFixed(2)} USDC`);
      chosen = { program, spec, compiled, amounts, draft, transcript, mode, usage: spent, rejected };
    } catch (err) {
      problem = String((err as Error).message ?? err).slice(0, 400);
      rejected.push(problem);
      log(`   rejected (attempt ${attempt}/${attempts}): ${problem}`);
    }
  }
  if (!chosen) throw new Error(`${myName} wrote no program the arena accepts: ${rejected.join(" | ")}`);
  const { program, spec, compiled, amounts, draft, transcript, mode, usage } = chosen;

  // the previous programs of this wallet go; the taker engine only sees the new one
  const mine = (await liveGladiators(cfg.gymSubgraph, cfg.router)).filter((g) => g.maker.toLowerCase() === account.address.toLowerCase());
  for (const g of mine) { await dock(pub, wallet, cfg.aqua, cfg.router, g.strategyHash, g.tokens); log(`   docked ${g.strategyHash.slice(0, 12)}`); }
  const tokens = compiled.tokens.map((t) => t.address);
  const shipped = await ship(pub, wallet, cfg.aqua, cfg.router, compiled.bytes, tokens, amounts);
  await registry.register(pub, wallet, arena, stringToHex(myName, { size: 32 }), "0x0000000000000000000000000000000000000000").catch(() => null);   // already registered: fine
  await registry.enter(pub, wallet, arena, shipped.strategyHash, ARCHETYPE_AUTHORED);
  const knobs = { ...summarize(spec), parent: program.parent, rationale: program.rationale };
  writeFileSync(`${dir}/${generation}-${account.address.toLowerCase()}.json`, JSON.stringify({
    generation, name: myName, address: account.address, mind: mode, model: mode === "heuristic" ? null : process.env.GLADIATOR_MODEL ?? "claude-opus-5", effort: process.env.GLADIATOR_EFFORT ?? "high",
    spec: { ...spec, salt: spec.salt?.toString() }, listing: compiled.listing, knobs, program: compiled.bytes, tokens, ledger: amounts.map(String), pairs: compiled.pairs.map((p) => p.name),
    blob: shipped.blob, strategyHash: shipped.strategyHash, draft, rejected, transcript, usage, context: ctx,
  }, null, 1));
  log(`${myName} shipped ${shipped.strategyHash.slice(0, 12)} on ${compiled.pairs.map((p) => p.name).join(", ")} and entered generation ${generation}`);
  return { name: myName, key, address: account.address, program, strategyHash: shipped.strategyHash, generation };
}

// The validator: a private anvil forked from the gym at its head, where the draft is shipped and
// quoted both ways on every pair at a probe size, and, when it ships all three pairs, taken around
// the triangle by the arena's own taker. A cap too tight, an empty curve, a bad argument, a loop
// that pays the taker: the draft is refused there and nothing reaches the gym. The fork dies either way.
export async function validateOnPrivateFork(cfg: Config, key: Hex, compiled: Compiled, amounts: bigint[]): Promise<Draft> {
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
    // gas money on the private fork for the two accounts that transact there; a live wallet holds only what its real transactions need
    for (const a of [wallet.account!.address, privateKeyToAccount(cfg.engineKey).address]) await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [a, "0x56BC75E2D63100000"] }) });
    const tokens = compiled.tokens.map((t) => t.address);
    const shipped = await ship(pub, wallet, cfg.aqua, cfg.router, compiled.bytes, tokens, amounts);
    const td = await pub.readContract({ address: cfg.takerData, abi: takerDataAbi, functionName: "build", args: [cfg.taker, true] });
    const ledger = (a: Address) => amounts[tokens.findIndex((t) => t.toLowerCase() === a.toLowerCase())];
    const quote = async (tokenIn: Address, tokenOut: Address, amountIn: bigint) => {
      const [, out] = await pub.readContract({ address: cfg.router, abi: routerAbi, functionName: "quote", args: [shipped.order, tokenIn, tokenOut, amountIn, td], account: cfg.taker });
      if (out === 0n) throw new Error(`the draft quotes nothing for ${tokenIn.slice(0, 8)} -> ${tokenOut.slice(0, 8)}`);
      return out;
    };
    const draft: Draft = { pairs: {}, loop: null };
    for (const pair of compiled.pairs) {
      // probes at a twentieth of the ledger, well inside any sane cap; a cap tighter than that is a rejection
      const { asset, numeraire } = conventional(pair);
      const sellIn = ledger(asset.address) / 20n; const buyIn = ledger(numeraire.address) / 20n;
      const sellOut = await quote(asset.address, numeraire.address, sellIn);
      const buyOut = await quote(numeraire.address, asset.address, buyIn);
      const sell = Number(formatUnits(sellOut, numeraire.decimals)) / Number(formatUnits(sellIn, asset.decimals));
      const buy = Number(formatUnits(buyIn, numeraire.decimals)) / Number(formatUnits(buyOut, asset.decimals));
      draft.pairs[pair.name] = { sell, buy };
      if (pair.name === "WETH/USDC") { draft.sell = sell; draft.buy = buy; }
    }
    if (compiled.pairs.length === 3) {
      // the triangle: the arena's passed taker, driven by the engine's account, 50 USDC around and back
      const engine = createWalletClient({ chain, transport: http(rpc), account: privateKeyToAccount(cfg.engineKey) });
      const swap = async (tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint> => {
        const { result } = await pub.simulateContract({ address: cfg.taker, abi: takerAbi, functionName: "swap", args: [shipped.order, tokenIn, tokenOut, amountIn, td], account: engine.account });
        const h = await engine.writeContract({ address: cfg.taker, abi: takerAbi, functionName: "swap", args: [shipped.order, tokenIn, tokenOut, amountIn, td] });
        const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== "success") throw new Error("a leg of the loop reverted");
        return result[1];
      };
      const usdcIn = BigInt(Math.round(cfg.loopUsdc * 1e6));
      const w = await swap(cfg.usdc, cfg.weth, usdcIn); const b = await swap(cfg.weth, cfg.cbbtc, w); const usdcOut = await swap(cfg.cbbtc, cfg.usdc, b);
      draft.loop = { usdcIn: Number(usdcIn) / 1e6, usdcOut: Number(usdcOut) / 1e6 };
      if (usdcOut > usdcIn) throw new Error(`a round trip USDC -> WETH -> cbBTC -> USDC through your three quotes pays the taker ${(Number(usdcOut - usdcIn) / 1e6).toFixed(3)} USDC per ${cfg.loopUsdc}: your three prices disagree; anchor every pair and keep a fee above the pools' discrepancy`);
    }
    return draft;
  } finally {
    child.kill("SIGKILL");
  }
}

// The conventional reading of a pair name: "cbBTC/USDC" prices cbBTC in USDC whichever way the pool is.
function conventional(pair: Pair): { asset: { address: Address; decimals: number }; numeraire: { address: Address; decimals: number } } {
  const [a] = pair.name.split("/");
  return pair.oracleBase.symbol === a ? { asset: pair.oracleBase, numeraire: pair.oracleQuote } : { asset: pair.oracleQuote, numeraire: pair.oracleBase };
}

// Standalone: one gladiator for the open generation. Env: GLADIATOR_KEY, GLADIATOR_NAME.
if (process.argv[1]?.endsWith("gladiator.ts")) {
  const cfg = loadConfig();
  const client = new Anthropic();
  const key = (process.env.GLADIATOR_KEY ?? "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d") as Hex;
  const arena = (process.env.ARENA ?? JSON.parse(readFileSync(REPO_ROOT + "infra/data/gym/addresses.json", "utf8")).arena) as Address;
  runGladiator(cfg, client, key, process.env.GLADIATOR_NAME ?? "solo", process.env.AQUASCAN_API ?? "http://127.0.0.1:3101", arena)
    .catch((err) => { console.error(err); process.exit(1); });
}
