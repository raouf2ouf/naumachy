// Reads a SwapVM program back into words: every instruction with its arguments decoded, the jumps
// resolved, and, for the curve families, the numbers a chart needs. Layouts follow SwapVM v1.0.2
// (contracts/lib/swap-vm/src, argument slicing quoted in docs/interfaces.md); opcode tables are the
// deployed routers' dispatch tables, the same ones aquascan/enrich/src/dialects.ts keeps.

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
const NAUMACHY: Record<number, string> = Object.fromEntries(
  Object.entries(FULL).filter(([b]) => ![0x13, 0x14, 0x15, 0x1f, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29].includes(Number(b))),
) as Record<number, string>;
NAUMACHY[0x2e] = "ToxicityFee"; NAUMACHY[0x2f] = "RiskCap"; NAUMACHY[0x30] = "OracleAnchor";

const DIALECTS: Record<string, { label: string; opcodes: Record<number, string> }> = {
  [AQUA_ROUTER]: { label: "AquaSwapVMRouter v1.0.1", opcodes: AQUA },
  [FULL_ROUTER]: { label: "SwapVMRouter v1.0.1", opcodes: FULL },
};
for (const addr of (process.env.NAUMACHY_ROUTERS ?? "").split(",").map((a) => a.trim().toLowerCase()).filter(Boolean)) {
  DIALECTS[addr] = { label: "NaumachyRouter", opcodes: NAUMACHY };
}

export type Role = "gate" | "branch" | "fee" | "curve" | "balances" | "guard" | "time" | "salt" | "other";

export interface CardInstruction {
  at: number;                 // byte offset of the opcode
  opcode: number;
  name: string;
  role: Role;
  text: string;               // one sentence, for the card
  fields: Record<string, string | number | boolean | null>;
  target?: number;            // jump target, absolute byte offset
  wraps?: boolean;            // middleware: the rest of the program runs inside it
  landing?: boolean;          // a jump lands here
}

export interface TokenInfo { symbol: string | null; decimals: number | null }

// Everything a chart needs for a two-token curve, in human units, quote per base.
export interface Curve {
  kind: "xyc" | "concentrated" | "limit";
  base: string; quote: string; base_symbol: string | null; quote_symbol: string | null;
  spot: number | null;          // quote per base at the declared balances
  min: number | null; max: number | null;   // price range, concentrated only
  base_balance: number | null; quote_balance: number | null;   // declared, human units
  liquidity: number | null;     // L in human units of sqrt(base*quote), concentrated only
  balances_from: "ship" | "program";
  // the price a taker gets for a trade of a given size in quote units: buying base (pays quote) and
  // selling base (receives quote), so the two branches of the depth chart
  depth: { size: number; buy: number | null; sell: number | null }[];
}

export interface ProgramCard {
  dialect: string | null;
  parsed: boolean;
  instructions: CardInstruction[];
  curve: Curve | null;
}

const hex = (b: Uint8Array, s: number, e: number) => "0x" + Buffer.from(b.subarray(s, e)).toString("hex");
const uint = (b: Uint8Array, s: number, e: number) => BigInt(e > s ? "0x" + Buffer.from(b.subarray(s, e)).toString("hex") : "0");
const num = (x: bigint) => Number(x);
const feeBps = (v: bigint) => Number(v) / 100_000;                  // 1e9 = 100%, one bp = 100,000
const fmtBps = (bps: number) => bps >= 100 ? `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%` : `${Number(bps.toFixed(3))} bps`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const date = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function sym(tokens: Record<string, TokenInfo>, a: string) { return tokens[a.toLowerCase()]?.symbol ?? short(a); }
function human(raw: bigint, decimals: number | null) { return decimals === null ? null : Number(raw) / 10 ** decimals; }

