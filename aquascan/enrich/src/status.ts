import type { Pool } from "./db.js";

export interface ChainStatus {
  chain: string; strategies: number; live: number; fills: number; economic: number; legs: number;
  fillsCursor: number; head: number | null; behind: number | null; gatewayCalls: number;
  priceHours: number; priceMisses: number; tokens: number; templates: number;
}

export async function status(pool: Pool): Promise<ChainStatus[]> {
  const { rows } = await pool.query(`
    SELECT c.name AS chain,
           (SELECT count(*) FROM strategies s WHERE s.chain = c.name) AS strategies,
           (SELECT count(*) FROM strategies s WHERE s.chain = c.name AND s.status = 'LIVE') AS live,
           (SELECT count(*) FROM fills f WHERE f.chain = c.name) AS fills,
           (SELECT count(*) FROM fills f WHERE f.chain = c.name AND f.economic) AS economic,
           (SELECT count(*) FROM legs l WHERE l.chain = c.name) AS legs,
           c.fills_cursor_block, c.subgraph_head, c.gateway_calls,
           (SELECT count(*) FROM prices p WHERE p.chain = c.name) AS price_hours,
           (SELECT count(*) FROM price_misses m WHERE m.chain = c.name AND m.permanent) AS price_misses,
           (SELECT count(*) FROM tokens t WHERE t.chain = c.name AND t.decimals IS NOT NULL) AS tokens,
           (SELECT count(*) FROM templates tp WHERE tp.chain = c.name) AS templates
    FROM chains c ORDER BY c.name`);
  return rows.map((r) => ({
    chain: r.chain, strategies: Number(r.strategies), live: Number(r.live), fills: Number(r.fills), economic: Number(r.economic),
    legs: Number(r.legs), fillsCursor: Number(r.fills_cursor_block), head: r.subgraph_head === null ? null : Number(r.subgraph_head),
    behind: r.subgraph_head === null ? null : Number(r.subgraph_head) - Number(r.fills_cursor_block), gatewayCalls: Number(r.gateway_calls),
    priceHours: Number(r.price_hours), priceMisses: Number(r.price_misses), tokens: Number(r.tokens), templates: Number(r.templates),
  }));
}

export function formatStatus(rows: ChainStatus[]): string {
  const head = `${"chain".padEnd(9)} ${"strategies".padStart(10)} ${"live".padStart(6)} ${"fills".padStart(8)} ${"economic".padStart(8)} ${"legs".padStart(8)} ${"cursor".padStart(12)} ${"head".padStart(12)} ${"behind".padStart(8)} ${"calls".padStart(6)} ${"prices".padStart(8)} ${"misses".padStart(7)} ${"tokens".padStart(7)} ${"tmpl".padStart(5)}`;
  const lines = rows.map((r) => `${r.chain.padEnd(9)} ${String(r.strategies).padStart(10)} ${String(r.live).padStart(6)} ${String(r.fills).padStart(8)} ${String(r.economic).padStart(8)} ${String(r.legs).padStart(8)} ${String(r.fillsCursor).padStart(12)} ${String(r.head ?? "-").padStart(12)} ${String(r.behind ?? "-").padStart(8)} ${String(r.gatewayCalls).padStart(6)} ${String(r.priceHours).padStart(8)} ${String(r.priceMisses).padStart(7)} ${String(r.tokens).padStart(7)} ${String(r.templates).padStart(5)}`);
  return [head, ...lines].join("\n");
}
