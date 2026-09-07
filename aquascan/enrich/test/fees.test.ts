import { describe, expect, it } from "vitest";
import { decodeFees, walkProgram } from "../src/fees.js";

const AQUA_ROUTER = "0x111111338c5091e8440b67b168bae16a668ac0de";
const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/^0x/, ""), "hex"));

// gate > AquaProtocolFeeIn(0.025 bps -> 0x8063d4fa…) > XYCConcentrateSwap > FeeFlatIn(0.10 bps) > XYCSwap > Salt,
// the program that carries most of Ethereum's volume, args of the swap instructions abbreviated.
const PROGRAM = "0x" +
  "2100" +                                                       // OnlyTxOriginTokenBalanceNonZero, no args
  "1c18" + "000009c4" + "8063d4fa000000000000000000000000deadbeef" + // AquaProtocolFeeIn: 2500 raw = 0.025 bps, recipient
  "1204" + "00000001" +                                          // XYCConcentrateSwap, 4 arg bytes
  "1504" + "00002710" +                                          // FeeFlatIn: 10000 raw = 0.10 bps
  "1100" +                                                       // XYCSwap
  "1401" + "aa";                                                 // Salt

describe("program fees", () => {
  it("walks [op][len][args] and refuses a truncated program", () => {
    expect(walkProgram(hex(PROGRAM))!.map((i) => i.op)).toEqual([0x21, 0x1c, 0x12, 0x15, 0x11, 0x14]);
    expect(walkProgram(hex(PROGRAM.slice(0, -2)))).toBeNull();
  });
  it("decodes the maker flat fee and the static protocol fee on the 1e9 base", () => {
    const f = decodeFees(AQUA_ROUTER, hex(PROGRAM))!;
    expect(f.makerFeeBps).toBeCloseTo(0.1, 6);
    expect(f.makerFeeSide).toBe("in");
    expect(f.makerFeeKind).toBe("flat");
    expect(f.protocolFeeBps).toBeCloseTo(0.025, 6);
    expect(f.protocolFeeTo).toBe("0x8063d4fa000000000000000000000000deadbeef");
    expect(f.protocolFeeKind).toBe("static");
  });
  it("returns null for an unknown router and all-null fields for a fee-less program", () => {
    expect(decodeFees("0x0000000000000000000000000000000000000001", hex(PROGRAM))).toBeNull();
    const f = decodeFees(AQUA_ROUTER, hex("0x2100" + "1100" + "1401aa"))!;
    expect(f.makerFeeBps).toBeNull(); expect(f.protocolFeeKind).toBeNull();
  });
});