export function decodeProgram(program: string, app: string, tokens: Record<string, TokenInfo>, declared: { tokens: string[]; amounts: string[] }): ProgramCard {
  const d = DIALECTS[app.toLowerCase()];
  const b = Uint8Array.from(Buffer.from(program.startsWith("0x") ? program.slice(2) : program, "hex"));
  const out: CardInstruction[] = [];
  let pc = 0; let parsed = true;
  let staticBalances: { token: string; amount: bigint }[] | null = null;
  let concentrate: { sqrtMin: bigint; sqrtMax: bigint } | null = null;
  let hasXyc = false, hasLimit = false;
  while (pc < b.length) {
    if (pc + 1 >= b.length) { parsed = false; break; }
    const op = b[pc]; const len = b[pc + 1]; const a = pc + 2; const end = a + len;
    if (end > b.length) { parsed = false; break; }
    const name = d?.opcodes[op] ?? null;
    const ins: CardInstruction = { at: pc, opcode: op, name: name ?? `opcode 0x${op.toString(16).padStart(2, "0")}`, role: "other", text: "", fields: {} };
    if (!name) { ins.text = d ? "Not in this router's table." : "Router dialect unknown."; ins.fields.args = hex(b, a, end); parsed = parsed && !!d; }
    else decode(ins, name, b, a, end, tokens);
    if (name === "StaticBalances" || name === "DynamicBalances") {
      const n = num(uint(b, a, a + 2)); staticBalances = [];
      for (let i = 0; i < n; i++) staticBalances.push({ token: hex(b, a + 2 + 20 * i, a + 22 + 20 * i), amount: uint(b, a + 2 + 20 * n + 32 * i, a + 2 + 20 * n + 32 * (i + 1)) });
    }
    if (name === "XYCConcentrateSwap") concentrate = { sqrtMin: uint(b, a, a + 32), sqrtMax: uint(b, a + 32, a + 64) };
    if (name === "XYCSwap") hasXyc = true;
    if (name === "LimitSwap" || name === "LimitSwapFullAmount") hasLimit = true;
    out.push(ins);
    pc = end;
  }
  for (const i of out) if (i.target !== undefined) { const t = out.find((x) => x.at === i.target); if (t) t.landing = true; }
  const curve = parsed ? buildCurve(staticBalances, declared, concentrate, hasXyc, hasLimit, tokens) : null;
  return { dialect: d?.label ?? null, parsed, instructions: out, curve };
}

