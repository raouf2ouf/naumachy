import type { Chain } from "./api";

export const CHAIN_NAME: Record<Chain, string> = { ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", optimism: "Optimism", polygon: "Polygon", bsc: "BSC" };
export const CHAIN_HUE: Record<Chain, string> = { ethereum: "#8ea6ff", base: "#5aa0ff", arbitrum: "#6fd0ff", optimism: "#ff7a6b", polygon: "#b98cff", bsc: "#f0c040" };
export const REGISTRY_CANONICAL = "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a";

export function shortAddr(a: string, head = 6, tail = 4): string {
  if (!a) return "";
  return a.length > head + tail + 2 ? `${a.slice(0, head)}…${a.slice(-tail)}` : a;
}

// Compact numbers: fewer decimals as magnitude grows, never trailing zeros, integers stay integers.
export function compact(n: number, digits = 2): string {
  const abs = Math.abs(n);
  const trim = (x: string) => (x.includes(".") ? x.replace(/\.?0+$/, "") : x);
  if (abs >= 1e9) return trim((n / 1e9).toFixed(abs >= 1e11 ? 0 : abs >= 1e10 ? 1 : 2)) + "B";
  if (abs >= 1e6) return trim((n / 1e6).toFixed(abs >= 1e8 ? 0 : abs >= 1e7 ? 1 : 2)) + "M";
  if (abs >= 1e3) return trim((n / 1e3).toFixed(abs >= 1e5 ? 0 : 1)) + "K";
  if (digits === 0 || Number.isInteger(n)) return n.toFixed(0);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 1) return trim(n.toFixed(Math.min(digits, 2)));
  if (abs === 0) return "0";
  return trim(n.toPrecision(2));
}

export function usd(n: number, signed = false): string {
  const s = compact(Math.abs(n));
  const sign = n < 0 ? "-" : signed && n > 0 ? "+" : "";
  return `${sign}$${s}`;
}

export function bps(edge: number | null, volume: number | null): string | null {
  if (edge === null || volume === null || volume <= 0) return null;
  const v = (edge / volume) * 1e4;
  return `${v > 0 ? "+" : ""}${v.toFixed(1)} bps`;
}

export function relTime(ts: number | null | undefined, now = Date.now() / 1000): string {
  if (!ts) return "";
  const d = Math.max(0, now - ts);
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 30 * 86400) return `${Math.floor(d / 86400)} d ago`;
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function absTime(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
}

// Token amounts: exact integer strings scaled by decimals, shown compact with a sign.
export function amount(raw: string, decimals: number | null, symbol: string | null): string {
  if (decimals === null) return `${raw.length > 12 ? raw.slice(0, 6) + "…" : raw} raw`;
  const neg = raw.startsWith("-");
  const digits = neg ? raw.slice(1) : raw;
  const whole = digits.length > decimals ? digits.slice(0, digits.length - decimals) : "0";
  const frac = digits.padStart(decimals + 1, "0").slice(-decimals);
  const value = Number(`${whole}.${frac || "0"}`);
  return `${neg ? "-" : ""}${compact(value, 3)} ${symbol ?? "?"}`;
}

export function percent(x: number | null | undefined): string {
  if (x === null || x === undefined) return "";
  const v = x * 100;
  return `${v > 99 && v < 100 ? v.toFixed(1) : Math.round(v)}%`;
}
