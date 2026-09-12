import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatUnits, nonceManager, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig, REPO_ROOT, type Config } from "./config.js";
import { erc20Abi, oracleAbi, routerAbi, swapRouter02Abi, takerAbi, takerDataAbi } from "./abi.js";
import { liveGladiators, quotesPair, type Gladiator } from "./orders.js";
import { futurePrice, loadTape } from "./tape.js";
import type { Pair, Token } from "./program.js";

const log = (...p: unknown[]) => console.log(new Date().toISOString(), ...p);

interface TakerRt { name: "pass" | "raider"; address: Address; td: Hex }

// The taker engine: the arena's flow, on every pair the arena trades. Every tick it replays the
// next swaps of the tape through the gym's pools, then looks at every live gladiator on every pair
// it ships: an arbitrage take when a quote beats the pool by more than the edge threshold, and, at
// random, one uninformed order that shops: it
// quotes every gladiator at its size and goes to the best one if that beats the pool, or if it is
// within the taker's own tolerance of the pool's mid (a lazy taker who does not route); otherwise
// it trades the pool. The informed taker reads the tape ahead and trades a coming move first. Orders arrive through one of two takers: one holds an arena pass (routed
// flow), the other is anonymous (the raider). A gladiator that gates on the pass never sees the
// raider, and never sees the share of the flow that comes without one. Fills go through the Taker
// contracts, so Aqua's ledger, the subgraph and Aquascan see them like any other fill.
async function main() {
  const cfg = loadConfig();
  const account = privateKeyToAccount(cfg.engineKey, { nonceManager });   // a lagging RPC nonce is answered with the last used plus one
  const chain = { id: cfg.chainId, name: "gym", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [cfg.rpc] } } } as const;
  const pub = createPublicClient({ chain, transport: http(cfg.rpc) });
  const wallet = createWalletClient({ chain, transport: http(cfg.rpc), account });
  // the gym replays a tape from the fork's timestamp; a live chain has no fork and no tape
  const forkTs = cfg.live ? 0 : Number((await pub.getBlock({ blockNumber: BigInt(readFileSync(process.env.GYM_FORK_BLOCK_FILE ?? REPO_ROOT + "infra/data/gym/fork-block", "utf8").trim()) })).timestamp);
  const takers: Record<"pass" | "raider", TakerRt> = {
    pass: { name: "pass", address: cfg.taker, td: await pub.readContract({ address: cfg.takerData, abi: takerDataAbi, functionName: "build", args: [cfg.taker, true] }) },
    raider: { name: "raider", address: cfg.raider, td: await pub.readContract({ address: cfg.takerData, abi: takerDataAbi, functionName: "build", args: [cfg.raider, true] }) },
  };
  const pick = (passShare: number): TakerRt => (Math.random() < passShare ? takers.pass : takers.raider);
  const { market } = cfg;
  const sym = (a: Address) => market.tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? a.slice(0, 8);
  const token = (a: Address): Token => market.tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())!;
  const fmt = (a: Address, amount: bigint) => `${Number(formatUnits(amount, token(a).decimals)).toFixed(token(a).decimals === 6 ? 2 : 5)} ${sym(a)}`;

  // approvals for the tape replay through the Uniswap router; a live engine never swaps the pools
  if (!cfg.live) for (const t of market.tokens) {
    const allowance = await pub.readContract({ address: t.address, abi: erc20Abi, functionName: "allowance", args: [account.address, cfg.swapRouter02] });
    if (allowance === 0n) await wallet.writeContract({ address: t.address, abi: erc20Abi, functionName: "approve", args: [cfg.swapRouter02, 2n ** 255n] });
  }
  const tape = cfg.live ? [] : await loadTape(cfg, forkTs);
  log(`engine ${account.address} | ${cfg.live ? "LIVE: real pools, the takers' own inventory, no tape" : "gym"} | pairs ${market.pairs.map((p) => p.name).join(", ")} | tape ${tape.length} swaps over ${cfg.tapeMinutes} min (scale ${cfg.tapeScale}) | probe $${cfg.probeUsd} noise $${cfg.noiseUsd} p=${cfg.noiseProbability} edge ${cfg.edgeBps} bps | tolerance ${cfg.toleranceBps} bps | informed: ${cfg.informedMoveBps} bps move ${cfg.informedHorizonS} s ahead, p=${cfg.informedProbability}, $${cfg.informedUsd} | pass share flow ${cfg.flowPassShare} informed ${cfg.informedPassShare}`);

  // prices: quote per base, 18 decimals, per pair; USD through the pair with USDC
  const price = (pair: Pair) => pub.readContract({ address: pair.oracle, abi: oracleAbi, functionName: "latestAnswer" });
  const fairOut = (pair: Pair, p: bigint, tokenIn: Address, amountIn: bigint): bigint => {
    const bd = BigInt(pair.oracleBase.decimals); const qd = BigInt(pair.oracleQuote.decimals);
    return tokenIn.toLowerCase() === pair.oracleBase.address.toLowerCase()
      ? amountIn * p * 10n ** qd / 10n ** (18n + bd)
      : amountIn * 10n ** (18n + bd) / (p * 10n ** qd);
  };
  const usdPair = (a: Address): Pair | null => a.toLowerCase() === cfg.usdc.toLowerCase() ? null : market.pairs.find((p) => [p.oracleBase.address, p.oracleQuote.address].map((x) => x.toLowerCase()).includes(a.toLowerCase()) && [p.oracleBase.address, p.oracleQuote.address].map((x) => x.toLowerCase()).includes(cfg.usdc.toLowerCase())) ?? null;
  const usdValue = async (a: Address, amount: bigint): Promise<number> => {
    const p = usdPair(a); if (!p) return Number(formatUnits(amount, 6));
    return Number(formatUnits(fairOut(p, await price(p), a, amount), 6));
  };
  const amountForUsd = async (a: Address, usd: number): Promise<bigint> => {
    const p = usdPair(a); const usdc = BigInt(Math.round(usd * 1e6)); if (!p) return usdc;
    return fairOut(p, await price(p), cfg.usdc, usdc);
  };
  const poolSwap = async (pair: Pair, tokenIn: Address, tokenOut: Address, amountIn: bigint) =>
    wallet.writeContract({ address: cfg.swapRouter02, abi: swapRouter02Abi, functionName: "exactInputSingle",
      args: [{ tokenIn, tokenOut, fee: pair.feeTier, recipient: account.address, amountIn, amountOutMinimum: 0n, sqrtPriceLimitX96: 0n }] });

  let gladiators: Gladiator[] = []; let tapeIndex = 0; const started = Date.now();
  let fills = 0; let arbs = 0; let tick = 0;
  try { gladiators = await liveGladiators(cfg.gymSubgraph, cfg.router); } catch (err) { log(String(err).slice(0, 160)); }
  for (;;) {
    const elapsed = (Date.now() - started) / 1000;
    // the tape: swaps due by now, at Base's own pace, replayed through the pools
    while (tapeIndex < tape.length && tape[tapeIndex].at <= elapsed) {
      const s = tape[tapeIndex++];
      try { await poolSwap(s.pair, s.tokenIn, s.tokenOut, s.amountIn); } catch (err) { log(`tape swap failed on ${s.pair.name}: ${String(err).slice(0, 120)}`); }
    }
    const edge = BigInt(Math.round(cfg.edgeBps * 1e5));                                  // 1e9 base
    // informed flow: the taker reads the tape ahead. When a pair's price INFORMED_HORIZON_S from now
    // differs from the pool's price now by INFORMED_MOVE_BPS or more, it trades that direction against
    // every gladiator on the pair whose quote still beats that price by the edge, with INFORMED_PROBABILITY per tick. The fill is marked five
    // minutes later at the moved price: this is the arbitrageur who sees the order flow, and the flow
    // that bleeds the mainnet desks.
    for (const pair of market.pairs) {
      if (Math.random() >= cfg.informedProbability) continue;
      const ahead = futurePrice(tape, pair, elapsed, cfg.informedHorizonS); if (ahead === null) continue;
      const now = Number(formatUnits(await price(pair), 18));
      const moveBps = (ahead / now - 1) * 1e4;
      if (Math.abs(moveBps) < cfg.informedMoveBps) continue;
      const baseUp = moveBps > 0;   // token1 per token0 rises: the base gets dearer, so buy it now
      const tokenIn = baseUp ? pair.oracleQuote.address : pair.oracleBase.address; const tokenOut = baseUp ? pair.oracleBase.address : pair.oracleQuote.address;
      const amt = await amountForUsd(tokenIn, cfg.informedUsd);
      const taker = pick(cfg.informedPassShare);
      // in the pair's conventional reading: "cbBTC/USDC" moves as cbBTC, whichever token the pool calls token0
      const [asset] = pair.name.split("/"); const assetUp = asset === sym(pair.oracleBase.address) ? baseUp : !baseUp;
      const assetMove = assetUp ? Math.abs(moveBps) : -Math.abs(moveBps);
      // rational: it takes only where the quote still beats the price it foresees by the edge, so a fee
      // that has ramped past the coming move prices it out, which is what a toxicity fee is for
      const pFuture = BigInt(Math.round(ahead * 1e18));
      for (const g of gladiators) {
        if (!quotesPair(g, tokenIn, tokenOut)) continue;
        const q = await quote(pub, cfg, g, tokenIn, tokenOut, amt, taker);   // a gate, a cap: the quote says no before any transaction
        if (q === null) continue;
        const worthLater = fairOut(pair, pFuture, tokenOut, q);              // what the fill is worth in tokenIn once the move has happened
        if (worthLater <= amt * (1_000_000_000n + edge) / 1_000_000_000n) continue;
        const gainBps = Number((worthLater - amt) * 10_000n / amt);
        const took = await take(wallet, cfg, g, tokenIn, tokenOut, amt, taker, `informed: ${assetUp ? "buys" : "sells"} ${asset} ahead of a ${assetMove.toFixed(1)} bps move, ${gainBps} bps net of the quote`, fmt);
        if (took) { fills += 1; arbs += 1; log(`${g.maker.slice(0, 10)} ${took} | ${pair.name} | fills ${fills} (informed ${arbs}) | tape ${tapeIndex}/${tape.length}`); }
      }
    }
    // a silent or exhausted tape still needs moving pools: random swaps through them, so prints exist and prices wobble
    if (!cfg.live && tapeIndex >= tape.length && Math.random() < cfg.poolNoiseProbability) {
      const pair = market.pairs[Math.floor(Math.random() * market.pairs.length)];
      const sellBase = Math.random() < 0.5; const usd = Math.max(50, Math.round(Math.random() * cfg.poolNoiseUsd));
      const tokenIn = sellBase ? pair.oracleBase.address : pair.oracleQuote.address; const tokenOut = sellBase ? pair.oracleQuote.address : pair.oracleBase.address;
      try { await poolSwap(pair, tokenIn, tokenOut, await amountForUsd(tokenIn, usd)); } catch (err) { log(`pool noise failed on ${pair.name}: ${String(err).slice(0, 120)}`); }
    }
    tick += 1;
    if (tick % 15 === 1 || gladiators.length === 0) {     // every 15 ticks, about half a minute, the roster is re-read
      try { gladiators = await liveGladiators(cfg.gymSubgraph, cfg.router); } catch (err) { log(String(err).slice(0, 160)); }
    }
    // arbitrage: on every pair, does a gladiator sell the base cheaper, or buy it dearer, than the pool by more than the edge?
    for (const pair of market.pairs) {
      const onPair = gladiators.filter((g) => quotesPair(g, pair.oracleBase.address, pair.oracleQuote.address));
      if (!onPair.length) continue;
      const p = await price(pair);
      const base = pair.oracleBase.address; const quote_ = pair.oracleQuote.address;
      const probeQuote = await amountForUsd(quote_, cfg.probeUsd); const probeBase = await amountForUsd(base, cfg.probeUsd);
      const fairBase = fairOut(pair, p, quote_, probeQuote); const fairQuote = fairOut(pair, p, base, probeBase);
      for (const g of onPair) {
        const taker = pick(cfg.informedPassShare);
        const buyBase = await quote(pub, cfg, g, quote_, base, probeQuote, taker);
        const sellBase = await quote(pub, cfg, g, base, quote_, probeBase, taker);
        let took: string | null = null;
        if (buyBase !== null && buyBase > fairBase * (1_000_000_000n + edge) / 1_000_000_000n) took = await take(wallet, cfg, g, quote_, base, probeQuote, taker, `arb: buys ${sym(base)} below the pool`, fmt);
        else if (sellBase !== null && sellBase > fairQuote * (1_000_000_000n + edge) / 1_000_000_000n) took = await take(wallet, cfg, g, base, quote_, probeBase, taker, `arb: sells ${sym(base)} above the pool`, fmt);
        if (took) { fills += 1; arbs += 1; log(`${g.maker.slice(0, 10)} ${took} | ${pair.name} ${formatUnits(p, 18)} | fills ${fills} (arbs ${arbs}) | tape ${tapeIndex}/${tape.length}`); }
      }
    }
    // the uninformed order: a pair, a direction, a size, a tolerance drawn from an exponential with
    // mean TOLERANCE_BPS (most takers route and accept only a quote that beats the pool; a few do not
    // look), and a taker: with a pass or anonymous. Every gladiator on the pair is quoted at the
    // order's size as that taker; the best quote wins the order if it beats the pool after the pool's
    // fee, or if it is within the tolerance; otherwise the pool gets it.
    if (gladiators.length > 0 && Math.random() < cfg.noiseProbability) {
      const pair = market.pairs[Math.floor(Math.random() * market.pairs.length)];
      const buyBase = Math.random() < 0.5; const usd = Math.max(1, Math.round(Math.random() * cfg.noiseUsd));
      const tokenIn = buyBase ? pair.oracleQuote.address : pair.oracleBase.address; const tokenOut = buyBase ? pair.oracleBase.address : pair.oracleQuote.address;
      const tolBps = -Math.log(1 - Math.random()) * cfg.toleranceBps;
      const taker = pick(cfg.flowPassShare);
      const p = await price(pair);
      const amt = await amountForUsd(tokenIn, usd);
      const fairAmt = fairOut(pair, p, tokenIn, amt);
      const poolOut = fairAmt * BigInt(1_000_000 - cfg.poolFeeBps * 100) / 1_000_000n;
      const floorOut = fairAmt * BigInt(Math.max(0, Math.round(1_000_000 - tolBps * 100))) / 1_000_000n;
      let best: { g: Gladiator; out: bigint } | null = null;
      for (const g of gladiators) {
        if (!quotesPair(g, tokenIn, tokenOut)) continue;
        const out = await quote(pub, cfg, g, tokenIn, tokenOut, amt, taker);
        if (out !== null && (best === null || out > best.out)) best = { g, out };
      }
      const label = `${buyBase ? "buys" : "sells"} ${sym(pair.oracleBase.address)} for ${sym(pair.oracleQuote.address)}`;
      if (best && (best.out >= poolOut || best.out >= floorOut)) {
        const why = best.out >= poolOut ? "flow: best quote beat the pool" : `flow: within ${tolBps.toFixed(1)} bps`;
        const took = await take(wallet, cfg, best.g, tokenIn, tokenOut, amt, taker, `${why}, ${label}`, fmt);
        if (took) { fills += 1; log(`${best.g.maker.slice(0, 10)} ${took} | ${pair.name} ${formatUnits(p, 18)} | fills ${fills} (arbs ${arbs}) | tape ${tapeIndex}/${tape.length}`); }
      } else if (cfg.live) {
        // on a live chain the order that no gladiator wins goes to the real pool, which needs nothing from us
        log(`pool       flow (${taker.name}): ${label} $${usd} stays with the pool, best gladiator ${best ? ((Number(best.out) / Number(fairAmt) - 1) * 1e4).toFixed(1) + " bps from mid" : "none"}, tolerance ${tolBps.toFixed(1)} bps`);
      } else {
        try {
          await poolSwap(pair, tokenIn, tokenOut, amt);
          log(`pool       flow (${taker.name}): ${label} $${usd} at the pool, best gladiator ${best ? ((Number(best.out) / Number(fairAmt) - 1) * 1e4).toFixed(1) + " bps from mid" : "none"}, tolerance ${tolBps.toFixed(1)} bps`);
        } catch (err) { log(`pool order failed on ${pair.name}: ${String(err).slice(0, 120)}`); }
      }
    }
    await new Promise((r) => setTimeout(r, cfg.tickMs));
  }
}

