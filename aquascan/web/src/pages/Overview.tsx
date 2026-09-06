import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { CHAIN_NAME, compact, percent, relTime, shortAddr, usd } from "../lib/format";
import { VolumeChart } from "../components/Chart";
import { ChainChip, DeskLink, EdgeCell, Failed, Loading, Money, Provenance, RegistryChip, Section, When, Windows } from "../components/ui";

const WINDOW_TEXT: Record<string, string> = { "24h": "the last 24 hours", "7d": "the last 7 days", "30d": "the last 30 days", all: "all of its history" };

export function Overview() {
  const [window, setWindow] = useState("30d");
  const ov = useQuery({ queryKey: ["overview", window], queryFn: () => api.overview(window, null) });
  const se = useQuery({ queryKey: ["series", window], queryFn: () => api.series(window, null) });
  const bleeding = useQuery({ queryKey: ["bleeding"], queryFn: () => api.desks(null, "markout", 5, 10000) });

  if (ov.isPending) return <Loading what="the pulse" />;
  if (ov.isError) return <Failed what="the overview" error={ov.error} />;
  const o = ov.data; const h = o.hero;
  const chains = o.chains.filter((c) => c.fills > 0);
  const topChain = chains[0];
  const totalVolume = chains.reduce((s, c) => s + (c.volume_usd.value ?? 0), 0);
  const partial = h.volume_usd.confidence < 0.995;
  const tilde = partial ? "~" : "";

  return (
    <div className="fade">
      <div className="flex items-start justify-between gap-8 flex-wrap">
        <div className="max-w-[44rem]">
          <p className="claim">
            In {WINDOW_TEXT[window]}, makers on Aqua settled <b>{tilde}{h.volume_usd.value === null ? "an unpriced volume" : usd(h.volume_usd.value)}</b> across <b>{compact(h.economic_fills, 1)}</b> trades
            {h.edge_usd.value === null ? <> on {chains.length} chains.</> : <>, keeping <b>{tilde}{usd(h.edge_usd.value, true)}</b> of edge.</>}
          </p>
          {h.markout_1h_usd.value !== null && (
            <p className="text-ink-muted mt-3 text-[15px]">Re-marked at prices one hour later, the same trades come to <span className={h.markout_1h_usd.value < 0 ? "loss" : "gain"}>{tilde}{usd(h.markout_1h_usd.value, true)}</span>.</p>
          )}
        </div>
        <div className="panel px-5 py-4 min-w-[220px] max-w-[26rem]">
          <div className="text-2xl font-medium">{compact(o.totals.live, 0)} <span className="text-base text-ink-muted font-normal">strategies live</span></div>
          <div className="text-ink-muted text-[13px] mt-1">{compact(o.totals.desks, 0)} desks, {compact(o.totals.makers, 0)} makers, {compact(o.totals.strategies, 0)} strategies ever shipped</div>
          <div className="flex flex-wrap gap-1.5 mt-3">{chains.map((c) => <ChainChip key={c.chain} chain={c.chain} />)}</div>
          <Link to="/desks" className="block mt-3 text-[13px] text-bronze">Browse the desks</Link>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
        <p className="text-ink-muted text-[13px]">
          Daily volume{topChain && totalVolume > 0 ? <>. {CHAIN_NAME[topChain.chain]} carries {percent((topChain.volume_usd.value ?? 0) / totalVolume)} of it.</> : "."}
          {partial && <span className="chip warn ml-2">priced {Math.round(h.volume_usd.confidence * 100)}%</span>}
        </p>
        <Windows value={window} onChange={setWindow} />
      </div>
      {se.data ? <VolumeChart series={se.data} /> : <div className="h-44" />}

      <Section title={`Top desks by volume, ${window === "all" ? "all time" : window}`} aside={<Link to="/desks" className="text-bronze">All desks</Link>}>
        <div className="overflow-x-auto panel">
          <table>
            <thead><tr><th>#</th><th>Desk</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Edge</th><th className="num">Markout, 1 h</th></tr></thead>
            <tbody>
              {o.top_desks.map((d, i) => (
                <tr key={d.chain + d.desk}>
                  <td className="text-ink-faint">{i + 1}</td>
                  <td><DeskLink chain={d.chain} desk={d.desk} maker={d.maker} makerLabel={d.maker_label} templateName={d.template_name} /></td>
                  <td className="num">{compact(d.fills, 0)}</td>
                  <td className="num"><Money p={d.volume_usd} /></td>
                  <td className="num"><EdgeCell edge={d.edge_usd} volume={d.volume_usd} /></td>
                  <td className="num"><Money p={d.markout_1h_usd} signed colored /></td>
                </tr>
              ))}
              {o.top_desks.length === 0 && <tr><td colSpan={6} className="text-ink-muted">No priced fills in this window yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="mt-9 grid gap-6 md:grid-cols-[1.2fr_1.4fr_1fr]">
        <div>
          <h2 className="text-[15px] font-medium mb-3">Bleeding desks</h2>
          <p className="text-xs text-ink-muted mb-3">Worst one-hour markout among desks with over $10K of volume.</p>
          <div className="panel divide-y divide-water-700">
            {bleeding.data?.map((d) => (
              <div key={d.chain + d.desk} className="flex items-center justify-between px-4 py-2.5">
                <DeskLink chain={d.chain} desk={d.desk} maker={d.maker} />
                <Money p={d.markout_1h_usd} signed colored />
              </div>
            ))}
            {bleeding.data?.length === 0 && <div className="px-4 py-3 text-ink-muted">Nothing priced enough to judge yet.</div>}
          </div>
        </div>
        <div>
          <h2 className="text-[15px] font-medium mb-3">Latest ships</h2>
          <p className="text-xs text-ink-muted mb-3">New strategies registered on Aqua, newest first.</p>
          <div className="panel divide-y divide-water-700">
            {o.latest_ships.map((s) => (
              <div key={s.chain + s.id} className="px-4 py-2.5 text-[13px] flex items-center gap-2 flex-wrap">
                <Link to={`/strategy/${s.chain}/${encodeURIComponent(s.id)}`} className="mono">{shortAddr(s.maker)}</Link>
                <span className="text-ink-muted">shipped a {s.template_name ?? "strategy"} on</span>
                <ChainChip chain={s.chain} />
                <RegistryChip registry={s.registry} />
                <When ts={s.shipped_at} className="text-ink-faint ml-auto" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-[15px] font-medium mb-3">By chain</h2>
          <p className="text-xs text-ink-muted mb-3">Volume share in the window.</p>
          <div className="panel px-4 py-3 space-y-2.5">
            {chains.map((c) => {
              const share = totalVolume > 0 ? (c.volume_usd.value ?? 0) / totalVolume : 0;
              return (
                <div key={c.chain}>
                  <div className="flex justify-between text-[13px]"><span>{CHAIN_NAME[c.chain]}</span><span className="text-ink-muted"><Money p={c.volume_usd} /> <span className="text-ink-faint">{compact(c.fills, 0)} fills</span></span></div>
                  <div className="h-1 bg-water-700 rounded mt-1"><div className="h-1 rounded bg-bronze-deep" style={{ width: `${Math.max(1, share * 100)}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <Provenance at={o.rollup_at} extra={`Latest fill ${relTime(Math.max(0, ...o.latest_ships.map((s) => s.shipped_at)))}.`} />
    </div>
  );
}
