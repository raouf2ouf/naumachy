import { parseAbi } from "viem";

// the router's own errors, so a refusal on the fork is named for the mind instead of a bare selector
export const naumachyErrors = [
  "error OracleAnchorStale(uint256 currentTime, uint256 updatedAt, uint16 maxStaleness)",
  "error OracleAnchorUnknownPair(address tokenIn, address tokenOut)",
  "error OracleAnchorEmptyCurve()",
  "error OracleAnchorMissingArgs()",
  "error OracleAnchorShouldBeAppliedBeforeSwapAmountsComputation()",
  "error RiskCapExceeded(address token, uint256 amount, uint256 cap)",
  "error RiskCapBpsOutOfRange(uint32 bps)",
  "error RiskCapMissingArgs()",
  "error ToxicityFeeBpsOutOfRange(uint32 bps)",
  "error ToxicityFeeMissingArgs()",
  "error UnsupportedInstruction()",
] as const;
export const routerAbi = parseAbi([
  "struct Order { address maker; uint256 traits; bytes data; }",
  "function quote(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
  "function hash(Order order) view returns (bytes32)",
  ...naumachyErrors,
]);
export const takerAbi = parseAbi([
  "struct Order { address maker; uint256 traits; bytes data; }",
  "function swap(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut)",
  ...naumachyErrors,
]);
export const takerDataAbi = parseAbi(["function build(address taker, bool isExactIn) pure returns (bytes)"]);
export const oracleAbi = parseAbi(["function latestAnswer() view returns (uint256)"]);
export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
]);
// Uniswap SwapRouter02 on Base: exactInputSingle without a deadline field
export const swapRouter02Abi = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);
export const orderAbi = [{ type: "tuple", components: [{ name: "maker", type: "address" }, { name: "traits", type: "uint256" }, { name: "data", type: "bytes" }] }] as const;
