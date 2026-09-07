import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, CHAINS, type Chain, type DeskRow } from "../lib/api";
import { bandText, CHAIN_NAME, compact, feeBps } from "../lib/format";
import { DeskLink, EdgeCell, Failed, Loading, Money, Provenance, When } from "../components/ui";

const SORTS: [string, string][] = [["volume", "volume"], ["edge", "edge at fill"], ["markout", "worst after 1 h"], ["adverse", "most adverse flow"], ["fees", "fee income"], ["fills", "fills"], ["recent", "recently active"]];

export function DeskTable({ rows, rank = false }: { rows: DeskRow[]; rank?: boolean }) {
  return (
    <div className="overflow-x-auto panel">
      <table>
        <thead><tr>{rank && <th>#</th>}<th>Desk</th><th className="num">Strategies</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fee</th><th className="num">Edge, 5 min after fill</th><th className="num">Edge at fill</th><th className="num">Marked 1 h later</th><th className="num">Last active</th></tr></thead>
        <tbody>
          {rows.map((d, i) => (
            <tr key={d.chain + d.desk}>
              {rank && <td className="text-ink-faint">{i + 1}</td>}
              <td><DeskLink chain={d.chain} desk={d.desk} maker={d.maker} makerLabel={d.maker_label} templateName={d.template_name} /></td>
              <td className="num"><span className="gain">{d.live}</span><span className="text-ink-faint"> / {d.strategies}</span></td>
              <td className="num">{compact(d.fills, 0)}</td>
              <td className="num"><Money p={d.volume_usd} /></td>
              <td className="num text-ink-muted" title={d.maker_fee_bps_min !== null && d.maker_fee_bps_min !== d.maker_fee_bps_max ? `${feeBps(d.maker_fee_bps_min)} to ${feeBps(d.maker_fee_bps_max)} across its strategies, volume-weighted` : "flat fee on the token in, from the program"}>{feeBps(d.maker_fee_bps)}</td>
              <td className="num"><Money p={d.markout_5m_usd} signed colored />{d.markout_5m_bps && <span className="text-ink-faint ml-1.5 text-xs">{bandText(d.markout_5m_bps)}</span>}</td>
              <td className="num"><EdgeCell edge={d.edge_usd} volume={d.volume_usd} /></td>
              <td className="num"><Money p={d.markout_1h_usd} signed colored /></td>
              <td className="num text-ink-muted"><When ts={d.last_seen} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={rank ? 10 : 9} className="text-ink-muted">No desks match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ChainFilter({ value, onChange }: { value: Chain | null; onChange: (c: Chain | null) => void }) {
  const cls = (active: boolean) => `px-2 py-0.5 rounded text-xs ${active ? "bg-water-600 text-ink" : "text-ink-muted hover:text-ink"}`;
  return (
    <div className="inline-flex gap-1 flex-wrap">
      <button className={cls(value === null)} onClick={() => onChange(null)}>all chains</button>
      {CHAINS.map((c) => <button key={c} className={cls(value === c)} onClick={() => onChange(c)}>{CHAIN_NAME[c]}</button>)}
    </div>
  );
}

export function Desks() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [sort, setSort] = useState("volume");
  const q = useQuery({ queryKey: ["desks", chain, sort], queryFn: () => api.desks(chain, sort, 100) });
  return (
    <div className="fade">
      <h1 className="text-xl font-medium">Desks</h1>
      <p className="text-ink-muted text-[13px] mt-1 max-w-2xl">A desk is one maker running one strategy template on one chain, across every instance it shipped. Numbers are all time; the leaderboard ranks them. The edge five minutes after a fill is the honest one: the same trade, re-marked once the market has re-priced. The band is one standard error from the desk's own fills.</p>
      <div className="mt-5 flex items-center justify-between gap-4 flex-wrap">
        <ChainFilter value={chain} onChange={setChain} />
        <div className="inline-flex gap-1 text-xs flex-wrap">{SORTS.map(([k, label]) => <button key={k} onClick={() => setSort(k)} className={`px-2 py-0.5 rounded ${sort === k ? "bg-water-600 text-ink" : "text-ink-muted hover:text-ink"}`}>{label}</button>)}</div>
      </div>
      <div className="mt-4">
        {q.isPending ? <Loading what="desks" /> : q.isError ? <Failed what="desks" error={q.error} /> : <DeskTable rows={q.data} />}
      </div>
      {q.data && <Provenance at={q.data[0]?.volume_usd.at ?? new Date().toISOString()} />}
    </div>
  );
}
