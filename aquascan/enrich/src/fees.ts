import { dialectFor } from "./dialects.js";

// Fee.sol: `uint256 constant BPS = 1e9` means 100%, so a raw fee argument of 10_000 is 0.10 bps.
export const FEE_BASE = 1e9;

export interface Instruction { op: number; args: Uint8Array }

export interface StrategyFees {
  makerFeeBps: number | null;             // basis points (1e-4), the maker's own fee on the token it receives or gives
  makerFeeSide: "in" | "out" | null;
  makerFeeKind: "flat" | "progressive" | "toxicity" | null;   // toxicity: base rate, widening with one-way flow
  protocolFeeBps: number | null;          // basis points pulled out of the maker's ledger for the protocol
  protocolFeeTo: string | null;           // recipient of a static protocol fee
  protocolFeeKind: "static" | "dynamic" | null;
  protocolFeeProvider: string | null;     // fee provider contract of a dynamic protocol fee
}

// Program encoding: [opcode:1][argsLen:1][args:N] per instruction, the same walk as the subgraph.
export function walkProgram(program: Uint8Array): Instruction[] | null {
  const out: Instruction[] = [];
  let pc = 0;
  while (pc + 1 < program.length) {
    const op = program[pc]; const len = program[pc + 1];
    if (pc + 2 + len > program.length) return null;
    out.push({ op, args: program.subarray(pc + 2, pc + 2 + len) });
    pc += 2 + len;
  }
  return pc === program.length ? out : null;
}

const rawBps = (args: Uint8Array) => ((args[0] << 24) >>> 0) + (args[1] << 16) + (args[2] << 8) + args[3];
const toBps = (raw: number) => (raw / FEE_BASE) * 1e4;
const addr = (bytes: Uint8Array) => "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// Reads the fee instructions of a program through its router's dialect. Null when the router is
// unknown or the program does not walk; a program without fee instructions decodes to all-null fields.
export function decodeFees(app: string, program: Uint8Array): StrategyFees | null {
  const dialect = dialectFor(app);
  if (!dialect) return null;
  const instructions = walkProgram(program);
  if (!instructions) return null;
  const fees: StrategyFees = { makerFeeBps: null, makerFeeSide: null, makerFeeKind: null, protocolFeeBps: null, protocolFeeTo: null, protocolFeeKind: null, protocolFeeProvider: null };
  for (const { op, args } of instructions) {
    const name = dialect.opcodes[op];
    if (!name) return null;
    switch (name) {
      case "FeeFlatIn": case "FeeFlatOut":
        if (fees.makerFeeKind === null && args.length >= 4) { fees.makerFeeBps = toBps(rawBps(args)); fees.makerFeeSide = name.endsWith("In") ? "in" : "out"; fees.makerFeeKind = "flat"; }
        break;
      case "ToxicityFee":
        if (fees.makerFeeKind === null && args.length >= 16) { fees.makerFeeBps = toBps(rawBps(args)); fees.makerFeeSide = "in"; fees.makerFeeKind = "toxicity"; }
        break;
      case "FeeProgressiveIn": case "FeeProgressiveOut":
        if (fees.makerFeeKind === null) { fees.makerFeeSide = name.endsWith("In") ? "in" : "out"; fees.makerFeeKind = "progressive"; }
        break;
      case "ProtocolFeeIn": case "ProtocolFeeOut": case "AquaProtocolFeeIn": case "AquaProtocolFeeOut":
        if (fees.protocolFeeKind === null && args.length >= 24) { fees.protocolFeeBps = toBps(rawBps(args)); fees.protocolFeeTo = addr(args.subarray(4, 24)); fees.protocolFeeKind = "static"; }
        break;
      case "DynamicProtocolFeeIn": case "AquaDynamicProtocolFeeIn":
        if (fees.protocolFeeKind === null && args.length >= 20) { fees.protocolFeeProvider = addr(args.subarray(0, 20)); fees.protocolFeeKind = "dynamic"; }
        break;
    }
  }
  return fees;
}
