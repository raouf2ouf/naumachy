import { describe, expect, it } from "vitest";
import { emptyBook, priceFill, trade, unrealised } from "../src/pnl.js";

describe("average cost book", () => {
  it("blends the basis when adding and realises when reducing", () => {
    const b = emptyBook();
    trade(b, 10, 100); trade(b, 10, 120);
    expect(b.position).toBe(20); expect(b.basis).toBe(110);
    trade(b, -5, 130);
    expect(b.realised).toBeCloseTo(100); expect(b.position).toBe(15); expect(b.basis).toBe(110);
    expect(unrealised(b, 140)).toBeCloseTo(450);
  });
  it("opens a short when giving out more than it took, and covers it", () => {
    const b = emptyBook();
    trade(b, -1, 2000);                       // sold 1 ETH it brought from the wallet
    expect(b.position).toBe(-1); expect(b.basis).toBe(2000);
    expect(unrealised(b, 2500)).toBeCloseTo(-500);
    trade(b, 1, 2400);                        // bought it back dearer
    expect(b.position).toBe(0); expect(b.realised).toBeCloseTo(-400); expect(unrealised(b, 2500)).toBe(0);
  });
  it("flips through zero and re-opens at the trade price", () => {
    const b = emptyBook();
    trade(b, 4, 10); trade(b, -6, 12);
    expect(b.realised).toBeCloseTo(8); expect(b.position).toBe(-2); expect(b.basis).toBe(12);
  });
  it("realised plus unrealised equals the position marked at latest prices", () => {
    // one two-sided fill: sold 1 ETH for 2000 USDC when ETH printed 2010 on the hour; marked at 2500
    const legs = priceFill([{ token: "eth", qty: -1, usd: 2010, rank: 1 }, { token: "usdc", qty: 2000, usd: 1, rank: 0 }])!;
    const books = new Map<string, ReturnType<typeof emptyBook>>();
    for (const l of legs) { const b = books.get(l.token) ?? emptyBook(); trade(b, l.qty, l.price); books.set(l.token, b); }
    const marks: Record<string, number> = { eth: 2500, usdc: 1 };
    let total = 0; for (const [t, b] of books) total += b.realised + (unrealised(b, marks[t]) ?? 0);
    expect(total).toBeCloseTo(-1 * 2500 + 2000 * 1);   // versus holding: -500, the at-fill slippage is inside
  });
});

describe("fill pricing", () => {
  it("anchors on the stable and implies the other leg", () => {
    const p = priceFill([{ token: "a", qty: -2, usd: 1500, rank: 1 }, { token: "u", qty: 3100, usd: 1, rank: 0 }])!;
    expect(p.find((l) => l.token === "a")!.price).toBeCloseTo(1550);
  });
  it("drops a fill nobody can price, and a multi-leg fill with a hole", () => {
    expect(priceFill([{ token: "a", qty: -2, usd: null, rank: 2 }, { token: "b", qty: 3, usd: null, rank: 2 }])).toBeNull();
    expect(priceFill([{ token: "a", qty: -2, usd: 1, rank: 2 }, { token: "b", qty: 3, usd: null, rank: 2 }, { token: "c", qty: 1, usd: 2, rank: 2 }])).toBeNull();
  });
});
