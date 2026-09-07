import type { Config } from "./config.js";

export interface TapeSwap { at: number; sellWeth: boolean; amountIn: bigint }   // amountIn in the sold token's units

// The tape: the pool's real swaps in the minutes before the fork, read from the published pools
// subgraph, so the gym's pool walks the path Base walked. amount0 > 0 means the pool received
// WETH (someone sold WETH); amount1 > 0 means it received USDC.
export async function loadTape(cfg: Config, forkTs: number): Promise<TapeSwap[]> {
  if (!cfg.tapeSubgraph || !cfg.graphApiKey) return [];
  const url = `https://gateway.thegraph.com/api/${cfg.graphApiKey}/subgraphs/id/${cfg.tapeSubgraph}`;
  const from = forkTs - cfg.tapeMinutes * 60; const out: TapeSwap[] = [];
  let after = from - 1;
  for (let page = 0; page < 20; page += 1) {
    const q = `{ swaps(first: 1000, orderBy: timestamp, orderDirection: asc, where: { pool: "${cfg.pool.toLowerCase()}", timestamp_gt: ${after}, timestamp_lt: ${forkTs} }) { timestamp amount0 amount1 } }`;
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "naumachy-arena/0.1" }, body: JSON.stringify({ query: q }) });
    const body = (await res.json()) as { data?: { swaps: { timestamp: string; amount0: string; amount1: string }[] } };
    const rows = body.data?.swaps ?? [];
    for (const r of rows) {
      const a0 = Number(r.amount0); const a1 = Number(r.amount1);
      if (a0 > 0) out.push({ at: Number(r.timestamp) - from, sellWeth: true, amountIn: BigInt(Math.round(a0 * cfg.tapeScale * 1e18)) });
      else if (a1 > 0) out.push({ at: Number(r.timestamp) - from, sellWeth: false, amountIn: BigInt(Math.round(a1 * cfg.tapeScale * 1e6)) });
    }
    if (rows.length < 1000) break;
    after = Number(rows[rows.length - 1].timestamp);
  }
  return out;
}
