import { concatHex, encodePacked, hexToBytes, keccak256, toHex, type Address, type Hex } from "viem";

// The Naumachy dialect: the SwapVM v1.0.2 bytes plus ours. Runtime byte = static slot minus one.
export const OP = {
  jump: 0x0a, jumpIfTokenIn: 0x0b, jumpIfTokenOut: 0x0c, deadline: 0x0d, onlyTakerTokenBalanceNonZero: 0x0e,
  xycSwap: 0x16, salt: 0x22, flatFeeIn: 0x23, aquaProtocolFeeIn: 0x2b,
  toxicityFee: 0x2e, riskCap: 0x2f, oracleAnchor: 0x30,
} as const;
export const OP_NAMES: Record<number, string> = Object.fromEntries(Object.entries(OP).map(([k, v]) => [v, k]));
export const BPS = 1_000_000_000n;   // SwapVM's fee base: 1e9 is 100%, one basis point is 100,000
export const bps = (n: number) => BigInt(Math.round(n * 100_000));
const fromBps = (raw: number) => raw / 100_000;

const ins = (op: number, args: Hex = "0x"): Hex => {
  const len = (args.length - 2) / 2;
  if (len > 255) throw new Error(`instruction ${OP_NAMES[op] ?? op} has ${len} bytes of arguments, over 255`);
  return concatHex([toHex(op, { size: 1 }), toHex(len, { size: 1 }), args]);
};
const size = (h: Hex) => (h.length - 2) / 2;

// ---- the market a program names ----

export interface Token { symbol: string; address: Address; decimals: number }
/// A pair anchored on a pool oracle. The oracle prices one `oracleBase` in `oracleQuote` (the pool's
/// token0 in token1); `name` is the conventional label the minds use, whichever way the pool is.
export interface Pair { name: string; oracle: Address; oracleDecimals: number; oracleBase: Token; oracleQuote: Token; pool: Address; feeTier: number }
export interface Market { tokens: Token[]; pairs: Pair[]; pass: Address }

export function findPair(market: Market, name: string): Pair {
  const [a, b] = name.split("/");
  const p = market.pairs.find((x) => x.name === name || x.name === `${b}/${a}`);
  if (!p) throw new Error(`unknown pair ${name}; the arena trades ${market.pairs.map((x) => x.name).join(", ")}`);
  return p;
}
export function findToken(market: Market, symbol: string): Token {
  const t = market.tokens.find((x) => x.symbol === symbol);
  if (!t) throw new Error(`unknown token ${symbol}; the arena knows ${market.tokens.map((x) => x.symbol).join(", ")}`);
  return t;
}
export const pairTokens = (p: Pair): [Token, Token] => [p.oracleBase, p.oracleQuote];

// ---- the program a mind writes ----

export type FeeOp =
  | { op: "flatFee"; bps: number }
  | { op: "toxicityFee"; baseBps: number; slopeBps: number; maxBps: number; windowSeconds: number };
export type Op =
  | { op: "gate" }
  | FeeOp
  | { op: "byTokenIn"; cases: { token: string; ops: FeeOp[] }[]; otherwise: FeeOp[] }
  | { op: "anchor"; depth: number; maxStaleness?: number }
  | { op: "xyc" };
export interface ProgramSpec { pairs: string[]; capBps: number; ops: Op[]; salt?: bigint }
export interface Compiled { bytes: Hex; tokens: Token[]; pairs: Pair[]; listing: string[] }

const FEE_OPS = new Set(["flatFee", "toxicityFee"]);

function feeBytes(f: FeeOp): Hex {
  if (f.op === "flatFee") return ins(OP.flatFeeIn, encodePacked(["uint32"], [Number(bps(f.bps))]));
  return ins(OP.toxicityFee, encodePacked(["uint32", "uint32", "uint32", "uint32"], [Number(bps(f.baseBps)), Number(bps(f.slopeBps)), Number(bps(f.maxBps)), f.windowSeconds]));
}

