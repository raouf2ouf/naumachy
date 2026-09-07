// A priced number never travels alone: value, where it came from, when, and how much of the
// underlying data was actually priced. Consumers render the confidence as a badge.
export interface Priced {
  value: number | null;
  source: string;
  at: string;           // ISO timestamp of the rollup that produced it
  confidence: number;   // 0..1: share of fills that were fully priced
}

export function priced(value: number | string | null | undefined, confidence: number | string | null | undefined, at: Date | string, source = "defillama hourly"): Priced {
  const v = value === null || value === undefined ? null : Number(value);
  const c = confidence === null || confidence === undefined ? 0 : Number(confidence);
  return { value: v === null || Number.isNaN(v) ? null : v, source, at: typeof at === "string" ? at : at.toISOString(), confidence: Math.max(0, Math.min(1, c)) };
}

// Where the reference prices behind a number came from, by the share of its fills referenced on the venue tape.
export function refSource(tapeRatio: number | string | null | undefined): string {
  const r = tapeRatio === null || tapeRatio === undefined ? 0 : Number(tapeRatio);
  if (r >= 0.995) return "venue tape, by the minute";
  if (r <= 0.005) return "defillama hourly";
  return `venue tape for ${Math.round(r * 100)}% of fills, defillama hourly for the rest`;
}

export const WINDOWS: Record<string, number> = { "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400, all: 0 };

export function windowSeconds(name: string | null | undefined): { name: string; seconds: number } {
  const key = name && name in WINDOWS ? name : "30d";
  return { name: key, seconds: WINDOWS[key] };
}
