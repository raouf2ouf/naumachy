import { concatHex, encodePacked, keccak256, toHex, type Address, type Hex } from "viem";

// The Naumachy dialect: the SwapVM v1.0.2 bytes plus ours. Runtime byte = static slot minus one.
export const OP = { xycSwap: 0x16, xycConcentrate: 0x17, decay: 0x18, salt: 0x22, flatFeeIn: 0x23, aquaProtocolFeeIn: 0x2b,
  toxicityFee: 0x2e, riskCap: 0x2f, oracleAnchor: 0x30 } as const;
export const BPS = 1_000_000_000n;   // SwapVM's fee base: 1e9 is 100%, one basis point is 100,000
export const bps = (n: number) => BigInt(Math.round(n * 100_000));

const ins = (op: number, args: Hex = "0x"): Hex => {
  const len = (args.length - 2) / 2;
  if (len > 255) throw new Error("instruction args over 255 bytes");
  return concatHex([toHex(op, { size: 1 }), toHex(len, { size: 1 }), args]);
};

export interface AnchoredKnobs {
  capBps: number;        // share of either balance one fill may move, in bps (2000 = 20%)
  feeBaseBps: number;    // fee at rest
  feeSlopeBps: number;   // fee added per full drain of the outgoing balance inside the window
  feeMaxBps: number;     // fee ceiling
  windowSeconds: number; // flow memory
  depth: number;         // virtual depth as a multiple of the real balance (100 = 100x)
  oracle: Address; base: Address; oracleDecimals: number; baseDecimals: number; quoteDecimals: number; maxStaleness: number;
  salt?: bigint;
}

// The anchored archetype: RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt.
export function anchoredProgram(k: AnchoredKnobs): Hex {
  return concatHex([
    ins(OP.riskCap, encodePacked(["uint32", "uint32"], [Number(bps(k.capBps)), Number(bps(k.capBps))])),
    ins(OP.toxicityFee, encodePacked(["uint32", "uint32", "uint32", "uint32"], [Number(bps(k.feeBaseBps)), Number(bps(k.feeSlopeBps)), Number(bps(k.feeMaxBps)), k.windowSeconds])),
    ins(OP.oracleAnchor, encodePacked(["address", "address", "uint8", "uint8", "uint8", "uint16", "uint32"], [k.oracle, k.base, k.oracleDecimals, k.baseDecimals, k.quoteDecimals, k.maxStaleness, Math.round(k.depth * 1e6)])),
    ins(OP.xycSwap),
    ins(OP.salt, encodePacked(["uint256"], [k.salt ?? BigInt(keccak256(toHex(Date.now())))])),
  ]);
}

export const ARCHETYPE_ANCHORED = keccak256(toHex("anchored-amm"));
