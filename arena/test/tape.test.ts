import { describe, expect, it } from "vitest";
import { futurePrice, type TapeSwap } from "../src/tape.js";
import type { Pair } from "../src/program.js";

const weth = { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" as const, decimals: 18 };
const usdc = { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const, decimals: 6 };
const pair: Pair = { name: "WETH/USDC", oracle: "0x1000000000000000000000000000000000000001", oracleDecimals: 18, oracleBase: weth, oracleQuote: usdc, pool: "0xd0b53d9277642d899df5c87a3966a349a798f224", feeTier: 500 };
const other: Pair = { ...pair, name: "cbBTC/USDC", pool: "0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef" };
const swap = (at: number, price: number, p = pair): TapeSwap => ({ at, pair: p, tokenIn: weth.address, tokenOut: usdc.address, amountIn: 1n, price });

describe("futurePrice", () => {
  const tape = [swap(10, 2000), swap(100, 2010), swap(250, 2020), swap(290, 2030), swap(310, 2050), swap(340, 2040), swap(400, 2100), swap(300, 9999, other)];
  it("takes the median of the swaps around the horizon", () => {
    expect(futurePrice(tape, pair, 0, 300)).toBe(2040);   // window (240, 360]: 2020, 2030, 2050, 2040 -> median 2040
  });
  it("falls back to the last swap before the horizon when the window is empty", () => {
    expect(futurePrice(tape, pair, 0, 100)).toBe(2010);   // window (80, 120] holds 2010
    expect(futurePrice(tape, pair, 110, 60)).toBe(null);  // nothing between 110 and 182
    expect(futurePrice(tape, pair, 0, 50)).toBe(2000);    // window (40, 60] empty; last swap at or before 50 is the one at 10
  });
  it("ignores other pairs and the past", () => {
    expect(futurePrice(tape, other, 0, 300)).toBe(9999);
    expect(futurePrice(tape, pair, 400, 300)).toBe(null);
  });
});
