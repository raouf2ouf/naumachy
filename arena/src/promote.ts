import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, http, nonceManager, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, REPO_ROOT } from "./config.js";
import { lanista } from "./lanista.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

// The rudis. A season's champion is granted a real bankroll, and that is the one act nothing in
// the arena can do alone: the prize sits on the operator's Ledger account, the transfer is signed
// on the device, and only once it is mined does the lanista write `promote` on the registry so the
// arena subgraph and the Arena page carry it. Run on the machine with the Flex:
//   yarn workspace @naumachy/arena promote            # names the champion, prints the command, waits for the transfer, promotes
//   yarn workspace @naumachy/arena promote --dry-run  # the request only
//   yarn workspace @naumachy/arena promote --tx 0x…   # verify this transfer instead of watching the chain
// Env: SEASON_GENERATIONS (4), PRIZE_USDC (30), PRIZE_ACCOUNT (base-1, the wallet-cli label), WAIT_MINUTES (30), LANISTA_KEY.
interface Gen { number: number; closedAt: string | null; champion: { id: Address; name: string } | null; entries: { gladiator: { id: Address; name: string }; strategyHash: Hex; score: { scoreQuote: string } | null }[] }
const name = (hex: string) => Buffer.from(hex.slice(2), "hex").toString("utf8").replace(/\0+$/, "");
const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

async function main() {
  const cfg = loadConfig();
  const dryRun = process.argv.includes("--dry-run");
  const givenTx = process.argv[process.argv.indexOf("--tx") + 1] as Hex | undefined;
  const season = Number(process.env.SEASON_GENERATIONS ?? 4);
  const prizeUsdc = Number(process.env.PRIZE_USDC ?? 30); const prize = BigInt(Math.round(prizeUsdc * 1e6));
  const account = process.env.PRIZE_ACCOUNT ?? "base-1";
  const chain = { id: cfg.chainId, name: "base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } } as const;
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const arena = (process.env.ARENA ?? JSON.parse(readFileSync(process.env.GYM_ADDRESSES ?? REPO_ROOT + "infra/data/gym/addresses.json", "utf8")).arena) as Address;

  // the season: the last closed generations, the record as the lanista attested it
  const res = await fetch(cfg.arenaSubgraph, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ query: `{ generations(where: { closedAt_not: null }, orderBy: number, orderDirection: desc, first: ${season}) { number closedAt champion { id name } entries { gladiator { id name } strategyHash score { scoreQuote } } } }` }) });
  const gens = ((await res.json()) as { data?: { generations: Gen[] } }).data?.generations ?? [];
  if (!gens.length) { log("no closed generation yet: nothing to promote"); return; }
  const tally = new Map<string, { address: Address; name: string; wins: number; score: bigint; hash: Hex }>();
  for (const g of gens) {
    if (!g.champion) continue;
    const e = g.entries.find((x) => x.gladiator.id.toLowerCase() === g.champion!.id.toLowerCase());
    const t = tally.get(g.champion.id.toLowerCase()) ?? { address: g.champion.id, name: name(g.champion.name), wins: 0, score: 0n, hash: e?.strategyHash ?? ("0x" + "0".repeat(64)) as Hex };
    t.wins += 1; t.score += BigInt(e?.score?.scoreQuote ?? 0);
    if (!tally.has(g.champion.id.toLowerCase())) tally.set(g.champion.id.toLowerCase(), t);   // the hash kept is the most recent win's
  }
  const ranked = [...tally.values()].sort((a, b) => b.wins - a.wins || (b.score > a.score ? 1 : b.score < a.score ? -1 : 0));
  if (!ranked.length) { log(`${gens.length} closed generation(s), none with a champion: nothing to promote`); return; }
  const champion = ranked[0];
  log(`season of ${gens.length} closed generation(s) (${gens.map((g) => g.number).reverse().join(", ")}):`);
  for (const r of ranked) log(`   ${r.name.padEnd(7)} ${r.address}  ${r.wins} win(s), attested ${formatUnits(r.score, 6)} USDC`);
  log(`champion: ${champion.name} ${champion.address}, strategy ${champion.hash}`);
  log("");
  log(`PROMOTION REQUEST: ${prizeUsdc} USDC from the Ledger account ${account} to ${champion.name}. Sign it on the Flex:`);
  log(`   wallet-cli send --account ${account} --to ${champion.address} --amount '${prizeUsdc} USDC'`);
  log("");
  if (dryRun) { log("dry run: nothing waits, nothing is written"); return; }

  // the transfer: given as a hash, or watched on the chain from now; either way it must be a USDC transfer of at least the prize to the champion
  let transfer: { tx: Hex; from: Address; value: bigint } | null = null;
  const from = await pub.getBlockNumber();
  const deadline = Date.now() + Number(process.env.WAIT_MINUTES ?? 30) * 60_000;
  if (givenTx) {
    const r = await pub.getTransactionReceipt({ hash: givenTx });
    const logs = await pub.getLogs({ address: cfg.usdc, event: TRANSFER, args: { to: champion.address }, fromBlock: r.blockNumber, toBlock: r.blockNumber });
    const hit = logs.find((l) => l.transactionHash === givenTx && (l.args.value ?? 0n) >= prize);
    if (!hit) throw new Error(`${givenTx} carries no USDC transfer of at least ${prizeUsdc} to ${champion.address}`);
    transfer = { tx: givenTx, from: hit.args.from!, value: hit.args.value! };
  } else {
    log(`waiting for the transfer (up to ${process.env.WAIT_MINUTES ?? 30} minutes)…`);
    while (!transfer && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10_000));
      const logs = await pub.getLogs({ address: cfg.usdc, event: TRANSFER, args: { to: champion.address }, fromBlock: from }).catch(() => []);
      const hit = logs.find((l) => (l.args.value ?? 0n) >= prize);
      if (hit) transfer = { tx: hit.transactionHash, from: hit.args.from!, value: hit.args.value! };
    }
    if (!transfer) { log("no transfer seen before the deadline; nothing promoted"); process.exit(2); }
  }
  log(`transfer seen: ${formatUnits(transfer.value, 6)} USDC from ${transfer.from} in ${transfer.tx}`);

  // only now the record: the lanista writes the promotion on the registry
  const lanKey = process.env.LANISTA_KEY as Hex | undefined; if (!lanKey) throw new Error("LANISTA_KEY is not set");
  const lan = createWalletClient({ chain, transport: http(cfg.rpc), account: privateKeyToAccount(lanKey, { nonceManager }) });
  const tx = await lanista.promote(pub, lan, arena, champion.address, champion.hash, BigInt(cfg.chainId), transfer.value);
  log(`promoted on the registry: ${tx}`);
  const dir = `${cfg.generationsDir}/../promotions`; if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const record = { at: new Date().toISOString(), season: gens.map((g) => g.number), ranking: ranked.map((r) => ({ ...r, score: r.score.toString() })), champion: champion.address, name: champion.name, strategyHash: champion.hash, prizeUsdc: formatUnits(transfer.value, 6), prizeFrom: transfer.from, ledgerAccount: account, transferTx: transfer.tx, promoteTx: tx };
  writeFileSync(`${dir}/${Date.now()}-${champion.address.toLowerCase()}.json`, JSON.stringify(record, null, 1));
  log(`record written under ${dir}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
