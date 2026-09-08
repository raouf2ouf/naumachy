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
      <div className="hero">
        <div className="hero-stat">
          <div className="l" title="Programs shipped to Aqua and still quoting">Strategies live</div>
          <div className="v">{compact(o.totals.live, 0)}</div>
          <div className="b">{compact(o.totals.desks, 0)} desks, {compact(o.totals.makers, 0)} makers</div>
        </div>
        <div className="hero-stat">
          <div className="l">Traded, {WINDOW_TEXT[window]}</div>
          <div className="v">{h.volume_usd.value === null ? <span className="text-ink-faint">unpriced</span> : <>{tilde}{usd(h.volume_usd.value)}</>}</div>
          <div className="b">{compact(h.economic_fills, 1)} fills on {chains.length} chains{partial && <span className="chip warn ml-2">priced {Math.round(h.volume_usd.confidence * 100)}%</span>}</div>
        </div>
        <div className="hero-stat">
          <div className="l">Fees makers charged</div>
          <div className="v fee">{h.maker_fee_usd.value === null ? <span className="text-ink-faint">unpriced</span> : usd(h.maker_fee_usd.value)}</div>
          <div className="b">{fees.maker_fee_bps !== null && <>{feeBps(fees.maker_fee_bps)} on average</>}{protocolTotal !== null && <>; the protocol took <span className="fee">{usd(protocolTotal)}</span></>}</div>
        </div>
        <div className="hero-stat primary">
          <div className="l" title="Each fill re-marked at the pool's price five minutes later, once the market had re-priced">Makers' result, 5 min after their fills</div>
          <div className="v">{h.markout_5m_usd.value === null ? <span className="text-ink-faint">not yet marked</span> : <span className={h.markout_5m_usd.value < 0 ? "loss" : "gain"}>{tilde}{usd(h.markout_5m_usd.value, true)}</span>}</div>
          <div className="b">{h.markout_5m_bps ? <>{bandText(h.markout_5m_bps)} of what they traded</> : <>&nbsp;</>}</div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div>
            <h2>Daily volume</h2>
            <p className="section-desc">{topChain && totalVolume > 0 ? <>{CHAIN_NAME[topChain.chain]} carries {percent((topChain.volume_usd.value ?? 0) / totalVolume)} of it.</> : "Settled on Aqua, by day."}{partial && <span className="chip warn ml-2">priced {Math.round(h.volume_usd.confidence * 100)}%</span>}</p>
          </div>
          <Windows value={window} onChange={setWindow} />
        </div>
        {se.data ? <VolumeChart series={se.data} /> : <div className="h-44" />}
        {h.edge_usd.value !== null && h.markout_5m_usd.value !== null && (
          <p className="horizons">
            <span className="horizons-l">The same fills, marked</span>
            <span><span className="l">at the fill</span><span className="v">{tilde}{usd(h.edge_usd.value, true)}</span></span>
            <span className="primary"><span className="l">5 minutes later</span><span className="v">{tilde}{usd(h.markout_5m_usd.value, true)}</span></span>
            {h.markout_1h_usd.value !== null && <span><span className="l">1 hour later</span><span className="v">{tilde}{usd(h.markout_1h_usd.value, true)}</span></span>}
            {h.markout_24h_usd.value !== null && <span><span className="l">1 day later</span><span className="v">{tilde}{usd(h.markout_24h_usd.value, true)}</span></span>}
            <span className="horizons-note">Negative means the market moved against the makers after they traded. {compact(o.totals.strategies, 0)} strategies have been shipped since the registries began.</span>
          </p>
        )}
      </div>

      <Section title={`Top desks by volume, ${window === "all" ? "all time" : window}`} description="A desk is one maker running one strategy template on one chain." aside={<Link to="/desks">All desks</Link>}>
        <div className="overflow-x-auto panel">
          <table>
            <thead><tr><th>#</th><th>Desk</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fees earned</th><th className="num">Edge, 5 min after fill</th><th className="num">Edge at fill</th></tr></thead>
            <tbody>
              {o.top_desks.map((d, i) => (
                <tr key={d.chain + d.desk}>
                  <td className="text-ink-faint">{i + 1}</td>
                  <td><DeskLink chain={d.chain} desk={d.desk} maker={d.maker} makerLabel={d.maker_label} templateName={d.template_name} pairs={d.pairs} /></td>
                  <td className="num">{compact(d.fills, 0)}</td>
                  <td className="num"><Money p={d.volume_usd} /></td>
                  <td className="num"><Money p={d.maker_fee_usd} className="fee" /><span className="sub">{feeBps(d.maker_fee_bps)}</span></td>
                  <td className="num"><Money p={d.markout_5m_usd} signed colored className="font-medium" />{d.markout_5m_bps && <span className="band">{bandText(d.markout_5m_bps)}</span>}</td>
                  <td className="num text-ink-muted"><EdgeCell edge={d.edge_usd} volume={d.volume_usd} /></td>
                </tr>
              ))}
              {o.top_desks.length === 0 && <tr><td colSpan={8} className="text-ink-muted">No priced fills in this window yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="section grid gap-8 md:grid-cols-[1.2fr_1.4fr_1fr]">
        <div>
          <div className="section-head"><div><h2>Bleeding desks</h2><p className="section-desc">Worst result one hour after filling, among desks with over $10K of volume.</p></div></div>
          <div className="list">
            {bleeding.data?.map((d) => (
              <div key={d.chain + d.desk} className="flex items-center justify-between px-1 py-2.5">
                <DeskLink chain={d.chain} desk={d.desk} maker={d.maker} />
                <Money p={d.markout_1h_usd} signed colored />
              </div>
            ))}
            {bleeding.data?.length === 0 && <div className="px-1 py-3 text-ink-muted">Nothing priced enough to judge yet.</div>}
          </div>
        </div>
        <div>
          <div className="section-head"><div><h2>Latest ships</h2><p className="section-desc">New strategies registered on Aqua, newest first.</p></div></div>
          <div className="list">
            {o.latest_ships.map((s) => (
              <div key={s.chain + s.id} className="ship">
                <Link to={`/strategy/${s.chain}/${encodeURIComponent(s.id)}`} className="mono">{shortAddr(s.maker)}</Link>
                <ChainChip chain={s.chain} />
                <span className="ship-what text-ink-muted" title={s.template_name ?? "strategy"}>shipped a {s.template_name ?? "strategy"}</span>
                <RegistryChip registry={s.registry} />
                <When ts={s.shipped_at} className="text-ink-faint ship-when" />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="section-head"><div><h2>By chain</h2><p className="section-desc">Volume share in the window.</p></div></div>
          <div className="space-y-3 pt-1">
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

      <Section title="Fees" description="What the programs charge, read from their bytecode.">
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
                    <td className="num fee">{r.fee_usd === null ? <span className="text-ink-faint">unpriced</span> : usd(r.fee_usd)}</td>
                    <td className="num">{r.volume_usd === null ? "" : usd(r.volume_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="section-desc mt-3">The maker fee is what a program adds on the token it takes in; the maker keeps it, so it is already inside the edge. The protocol fee is pulled out of the maker's ledger in the same transaction, so every number here is net of it. Maker fee dollars are the rate applied to volume; protocol fee dollars are the pulls themselves, valued at the fill hour.</p>
      </Section>
      <Provenance at={o.rollup_at} extra={`Latest fill ${relTime(Math.max(0, ...o.latest_ships.map((s) => s.shipped_at)))}.`} />
    </div>
  );
}
