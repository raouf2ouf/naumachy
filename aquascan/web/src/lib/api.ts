export interface Priced { value: number | null; source: string; at: string; confidence: number }
export type Chain = "ethereum" | "base" | "arbitrum" | "optimism" | "polygon" | "bsc";
export const CHAINS: Chain[] = ["ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"];

// Every scored row carries the same set: edge at fill time, markouts at three horizons, the drift
// (markout minus edge), fees, and the share of its fills referenced on the venue tape.
export interface Band { bps: number; se: number | null }   // a volume-weighted rate and its standard error
export interface Scored {
  volume_usd: Priced; edge_usd: Priced; markout_5m_usd: Priced; markout_1h_usd: Priced; markout_24h_usd: Priced;
  drift_1h_usd: Priced; drift_24h_usd: Priced; protocol_fee_usd: Priced; maker_fee_usd: Priced; tape_ratio: number;
  markout_5m_bps: Band | null; markout_1h_bps: Band | null;
}
export interface FeeTier { maker_fee_bps: number | null; kind: string | null; strategies: number; volume_usd: number | null; share: number }
export interface ProtocolRecipient { recipient: string | null; kind: string | null; bps_min: number | null; bps_max: number | null; fee_usd: number | null; volume_usd: number | null }
export interface Overview {
  window: string; chain: string; rollup_at: string;
  hero: Scored & { economic_fills: number; strategies_active: number };
  fees: { maker_fee_bps: number | null; tiers: FeeTier[]; protocol: ProtocolRecipient[] };
  totals: { strategies: number; live: number; desks: number; makers: number };
  chains: { chain: Chain; fills: number; volume_usd: Priced; edge_usd: Priced; markout_1h_usd: Priced }[];
  top_makers: MakerSummary[];
  latest_ships: { chain: Chain; id: string; maker: string; desk: string; template: string; template_name: string | null; registry: string; shipped_at: number; shipped_tx: string; status: string }[];
}
export interface MakerTemplate { template: string; name: string | null; kind: string | null; strategies: number; live: number; volume_usd: number | null; instructions?: string[] | null }
export interface MakerSummary extends Scored { chain: Chain; maker: string; maker_label?: string | null; pairs?: DeskPair[]; templates?: MakerTemplate[]; fills: number; maker_fee_bps: number | null }
export interface DeskPair { base_token: string; quote_token: string; base_symbol: string | null; quote_symbol: string | null; fills: number; share: number }
export interface MakerRow extends MakerSummary { templates_count: number; strategies: number; live: number; pnl_usd_marked: Priced; maker_fee_bps_min: number | null; maker_fee_bps_max: number | null; first_seen: number | null; last_seen: number | null }
export interface Series { window: string; chain: string; rollup_at: string; source: string; days: { day: number; date: string; fills: number; volume_usd: number | null; edge_usd: number | null; markout_5m_usd: number | null; markout_1h_usd: number | null; drift_1h_usd: number | null; protocol_fee_usd: number | null; maker_fee_usd: number | null }[] }
export interface PnlQuote { value: number; quote_token: string; quote_symbol?: string | null; coverage: number; mark_age_s?: number | null; source: string }
export interface StrategyRow extends Scored { id: string; template?: string; template_name?: string | null; strategy_hash: string; registry: string; status: string; shipped_at: number; docked_at: number | null; fills: number; maker_fee_bps: number | null; protocol_fee_bps: number | null; pnl_quote: PnlQuote | null; takers: number; top_taker_share: number | null; self_fills: number }
export interface FillRow { id: string; tx: string; block: number; ts: number; taker: string | null; shape: string; volume_usd: Priced; edge_usd: Priced; markout_5m_usd: Priced; markout_1h_usd: Priced; drift_1h_usd: Priced; protocol_fee_usd: Priced; ref_kind: string | null; ref_window_min: number | null; ref_fills: number | null; legs?: Leg[] }
export interface Leg { token: string; symbol: string | null; decimals: number | null; net: string; pushed: string; pulled: string }
export interface DeskFees { decoded: number; strategies: number; maker_fee_bps: number | null; maker_fee_bps_min: number | null; maker_fee_bps_max: number | null; maker_kinds: string[]; maker_sides: string[]; protocol_fee_bps_min: number | null; protocol_fee_bps_max: number | null; protocol_recipients: string[]; protocol_kinds: string[] }
export interface MakerTemplateRow extends Omit<MakerTemplate, "volume_usd">, Scored { fills: number; maker_fee_bps: number | null }
export interface MakerDetailFull extends Omit<MakerRow, "strategies" | "templates"> { templates: MakerTemplateRow[]; strategies: StrategyRow[]; strategies_total: number; fees: DeskFees; recent_fills: FillRow[] }
export interface Mark { base_token: string; base_symbol: string | null; quote_token: string; quote_symbol: string | null; price: number | null; vwap_raw: number; fills: number; mark_ts: number }
export interface StrategyFees { decoded: boolean; maker_fee_bps: number | null; maker_fee_side: string | null; maker_fee_kind: string | null; protocol_fee_bps: number | null; protocol_fee_to: string | null; protocol_fee_kind: string | null; protocol_fee_provider: string | null }
export interface StrategyDetail {
  chain: Chain; id: string; strategy_hash: string; registry: string; maker: string; maker_label: string | null; app: string; app_label: string | null; desk: string; template: string; template_name: string | null; template_kind: string | null; instructions: string[] | null; fills_total: number; program: string; parsed: boolean;
  tokens: string[]; amounts: string[]; shipped_at: number; shipped_tx: string; docked_at: number | null; docked_tx: string | null; status: string;
  fees: StrategyFees | null;
  stats: (Scored & { fills: number; first_fill_ts: number; last_fill_ts: number; pnl_usd_marked: Priced; pnl_quote: PnlQuote | null; takers: number; top_taker_share: number | null; self_fills: number }) | null;
  marks: Mark[]; fills: FillRow[];
}
export interface Health { rollup_at: string; chains: { chain: Chain; cursor: number; subgraph_head: number | null; blocks_behind: number | null; updated_at: string; economic_fills: number; priced_ratio: number; tape_ratio: number }[] }
export interface SearchResult { makers: { chain: Chain; maker: string; fills: number; strategies: number; live: number }[]; strategies: { chain: Chain; id: string; strategy_hash: string; maker: string; status: string }[] }

