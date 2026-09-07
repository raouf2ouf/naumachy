import { describe, expect, it } from "vitest";
import { bestPool, chooseRoute, orient } from "../src/routes.js";

const ONEINCH = "0x1111", STETH = "0xae7a", WETH = "0xc02a", USDC = "0xa0b8";
const rank = (t: string) => (t === USDC ? 0 : t === WETH ? 1 : 2);
const pool = (id: string, swaps30d: number) => ({ id, token0: "x", token1: "y", swaps30d, volume30dUsd: 0, feeTier: 3000 });

describe("orient", () => {
  it("puts the less money-like token first and remembers a flip", () => {
    expect(orient(WETH, 1, ONEINCH, 2)).toEqual({ a: ONEINCH, b: WETH, flipped: true });
    expect(orient(ONEINCH, 2, WETH, 1)).toEqual({ a: ONEINCH, b: WETH, flipped: false });
  });
});

describe("chooseRoute", () => {
  it("keeps a dense pair on the tape", () => {
    expect(chooseRoute(ONEINCH, WETH, rank, () => 500, pool("p", 9999), [USDC], () => null).kind).toBe("tape");
  });
  it("takes the direct pool when the tape is thin and the pool trades", () => {
    const r = chooseRoute(USDC, WETH, rank, () => 3, pool("direct", 578000), [], () => null);
    expect(r.kind).toBe("pool"); expect(r.pool).toBe("direct"); expect(r.leg1?.src).toBe("pool");
  });
  it("hops through a hub: the dense tape leg first, the pool leg second, with inversions", () => {
    const dense = (x: string, y: string) => (x === ONEINCH && y === WETH ? 500 : 1);
    const r = chooseRoute(ONEINCH, STETH, rank, dense, null, [WETH], (hub, other) => (hub === WETH && other === STETH ? pool("weth-steth", 32) : null));
    expect(r.kind).toBe("hourly");   // 32 swaps in 30 days is below the floor
    const r2 = chooseRoute(ONEINCH, STETH, rank, dense, null, [WETH], (hub, other) => (hub === WETH && other === STETH ? pool("weth-steth", 1000) : null));
    expect(r2.kind).toBe("hop"); expect(r2.hub).toBe(WETH); expect(r2.pool).toBe("weth-steth");
    expect(r2.leg1).toEqual({ a: ONEINCH, b: WETH, src: "tape", inv: false });
    // stETH ranks above WETH? no: both rank 2 and 1, WETH is the quote -> pair (stETH, WETH); we need price(WETH in stETH) = inverted
    expect(r2.leg2).toEqual({ a: STETH, b: WETH, src: "pool", inv: true });
  });
  it("falls back to hourly when nothing qualifies", () => {
    expect(bestPool([pool("a", 10), pool("b", 50)])).toBeNull();
    expect(chooseRoute(ONEINCH, STETH, rank, () => 1, null, [WETH, USDC], () => null).kind).toBe("hourly");
  });
});