function decode(ins: CardInstruction, name: string, b: Uint8Array, a: number, end: number, tokens: Record<string, TokenInfo>) {
  const f = ins.fields;
  switch (name) {
    case "Jump": { ins.role = "branch"; ins.target = num(uint(b, a, a + 2)); f.to = ins.target; ins.text = `Continue at byte ${ins.target}.`; break; }
    case "JumpIfTokenIn": case "JumpIfTokenOut": {
      ins.role = "branch"; const t = hex(b, a, a + 20); ins.target = num(uint(b, a + 20, a + 22)); f.token = t; f.to = ins.target;
      ins.text = `If the taker ${name === "JumpIfTokenIn" ? "pays" : "receives"} ${sym(tokens, t)}, continue at byte ${ins.target}.`; break;
    }
    case "Deadline": { ins.role = "time"; const ts = num(uint(b, a, a + 5)); f.deadline = ts; ins.text = `Refuses fills after ${date(ts)}.`; break; }
    case "OnlyTakerTokenBalanceNonZero": case "OnlyTxOriginTokenBalanceNonZero": {
      ins.role = "gate"; const t = hex(b, a, a + 20); f.token = t;
      ins.text = `Only ${name.startsWith("OnlyTx") ? "transaction senders" : "takers"} holding ${sym(tokens, t)} may fill.`; break;
    }
    case "OnlyTakerTokenBalanceGte": {
      ins.role = "gate"; const t = hex(b, a, a + 20); const min = uint(b, a + 20, a + 52); f.token = t; f.min = min.toString();
      const h = human(min, tokens[t]?.decimals ?? null); ins.text = `Only takers holding at least ${h === null ? min.toString() : h.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${sym(tokens, t)} may fill.`; break;
    }
    case "OnlyTakerTokenSupplyShareGte": {
      ins.role = "gate"; const t = hex(b, a, a + 20); const share = Number(uint(b, a + 20, a + 28)) / 1e18; f.token = t; f.share = share;
      ins.text = `Only takers holding at least ${(share * 100).toFixed(2)}% of ${sym(tokens, t)}'s supply may fill.`; break;
    }
    case "Salt": { ins.role = "salt"; f.salt = hex(b, a, end); ins.text = "Makes the strategy hash unique. No effect on the swap."; break; }
    case "StaticBalances": case "DynamicBalances": {
      ins.role = "balances"; const n = num(uint(b, a, a + 2)); const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const t = hex(b, a + 2 + 20 * i, a + 22 + 20 * i); const amt = uint(b, a + 2 + 20 * n + 32 * i, a + 2 + 20 * n + 32 * (i + 1));
        const h = human(amt, tokens[t]?.decimals ?? null); f[sym(tokens, t)] = amt.toString();
        parts.push(`${h === null ? amt.toString() : h.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${sym(tokens, t)}`);
      }
      ins.wraps = name === "DynamicBalances";
      ins.text = name === "StaticBalances" ? `Quotes as if it held ${parts.join(" and ")}, every time.` : `Starts with ${parts.join(" and ")} and carries the balances from fill to fill.`; break;
    }
    case "InvalidateBit": { ins.role = "guard"; f.bit = num(uint(b, a, a + 4)); ins.text = "Fills once, then the order is spent."; break; }
    case "InvalidateTokenIn": case "InvalidateTokenOut": { ins.role = "guard"; ins.wraps = true; ins.text = `Counts what has been ${name.endsWith("In") ? "taken in" : "given out"} so partial fills cannot exceed the balance.`; break; }
    case "XYCSwap": { ins.role = "curve"; ins.text = "Constant-product curve on the balances: x times y stays equal."; break; }
    case "XYCConcentrateSwap": {
      ins.role = "curve"; ins.wraps = true; const sMin = Number(uint(b, a, a + 32)) / 1e18, sMax = Number(uint(b, a + 32, a + 64)) / 1e18;
      f.sqrt_price_min = sMin; f.sqrt_price_max = sMax; f.price_min_raw = sMin * sMin; f.price_max_raw = sMax * sMax;
      ins.text = "Concentrates the balances into a price range, like a Uniswap v3 position; the curve is drawn below."; break;
    }
    case "Decay": { ins.role = "guard"; ins.wraps = true; const p = num(uint(b, a, a + 2)); f.period_s = p; ins.text = `After each fill the curve worsens by the amount traded and heals over ${p} s, blunting sandwich attacks.`; break; }
    case "LimitSwap": case "LimitSwapFullAmount": { ins.role = "curve"; f.maker_direction_lt = b[a] !== 0; ins.text = name === "LimitSwap" ? "Fixed rate, the ratio of the two balances, partial fills allowed." : "Fixed rate, the ratio of the two balances, all or nothing."; break; }
    case "RequireMinRate": case "AdjustMinRate": {
      ins.role = "guard"; ins.wraps = true; const lt = uint(b, a, a + 8), gt = uint(b, a + 8, a + 16); f.rate_lt = lt.toString(); f.rate_gt = gt.toString();
      ins.text = name === "RequireMinRate" ? "Rejects any fill worse than a floor rate." : "Clamps any fill to a floor rate instead of rejecting it."; break;
    }
    case "DutchAuctionBalanceIn": case "DutchAuctionBalanceOut": {
      ins.role = "time"; const start = num(uint(b, a, a + 5)), dur = num(uint(b, a + 5, a + 7)), k = Number(uint(b, a + 7, a + 15)) / 1e18;
      f.start = start; f.duration_s = dur; f.decay_per_s = k; const perHour = (1 - k ** 3600) * 100;
      ins.text = `Price improves for the taker by about ${perHour.toFixed(2)}% an hour from ${date(start)}, for ${dur} s.`; break;
    }
    case "BaseFeeAdjuster": { ins.role = "guard"; f.base_gas_price = uint(b, a, a + 8).toString(); f.gas = num(uint(b, a + 20, a + 23)); ins.text = "Gives the taker a better price when gas is dearer than expected."; break; }
    case "TWAPSwap": {
      ins.role = "curve"; const start = num(uint(b, a + 64, a + 96)), dur = num(uint(b, a + 96, a + 128)); f.start = start; f.duration_s = dur; f.balance_in = uint(b, a, a + 32).toString(); f.balance_out = uint(b, a + 32, a + 64).toString();
      ins.text = `Sells the balance evenly over ${Math.round(dur / 3600)} h from ${date(start)}, at the last price nudged down each second.`; break;
    }
    case "Extruction": { ins.role = "other"; f.target = hex(b, a, a + 20); ins.text = `Hands the swap to the contract ${short(f.target as string)}, which may rewrite the registers.`; break; }
    case "FeeFlatIn": case "FeeFlatOut": { ins.role = "fee"; ins.wraps = true; const bps = feeBps(uint(b, a, a + 4)); f.bps = bps; ins.text = `Keeps ${fmtBps(bps)} of the token it ${name.endsWith("In") ? "takes in" : "gives out"}.`; break; }
    case "FeeProgressiveIn": case "FeeProgressiveOut": { ins.role = "fee"; ins.wraps = true; const bps = feeBps(uint(b, a, a + 4)); f.lambda_bps = bps; ins.text = `A fee that grows with the size of the trade against the balance (slope ${fmtBps(bps)}).`; break; }
    case "ProtocolFeeIn": case "ProtocolFeeOut": case "AquaProtocolFeeIn": case "AquaProtocolFeeOut": {
      ins.role = "fee"; ins.wraps = true; const bps = feeBps(uint(b, a, a + 4)); const to = hex(b, a + 4, a + 24); f.bps = bps; f.to = to;
      ins.text = `Pays ${fmtBps(bps)} of the token it ${name.endsWith("In") ? "takes in" : "gives out"} to ${short(to)}${name.startsWith("Aqua") ? ", out of the maker's Aqua ledger" : ""}.`; break;
    }
    case "DynamicProtocolFeeIn": case "AquaDynamicProtocolFeeIn": { ins.role = "fee"; ins.wraps = true; const p = hex(b, a, a + 20); f.provider = p; ins.text = `Asks ${short(p)} for the protocol fee on each swap.`; break; }
    case "PeggedSwap": { ins.role = "curve"; const A = Number(uint(b, a + 64, a + 96)) / 1e27; f.amplification = A; ins.text = `Stable-pair curve that stays near parity (amplification ${A.toFixed(0)}).`; break; }
    case "ToxicityFee": {
      ins.role = "fee"; ins.wraps = true; const base = feeBps(uint(b, a, a + 4)), slope = feeBps(uint(b, a + 4, a + 8)), max = feeBps(uint(b, a + 8, a + 12)), w = num(uint(b, a + 12, a + 16));
      f.base_bps = base; f.slope_bps = slope; f.max_bps = max; f.window_s = w;
      ins.text = `Fee of ${fmtBps(base)} that rises with one-way flow, up to ${fmtBps(max)}, easing back over ${w} s.`; break;
    }
    case "RiskCap": { ins.role = "guard"; ins.wraps = true; const o = feeBps(uint(b, a, a + 4)) / 100, i = feeBps(uint(b, a + 4, a + 8)) / 100; f.max_out_pct = o; f.max_in_pct = i; ins.text = `No single fill may take more than ${o}% of a balance out or push more than ${i}% in.`; break; }
    case "OracleAnchor": {
      ins.role = "curve"; const stale = num(uint(b, a, a + 2)), depth = Number(uint(b, a + 2, a + 6)) / 1e6; f.max_staleness_s = stale; f.depth = depth; const pairs: string[] = [];
      for (let o = a + 6; o + 63 <= end; o += 63) pairs.push(`${sym(tokens, hex(b, o + 20, o + 40))}/${sym(tokens, hex(b, o + 40, o + 60))}`);
      f.pairs = pairs.join(", ");
      ins.text = `Quotes at the oracle price of ${pairs.join(", ") || "its pairs"} with ${depth}x the balance as depth${stale ? `, refusing answers older than ${stale} s` : ""}.`; break;
    }
    default: ins.text = ""; ins.fields.args = hex(b, a, end);
  }
}

