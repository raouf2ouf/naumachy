import { describe, expect, it } from "vitest";
import { decodeInstructions } from "../src/dialects.js";
import { nameTemplate } from "../src/naming.js";

const AQUA = "0x111111338c5091e8440b67b168bae16a668ac0de";

describe("templates", () => {
  it("decodes the dominant Base sequence through the Aqua router dialect", () => {
    expect(decodeInstructions(AQUA, [0x21, 0x1c, 0x12, 0x15, 0x11, 0x14])).toEqual([
      "OnlyTxOriginTokenBalanceNonZero", "AquaProtocolFeeIn", "XYCConcentrateSwap", "FeeFlatIn", "XYCSwap", "Salt",
    ]);
  });
  it("returns null for an unknown router or an unknown byte", () => {
    expect(decodeInstructions("0xabc", [0x11])).toBeNull();
    expect(decodeInstructions(AQUA, [0x11, 0x7f])).toBeNull();
  });
  it("names the dominant template and keeps plumbing silent", () => {
    expect(nameTemplate(["OnlyTxOriginTokenBalanceNonZero", "AquaProtocolFeeIn", "XYCConcentrateSwap", "FeeFlatIn", "XYCSwap", "Salt"]))
      .toEqual({ name: "gated concentrated AMM, flat fee", kind: "concentrated" });
    expect(nameTemplate(["XYCConcentrateSwap", "FeeFlatIn", "XYCSwap", "Salt"]).name).toBe("concentrated AMM, flat fee");
    expect(nameTemplate(["Extruction", "AdjustMinRate", "DynamicBalances", "InvalidateTokenOut", "StaticBalances", "InvalidateTokenIn"]).name)
      .toBe("custom logic, self re-arming, static balances, rate floor");
    expect(nameTemplate(null, false)).toEqual({ name: "unparsed program", kind: "unknown" });
    expect(nameTemplate(null)).toEqual({ name: "unknown router", kind: "unknown" });
  });
});
