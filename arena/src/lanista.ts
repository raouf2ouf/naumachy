import { parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { settled } from "./ship.js";

export const arenaAbi = parseAbi([
  "function register(bytes32 name, address parent)",
  "function enter(bytes32 strategyHash, bytes32 archetype)",
  "function openGeneration(bytes32 tape) returns (uint32)",
  "function score(uint32 generation, address gladiator, bytes32 strategyHash, int256 scoreQuote, int256 seQuote, uint32 fills, address quoteToken)",
  "function closeGeneration(uint32 generation, address champion, bytes32 championStrategy, int256 scoreQuote)",
  "function promote(address gladiator, bytes32 strategyHash, uint256 chainId, uint256 bankroll)",
  "function currentGeneration() view returns (uint32)",
  "function generationCount() view returns (uint256)",
  "function gladiators(address) view returns (bytes32 name, uint32 generationBorn, address parent, bool registered)",
]);

async function send(pub: PublicClient, wallet: WalletClient, address: Address, functionName: string, args: unknown[]): Promise<Hex> {
  const h = await wallet.writeContract({ address, abi: arenaAbi, functionName: functionName as never, args: args as never, chain: wallet.chain, account: wallet.account! });
  await settled(pub, h).catch(() => { throw new Error(`${functionName} reverted ${h}`); });
  return h;
}

export const lanista = {
  open: (pub: PublicClient, w: WalletClient, arena: Address, tape: Hex) => send(pub, w, arena, "openGeneration", [tape]),
  score: (pub: PublicClient, w: WalletClient, arena: Address, generation: number, gladiator: Address, strategyHash: Hex, scoreQuote: bigint, seQuote: bigint, fills: number, quoteToken: Address) =>
    send(pub, w, arena, "score", [generation, gladiator, strategyHash, scoreQuote, seQuote, fills, quoteToken]),
  close: (pub: PublicClient, w: WalletClient, arena: Address, generation: number, champion: Address, championStrategy: Hex, scoreQuote: bigint) =>
    send(pub, w, arena, "closeGeneration", [generation, champion, championStrategy, scoreQuote]),
  promote: (pub: PublicClient, w: WalletClient, arena: Address, gladiator: Address, strategyHash: Hex, chainId: bigint, bankroll: bigint) =>
    send(pub, w, arena, "promote", [gladiator, strategyHash, chainId, bankroll]),
};

export const gladiator = {
  register: async (pub: PublicClient, w: WalletClient, arena: Address, name: Hex, parent: Address) => {
    const [, , , registered] = await pub.readContract({ address: arena, abi: arenaAbi, functionName: "gladiators", args: [w.account!.address] });
    if (registered) return null;
    return send(pub, w, arena, "register", [name, parent]);
  },
  enter: (pub: PublicClient, w: WalletClient, arena: Address, strategyHash: Hex, archetype: Hex) => send(pub, w, arena, "enter", [strategyHash, archetype]),
};

// Aquascan's verdict on a strategy, read from the gym API: the 5-minute markout sum and its band.
export async function aquascanScore(api: string, chain: string, strategyId: string): Promise<{ scoreUsd: number | null; seBps: number | null; bps: number | null; fills: number; volume: number | null; edgeUsd: number | null }> {
  const res = await fetch(`${api}/api/strategy/${chain}/${encodeURIComponent(strategyId)}?limit=1`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`aquascan ${res.status} for ${strategyId.slice(0, 12)}`);
  const d = (await res.json()) as { stats: { fills: number; volume_usd: { value: number | null }; edge_usd: { value: number | null }; markout_5m_usd: { value: number | null }; markout_5m_bps: { bps: number; se: number | null } | null } | null };
  const st = d.stats;
  if (!st) return { scoreUsd: null, seBps: null, bps: null, fills: 0, volume: null, edgeUsd: null };
  return { scoreUsd: st.markout_5m_usd.value, seBps: st.markout_5m_bps?.se ?? null, bps: st.markout_5m_bps?.bps ?? null, fills: st.fills, volume: st.volume_usd.value, edgeUsd: st.edge_usd.value };
}
