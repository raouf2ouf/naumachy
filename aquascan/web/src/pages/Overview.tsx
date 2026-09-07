import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { bandText, CHAIN_NAME, compact, feeBps, percent, relTime, shortAddr, usd } from "../lib/format";
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
  const o = ov.data; const h = o.hero; const fees = o.fees;
  const chains = o.chains.filter((c) => c.fills > 0);
  const topChain = chains[0];
  const totalVolume = chains.reduce((s, c) => s + (c.volume_usd.value ?? 0), 0);
  const partial = h.volume_usd.confidence < 0.995;
  const tilde = partial ? "~" : "";
  const topTier = fees.tiers[0];
  const protocolTotal = h.protocol_fee_usd.value;

  return (
    <div className="fade">
      <div className="flex items-start justify-between gap-8 flex-wrap">
        <div className="max-w-[44rem]">
          <p className="claim">
            In {WINDOW_TEXT[window]}, makers on Aqua settled <b>{tilde}{h.volume_usd.value === null ? "an unpriced volume" : usd(h.volume_usd.value)}</b> across <b>{compact(h.economic_fills, 1)}</b> trades
            {h.markout_5m_usd.value !== null ? <> and, once the market had re-priced five minutes later, {h.markout_5m_usd.value < 0 ? "had given up" : "had kept"} <b>{tilde}{usd(Math.abs(h.markout_5m_usd.value))}</b>{h.markout_5m_bps && <> of it, <b>{bandText(h.markout_5m_bps)}</b></>}.</>
              : h.edge_usd.value === null ? <> on {chains.length} chains.</> : <>, keeping <b>{tilde}{usd(h.edge_usd.value, true)}</b> of edge against the venue's own price.</>}
          </p>
          {h.edge_usd.value !== null && h.markout_5m_usd.value !== null && (
            <p className="text-ink-muted mt-3 text-[15px]">
              At the fill itself the same trades showed <span className={h.edge_usd.value < 0 ? "loss" : "gain"}>{tilde}{usd(h.edge_usd.value, true)}</span>;
              {h.markout_1h_usd.value !== null && <> marked one hour later, <span className={h.markout_1h_usd.value < 0 ? "loss" : "gain"}>{tilde}{usd(h.markout_1h_usd.value, true)}</span></>}
              {h.markout_24h_usd.value !== null && <>; one day later, <span className={h.markout_24h_usd.value < 0 ? "loss" : "gain"}>{tilde}{usd(h.markout_24h_usd.value, true)}</span></>}.
            </p>
          )}
          {fees.maker_fee_bps !== null && (
            <p className="text-ink-muted mt-2 text-[15px]">
              Makers charged <b className="text-ink font-medium">{feeBps(fees.maker_fee_bps)}</b> on average{topTier && topTier.maker_fee_bps !== null && topTier.share > 0.5 && <>, {percent(topTier.share)} of the volume at {feeBps(topTier.maker_fee_bps)}</>}
              {h.maker_fee_usd.value !== null && <>, about <b className="text-ink font-medium">{usd(h.maker_fee_usd.value)}</b> in fees</>}
              {protocolTotal !== null && <>; the protocol collected <b className="text-ink font-medium">{usd(protocolTotal)}</b></>}.
            </p>
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
            <thead><tr><th>#</th><th>Desk</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fee</th><th className="num">Edge, 5 min after fill</th><th className="num">Edge at fill</th><th className="num">Marked 1 h later</th></tr></thead>
            <tbody>
              {o.top_desks.map((d, i) => (
                <tr key={d.chain + d.desk}>
                  <td className="text-ink-faint">{i + 1}</td>
                  <td><DeskLink chain={d.chain} desk={d.desk} maker={d.maker} makerLabel={d.maker_label} templateName={d.template_name} /></td>
                  <td className="num">{compact(d.fills, 0)}</td>
                  <td className="num"><Money p={d.volume_usd} /></td>
                  <td className="num text-ink-muted">{feeBps(d.maker_fee_bps)}</td>
                  <td className="num"><Money p={d.markout_5m_usd} signed colored />{d.markout_5m_bps && <span className="text-ink-faint ml-1.5 text-xs">{bandText(d.markout_5m_bps)}</span>}</td>
                  <td className="num"><EdgeCell edge={d.edge_usd} volume={d.volume_usd} /></td>
                  <td className="num"><Money p={d.markout_1h_usd} signed colored /></td>
                </tr>
              ))}
              {o.top_desks.length === 0 && <tr><td colSpan={8} className="text-ink-muted">No priced fills in this window yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="mt-9 grid gap-6 md:grid-cols-[1.2fr_1.4fr_1fr]">
        <div>
          <h2 className="text-[15px] font-medium mb-3">Bleeding desks</h2>
          <p className="text-xs text-ink-muted mb-3">Worst result one hour after filling, among desks with over $10K of volume.</p>
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

      <Section title="Fees" aside="What the programs charge, read from their bytecode">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="overflow-x-auto panel">
            <table>
              <thead><tr><th>Maker fee</th><th className="num">Volume share</th><th className="num">Volume</th><th className="num">Strategies</th></tr></thead>
              <tbody>
                {fees.tiers.map((t, i) => (
                  <tr key={i}>
                    <td>{t.maker_fee_bps === null ? <span className="text-ink-muted">{t.kind === "progressive" ? "progressive" : "none"}</span> : <>{feeBps(t.maker_fee_bps)} <span className="text-ink-faint">{t.kind}</span></>}</td>
                    <td className="num">{percent(t.share)}</td>
                    <td className="num">{t.volume_usd === null ? "" : usd(t.volume_usd)}</td>
                    <td className="num">{compact(t.strategies, 0)}</td>
                  </tr>
                ))}
                {fees.tiers.length === 0 && <tr><td colSpan={4} className="text-ink-muted">No decoded programs in this window.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto panel">
            <table>
              <thead><tr><th>Protocol fee, paid to</th><th className="num">Effective rate</th><th className="num">Collected</th><th className="num">On volume</th></tr></thead>
              <tbody>
                {fees.protocol.map((r, i) => (
                  <tr key={i}>
                    <td>{r.recipient ? <span className="mono" title={r.recipient}>{shortAddr(r.recipient, 8, 4)}</span> : <span className="text-ink-muted">{r.kind === "dynamic" ? "a dynamic fee provider" : "no protocol fee"}</span>}</td>
                    <td className="num text-ink-muted" title={r.bps_min === null ? "" : r.bps_min === r.bps_max ? `programs charge ${feeBps(r.bps_min)}` : `programs charge from ${feeBps(r.bps_min)} to ${feeBps(r.bps_max)}`}>{r.fee_usd !== null && r.volume_usd ? feeBps((r.fee_usd / r.volume_usd) * 1e4) : ""}</td>
                    <td className="num">{r.fee_usd === null ? <span className="text-ink-faint">unpriced</span> : usd(r.fee_usd)}</td>
                    <td className="num">{r.volume_usd === null ? "" : usd(r.volume_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-ink-muted mt-3 max-w-3xl">The maker fee is what a program adds on the token it takes in; the maker keeps it, so it is already inside the edge. The protocol fee is pulled out of the maker's ledger in the same transaction, so every number here is net of it. Maker fee dollars are the rate applied to volume; protocol fee dollars are the pulls themselves, valued at the fill hour.</p>
      </Section>
      <Provenance at={o.rollup_at} extra={`Latest fill ${relTime(Math.max(0, ...o.latest_ships.map((s) => s.shipped_at)))}.`} />
    </div>
  );
}