/// Checks the shape of a program before any byte is written. Throws a sentence the mind can act on.
export function validateSpec(spec: ProgramSpec, market: Market): void {
  if (!spec.pairs.length) throw new Error("a program must name at least one pair");
  if (new Set(spec.pairs.map((p) => findPair(market, p).name)).size !== spec.pairs.length) throw new Error("a pair is named twice");
  if (!(spec.capBps >= 100 && spec.capBps <= 5000)) throw new Error("capBps must be between 100 and 5000 (1% to 50% of a balance per fill)");
  const ops = spec.ops;
  if (!ops.length || ops[ops.length - 1].op !== "xyc") throw new Error("the last instruction must be xyc, the swap itself");
  if (ops.filter((o) => o.op === "xyc").length !== 1) throw new Error("exactly one xyc instruction");
  if (ops.filter((o) => o.op === "anchor").length > 1) throw new Error("at most one anchor instruction");
  if (ops.filter((o) => o.op === "gate").length > 1) throw new Error("at most one gate instruction");
  if (ops.filter((o) => o.op === "byTokenIn").length > 1) throw new Error("at most one byTokenIn instruction");
  const tokens = new Set(spec.pairs.flatMap((p) => pairTokens(findPair(market, p)).map((t) => t.symbol)));
  for (const o of ops) {
    if (o.op === "byTokenIn") {
      if (!o.cases.length) throw new Error("byTokenIn needs at least one case");
      for (const c of o.cases) {
        if (!tokens.has(c.token)) throw new Error(`byTokenIn names ${c.token}, which none of the program's pairs trade`);
        for (const f of c.ops) if (!FEE_OPS.has(f.op)) throw new Error("byTokenIn cases hold fee instructions only");
      }
      for (const f of o.otherwise) if (!FEE_OPS.has(f.op)) throw new Error("byTokenIn otherwise holds fee instructions only");
    }
    if (o.op === "flatFee" && !(o.bps >= 0 && o.bps <= 500)) throw new Error("flatFee bps must be between 0 and 500");
    if (o.op === "toxicityFee" && !(o.baseBps >= 0 && o.maxBps >= o.baseBps && o.maxBps <= 500 && o.slopeBps >= 0 && o.windowSeconds >= 0 && o.windowSeconds <= 86400)) throw new Error("toxicityFee: 0 <= baseBps <= maxBps <= 500, slopeBps >= 0, window 0 to 86400 s");
    if (o.op === "anchor" && !(o.depth >= 1 && o.depth <= 10000)) throw new Error("anchor depth must be between 1 and 10000 (times the real balance)");
  }
}

interface Chunk { bytes?: Hex; jumpIfTokenIn?: { token: Address; label: string }; jump?: string; label?: string; text?: string }

