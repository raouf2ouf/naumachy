import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { bandText, CHAIN_NAME, compact, feeBps, percent, relTime, shortAddr, usd } from "../lib/format";
import { VolumeChart } from "../components/Chart";
import { ChainChip, EdgeCell, Failed, Loading, MakerLink, Money, PageHeader, Provenance, RegistryChip, When, Windows } from "../components/ui";

const WINDOW_TEXT: Record<string, string> = { "24h": "the last 24 hours", "7d": "the last 7 days", "30d": "the last 30 days", all: "all of its history" };

// The overview: the venue in four numbers, its volume by day and the same fills marked at four
// moments, the biggest makers, who is bleeding, what just shipped, where the volume is, and what
// the programs charge. One window control, in the header, for the whole page.
export function Overview() {
  const [window, setWindow] = useState("30d");
  const ov = useQuery({ queryKey: ["overview", window], queryFn: () => api.overview(window, null) });
  const se = useQuery({ queryKey: ["series", window], queryFn: () => api.series(window, null) });
  const bleeding = useQuery({ queryKey: ["bleeding"], queryFn: () => api.makers(null, "markout", 6, 10000) });

  if (ov.isPending) return <Loading what="the pulse" />;
  if (ov.isError) return <Failed what="the overview" error={ov.error} />;
  const o = ov.data; const h = o.hero; const fees = o.fees;
  const chains = o.chains.filter((c) => c.fills > 0);
  const topChain = chains[0];
  const totalVolume = chains.reduce((s, c) => s + (c.volume_usd.value ?? 0), 0);
  const partial = h.volume_usd.confidence < 0.995;
  const tilde = partial ? "~" : "";
  const protocolTotal = h.protocol_fee_usd.value;
  const windowLabel = window === "all" ? "all time" : window;

  return (
    <div className="fade">
      <PageHeader title="Aqua, re-priced" description={<>Every strategy shipped to 1inch Aqua on seven chains, read through The Graph, every fill re-marked at the pool five minutes later. Fees are the revenue side of making; the result five minutes after the fill is the cost side. Window: {WINDOW_TEXT[window]}.</>}>
        <Windows value={window} onChange={setWindow} />
      </PageHeader>

      <div className="hero mt-6">
        <div className="hero-stat">
          <div className="l" title="Programs shipped to Aqua and still quoting">Strategies live</div>
          <div className="v">{compact(o.totals.live, 0)}</div>
          <div className="b">{compact(o.totals.makers, 0)} makers, {compact(o.totals.strategies, 0)} strategies ever shipped</div>
        </div>
        <div className="hero-stat">
          <div className="l">Traded, {WINDOW_TEXT[window]}</div>
          <div className="v">{h.volume_usd.value === null ? <span className="text-ink-faint">unpriced</span> : <>{tilde}{usd(h.volume_usd.value)}</>}</div>
          <div className="b">{compact(h.economic_fills, 1)} fills on {chains.length} chains{partial && <span className="chip warn ml-2">priced {Math.round(h.volume_usd.confidence * 100)}%</span>}</div>
        </div>
        <div className="hero-stat">
          <div className="l">Fees makers charged</div>
          <div className="v fee">{h.maker_fee_usd.value === null ? <span className="text-ink-faint">unpriced</span> : usd(h.maker_fee_usd.value)}</div>
          <div className="b">{fees.maker_fee_bps !== null && <>{feeBps(fees.maker_fee_bps)} on average</>}{protocolTotal !== null && <>; the protocol took {usd(protocolTotal)}</>}</div>
        </div>
        <div className="hero-stat primary">
          <div className="l" title="Each fill re-marked at the pool's price five minutes later, once the market had re-priced">Makers' result, 5 min after their fills</div>
          <div className="v">{h.markout_5m_usd.value === null ? <span className="text-ink-faint">not yet marked</span> : <span className={h.markout_5m_usd.value < 0 ? "loss" : "gain"}>{tilde}{usd(h.markout_5m_usd.value, true)}</span>}</div>
          <div className="b">{h.markout_5m_bps ? <>{bandText(h.markout_5m_bps)} of what they traded, once the market had re-priced.</> : <>&nbsp;</>}</div>
        </div>
      </div>

      <div className="tile mt-4">
        <div className="tile-head">
          <h2>Daily volume, {windowLabel}</h2>
          <span className="note">{topChain && totalVolume > 0 ? <>{CHAIN_NAME[topChain.chain]} carries {percent((topChain.volume_usd.value ?? 0) / totalVolume)} of it.</> : "Settled on Aqua, by day."}{partial && <span className="chip warn ml-2">priced {Math.round(h.volume_usd.confidence * 100)}%</span>}</span>
        </div>
        <div className="tile-body">
          {se.data ? <VolumeChart series={se.data} /> : <div className="h-44" />}
          {h.edge_usd.value !== null && h.markout_5m_usd.value !== null && (
            <div className="marks">
              <div><div className="l">The same fills, at the fill</div><div className="v">{tilde}{usd(h.edge_usd.value, true)}</div></div>
              <div className="primary"><div className="l">5 minutes later</div><div className={`v ${h.markout_5m_usd.value < 0 ? "loss" : "gain"}`}>{tilde}{usd(h.markout_5m_usd.value, true)}</div></div>
              <div><div className="l">1 hour later</div><div className="v">{h.markout_1h_usd.value === null ? <span className="text-ink-faint">pending</span> : <>{tilde}{usd(h.markout_1h_usd.value, true)}</>}</div></div>
              <div><div className="l">1 day later</div><div className="v">{h.markout_24h_usd.value === null ? <span className="text-ink-faint">pending</span> : <>{tilde}{usd(h.markout_24h_usd.value, true)}</>}</div></div>
            </div>
          )}
        </div>
        <div className="tile-foot">Negative means the market moved against the makers after they traded: the takers knew where the price was going.</div>
      </div>

      <div className="tile mt-4">
        <div className="tile-head"><h2>Top makers by volume, {windowLabel}</h2><Link to="/makers" className="note">All makers</Link></div>
        <div className="tile-body flush overflow-x-auto">
          <table>
            <thead><tr><th>#</th><th>Maker</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fees earned</th><th className="num">Result, 5 min after fill</th><th className="num">Edge at fill</th></tr></thead>
            <tbody>
              {o.top_makers.map((d, i) => (
                <tr key={d.chain + d.maker}>
                  <td className="text-ink-faint">{i + 1}</td>
                  <td><MakerLink chain={d.chain} maker={d.maker} makerLabel={d.maker_label} templates={d.templates} pairs={d.pairs} /></td>
                  <td className="num">{compact(d.fills, 0)}</td>
                  <td className="num"><Money p={d.volume_usd} /></td>
                  <td className="num"><Money p={d.maker_fee_usd} className="fee" /><span className="sub">{feeBps(d.maker_fee_bps)}</span></td>
                  <td className="num"><Money p={d.markout_5m_usd} signed colored className="font-medium" />{d.markout_5m_bps && <span className="band">{bandText(d.markout_5m_bps)}</span>}</td>
                  <td className="num text-ink-muted"><EdgeCell edge={d.edge_usd} volume={d.volume_usd} /></td>
                </tr>
              ))}
              {o.top_makers.length === 0 && <tr><td colSpan={7} className="text-ink-muted">No priced fills in this window yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="tile-foot">A maker is a wallet that ships strategies to Aqua; one row per maker and chain, across every strategy it shipped there.</div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div className="tile">
          <div className="tile-head"><h2>Bleeding makers</h2><Link to="/makers" className="note">worst after 1 h</Link></div>
          <div className="tile-body">
            {bleeding.data?.map((d) => (
              <div key={d.chain + d.maker} className="row">
                <MakerLink chain={d.chain} maker={d.maker} makerLabel={d.maker_label} />
                <Money p={d.markout_1h_usd} signed colored compact className="font-medium whitespace-nowrap" />
              </div>
            ))}
            {bleeding.data?.length === 0 && <div className="text-ink-muted">Nothing priced enough to judge yet.</div>}
          </div>
          <div className="tile-foot">The worst result one hour after filling, among makers with over $10K of volume.</div>
        </div>
        <div className="tile">
          <div className="tile-head"><h2>Latest ships</h2><span className="note">newest first</span></div>
          <div className="tile-body">
            {o.latest_ships.slice(0, 6).map((s) => (
              <div key={s.chain + s.id} className="row">
                <span className="min-w-0">
                  <span className="flex items-center gap-2"><Link to={`/strategy/${s.chain}/${encodeURIComponent(s.id)}`} className="mono whitespace-nowrap">{shortAddr(s.maker)}</Link><ChainChip chain={s.chain} /><RegistryChip registry={s.registry} /></span>
                  <span className="block text-ink-muted truncate text-[12.5px] mt-0.5" title={s.template_name ?? "strategy"}>{s.template_name ?? "a strategy"}</span>
                </span>
                <When ts={s.shipped_at} className="text-ink-faint whitespace-nowrap" />
              </div>
            ))}
          </div>
          <div className="tile-foot">New strategies registered on Aqua, with the template Aquascan reads from their bytes.</div>
        </div>
        <div className="tile">
          <div className="tile-head"><h2>By chain</h2><span className="note">share of volume, {windowLabel}</span></div>
          <div className="tile-body">
            {chains.map((c) => {
              const share = totalVolume > 0 ? (c.volume_usd.value ?? 0) / totalVolume : 0;
              return (
                <div key={c.chain} className="py-1.5">
                  <div className="flex justify-between text-[13px]"><span>{CHAIN_NAME[c.chain]}</span><span className="text-ink-muted whitespace-nowrap"><Money p={c.volume_usd} compact /> <span className="text-ink-faint">{compact(c.fills, 0)} fills</span></span></div>
                  <div className="bar"><div style={{ width: `${Math.max(1, share * 100)}%` }} /></div>
                </div>
              );
            })}
          </div>
          <div className="tile-foot">Seven chains through The Graph: six by subgraph, Robinhood Chain by Substreams.</div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="tile">
          <div className="tile-head"><h2>Maker fees</h2><span className="note">read from the programs' bytecode</span></div>
          <div className="tile-body flush overflow-x-auto">
            <table>
              <thead><tr><th>Fee</th><th className="num">Volume share</th><th className="num">Volume</th><th className="num">Strategies</th></tr></thead>
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
          <div className="tile-foot">The maker fee is what a program adds on the token it takes in; the maker keeps it, so it is already inside the edge.</div>
        </div>
        <div className="tile">
          <div className="tile-head"><h2>Protocol fees</h2><span className="note">pulled from the maker's ledger in the same transaction</span></div>
          <div className="tile-body flush overflow-x-auto">
            <table>
              <thead><tr><th>Paid to</th><th className="num">Effective rate</th><th className="num">Collected</th><th className="num">On volume</th></tr></thead>
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
          <div className="tile-foot">The protocol fee is taken out of the maker's ledger when the fill settles, so it is a cost to the maker on top of what the market does next.</div>
        </div>
      </div>

      <Provenance at={o.rollup_at} extra={`Latest fill ${relTime(Math.max(0, ...o.latest_ships.map((s) => s.shipped_at)))}.`} />
    </div>
  );
}