// The arena: generations of gladiators as the registry attests them, joined with Aquascan's numbers.
export interface Knobs { feeBaseBps: number; feeSlopeBps: number; feeMaxBps: number; windowSeconds: number; depth: number; capBps: number; parent?: string | null }
export interface ArenaLive extends Scored { fills: number; maker_fee_bps: number | null }
export interface ArenaEntry {
  gladiator: string; name: string | null; generation_born: number; parent: { address: string; name: string | null } | null;
  strategy_hash: string; strategy_id: string | null; desk: string | null; status: string | null; archetype: string | null; entered_at: number;
  attested: { score_quote: string; se_quote: string; fills: number; quote_token: string; score_usd: number; se_usd: number; attested_at: number } | null;
  champion: boolean; knobs: Knobs | null; mind: string | null; parent_choice: string | null; live: ArenaLive | null;
}
export interface ArenaGeneration { number: number; tape: string; opened_at: number; closed_at: number | null; champion: { address: string; name: string | null; strategy_hash: string | null; score_usd: number | null } | null; entries: ArenaEntry[] }
export interface Arena { chain: Chain; configured: boolean; rollup_at?: string; generations: ArenaGeneration[]; gladiators: { address: string; name: string | null; generation_born: number; parent: { address: string; name: string | null } | null; registered_at: number; entries: number; wins: number }[]; promotions: { gladiator: string; name: string | null; strategy_hash: string; chain_id: number; bankroll: string; at: number; tx: string }[] }
export interface ToolRead { tool: string; input: Record<string, unknown>; chars: number; ms: number }
export interface GenerationEntry extends ArenaEntry { parent_line: { address: string; generation: number; knobs: Knobs } | null; rationale: string | null; transcript: ToolRead[]; draft: { pairs?: Record<string, { sell: number; buy: number }>; loop?: { usdcIn: number; usdcOut: number } | null; sell?: number; buy?: number; usdcFor1Weth?: string; wethFor1000Usdc?: string } | null; program: string | null; listing: string[] | null; pairs: string[] | null; rejected: string[] }
export interface GenerationDetail extends Omit<ArenaGeneration, "entries"> { chain: Chain; rollup_at: string; entries: GenerationEntry[] }

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
  makers: (chain: string | null, sort: string, limit = 50, minVolume = 0) => get<MakerRow[]>(`/api/makers?sort=${sort}&limit=${limit}&minVolume=${minVolume}${chain ? `&chain=${chain}` : ""}`),
  leaderboard: (chain: string | null, sort: string, limit = 50, minVolume = 1000) => get<MakerRow[]>(`/api/leaderboard?sort=${sort}&limit=${limit}&minVolume=${minVolume}${chain ? `&chain=${chain}` : ""}`),
  maker: (chain: string, address: string, limit = 50) => get<MakerDetailFull>(`/api/maker/${chain}/${address}?limit=${limit}`),
  strategy: (chain: string, id: string, limit = 50) => get<StrategyDetail>(`/api/strategy/${chain}/${encodeURIComponent(id)}?limit=${limit}`),
  search: (q: string) => get<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
  arena: () => get<Arena>("/api/arena"),
  generation: (n: number) => get<GenerationDetail>(`/api/arena/generation/${n}`),
};
