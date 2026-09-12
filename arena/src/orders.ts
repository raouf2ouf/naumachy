import { decodeAbiParameters, type Address, type Hex } from "viem";
import { orderAbi } from "./abi.js";

export interface Gladiator { id: string; maker: Address; strategyHash: Hex; order: { maker: Address; traits: bigint; data: Hex }; tokens: Address[] }

// Live strategies shipped to our router, read from the gym's Aqua subgraph. The blob is the
// abi-encoded Order the maker shipped; the router hashes it the same way. The tokens are the
// ledger it declared: a pair outside them is not quotable, so the engine never asks.
export async function liveGladiators(subgraph: string, router: Address): Promise<Gladiator[]> {
  const q = `{ strategies(first: 100, where: { app: "${router.toLowerCase()}", status: LIVE }) { id strategyHash blob tokens maker { id } } }`;
  const res = await fetch(subgraph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(20_000) });
  const body = (await res.json()) as { data?: { strategies: { id: string; strategyHash: Hex; blob: Hex; tokens: Address[]; maker: { id: Address } }[] }; errors?: unknown };
  if (!body.data) throw new Error(`gym subgraph: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.data.strategies.map((s) => {
    const [o] = decodeAbiParameters(orderAbi, s.blob);
    return { id: s.id, maker: s.maker.id, strategyHash: s.strategyHash, order: { maker: o.maker, traits: o.traits, data: o.data }, tokens: s.tokens.map((t) => t.toLowerCase() as Address) };
  });
}

export const quotesPair = (g: Gladiator, a: Address, b: Address) => g.tokens.includes(a.toLowerCase() as Address) && g.tokens.includes(b.toLowerCase() as Address);
