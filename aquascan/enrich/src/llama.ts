import type { Paced } from "./pacer.js";

// DefiLlama coins API, batchHistorical: many (coin, timestamp) pairs in one call.
// Coin ids are "<chain>:<address>"; our chain names match DefiLlama's slugs for all six chains.

export const LLAMA_BASE = "https://coins.llama.fi";
export const SEARCH_WIDTH = "4h";           // accept a data point within four hours of the asked hour
export const PAIRS_PER_CALL = 80;           // keeps the URL well under length limits

export interface PriceTarget { chain: string; token: string; hour: number }
export interface PricePoint { chain: string; token: string; hour: number; usd: number; sourceTs: number; confidence: number | null; symbol?: string; decimals?: number }

interface LlamaResponse {
  coins: Record<string, { symbol?: string; decimals?: number; prices?: { timestamp: number; price: number; confidence?: number }[] }>;
}

// Groups targets into calls of at most PAIRS_PER_CALL (coin, hour) pairs.
export function batchTargets(targets: PriceTarget[], pairsPerCall = PAIRS_PER_CALL): PriceTarget[][] {
  const batches: PriceTarget[][] = [];
  for (let i = 0; i < targets.length; i += pairsPerCall) batches.push(targets.slice(i, i + pairsPerCall));
  return batches;
}

export function coinsParam(batch: PriceTarget[]): Record<string, number[]> {
  const coins: Record<string, number[]> = {};
  for (const t of batch) (coins[`${t.chain}:${t.token}`] ??= []).push(t.hour);
  return coins;
}

// Assigns each returned data point to the closest requested hour, within the search width.
export function matchPoints(batch: PriceTarget[], body: LlamaResponse, widthSeconds = 4 * 3600): { points: PricePoint[]; misses: PriceTarget[] } {
  const points: PricePoint[] = [];
  const found = new Set<string>();
  for (const t of batch) {
    const coin = body.coins[`${t.chain}:${t.token}`];
    if (!coin?.prices?.length) continue;
    let best: { timestamp: number; price: number; confidence?: number } | undefined;
    for (const p of coin.prices) {
      if (Math.abs(p.timestamp - t.hour) > widthSeconds) continue;
      if (!best || Math.abs(p.timestamp - t.hour) < Math.abs(best.timestamp - t.hour)) best = p;
    }
    if (!best || !(best.price > 0)) continue;
    found.add(`${t.chain}:${t.token}:${t.hour}`);
    points.push({ chain: t.chain, token: t.token, hour: t.hour, usd: best.price, sourceTs: best.timestamp, confidence: best.confidence ?? null, symbol: coin.symbol, decimals: coin.decimals });
  }
  const misses = batch.filter((t) => !found.has(`${t.chain}:${t.token}:${t.hour}`));
  return { points, misses };
}

export class Llama {
  constructor(private readonly paced: Paced, private readonly fetchImpl: typeof fetch = fetch) {}

  async batchHistorical(batch: PriceTarget[]): Promise<{ points: PricePoint[]; misses: PriceTarget[] }> {
    const url = `${LLAMA_BASE}/batchHistorical?coins=${encodeURIComponent(JSON.stringify(coinsParam(batch)))}&searchWidth=${SEARCH_WIDTH}`;
    const res = await this.paced(() => this.fetchImpl(url, { headers: { accept: "application/json", "user-agent": "naumachy-aquascan-enrich/0.1" } }));
    if (res.status === 429) throw new Error("defillama 429");
    if (!res.ok) throw new Error(`defillama ${res.status}`);
    const body = (await res.json()) as LlamaResponse;
    return matchPoints(batch, body);
  }
}
