import { decodeAbiParameters, type Address, type Hex } from "viem";
import { orderAbi } from "./abi.js";

export interface Gladiator { id: string; maker: Address; strategyHash: Hex; order: { maker: Address; traits: bigint; data: Hex } }

// Live strategies shipped to our router, read from the gym's Aqua subgraph. The blob is the
// abi-encoded Order the maker shipped; the router hashes it the same way.
export async function liveGladiators(subgraph: string, router: Address): Promise<Gladiator[]> {
  const q = `{ strategies(first: 100, where: { app: "${router.toLowerCase()}", status: LIVE }) { id strategyHash blob maker { id } } }`;
  const res = await fetch(subgraph, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) });
  const body = (await res.json()) as { data?: { strategies: { id: string; strategyHash: Hex; blob: Hex; maker: { id: Address } }[] }; errors?: unknown };
  if (!body.data) throw new Error(`gym subgraph: ${JSON.stringify(body.errors).slice(0, 200)}`);
  return body.data.strategies.map((s) => {
    const [o] = decodeAbiParameters(orderAbi, s.blob);
    return { id: s.id, maker: s.maker.id, strategyHash: s.strategyHash, order: { maker: o.maker, traits: o.traits, data: o.data } };
  });
}
