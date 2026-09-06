export interface Priced { value: number | null; source: string; at: string; confidence: number }
export type Chain = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "bsc";
export const CHAINS: Chain[] = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"];

export interface Overview {
  window: string; chain: string; rollup_at: string;
  hero: { economic_fills: number; strategies_active: number; volume_usd: Priced; edge_usd: Priced; markout_1h_usd: Priced; markout_24h_usd: Priced };
  totals: { strategies: number; live: number; desks: number; makers: number };
  chains: { chain: Chain; fills: number; volume_usd: Priced; edge_usd: Priced }[];
  top_desks: DeskSummary[];
  latest_ships: { chain: Chain; id: string; maker: string; desk: string; template: string; template_name: string | null; registry: string; shipped_at: number; shipped_tx: string; status: string }[];
}
export interface DeskSummary { chain: Chain; desk: string; maker: string; maker_label?: string | null; template: string; template_name?: string | null; template_kind?: string | null; fills: number; volume_usd: Priced; edge_usd: Priced; markout_1h_usd: Priced }
export interface DeskRow extends DeskSummary { strategies: number; live: number; markout_24h_usd: Priced; pnl_usd_marked: Priced; first_seen: number | null; last_seen: number | null }
export interface Series { window: string; chain: string; rollup_at: string; source: string; days: { day: number; date: string; fills: number; volume_usd: number | null; edge_usd: number | null; markout_1h_usd: number | null }[] }
export interface PnlQuote { value: number; quote_token: string; quote_symbol?: string | null; coverage: number; mark_age_s?: number | null; source: string }
export interface StrategyRow { id: string; strategy_hash: string; registry: string; status: string; shipped_at: number; docked_at: number | null; fills: number; volume_usd: Priced; edge_usd: Priced; markout_1h_usd: Priced; pnl_quote: PnlQuote | null; takers: number; top_taker_share: number | null; self_fills: number }
export interface FillRow { id: string; tx: string; block: number; ts: number; taker: string | null; shape: string; volume_usd: Priced; edge_usd: Priced; markout_1h_usd: Priced; legs?: Leg[] }
export interface Leg { token: string; symbol: string | null; decimals: number | null; net: string; pushed: string; pulled: string }
export interface DeskDetail extends DeskRow { strategies_list?: never; strategies: number; recent_fills: FillRow[] }
export interface DeskDetailFull extends Omit<DeskRow, "strategies"> { strategies: StrategyRow[]; strategies_total: number; instructions: string[] | null; recent_fills: FillRow[] }
export interface Mark { base_token: string; base_symbol: string | null; quote_token: string; quote_symbol: string | null; price: number | null; vwap_raw: number; fills: number; mark_ts: number }
export interface StrategyDetail {
  chain: Chain; id: string; strategy_hash: string; registry: string; maker: string; maker_label: string | null; app: string; app_label: string | null; desk: string; template: string; template_name: string | null; template_kind: string | null; instructions: string[] | null; fills_total: number; program: string; parsed: boolean;
  tokens: string[]; amounts: string[]; shipped_at: number; shipped_tx: string; docked_at: number | null; docked_tx: string | null; status: string;
  stats: { fills: number; first_fill_ts: number; last_fill_ts: number; volume_usd: Priced; edge_usd: Priced; markout_1h_usd: Priced; markout_24h_usd: Priced; pnl_usd_marked: Priced; pnl_quote: PnlQuote | null; takers: number; top_taker_share: number | null; self_fills: number } | null;
  marks: Mark[]; fills: FillRow[];
}
export interface Health { rollup_at: string; chains: { chain: Chain; cursor: number; subgraph_head: number | null; blocks_behind: number | null; updated_at: string; economic_fills: number; priced_ratio: number }[] }
export interface SearchResult { makers: { chain: Chain; maker: string }[]; strategies: { chain: Chain; id: string; strategy_hash: string; desk: string; status: string }[]; desks: { chain: Chain; desk: string; maker: string; fills: number }[] }

const BASE = import.meta.env.VITE_API_URL ?? "";

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: { accept: "application/json" } });
  if (res.status === 404) throw new Error("not found");
  if (!res.ok) throw new Error(`api ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  health: () => get<Health>("/api/health"),
  overview: (window: string, chain: string | null) => get<Overview>(`/api/overview?window=${window}${chain ? `&chain=${chain}` : ""}`),
  series: (window: string, chain: string | null) => get<Series>(`/api/series?window=${window}${chain ? `&chain=${chain}` : ""}`),
  desks: (chain: string | null, sort: string, limit = 50, minVolume = 0) => get<DeskRow[]>(`/api/desks?sort=${sort}&limit=${limit}&minVolume=${minVolume}${chain ? `&chain=${chain}` : ""}`),
  leaderboard: (chain: string | null, sort: string, limit = 50, minVolume = 1000) => get<DeskRow[]>(`/api/leaderboard?sort=${sort}&limit=${limit}&minVolume=${minVolume}${chain ? `&chain=${chain}` : ""}`),
  desk: (chain: string, id: string, limit = 50) => get<DeskDetailFull>(`/api/desk/${chain}/${encodeURIComponent(id)}?limit=${limit}`),
  strategy: (chain: string, id: string, limit = 50) => get<StrategyDetail>(`/api/strategy/${chain}/${encodeURIComponent(id)}?limit=${limit}`),
  search: (q: string) => get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
};
