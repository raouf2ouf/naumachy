import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { erc20Abi, orderAbi } from "./abi.js";

const aquaAbi = parseAbi([
  "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)",
  "function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) view returns (uint256, uint256)",
  "function dock(address app, bytes32 strategyHash, address[] tokens)",
]);
const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;   // MakerTraits: the strategy lives in Aqua, no signature

// A receipt, then the read node caught up to its block: some providers answer eth_call and
// estimateGas from a replica a few blocks behind the head, so the next write would be simulated
// against a state that does not yet hold this one.
export async function settled(pub: PublicClient, hash: Hex): Promise<void> {
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted ${hash}`);
  for (let i = 0; i < 40 && (await pub.getBlockNumber({ cacheTime: 0 })) < receipt.blockNumber; i += 1) await new Promise((r) => setTimeout(r, 500));
}

export interface Shipped { strategyHash: Hex; order: { maker: Address; traits: bigint; data: Hex }; blob: Hex }

// Ships a program from the wallet's own account: approvals to Aqua, then Aqua.ship with the
// abi-encoded order as the strategy, which is exactly what the router hashes. Any number of
// tokens: one ledger backs every pair among them.
export async function ship(pub: PublicClient, wallet: WalletClient, aqua: Address, router: Address, program: Hex, tokens: Address[], amounts: bigint[]): Promise<Shipped> {
  const maker = wallet.account!.address;
  if (tokens.length !== amounts.length) throw new Error("tokens and amounts differ in length");
  for (const [i, t] of tokens.entries()) {
    const allowance = await pub.readContract({ address: t, abi: erc20Abi, functionName: "allowance", args: [maker, aqua] });
    if (allowance < amounts[i] * 10n) {
      const h = await wallet.writeContract({ address: t, abi: erc20Abi, functionName: "approve", args: [aqua, 2n ** 255n], chain: wallet.chain, account: wallet.account! });
      await settled(pub, h);
    }
  }
  const order = { maker, traits: USE_AQUA_INSTEAD_OF_SIGNATURE, data: program };
  const blob = encodeAbiParameters(orderAbi, [order]);
  const h = await wallet.writeContract({ address: aqua, abi: aquaAbi, functionName: "ship", args: [router, blob, tokens, amounts], chain: wallet.chain, account: wallet.account! });
  await settled(pub, h).catch(() => { throw new Error(`ship reverted ${h}`); });
  return { strategyHash: keccak256(blob), order, blob };   // strategyHash = keccak256(blob); the Shipped event carries it too
}

// Docks a live strategy of the wallet's own account: Aqua forgets its ledger, the tokens never left
// the wallet. A gladiator docks its previous program before shipping the next one.
export async function dock(pub: PublicClient, wallet: WalletClient, aqua: Address, router: Address, strategyHash: Hex, tokens: Address[]): Promise<void> {
  const h = await wallet.writeContract({ address: aqua, abi: aquaAbi, functionName: "dock", args: [router, strategyHash, tokens], chain: wallet.chain, account: wallet.account! });
  await settled(pub, h).catch(() => { throw new Error(`dock reverted ${h}`); });
}
