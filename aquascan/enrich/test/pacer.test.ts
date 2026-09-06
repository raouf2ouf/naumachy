import { describe, expect, it } from "vitest";
import { createPacer } from "../src/pacer.js";

describe("createPacer", () => {
  it("spaces calls by the interval and runs them in order", async () => {
    let clock = 0;
    const waits: number[] = [];
    const paced = createPacer(60, () => clock, async (ms) => { waits.push(ms); clock += ms; });
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((n) => paced(async () => { order.push(n); })));
    expect(order).toEqual([1, 2, 3]);
    expect(waits).toEqual([1000, 1000]);
  });
  it("keeps pacing after a failed call", async () => {
    let clock = 0;
    const paced = createPacer(60, () => clock, async (ms) => { clock += ms; });
    await expect(paced(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(paced(async () => 42)).resolves.toBe(42);
  });
});
