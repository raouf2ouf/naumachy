import { describe, expect, it } from "vitest";
import { batchTargets, coinsParam, matchPoints } from "../src/llama.js";
import { decodeString } from "../src/lanes/tokens.js";

const t = (hour: number) => ({ chain: "base", token: "0xabc", hour });

describe("llama batching", () => {
  it("splits targets into calls of the given size", () => {
    expect(batchTargets([t(1), t(2), t(3)], 2).map((b) => b.length)).toEqual([2, 1]);
  });
  it("groups hours per coin id", () => {
    expect(coinsParam([t(3600), t(7200), { chain: "bsc", token: "0xdef", hour: 3600 }])).toEqual({ "base:0xabc": [3600, 7200], "bsc:0xdef": [3600] });
  });
  it("matches each hour to the closest point inside the width and reports the rest as misses", () => {
    const body = { coins: { "base:0xabc": { symbol: "ABC", decimals: 18, prices: [{ timestamp: 3700, price: 2, confidence: 0.9 }, { timestamp: 7100, price: 3 }] } } };
    const { points, misses } = matchPoints([t(3600), t(7200), t(90000)], body, 4 * 3600);
    expect(points.map((p) => [p.hour, p.usd, p.sourceTs, p.confidence, p.decimals])).toEqual([[3600, 2, 3700, 0.9, 18], [7200, 3, 7100, null, 18]]);
    expect(misses).toEqual([t(90000)]);
  });
});

describe("decodeString", () => {
  it("decodes an abi string", () => {
    const hex = "0x" + "20".padStart(64, "0") + "4".padStart(64, "0") + Buffer.from("WETH").toString("hex").padEnd(64, "0");
    expect(decodeString(hex)).toBe("WETH");
  });
  it("decodes a bytes32 symbol", () => {
    expect(decodeString("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0"))).toBe("MKR");
  });
  it("returns null on empty data", () => {
    expect(decodeString("0x")).toBeNull();
  });
});
