import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, REPO_ROOT } from "@naumachy/arena/config";
import { aquascanScore, lanista, arenaAbi } from "@naumachy/arena/lanista";
import { runGladiator } from "./gladiator.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

// Evolution: G generations in a row. Each one the lanista opens, every gladiator's mind reads the
// results so far and writes its next program, the taker engine trades them for GEN_MINUTES, Aquascan
// scores them, the lanista attests, crowns and closes. Minds see every program (bytes on chain,
// listed in the dialect) and the champion's, so losers can copy and mutate; lineage goes on chain as `parent`.
async function main() {
  const cfg = loadConfig();
  const client = new Anthropic();
  const chain = { id: cfg.chainId, name: "gym", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } } as const;
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const lan = createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount((process.env.LANISTA_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80") as Hex) });
  const arena = (process.env.ARENA ?? JSON.parse(readFileSync(REPO_ROOT + "infra/data/gym/addresses.json", "utf8")).arena) as Address;
  const api = process.env.AQUASCAN_API ?? "http://127.0.0.1:3101";
  const rounds = Number(process.env.GENERATIONS ?? 2); const minutes = Number(process.env.GEN_MINUTES ?? 8);
  const roster: { name: string; key: Hex }[] = (process.env.GLADIATORS ?? "steady:0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d,tight:0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6,wide:0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a,flat:0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba")
    .split(",").map((s) => { const [name, key] = s.split(":"); return { name, key: key as Hex }; });

  for (let round = 0; round < rounds; round += 1) {
    // a generation left open by an earlier run is reused, never abandoned
    const already = await pub.readContract({ address: arena, abi: arenaAbi, functionName: "currentGeneration" }).catch(() => null);
    if (already === null) await lanista.open(pub, lan, arena, keccak256(stringToHex(`tape-${round % 2 === 0 ? "train" : "holdout"}-${Date.now()}`)));
    const generation = Number(await pub.readContract({ address: arena, abi: arenaAbi, functionName: "currentGeneration" }));
    log(`generation ${generation} ${already === null ? `open (${round % 2 === 0 ? "train" : "hold-out"} tape)` : "was still open, reusing it"}; the ${process.env.GLADIATOR_MIND === "heuristic" ? "heuristic controls" : "minds"} are writing`);
    const entries: { name: string; address: Address; hash: Hex }[] = [];
    for (const g of roster) {
      try {
        const r = await runGladiator(cfg, client, g.key, g.name, api, arena);
        entries.push({ name: r.name, address: r.address, hash: r.strategyHash });
      } catch (err) { log(`${g.name} sits this one out: ${String(err).slice(0, 200)}`); }
    }
    log(`${entries.length} gladiators entered; the engine trades for ${minutes} minutes`);
    await new Promise((r) => setTimeout(r, minutes * 60_000));
    // Aquascan marks a fill five minutes after it and the rollup passes about once a minute: wait
    // until every entry carries a five-minute markout, up to SCORE_WAIT_MINUTES more, then score.
    const ids = entries.map((e) => (e.address + cfg.router.slice(2) + e.hash.slice(2)).toLowerCase());
    for (const deadline = Date.now() + Number(process.env.SCORE_WAIT_MINUTES ?? 6) * 60_000; Date.now() < deadline;) {
      const marked = (await Promise.all(ids.map((id) => aquascanScore(api, "base", id).catch(() => null)))).filter((s) => s && s.scoreUsd !== null).length;
      if (marked === ids.length) break;
      log(`  waiting for Aquascan's five-minute marks (${marked}/${ids.length})`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
    let champion: { address: Address; hash: Hex; score: bigint } | null = null;
    for (const e of entries) {
      const s = await aquascanScore(api, "base", (e.address + cfg.router.slice(2) + e.hash.slice(2)).toLowerCase());   // Aquascan ids are lowercase
      const scoreQuote = BigInt(Math.round((s.scoreUsd ?? 0) * 1e6)); const seQuote = BigInt(Math.round(((s.seBps ?? 0) / 1e4) * (s.volume ?? 0) * 1e6));
      await lanista.score(pub, lan, arena, generation, e.address, e.hash, scoreQuote, seQuote, s.fills, cfg.usdc);
      log(`  ${e.name.padEnd(7)} ${s.bps?.toFixed(1) ?? "?"} ± ${s.seBps?.toFixed(1) ?? "?"} bps, ${s.scoreUsd?.toFixed(2) ?? "none"} USD on ${s.fills} fills`);
      if (s.scoreUsd !== null && (!champion || scoreQuote > champion.score)) champion = { address: e.address, hash: e.hash, score: scoreQuote };
    }
    if (champion) { await lanista.close(pub, lan, arena, generation, champion.address, champion.hash, champion.score); log(`generation ${generation} closed; champion ${entries.find((e) => e.address === champion!.address)?.name}`); }
    else { await lanista.close(pub, lan, arena, generation, "0x0000000000000000000000000000000000000000", "0x0000000000000000000000000000000000000000000000000000000000000000", 0n); log(`generation ${generation} closed without a champion`); }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