/// Compiles a program to bytes: RiskCap first (the arena's rule, never the mind's to drop), the
/// mind's instructions, Salt last. `byTokenIn` becomes conditional jumps: fee instructions are
/// middleware that run the rest of the program nested inside themselves, so each branch ends with
/// a jump past the other branches to the shared tail.
export function compile(spec: ProgramSpec, market: Market): Compiled {
  validateSpec(spec, market);
  const pairs = spec.pairs.map((p) => findPair(market, p));
  const tokens = market.tokens.filter((t) => pairs.some((p) => pairTokens(p).some((x) => x.address === t.address)));
  const chunks: Chunk[] = [];
  const cap = Number(bps(spec.capBps));
  chunks.push({ bytes: ins(OP.riskCap, encodePacked(["uint32", "uint32"], [cap, cap])), text: `RiskCap ${spec.capBps / 100}% of either balance per fill` });
  let branch = 0;
  for (const o of spec.ops) {
    if (o.op === "gate") chunks.push({ bytes: ins(OP.onlyTakerTokenBalanceNonZero, market.pass), text: "Gate: taker must hold an arena pass" });
    else if (o.op === "flatFee" || o.op === "toxicityFee") chunks.push({ bytes: feeBytes(o), text: feeText(o) });
    else if (o.op === "byTokenIn") {
      const id = branch++;
      for (const [i, c] of o.cases.entries()) chunks.push({ jumpIfTokenIn: { token: findToken(market, c.token).address, label: `b${id}c${i}` }, text: `if the taker pays ${c.token}` });
      for (const f of o.otherwise) chunks.push({ bytes: feeBytes(f), text: `otherwise: ${feeText(f)}` });
      chunks.push({ jump: `b${id}end` });
      for (const [i, c] of o.cases.entries()) {
        chunks.push({ label: `b${id}c${i}` });
        for (const f of c.ops) chunks.push({ bytes: feeBytes(f), text: `paying ${c.token}: ${feeText(f)}` });
        chunks.push({ jump: `b${id}end` });
      }
      chunks.push({ label: `b${id}end` });
    } else if (o.op === "anchor") {
      const entries = pairs.map((p) => encodePacked(["address", "address", "address", "uint8", "uint8", "uint8"], [p.oracle, p.oracleBase.address, p.oracleQuote.address, p.oracleDecimals, p.oracleBase.decimals, p.oracleQuote.decimals]));
      const args = concatHex([encodePacked(["uint16", "uint32"], [o.maxStaleness ?? 0, Math.round(o.depth * 1e6)]), ...entries]);
      chunks.push({ bytes: ins(OP.oracleAnchor, args), text: `OracleAnchor depth ${o.depth}x on ${pairs.map((p) => p.name).join(", ")}` });
    } else if (o.op === "xyc") chunks.push({ bytes: ins(OP.xycSwap), text: "XYCSwap" });
  }
  chunks.push({ bytes: ins(OP.salt, encodePacked(["uint256"], [spec.salt ?? BigInt(keccak256(toHex(Date.now())))])), text: "Salt" });

  // layout: labels resolve to byte offsets; jumps have fixed sizes
  const at: Record<string, number> = {}; let pc = 0;
  for (const c of chunks) { if (c.label) at[c.label] = pc; else if (c.jumpIfTokenIn) pc += 24; else if (c.jump) pc += 4; else pc += size(c.bytes!); }
  const parts: Hex[] = []; const listing: string[] = []; pc = 0;
  for (const c of chunks) {
    if (c.label) continue;
    let b: Hex; let text = c.text ?? "";
    if (c.jumpIfTokenIn) { b = ins(OP.jumpIfTokenIn, encodePacked(["address", "uint16"], [c.jumpIfTokenIn.token, at[c.jumpIfTokenIn.label]])); text = `JumpIfTokenIn ${text} -> @${at[c.jumpIfTokenIn.label]}`; }
    else if (c.jump) { b = ins(OP.jump, encodePacked(["uint16"], [at[c.jump]])); text = `Jump -> @${at[c.jump]}`; }
    else b = c.bytes!;
    listing.push(`@${String(pc).padStart(3)}  ${text}`); parts.push(b); pc += size(b);
  }
  return { bytes: concatHex(parts), tokens, pairs, listing };
}

function feeText(f: FeeOp): string {
  return f.op === "flatFee" ? `FlatFee ${f.bps} bps` : `ToxicityFee ${f.baseBps} bps at rest, +${f.slopeBps} bps per full drain, max ${f.maxBps} bps, window ${f.windowSeconds} s`;
}

