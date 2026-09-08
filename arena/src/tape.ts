import type { Address } from "viem";
import type { Config } from "./config.js";
import type { Pair } from "./program.js";

export interface TapeSwap { at: number; pair: Pair; tokenIn: Address; tokenOut: Address; amountIn: bigint; price: number }   // amountIn in the sold token's units; price = token1 per token0 at that swap

// The tape: each arena pool's real swaps in the minutes before the fork, read from the published
// pools subgraph, so the gym's pools walk the path Base walked. amount0 > 0 means the pool
// received token0 (someone sold it); amount1 > 0 means it received token1.
export async function loadTape(cfg: Config, forkTs: number): Promise<TapeSwap[]> {
  if (!cfg.tapeSubgraph || !cfg.graphApiKey) return [];
  const url = `https://gateway.thegraph.com/api/${cfg.graphApiKey}/subgraphs/id/${cfg.tapeSubgraph}`;
  const from = forkTs - cfg.tapeMinutes * 60; const out: TapeSwap[] = [];
  for (const pair of cfg.market.pairs) {
    let after = from - 1;
    for (let page = 0; page < 20; page += 1) {
      const q = `{ swaps(first: 1000, orderBy: timestamp, orderDirection: asc, where: { pool: "${pair.pool.toLowerCase()}", timestamp_gt: ${after}, timestamp_lt: ${forkTs} }) { timestamp amount0 amount1 } }`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "naumachy-arena/0.1" }, body: JSON.stringify({ query: q }) });
      const body = (await res.json()) as { data?: { swaps: { timestamp: string; amount0: string; amount1: string }[] } };
      const rows = body.data?.swaps ?? [];
      for (const r of rows) {
        const a0 = Number(r.amount0); const a1 = Number(r.amount1); const at = Number(r.timestamp) - from;
        if (a0 === 0 || a1 === 0) continue;
        const price = Math.abs(a1 / a0);
        if (a0 > 0) out.push({ at, pair, tokenIn: pair.oracleBase.address, tokenOut: pair.oracleQuote.address, amountIn: BigInt(Math.round(a0 * cfg.tapeScale * 10 ** pair.oracleBase.decimals)), price });
        else out.push({ at, pair, tokenIn: pair.oracleQuote.address, tokenOut: pair.oracleBase.address, amountIn: BigInt(Math.round(a1 * cfg.tapeScale * 10 ** pair.oracleQuote.decimals)), price });
      }
      if (rows.length < 1000) break;
      after = Number(rows[rows.length - 1].timestamp);
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

// The informed taker reads the tape ahead: the pair's price about `horizon` seconds after `elapsed`,
// as the median of the swaps printed between 80% and 120% of the horizon, else the last swap before
// the horizon. Null when the tape says nothing about that stretch. Pure, so a test can pin it.
export function futurePrice(tape: TapeSwap[], pair: Pair, elapsed: number, horizon: number): number | null {
  const mine = tape.filter((s) => s.pair === pair && s.at > elapsed && s.at <= elapsed + 1.2 * horizon);
  const window = mine.filter((s) => s.at > elapsed + 0.8 * horizon);
  const picked = window.length ? window : mine.filter((s) => s.at <= elapsed + horizon).slice(-1);
  if (!picked.length) return null;
  const prices = picked.map((s) => s.price).sort((a, b) => a - b);
  return prices[Math.floor(prices.length / 2)];
}
