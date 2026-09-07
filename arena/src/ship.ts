import { encodeAbiParameters, parseAbi, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { erc20Abi } from "./abi.js";
import { orderAbi } from "./abi.js";

const aquaAbi = parseAbi([
  "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)",
  "function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) view returns (uint256, uint256)",
  "function dock(address app, bytes32 strategyHash, address[] tokens)",
]);
const USE_AQUA_INSTEAD_OF_SIGNATURE = 1n << 254n;   // MakerTraits: the strategy lives in Aqua, no signature

export interface Shipped { strategyHash: Hex; order: { maker: Address; traits: bigint; data: Hex }; blob: Hex }

// Ships a program from the wallet's own account: approvals to Aqua, then Aqua.ship with the
// abi-encoded order as the strategy, which is exactly what the router hashes.
export async function ship(pub: PublicClient, wallet: WalletClient, aqua: Address, router: Address, program: Hex, tokens: [Address, Address], amounts: [bigint, bigint]): Promise<Shipped> {
  const maker = wallet.account!.address;
  for (const t of tokens) {
    const allowance = await pub.readContract({ address: t, abi: erc20Abi, functionName: "allowance", args: [maker, aqua] });
    if (allowance < amounts[0] + amounts[1]) {
      const h = await wallet.writeContract({ address: t, abi: erc20Abi, functionName: "approve", args: [aqua, 2n ** 255n], chain: wallet.chain, account: wallet.account! });
      await pub.waitForTransactionReceipt({ hash: h });
    }
  }
  const order = { maker, traits: USE_AQUA_INSTEAD_OF_SIGNATURE, data: program };
  const blob = encodeAbiParameters(orderAbi, [order]);
  const h = await wallet.writeContract({ address: aqua, abi: aquaAbi, functionName: "ship", args: [router, blob, tokens, amounts], chain: wallet.chain, account: wallet.account! });
  const receipt = await pub.waitForTransactionReceipt({ hash: h });
  if (receipt.status !== "success") throw new Error(`ship reverted ${h}`);
  // strategyHash = keccak256(blob); the Shipped event carries it too
  const { keccak256 } = await import("viem");
  return { strategyHash: keccak256(blob), order, blob };
}

// Docks a live strategy of the wallet's own account: Aqua forgets its ledger, the tokens never left
// the wallet. A gladiator docks its previous program before shipping the next one.
export async function dock(pub: PublicClient, wallet: WalletClient, aqua: Address, router: Address, strategyHash: Hex, tokens: [Address, Address]): Promise<void> {
  const h = await wallet.writeContract({ address: aqua, abi: aquaAbi, functionName: "dock", args: [router, strategyHash, tokens], chain: wallet.chain, account: wallet.account! });
  const receipt = await pub.waitForTransactionReceipt({ hash: h });
  if (receipt.status !== "success") throw new Error(`dock reverted ${h}`);
}