/// Reads a program back from its bytes, naming what the market knows. What rivals see of each
/// other: the bytes are on chain, so this listing is public by construction.
export function disassemble(program: Hex, market: Market): string[] {
  const b = hexToBytes(program); const out: string[] = []; let pc = 0;
  const addr = (o: number) => ("0x" + Array.from(b.subarray(o, o + 20), (x) => x.toString(16).padStart(2, "0")).join("")) as Address;
  const u32 = (o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  const u16 = (o: number) => (b[o] << 8) + b[o + 1];
  const sym = (a: Address) => market.tokens.find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? a.slice(0, 8);
  while (pc + 1 < b.length) {
    const op = b[pc]; const len = b[pc + 1]; const a = pc + 2; const name = OP_NAMES[op] ?? `op 0x${op.toString(16)}`;
    let text = name;
    switch (op) {
      case OP.riskCap: text = `RiskCap ${fromBps(u32(a)) / 100}% out, ${fromBps(u32(a + 4)) / 100}% in, per fill`; break;
      case OP.toxicityFee: text = feeText({ op: "toxicityFee", baseBps: fromBps(u32(a)), slopeBps: fromBps(u32(a + 4)), maxBps: fromBps(u32(a + 8)), windowSeconds: u32(a + 12) }); break;
      case OP.flatFeeIn: text = `FlatFee ${fromBps(u32(a))} bps`; break;
      case OP.jump: text = `Jump -> @${u16(a)}`; break;
      case OP.jumpIfTokenIn: text = `JumpIfTokenIn if the taker pays ${sym(addr(a))} -> @${u16(a + 20)}`; break;
      case OP.jumpIfTokenOut: text = `JumpIfTokenOut if the taker receives ${sym(addr(a))} -> @${u16(a + 20)}`; break;
      case OP.onlyTakerTokenBalanceNonZero: text = addr(a).toLowerCase() === market.pass.toLowerCase() ? "Gate: taker must hold an arena pass" : `Gate: taker must hold ${addr(a)}`; break;
      case OP.oracleAnchor: {
        const names: string[] = [];
        for (let o = a + 6; o + 63 <= a + len; o += 63) {
          const base = addr(o + 20); const quote = addr(o + 40);
          const p = market.pairs.find((x) => x.oracleBase.address.toLowerCase() === base.toLowerCase() && x.oracleQuote.address.toLowerCase() === quote.toLowerCase());
          names.push(p ? p.name : `${sym(base)}/${sym(quote)}`);
        }
        text = `OracleAnchor depth ${u32(a + 2) / 1e6}x on ${names.join(", ")}${u16(a) ? `, stale after ${u16(a)} s` : ""}`; break;
      }
      case OP.xycSwap: text = "XYCSwap"; break;
      case OP.salt: text = "Salt"; break;
    }
    out.push(`@${String(pc).padStart(3)}  ${text}`);
    pc += 2 + len;
  }
  return out;
}

// ---- the anchored archetype as a spec: RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt ----

export interface AnchoredKnobs { capBps: number; feeBaseBps: number; feeSlopeBps: number; feeMaxBps: number; windowSeconds: number; depth: number }
export function anchoredSpec(k: AnchoredKnobs, pairs: string[] = ["WETH/USDC"], salt?: bigint): ProgramSpec {
  return { pairs, capBps: k.capBps, salt, ops: [
    { op: "toxicityFee", baseBps: k.feeBaseBps, slopeBps: k.feeSlopeBps, maxBps: k.feeMaxBps, windowSeconds: k.windowSeconds },
    { op: "anchor", depth: k.depth },
    { op: "xyc" },
  ] };
}

/// A flat summary of a spec for tables and diffs: the numbers a reader compares across generations.
export function summarize(spec: ProgramSpec): Record<string, unknown> {
  const s: Record<string, unknown> = { pairs: spec.pairs.join(","), capBps: spec.capBps, gate: spec.ops.some((o) => o.op === "gate") };
  const fees = spec.ops.filter((o) => o.op === "flatFee" || o.op === "toxicityFee") as FeeOp[];
  const f = fees[0];
  if (f?.op === "toxicityFee") { s.feeBaseBps = f.baseBps; s.feeSlopeBps = f.slopeBps; s.feeMaxBps = f.maxBps; s.windowSeconds = f.windowSeconds; }
  else if (f?.op === "flatFee") { s.feeBaseBps = f.bps; s.feeSlopeBps = 0; s.feeMaxBps = f.bps; }
  const by = spec.ops.find((o) => o.op === "byTokenIn");
  if (by && by.op === "byTokenIn") s.feeByTokenIn = by.cases.map((c) => `${c.token}: ${c.ops.map((x) => x.op === "flatFee" ? `${x.bps} bps` : `${x.baseBps}-${x.maxBps} bps`).join("+") || "none"}`).join("; ");
  const anchor = spec.ops.find((o) => o.op === "anchor");
  s.depth = anchor && anchor.op === "anchor" ? anchor.depth : null;
  s.shape = spec.ops.map((o) => o.op).join(" > ");
  return s;
}

export const ARCHETYPE_ANCHORED = keccak256(toHex("anchored-amm"));
export const ARCHETYPE_AUTHORED = keccak256(toHex("authored"));
