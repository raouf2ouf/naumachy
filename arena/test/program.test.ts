import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import { anchoredSpec, compile, disassemble, summarize, validateSpec, type Market, type ProgramSpec } from "../src/program.js";

const weth = { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" as const, decimals: 18 };
const usdc = { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const, decimals: 6 };
const cbbtc = { symbol: "cbBTC", address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf" as const, decimals: 8 };
const market: Market = {
  tokens: [weth, usdc, cbbtc],
  pairs: [
    { name: "WETH/USDC", oracle: "0x1000000000000000000000000000000000000001", oracleDecimals: 18, oracleBase: weth, oracleQuote: usdc, pool: "0xd0b53d9277642d899df5c87a3966a349a798f224", feeTier: 500 },
    { name: "cbBTC/USDC", oracle: "0x1000000000000000000000000000000000000002", oracleDecimals: 18, oracleBase: usdc, oracleQuote: cbbtc, pool: "0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef", feeTier: 500 },
    { name: "cbBTC/WETH", oracle: "0x1000000000000000000000000000000000000003", oracleDecimals: 18, oracleBase: weth, oracleQuote: cbbtc, pool: "0x7aea2e8a3843516afa07293a10ac8e49906dabd1", feeTier: 500 },
  ],
  pass: "0x2000000000000000000000000000000000000001",
};

// walks [op][len][args] and returns the opcodes with their byte offsets
function walk(bytes: `0x${string}`): { pc: number; op: number; len: number }[] {
  const b = hexToBytes(bytes); const out = []; let pc = 0;
  while (pc < b.length) { out.push({ pc, op: b[pc], len: b[pc + 1] }); pc += 2 + b[pc + 1]; }
  return out;
}

describe("compile", () => {
  it("emits the anchored archetype as RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt", () => {
    const c = compile(anchoredSpec({ capBps: 2000, feeBaseBps: 5, feeSlopeBps: 200, feeMaxBps: 50, windowSeconds: 600, depth: 100 }, ["WETH/USDC"], 1n), market);
    expect(walk(c.bytes).map((i) => i.op)).toEqual([0x2f, 0x2e, 0x30, 0x16, 0x22]);
    expect(c.tokens.map((t) => t.symbol)).toEqual(["WETH", "USDC"]);
    expect(c.listing[2]).toContain("OracleAnchor depth 100x on WETH/USDC");
    // the anchor carries one 63-byte entry after the 6-byte header
    expect(walk(c.bytes)[2].len).toBe(6 + 63);
  });

  it("ships the union of the pairs' tokens and one anchor entry per pair", () => {
    const c = compile({ pairs: ["WETH/USDC", "cbBTC/USDC", "cbBTC/WETH"], capBps: 2000, salt: 1n, ops: [{ op: "gate" }, { op: "flatFee", bps: 8 }, { op: "anchor", depth: 100, maxStaleness: 0 }, { op: "xyc" }] }, market);
    expect(c.tokens.map((t) => t.symbol)).toEqual(["WETH", "USDC", "cbBTC"]);
    const ins = walk(c.bytes);
    expect(ins.map((i) => i.op)).toEqual([0x2f, 0x0e, 0x23, 0x30, 0x16, 0x22]);
    expect(ins[3].len).toBe(6 + 3 * 63);
  });

  it("compiles byTokenIn into jumps that land on instruction boundaries and skip the other branches", () => {
    const spec: ProgramSpec = { pairs: ["WETH/USDC"], capBps: 2000, salt: 1n, ops: [
      { op: "byTokenIn", cases: [{ token: "WETH", ops: [{ op: "flatFee", bps: 2 }] }], otherwise: [{ op: "toxicityFee", baseBps: 20, slopeBps: 0, maxBps: 20, windowSeconds: 600 }] },
      { op: "anchor", depth: 100, maxStaleness: 0 }, { op: "xyc" },
    ] };
    const c = compile(spec, market);
    const ins = walk(c.bytes);
    // riskCap, jumpIfTokenIn, toxicity(otherwise), jump, flatFee(WETH case), jump, anchor, xyc, salt
    expect(ins.map((i) => i.op)).toEqual([0x2f, 0x0b, 0x2e, 0x0a, 0x23, 0x0a, 0x30, 0x16, 0x22]);
    const b = hexToBytes(c.bytes);
    const target = (i: number, off: number) => (b[ins[i].pc + 2 + off] << 8) + b[ins[i].pc + 2 + off + 1];
    expect(target(1, 20)).toBe(ins[4].pc);     // WETH case starts at the flat fee
    expect(target(3, 0)).toBe(ins[6].pc);      // otherwise jumps to the anchor
    expect(target(5, 0)).toBe(ins[6].pc);      // the case jumps to the anchor too
    expect(c.listing.some((l) => l.includes("JumpIfTokenIn if the taker pays WETH"))).toBe(true);
  });

  it("reads its own bytes back", () => {
    const spec: ProgramSpec = { pairs: ["WETH/USDC", "cbBTC/USDC"], capBps: 1500, salt: 1n, ops: [{ op: "gate" }, { op: "toxicityFee", baseBps: 5, slopeBps: 200, maxBps: 50, windowSeconds: 600 }, { op: "anchor", depth: 80, maxStaleness: 0 }, { op: "xyc" }] };
    const c = compile(spec, market);
    const d = disassemble(c.bytes, market);
    expect(d.length).toBe(c.listing.length);
    expect(d[0]).toContain("RiskCap 15% out, 15% in");
    expect(d[1]).toContain("arena pass");
    expect(d[2]).toContain("ToxicityFee 5 bps at rest, +200 bps per full drain, max 50 bps, window 600 s");
    expect(d[3]).toContain("OracleAnchor depth 80x on WETH/USDC, cbBTC/USDC");
    expect(summarize(spec)).toMatchObject({ pairs: "WETH/USDC,cbBTC/USDC", gate: true, feeBaseBps: 5, depth: 80, shape: "gate > toxicityFee > anchor > xyc" });
  });

  it("refuses shapes the arena does not accept", () => {
    const bad = (ops: ProgramSpec["ops"], pairs = ["WETH/USDC"]) => () => validateSpec({ pairs, capBps: 2000, ops }, market);
    expect(bad([{ op: "anchor", depth: 100, maxStaleness: 0 }])).toThrow(/last instruction must be xyc/);
    expect(bad([{ op: "xyc" }, { op: "flatFee", bps: 1 }])).toThrow(/last instruction must be xyc/);
    expect(bad([{ op: "anchor", depth: 100, maxStaleness: 0 }, { op: "anchor", depth: 100, maxStaleness: 0 }, { op: "xyc" }])).toThrow(/at most one anchor/);
    expect(bad([{ op: "byTokenIn", cases: [{ token: "cbBTC", ops: [] }], otherwise: [] }, { op: "xyc" }])).toThrow(/none of the program's pairs trade/);
    expect(bad([{ op: "xyc" }], ["WETH/DOGE"])).toThrow(/unknown pair/);
    expect(() => validateSpec({ pairs: ["WETH/USDC"], capBps: 50, ops: [{ op: "xyc" }] }, market)).toThrow(/capBps/);
  });
});
