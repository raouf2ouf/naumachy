// An opcode byte means nothing without the router that executes it: dispatch tables are per
// contract and per version. These two are the deployed v1.0.1 routers, the same vanity
// addresses on every chain. Runtime byte = index in the router's static table minus one.

const AQUA_ROUTER = "0x111111338c5091e8440b67b168bae16a668ac0de";
const FULL_ROUTER = "0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de";

const AQUA: Record<number, string> = {
  0x0a: "Jump", 0x0b: "JumpIfTokenIn", 0x0c: "JumpIfTokenOut", 0x0d: "Deadline",
  0x0e: "OnlyTakerTokenBalanceNonZero", 0x0f: "OnlyTakerTokenBalanceGte", 0x10: "OnlyTakerTokenSupplyShareGte",
  0x11: "XYCSwap", 0x12: "XYCConcentrateSwap", 0x13: "Decay", 0x14: "Salt", 0x15: "FeeFlatIn",
  0x1b: "ProtocolFeeIn", 0x1c: "AquaProtocolFeeIn", 0x1d: "DynamicProtocolFeeIn", 0x1e: "AquaDynamicProtocolFeeIn",
  0x1f: "PeggedSwap", 0x20: "Extruction", 0x21: "OnlyTxOriginTokenBalanceNonZero",
};

const FULL: Record<number, string> = {
  0x0a: "Jump", 0x0b: "JumpIfTokenIn", 0x0c: "JumpIfTokenOut", 0x0d: "Deadline",
  0x0e: "OnlyTakerTokenBalanceNonZero", 0x0f: "OnlyTakerTokenBalanceGte", 0x10: "OnlyTakerTokenSupplyShareGte",
  0x11: "StaticBalances", 0x12: "DynamicBalances", 0x13: "InvalidateBit", 0x14: "InvalidateTokenIn", 0x15: "InvalidateTokenOut",
  0x16: "XYCSwap", 0x17: "XYCConcentrateSwap", 0x18: "Decay", 0x19: "LimitSwap", 0x1a: "LimitSwapFullAmount",
  0x1b: "RequireMinRate", 0x1c: "AdjustMinRate", 0x1d: "DutchAuctionBalanceIn", 0x1e: "DutchAuctionBalanceOut",
  0x1f: "BaseFeeAdjuster", 0x20: "TWAPSwap", 0x21: "Extruction", 0x22: "Salt",
  0x23: "FeeFlatIn", 0x24: "FeeFlatOut", 0x25: "FeeProgressiveIn", 0x26: "FeeProgressiveOut",
  0x27: "ProtocolFeeOut", 0x28: "AquaProtocolFeeOut", 0x29: "PeggedSwap",
  0x2a: "ProtocolFeeIn", 0x2b: "AquaProtocolFeeIn", 0x2c: "DynamicProtocolFeeIn", 0x2d: "AquaDynamicProtocolFeeIn",
};

// NaumachyRouter: the full table with the slots no archetype composes turned into reverts, then ours.
const NAUMACHY: Record<number, string> = Object.fromEntries(
  Object.entries(FULL).filter(([b]) => ![0x13, 0x14, 0x15, 0x1f, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29].includes(Number(b))),
) as Record<number, string>;
NAUMACHY[0x2e] = "ToxicityFee"; NAUMACHY[0x2f] = "RiskCap"; NAUMACHY[0x30] = "OracleAnchor";

export const DIALECTS: Record<string, { label: string; opcodes: Record<number, string> }> = {
  [AQUA_ROUTER]: { label: "AquaSwapVMRouter v1.0.1", opcodes: AQUA },
  [FULL_ROUTER]: { label: "SwapVMRouter v1.0.1", opcodes: FULL },
};
// Our routers live at different addresses per deployment (a fork, Base): NAUMACHY_ROUTERS lists them.
for (const addr of (process.env.NAUMACHY_ROUTERS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)) {
  DIALECTS[addr] = { label: "NaumachyRouter", opcodes: NAUMACHY };
}

export function dialectFor(app: string) { return DIALECTS[app.toLowerCase()]; }

// Returns instruction names, or null when the app is unknown or a byte is not in its table.
export function decodeInstructions(app: string, opcodes: number[]): string[] | null {
  const d = dialectFor(app);
  if (!d) return null;
  const out: string[] = [];
  for (const op of opcodes) {
    const name = d.opcodes[op];
    if (!name) return null;
    out.push(name);
  }
  return out;
}