// A quote as the taker that would take: the router reads the caller as the taker, so a gate on the
// pass answers differently to the passed taker and to the raider.
async function quote(pub: ReturnType<typeof createPublicClient>, cfg: Config, g: Gladiator, tokenIn: Address, tokenOut: Address, amount: bigint, taker: TakerRt): Promise<bigint | null> {
  try {
    const [, out] = await pub.readContract({ address: cfg.router, abi: routerAbi, functionName: "quote", args: [g.order, tokenIn, tokenOut, amount, taker.td], account: taker.address });
    return out;
  } catch { return null; }   // a cap, a gate, an empty side: no quote, no take
}

async function take(wallet: ReturnType<typeof createWalletClient>, cfg: Config, g: Gladiator, tokenIn: Address, tokenOut: Address, amount: bigint, taker: TakerRt, why: string, fmt: (a: Address, n: bigint) => string): Promise<string | null> {
  try {
    const hash = await wallet.writeContract({ address: taker.address, abi: takerAbi, functionName: "swap", args: [g.order, tokenIn, tokenOut, amount, taker.td], chain: wallet.chain, account: wallet.account! });
    return `${why} (${taker.name}) ${fmt(tokenIn, amount)} in (${hash.slice(0, 10)})`;
  } catch (err) { log(`take failed ${why} (${taker.name}): ${String(err).slice(0, 140)}`); return null; }
}

main().catch((err) => { console.error(err); process.exit(1); });