// The two-token curve in human units. Balances come from StaticBalances when the program carries
// them, else from what the maker pushed when it shipped. Base is the token with the fewer stable
// credentials so the price reads as "quote per base".
const STABLES = new Set(["USDC", "USDT", "DAI", "USDS", "USDE", "FRAX", "GHO", "LUSD", "CRVUSD", "PYUSD", "USD1", "USDBC", "USDT0", "FDUSD", "TUSD", "USDP", "BUSD", "SUSD", "USDC.E", "USDT.E", "DAI.E", "EURC", "EURE", "EURS", "AGEUR", "USDG"]);
const MAJORS = new Set(["WETH", "ETH", "WBTC", "CBBTC", "WSTETH", "STETH", "WEETH", "WBNB", "WMATIC", "WPOL"]);
const rank = (s: string | null) => s === null ? 2 : STABLES.has(s.toUpperCase()) ? 0 : MAJORS.has(s.toUpperCase()) ? 1 : 2;

function buildCurve(staticBalances: { token: string; amount: bigint }[] | null, declared: { tokens: string[]; amounts: string[] }, conc: { sqrtMin: bigint; sqrtMax: bigint } | null, hasXyc: boolean, hasLimit: boolean, tokens: Record<string, TokenInfo>): Curve | null {
  if (!conc && !hasXyc && !hasLimit) return null;
  const bal = staticBalances ?? declared.tokens.map((t, i) => ({ token: t.toLowerCase(), amount: BigInt(declared.amounts[i] ?? "0") }));
  if (bal.length !== 2) return null;
  const [t0, t1] = [...bal].sort((x, y) => (x.token < y.token ? -1 : 1));   // lt, gt by address, as the VM orders them
  const i0 = tokens[t0.token] ?? { symbol: null, decimals: null }, i1 = tokens[t1.token] ?? { symbol: null, decimals: null };
  if (i0.decimals === null || i1.decimals === null) return null;
  // the VM's price is gt per lt in raw units; choose base/quote for humans
  const baseIsLt = rank(i0.symbol) >= rank(i1.symbol);
  const scale = 10 ** (i0.decimals - i1.decimals);              // raw gt/lt -> human gt per lt
  const toHuman = (pRaw: number) => baseIsLt ? pRaw * scale : 1 / (pRaw * scale);
  const x = Number(t0.amount), y = Number(t1.amount);           // raw lt, gt
  const base = baseIsLt ? t0 : t1, quote = baseIsLt ? t1 : t0;
  const bi = baseIsLt ? i0 : i1, qi = baseIsLt ? i1 : i0;
  const curve: Curve = {
    kind: conc ? "concentrated" : hasXyc ? "xyc" : "limit", base: base.token, quote: quote.token, base_symbol: bi.symbol, quote_symbol: qi.symbol,
    spot: null, min: null, max: null, base_balance: human(base.amount, bi.decimals), quote_balance: human(quote.amount, qi.decimals), liquidity: null,
    balances_from: staticBalances ? "program" : "ship", depth: [],
  };
  if (x <= 0 || y <= 0) return curve;
  let Xv = x, Yv = y;   // virtual reserves in raw lt, gt
  if (conc) {
    const a = Number(conc.sqrtMin) / 1e18, bb = Number(conc.sqrtMax) / 1e18;
    if (a <= 0 || bb <= a) return curve;
    const alpha = 1 - a / bb, beta = x * a + y / bb;
    const L = (beta + Math.sqrt(beta * beta + 4 * alpha * x * y)) / (2 * alpha);
    Xv = x + L / bb; Yv = y + L * a;
    const pMin = a * a, pMax = bb * bb;   // raw gt per lt
    const [hMin, hMax] = [toHuman(pMin), toHuman(pMax)].sort((p, q) => p - q);
    curve.min = hMin; curve.max = hMax; curve.liquidity = L / Math.sqrt(10 ** (i0.decimals + i1.decimals));
  }
  if (hasLimit && !conc) { curve.spot = toHuman(y / x); return curve; }
  curve.spot = toHuman(Yv / Xv);
  // depth at fixed quote notionals: a taker paying Q quote for base, and a taker taking Q quote out for base
  const quoteVirtual = baseIsLt ? Yv : Xv, baseVirtual = baseIsLt ? Xv : Yv;
  const qDec = qi.decimals as number, bDec = bi.decimals as number;
  for (const size of [1e3, 1e4, 1e5, 1e6, 1e7]) {
    const Qr = size * 10 ** qDec;
    const baseOut = Qr * baseVirtual / (quoteVirtual + Qr);                       // taker buys base with Q quote
    const buy = baseOut > 0 ? (Qr / 10 ** qDec) / (baseOut / 10 ** bDec) : null;
    const baseIn = Qr < quoteVirtual ? Qr * baseVirtual / (quoteVirtual - Qr) : null;   // taker sells base for Q quote
    const sell = baseIn !== null && baseIn > 0 ? (Qr / 10 ** qDec) / (baseIn / 10 ** bDec) : null;
    curve.depth.push({ size, buy: buy !== null && Number.isFinite(buy) ? buy : null, sell: sell !== null && Number.isFinite(sell) ? sell : null });
  }
  return curve;
}
