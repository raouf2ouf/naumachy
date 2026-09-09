import { describe, expect, it } from "vitest";
import { decodeProgram } from "../src/swapvm.js";

const AQUA = "0x111111338c5091e8440b67b168bae16a668ac0de";
const FULL = "0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const tokens = { [USDC]: { symbol: "USDC", decimals: 6 }, [WETH]: { symbol: "WETH", decimals: 18 } };
const h = (n: bigint | number, bytes: number) => BigInt(n).toString(16).padStart(bytes * 2, "0");
const ins = (op: number, args = "") => h(op, 1) + h(args.length / 2, 1) + args;

describe("program card", () => {
  it("reads a flat fee, a gate and a jump in the Aqua dialect", () => {
    const program = "0x" + ins(0x15, h(100_000, 4)) + ins(0x0e, WETH.slice(2)) + ins(0x0b, USDC.slice(2) + h(58, 2)) + ins(0x11) + ins(0x0a, h(58, 2)) + ins(0x11);   // 6 + 22 + 24 + 2 + 4 = 58
    const card = decodeProgram(program, AQUA, tokens, { tokens: [], amounts: [] });
    expect(card.dialect).toContain("Aqua"); expect(card.parsed).toBe(true);
    expect(card.instructions[0].text).toBe("Keeps 1 bps of the token it takes in.");
    expect(card.instructions[1].text).toContain("holding WETH");
    expect(card.instructions[2].target).toBe(58); expect(card.instructions[2].text).toContain("pays USDC");
    expect(card.instructions.find((i) => i.at === 58)?.landing).toBe(true);
  });
  it("draws a concentrated curve from static balances in the full dialect", () => {
    // 1 WETH and 2500 USDC, range sqrt prices for 2000..3000 USDC per WETH in raw gt-per-lt units
    // lt = USDC (0xa0..), gt = WETH (0xc0..): raw price = weth_raw / usdc_raw = (1/P) * 1e12
    const sqrt = (p: number) => BigInt(Math.round(Math.sqrt(p) * 1e18));
    const pRaw = (P: number) => (1 / P) * 1e12;
    const balances = h(2, 2) + USDC.slice(2) + WETH.slice(2) + h(2500_000000n, 32) + h(10n ** 18n, 32);
    const program = "0x" + ins(0x11, balances) + ins(0x17, h(sqrt(pRaw(3000)), 32) + h(sqrt(pRaw(2000)), 32)) + ins(0x16);
    const card = decodeProgram(program, FULL, tokens, { tokens: [], amounts: [] });
    expect(card.parsed).toBe(true);
    const c = card.curve!;
    expect(c.kind).toBe("concentrated"); expect(c.base_symbol).toBe("WETH"); expect(c.quote_symbol).toBe("USDC");
    expect(c.min).toBeCloseTo(2000, 0); expect(c.max).toBeCloseTo(3000, 0);
    expect(c.spot).toBeGreaterThan(2000); expect(c.spot).toBeLessThan(3000);
    const small = c.depth[0];   // a $1,000 trade barely moves a 1 WETH / 2500 USDC position's quote
    expect(small.buy!).toBeGreaterThan(c.spot!); expect(small.sell!).toBeLessThan(c.spot!);
    expect(small.buy! - c.spot!).toBeLessThan(c.spot! * 0.5);
    expect(c.depth.at(-1)!.sell).toBeNull();   // $10M of quote cannot come out of 2500 USDC
  });
  it("marks an unknown router and a torn program", () => {
    expect(decodeProgram("0x0a02", "0x0000000000000000000000000000000000000001", {}, { tokens: [], amounts: [] }).parsed).toBe(false);
    expect(decodeProgram("0x1100", AQUA, {}, { tokens: [], amounts: [] }).parsed).toBe(true);
  });
});
