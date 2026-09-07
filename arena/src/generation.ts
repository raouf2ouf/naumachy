import { createPublicClient, createWalletClient, http, keccak256, stringToHex, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "./config.js";
import { anchoredProgram, ARCHETYPE_ANCHORED } from "./program.js";
import { ship } from "./ship.js";
import { aquascanScore, gladiator, lanista } from "./lanista.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

// One generation of the gym, end to end: the lanista opens it, N gladiators (anvil accounts,
// funded by the caller) ship a variation of the anchored archetype and enter, the taker engine
// trades them for a while, Aquascan scores them, the lanista attests the scores, names the
// champion and closes. Knobs: GEN_MINUTES, GEN_GLADIATORS, GEN_LEDGER_WETH, GEN_LEDGER_USDC.
//   node --import tsx src/generation.ts open | score
async function main() {
  const cfg = loadConfig(); const mode = process.argv[2] ?? "open";
  const chain = { id: cfg.chainId, name: "gym", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } } as const;
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const lanistaKey = (process.env.LANISTA_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex;
  const lan = createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount(lanistaKey) });
  const arena = (process.env.ARENA ?? JSON.parse(await (await import("node:fs/promises")).readFile(process.env.GYM_ADDRESSES ?? cfgRoot() + "infra/data/gym/addresses.json", "utf8")).arena) as Address;
  const keys = (process.env.GLADIATOR_KEYS ?? [
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",   // anvil 1
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",   // anvil 3
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",   // anvil 4
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",   // anvil 5
  ].join(",")).split(",").map((k) => k.trim() as Hex);
  const n = Number(process.env.GEN_GLADIATORS ?? keys.length);
  const ledgerWeth = BigInt(process.env.GEN_LEDGER_WETH ?? "1000000000000000000"); const ledgerUsdc = BigInt(process.env.GEN_LEDGER_USDC ?? "2500000000");
  const api = process.env.AQUASCAN_API ?? "http://127.0.0.1:3101";

  if (mode === "open") {
    const tape = keccak256(stringToHex(`tape-${Date.now()}`));
    log("lanista opens a generation", await lanista.open(pub, lan, arena, tape));
    const generation = await pub.readContract({ address: arena, abi: (await import("./lanista.js")).arenaAbi, functionName: "currentGeneration" });
    // variations of the anchored archetype: fee at rest, slope, depth
    const variants = [
      { name: "steady", feeBaseBps: 5, feeSlopeBps: 200, feeMaxBps: 50, depth: 100 },
      { name: "tight", feeBaseBps: 2, feeSlopeBps: 400, feeMaxBps: 40, depth: 200 },
      { name: "wide", feeBaseBps: 15, feeSlopeBps: 100, feeMaxBps: 80, depth: 50 },
      { name: "flat", feeBaseBps: 8, feeSlopeBps: 0, feeMaxBps: 8, depth: 100 },
    ];
    for (let i = 0; i < n; i += 1) {
      const v = variants[i % variants.length];
      const w = createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount(keys[i]) });
      const program = anchoredProgram({ capBps: 2000, windowSeconds: 600, oracle: cfg.oracle, base: cfg.weth, oracleDecimals: 18, baseDecimals: 18, quoteDecimals: 6, maxStaleness: 0, salt: BigInt(keccak256(toHex(`${v.name}-${generation}-${Date.now()}`))), ...v });
      const shipped = await ship(pub, w, cfg.aqua, cfg.router, program, [cfg.weth, cfg.usdc], [ledgerWeth, ledgerUsdc]);
      const name = stringToHex(v.name, { size: 32 });
      await gladiator.register(pub, w, arena, name, "0x0000000000000000000000000000000000000000");
      await gladiator.enter(pub, w, arena, shipped.strategyHash, ARCHETYPE_ANCHORED);
      log(`gladiator ${v.name} ${w.account!.address.slice(0, 10)} shipped ${shipped.strategyHash.slice(0, 12)} and entered generation ${generation}`);
    }
    log(`generation ${generation} open with ${n} gladiators; run the engine, then: generation.ts score`);
    return;
  }

  if (mode === "score") {
    const { arenaAbi } = await import("./lanista.js");
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
      log(`scored ${e.gladiator.id.slice(0, 10)} ${e.strategyHash.slice(0, 12)}: 5-min markout ${s.scoreUsd?.toFixed(2) ?? "none"} USD (${s.bps?.toFixed(1) ?? "?"} ± ${s.seBps?.toFixed(1) ?? "?"} bps) on ${s.fills} fills, edge ${s.edgeUsd?.toFixed(2) ?? "none"}`);
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

function cfgRoot(): string { return (globalThis as unknown as { REPO_ROOT?: string }).REPO_ROOT ?? new URL("../../", import.meta.url).pathname; }

main().catch((err) => { console.error(err); process.exit(1); });
