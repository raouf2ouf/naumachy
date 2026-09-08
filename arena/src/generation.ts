import { createPublicClient, createWalletClient, http, keccak256, stringToHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { loadConfig, ledgerFor, REPO_ROOT } from "./config.js";
import { anchoredSpec, compile, summarize, ARCHETYPE_ANCHORED, ARCHETYPE_AUTHORED, type ProgramSpec } from "./program.js";
import { ship } from "./ship.js";
import { aquascanScore, gladiator, lanista, arenaAbi } from "./lanista.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

// One generation of the gym, end to end: the lanista opens it, N gladiators (anvil accounts,
// funded by the caller) ship a seed program and enter, the taker engine trades them for a while,
// Aquascan scores them, the lanista attests the scores, names the champion and closes.
// Knobs: GEN_GLADIATORS, GEN_LEDGER_WETH, GEN_LEDGER_USDC, GEN_LEDGER_CBBTC.
//   node --import tsx src/generation.ts open | score
async function main() {
  const cfg = loadConfig(); const mode = process.argv[2] ?? "open";
  const chain = { id: cfg.chainId, name: "gym", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } } as const;
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const lanistaKey = (process.env.LANISTA_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
  const lan = createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount(lanistaKey) });
  const arena = (process.env.ARENA ?? JSON.parse(readFileSync(process.env.GYM_ADDRESSES ?? REPO_ROOT + "infra/data/gym/addresses.json", "utf8")).arena) as Address;
  const keys = (process.env.GLADIATOR_KEYS ?? [
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",   // anvil 1
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",   // anvil 3
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",   // anvil 4
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",   // anvil 5
  ].join(",")).split(",").map((k) => k.trim() as Hex);
  const n = Number(process.env.GEN_GLADIATORS ?? keys.length);
  const api = process.env.AQUASCAN_API ?? "http://127.0.0.1:3101";

  if (mode === "open") {
    const tape = keccak256(stringToHex(`tape-${Date.now()}`));
    log("lanista opens a generation", await lanista.open(pub, lan, arena, tape));
    const generation = Number(await pub.readContract({ address: arena, abi: arenaAbi, functionName: "currentGeneration" }));
    // four seeds: the anchored archetype at three settings on WETH/USDC, and one that ships all three pairs behind the pass gate
    const seeds: { name: string; spec: ProgramSpec; archetype: Hex }[] = [
      { name: "steady", spec: anchoredSpec({ capBps: 2000, feeBaseBps: 5, feeSlopeBps: 200, feeMaxBps: 50, windowSeconds: 600, depth: 100 }), archetype: ARCHETYPE_ANCHORED },
      { name: "tight", spec: anchoredSpec({ capBps: 2000, feeBaseBps: 2, feeSlopeBps: 400, feeMaxBps: 40, windowSeconds: 600, depth: 200 }), archetype: ARCHETYPE_ANCHORED },
      { name: "wide", spec: anchoredSpec({ capBps: 2000, feeBaseBps: 15, feeSlopeBps: 100, feeMaxBps: 80, windowSeconds: 600, depth: 50 }), archetype: ARCHETYPE_ANCHORED },
      { name: "flat", spec: { pairs: ["WETH/USDC", "cbBTC/USDC", "cbBTC/WETH"], capBps: 2000, ops: [{ op: "gate" }, { op: "flatFee", bps: 8 }, { op: "anchor", depth: 100 }, { op: "xyc" }] }, archetype: ARCHETYPE_AUTHORED },
    ];
    const dir = `${REPO_ROOT}infra/data/gym/generations`; mkdirSync(dir, { recursive: true });
    for (let i = 0; i < n; i += 1) {
      const seed = seeds[i % seeds.length];
      const w = createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount(keys[i]) });
      const spec = { ...seed.spec, salt: BigInt(keccak256(toHex(`${seed.name}-${generation}-${Date.now()}`))) };
      const compiled = compile(spec, cfg.market);
      const tokens = compiled.tokens.map((t) => t.address); const amounts = ledgerFor(compiled.tokens);
      const shipped = await ship(pub, w, cfg.aqua, cfg.router, compiled.bytes, tokens, amounts);
      const name = stringToHex(seed.name, { size: 32 });
      await gladiator.register(pub, w, arena, name, "0x0000000000000000000000000000000000000000");
      await gladiator.enter(pub, w, arena, shipped.strategyHash, seed.archetype);
      const knobs = { ...summarize(spec), parent: null, rationale: `Seeded by the lanista: ${seed.name}.` };
      writeFileSync(`${dir}/${generation}-${w.account!.address.toLowerCase()}.json`, JSON.stringify({ generation, name: seed.name, address: w.account!.address, mind: "seed", spec: { ...spec, salt: spec.salt.toString() }, listing: compiled.listing, knobs, program: compiled.bytes, tokens, ledger: amounts.map(String), pairs: compiled.pairs.map((p) => p.name), blob: shipped.blob, strategyHash: shipped.strategyHash, draft: null, rejected: [], transcript: [], context: null }, null, 1));
      log(`gladiator ${seed.name} ${w.account!.address.slice(0, 10)} shipped ${shipped.strategyHash.slice(0, 12)} on ${compiled.pairs.map((p) => p.name).join(", ")} and entered generation ${generation}`);
      for (const line of compiled.listing) log(`     ${line}`);
    }
    log(`generation ${generation} open with ${n} gladiators; run the engine, then: generation.ts score`);
    return;
  }

  if (mode === "score") {
    const generation = await pub.readContract({ address: arena, abi: arenaAbi, functionName: "currentGeneration" });
    // entries from the gym arena subgraph, scores from the gym Aquascan API
    const q = `{ entries(where: { generation: "${generation}" }) { gladiator { id } strategyHash } }`;
    const res = await fetch(cfg.gymSubgraph.replace("aqua-gym", "arena-gym"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
    const entries = ((await res.json()) as { data: { entries: { gladiator: { id: Address }; strategyHash: Hex }[] } }).data.entries;
    let champion: { gladiator: Address; hash: Hex; score: bigint } | null = null;
    for (const e of entries) {
      const strategyId = e.gladiator.id + cfg.router.slice(2) + e.strategyHash.slice(2);
      const s = await aquascanScore(api, "base", strategyId);
      const scoreQuote = BigInt(Math.round((s.scoreUsd ?? 0) * 1e6));                  // USDC has 6 decimals
      const seQuote = BigInt(Math.round(((s.seBps ?? 0) / 1e4) * (s.volume ?? 0) * 1e6));
      await lanista.score(pub, lan, arena, generation, e.gladiator.id, e.strategyHash, scoreQuote, seQuote, s.fills, cfg.usdc);
      log(`scored ${e.gladiator.id.slice(0, 10)} ${e.strategyHash.slice(0, 12)}: 5-min markout ${s.scoreUsd?.toFixed(2) ?? "none"} USD (${s.bps?.toFixed(1) ?? "?"} ± ${s.seBps?.toFixed(1) ?? "?"} bps) on ${s.fills} fills`);
      if (s.scoreUsd !== null && (!champion || scoreQuote > champion.score)) champion = { gladiator: e.gladiator.id, hash: e.strategyHash, score: scoreQuote };
    }
    if (champion) {
      await lanista.close(pub, lan, arena, generation, champion.gladiator, champion.hash, champion.score);
      log(`generation ${generation} closed; champion ${champion.gladiator.slice(0, 10)} with ${Number(champion.score) / 1e6} USDC of 5-minute markout`);
    } else {
      await lanista.close(pub, lan, arena, generation, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000000000", 0n);
      log(`generation ${generation} closed without a champion: nothing scored yet`);
    }
    return;
  }
  throw new Error(`unknown mode ${mode}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
