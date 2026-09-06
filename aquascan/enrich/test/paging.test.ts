import { describe, expect, it } from "vitest";
import { planNextPage } from "../src/paging.js";

describe("planNextPage", () => {
  it("is done on an empty page and keeps the cursor", () => {
    expect(planNextPage([], 3, 10)).toEqual({ done: true, cursor: 10 });
  });
  it("is done on a short page and moves the cursor to the last key", () => {
    expect(planNextPage([11, 12], 3, 10)).toEqual({ done: true, cursor: 12 });
  });
  it("steps back one key after a full page so ties on the last key are re-read", () => {
    expect(planNextPage([11, 12, 13], 3, 10)).toEqual({ done: false, cursor: 12 });
  });
  it("flags a full page made of a single key for skip paging", () => {
    expect(planNextPage([12, 12, 12], 3, 10)).toEqual({ done: false, cursor: 12, overflowKey: 12 });
  });
});
