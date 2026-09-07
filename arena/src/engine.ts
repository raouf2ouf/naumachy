import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, REPO_ROOT } from "./config.js";
import { erc20Abi, oracleAbi, routerAbi, swapRouter02Abi, takerAbi, takerDataAbi } from "./abi.js";
import { liveGladiators, type Gladiator } from "./orders.js";
import { loadTape } from "./tape.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

// The taker engine: the arena's flow. Every tick it replays the next swaps of the tape through the
// gym's pool, then looks at every live gladiator: an informed take when a quote beats the pool by
// more than the edge threshold (the arbitrage that bleeds mainnet desks), an uninformed take at
// random with a small size (the spread income a maker lives on). Fills go through the Taker
// contract, so Aqua's ledger, the subgraph and Aquascan see them like any other fill.
async function main() {
  const cfg = loadConfig();
  const account = privateKeyToAccount(cfg.engineKey);
  const chain = { id: cfg.chainId, name: "gym", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } } as const;
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const wallet = createWalletClient({ chain, transport: http(cfg.rpc), account });
  const forkBlock = BigInt(readFileSync(process.env.GYM_FORK_BLOCK_FILE ?? REPO_ROOT + "infra/data/gym/fork-block", "utf8").trim());
  const forkTs = Number((await pub.getBlock({ blockNumber: forkBlock })).timestamp);
  const takerData = { in: await pub.readContract({ address: cfg.takerData, abi: takerDataAbi, functionName: "build", args: [cfg.taker, true] }) };

  // approvals for the tape replay through the Uniswap router
  for (const token of [cfg.weth, cfg.usdc]) {
    const allowance = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, cfg.swapRouter02] });
    if (allowance === 0n) await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [cfg.swapRouter02, 2n ** 255n] });
  }
  const tape = await loadTape(cfg, forkTs);
  log(`engine ${account.address} | tape ${tape.length} swaps over ${cfg.tapeMinutes} min (scale ${cfg.tapeScale}) | probe $${cfg.probeUsd} noise $${cfg.noiseUsd} p=${cfg.noiseProbability} edge ${cfg.edgeBps} bps`);

  let gladiators: Gladiator[] = []; let tapeIndex = 0; const started = Date.now();
  let fills = 0; let arbs = 0; let tick = 0;
  try { gladiators = await liveGladiators(cfg.gymSubgraph, cfg.router); } catch (err) { log(String(err).slice(0, 160)); }
  for (;;) {
    const elapsed = (Date.now() - started) / 1000;
    // the tape: swaps due by now, at Base's own pace. Informed flow is the tape read one step ahead:
    // before a swap large enough to move the pool replays, the taker trades the gladiators in that
    // direction at the old price, which is what an arbitrageur who sees the order flow does.
    while (tapeIndex < tape.length && tape[tapeIndex].at <= elapsed) {
      const s = tape[tapeIndex++];
      const priceNow = await pub.readContract({ address: cfg.oracle, abi: oracleAbi, functionName: "latestAnswer" });
      const usdSize = s.sellWeth ? Number(formatUnits(s.amountIn * priceNow / 10n ** 18n, 18)) : Number(formatUnits(s.amountIn, 6));
      if (usdSize >= cfg.informedMinUsd) {
        const amt = BigInt(Math.round(Math.min(usdSize / 4, cfg.probeUsd * 2) * 1e6));   // a slice of it, inside the caps
        for (const g of gladiators) {
          const took = s.sellWeth
            ? await take(wallet, cfg, g, cfg.weth, cfg.usdc, amt * 10n ** 30n / priceNow, takerData.in, "informed: sells WETH ahead of the tape")
            : await take(wallet, cfg, g, cfg.usdc, cfg.weth, amt, takerData.in, "informed: buys WETH ahead of the tape");
          if (took) { fills += 1; arbs += 1; log(`${g.maker.slice(0, 10)} ${took} | tape ${tapeIndex}/${tape.length}`); }
        }
      }
      try {
        await wallet.writeContract({ address: cfg.swapRouter02, abi: swapRouter02Abi, functionName: "exactInputSingle",
          args: [{ tokenIn: s.sellWeth ? cfg.weth : cfg.usdc, tokenOut: s.sellWeth ? cfg.usdc : cfg.weth, fee: 500, recipient: account.address, amountIn: s.amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
      } catch (err) { log(`tape swap failed: ${String(err).slice(0, 120)}`); }
    }
    // a silent tape still needs a moving pool: random swaps through it, so prints exist and the price wobbles
    if (tape.length === 0 && Math.random() < cfg.poolNoiseProbability) {
      const sellWeth = Math.random() < 0.5; const usd = Math.max(50, Math.round(Math.random() * cfg.poolNoiseUsd));
      const price0 = await pub.readContract({ address: cfg.oracle, abi: oracleAbi, functionName: "latestAnswer" });
      const amountIn = sellWeth ? BigInt(usd) * 10n ** 36n / price0 : BigInt(usd) * 10n ** 6n;
      try {
        await wallet.writeContract({ address: cfg.swapRouter02, abi: swapRouter02Abi, functionName: "exactInputSingle",
          args: [{ tokenIn: sellWeth ? cfg.weth : cfg.usdc, tokenOut: sellWeth ? cfg.usdc : cfg.weth, fee: 500, recipient: account.address, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });
      } catch (err) { log(`pool noise failed: ${String(err).slice(0, 120)}`); }
    }
    tick += 1;
    if (tick % 15 === 1 || gladiators.length === 0) {     // every 15 ticks, about half a minute, the roster is re-read
      try { gladiators = await liveGladiators(cfg.gymSubgraph, cfg.router); } catch (err) { log(String(err).slice(0, 160)); }
    }
    const price = await pub.readContract({ address: cfg.oracle, abi: oracleAbi, functionName: "latestAnswer" });   // USDC per WETH, 1e18
    for (const g of gladiators) {
      const probeUsdc = BigInt(Math.round(cfg.probeUsd * 1e6));
      const probeWeth = probeUsdc * 10n ** 30n / price;                                   // the same value in WETH
      // informed: does the gladiator sell WETH cheaper, or buy WETH dearer, than the pool by more than the edge?
      const buyWeth = await quote(pub, cfg, g, cfg.usdc, cfg.weth, probeUsdc, takerData.in);
      const sellWeth = await quote(pub, cfg, g, cfg.weth, cfg.usdc, probeWeth, takerData.in);
      const fairWeth = probeUsdc * 10n ** 30n / price; const fairUsdc = probeWeth * price / 10n ** 30n;
      const edge = BigInt(Math.round(cfg.edgeBps * 1e5));                                  // 1e9 base
      let took: string | null = null;
      if (buyWeth !== null && buyWeth > fairWeth * (1_000_000_000n + edge) / 1_000_000_000n) took = await take(wallet, cfg, g, cfg.usdc, cfg.weth, probeUsdc, takerData.in, "arb: buys WETH below the pool");
      else if (sellWeth !== null && sellWeth > fairUsdc * (1_000_000_000n + edge) / 1_000_000_000n) took = await take(wallet, cfg, g, cfg.weth, cfg.usdc, probeWeth, takerData.in, "arb: sells WETH above the pool");
      else if (Math.random() < cfg.noiseProbability) {
        const usd = Math.max(1, Math.round(Math.random() * cfg.noiseUsd));
        const amt = BigInt(usd * 1e6);
        took = Math.random() < 0.5
          ? await take(wallet, cfg, g, cfg.usdc, cfg.weth, amt, takerData.in, "noise: buys WETH")
          : await take(wallet, cfg, g, cfg.weth, cfg.usdc, amt * 10n ** 30n / price, takerData.in, "noise: sells WETH");
      }
      if (took) { fills += 1; if (took.startsWith("arb")) arbs += 1; log(`${g.maker.slice(0, 10)} ${took} | pool ${formatUnits(price, 18)} | fills ${fills} (arbs ${arbs}) | tape ${tapeIndex}/${tape.length}`); }
    }
    await new Promise((r) => setTimeout(r, cfg.tickMs));
  }
}

async function quote(pub: ReturnType<typeof createPublicClient>, cfg: ReturnType<typeof loadConfig>, g: Gladiator, tokenIn: Address, tokenOut: Address, amount: bigint, td: Hex): Promise<bigint | null> {
  try {
    const [, out] = await pub.readContract({ address: cfg.router, abi: routerAbi, functionName: "quote", args: [g.order, tokenIn, tokenOut, amount, td] });
    return out;
  } catch { return null; }   // a cap or an empty side: no quote, no take
}

async function take(wallet: ReturnType<typeof createWalletClient>, cfg: ReturnType<typeof loadConfig>, g: Gladiator, tokenIn: Address, tokenOut: Address, amount: bigint, td: Hex, why: string): Promise<string | null> {
  try {
    const hash = await wallet.writeContract({ address: cfg.taker, abi: takerAbi, functionName: "swap", args: [g.order, tokenIn, tokenOut, amount, td], chain: wallet.chain, account: wallet.account! });
    return `${why} ${tokenIn === cfg.usdc ? formatUnits(amount, 6) + " USDC" : formatUnits(amount, 18) + " WETH"} in (${hash.slice(0, 10)})`;
  } catch (err) { log(`take failed ${why}: ${String(err).slice(0, 140)}`); return null; }
}

main().catch((err) => { console.error(err); process.exit(1); });
