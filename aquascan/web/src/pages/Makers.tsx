import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, CHAINS, type Chain, type MakerRow } from "../lib/api";
import { bandText, bps, CHAIN_NAME, compact, feeBps } from "../lib/format";
import { Failed, Loading, MakerLink, Money, PageHeader, Provenance, Segmented, When } from "../components/ui";

const SORTS: [string, string][] = [["volume", "volume"], ["edge", "edge at fill"], ["markout", "worst after 1 h"], ["adverse", "most adverse flow"], ["fees", "fee income"], ["fills", "fills"], ["recent", "recently active"]];

export type Highlight = "m5" | "edge" | "m1h";
export function MakerTable({ rows, rank = false, highlight = "m5" }: { rows: MakerRow[]; rank?: boolean; highlight?: Highlight }) {
  return (
    <div className="overflow-x-auto panel">
      <table>
        <thead><tr>{rank && <th>#</th>}<th>Maker</th><th className="num">Strategies</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fees earned</th><th className="num">Edge, 5 min after fill</th><th className="num">Edge at fill</th>{highlight === "m1h" && <th className="num">Marked 1 h later</th>}<th className="num">Last active</th></tr></thead>
        <tbody>
          {rows.map((d, i) => (
            <tr key={d.chain + d.maker}>
              {rank && <td className="text-ink-faint">{i + 1}</td>}
              <td><MakerLink chain={d.chain} maker={d.maker} makerLabel={d.maker_label} templates={d.templates} pairs={d.pairs} /></td>
              <td className="num"><span className="gain">{d.live}</span><span className="text-ink-faint"> / {d.strategies}</span></td>
              <td className="num">{compact(d.fills, 0)}</td>
              <td className="num"><Money p={d.volume_usd} /></td>
              <td className="num" title={d.maker_fee_bps_min !== null && d.maker_fee_bps_min !== d.maker_fee_bps_max ? `${feeBps(d.maker_fee_bps_min)} to ${feeBps(d.maker_fee_bps_max)} across its strategies, volume-weighted` : "flat fee on the token in, from the program"}><Money p={d.maker_fee_usd} className="fee" /><span className="sub">{feeBps(d.maker_fee_bps)}</span></td>
              <td className={`num ${highlight === "m5" ? "" : "text-ink-muted"}`}><Money p={d.markout_5m_usd} signed colored={highlight === "m5"} className={highlight === "m5" ? "font-medium" : ""} />{d.markout_5m_bps && <span className="band">{bandText(d.markout_5m_bps)}</span>}</td>
              <td className={`num ${highlight === "edge" ? "" : "text-ink-muted"}`}><Money p={d.edge_usd} signed colored={highlight === "edge"} className={highlight === "edge" ? "font-medium" : ""} />{bps(d.edge_usd.value, d.volume_usd.value) && <span className="band">{bps(d.edge_usd.value, d.volume_usd.value)}</span>}</td>
              {highlight === "m1h" && <td className="num"><Money p={d.markout_1h_usd} signed colored className="font-medium" />{d.markout_1h_bps && <span className="band">{bandText(d.markout_1h_bps)}</span>}</td>}
              <td className="num text-ink-muted"><When ts={d.last_seen} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={rank ? 10 : 9} className="text-ink-muted">No makers match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ChainFilter({ value, onChange }: { value: Chain | null; onChange: (c: Chain | null) => void }) {
  return <Segmented value={value ?? "all"} onChange={(v) => onChange(v === "all" ? null : (v as Chain))} label="Chain" options={[["all", "all chains"], ...CHAINS.map((c) => [c, CHAIN_NAME[c]] as [string, string])]} />;
}

export function Makers() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [sort, setSort] = useState("volume");
  const q = useQuery({ queryKey: ["makers", chain, sort], queryFn: () => api.makers(chain, sort, 100) });
  return (
    <div className="fade">
      <PageHeader title="Makers" description={<>A maker is a wallet that ships strategies to Aqua. Each row is one maker on one chain, across every strategy it shipped there, all time. The edge five minutes after a fill is the honest one: the same trade, re-marked once the market has re-priced. The band is one standard error from the maker's own fills.</>} />
      <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
        <ChainFilter value={chain} onChange={setChain} />
        <Segmented value={sort} onChange={setSort} label="Sort" options={SORTS.map(([k, label]) => [k, label] as [string, string])} />
      </div>
      <div className="mt-4">
        {q.isPending ? <Loading what="makers" /> : q.isError ? <Failed what="makers" error={q.error} /> : <MakerTable rows={q.data} highlight={sort === "edge" ? "edge" : sort === "markout" || sort === "adverse" ? "m1h" : "m5"} />}
      </div>
      {q.data && <Provenance at={q.data[0]?.volume_usd.at ?? new Date().toISOString()} />}
    </div>
  );
}
