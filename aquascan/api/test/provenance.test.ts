import { describe, expect, it } from "vitest";
import { priced, windowSeconds } from "../src/provenance.js";

describe("priced", () => {
  it("wraps a number with its source, time and clamped confidence", () => {
    expect(priced("12.5", 1.2, "2026-09-06T00:00:00.000Z")).toEqual({ value: 12.5, source: "defillama hourly", at: "2026-09-06T00:00:00.000Z", confidence: 1 });
  });
  it("keeps null values null and missing confidence at zero", () => {
    expect(priced(null, null, new Date(0)).value).toBeNull();
    expect(priced(null, null, new Date(0)).confidence).toBe(0);
  });
});

describe("windowSeconds", () => {
  it("defaults to thirty days and knows the named windows", () => {
    expect(windowSeconds(undefined)).toEqual({ name: "30d", seconds: 30 * 86400 });
    expect(windowSeconds("24h").seconds).toBe(86400);
    expect(windowSeconds("all").seconds).toBe(0);
  });
});

describe("refSource", () => {
  it("names the tape, the hourly fallback, or the mix", async () => {
    const { refSource } = await import("../src/provenance.js");
    expect(refSource(1)).toBe("venue tape or same-chain pools, by the minute");
    expect(refSource(0)).toBe("defillama hourly");
    expect(refSource(0.85)).toBe("venue tape or same-chain pools for 85% of fills, defillama hourly for the rest");
  });
});
