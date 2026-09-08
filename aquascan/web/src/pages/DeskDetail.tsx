import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type Band, type Chain, type DeskFees, type FillRow, type Priced } from "../lib/api";
import { bandText, bps, compact, feeBps, percent, shortAddr, usd } from "../lib/format";
import { Addr, ChainChip, EdgeCell, Failed, Loading, Money, Pairs, Provenance, RegistryChip, Section, StatusDot, When } from "../components/ui";

function Score({ label, p, signed, colored, sub, primary }: { label: string; p: Priced; signed?: boolean; colored?: boolean; sub?: string | null; primary?: boolean }) {
  return (
    <div className={primary ? "primary" : ""}>
      <div className="l">{label}</div>
      <div className="v"><Money p={p} signed={signed} colored={colored} /></div>
      {sub && <div className="b">{sub}</div>}
    </div>
  );
}

// The six numbers every scored page opens with. The headline is the fill re-marked five minutes
// later, once the market has re-priced; it alone carries the colour. Its companions stay quiet.
export function ScoreTiles({ s, volumeLabel = "Volume" }: { s: { volume_usd: Priced; edge_usd: Priced; markout_5m_usd: Priced; markout_1h_usd: Priced; markout_24h_usd: Priced; pnl_usd_marked: Priced; markout_5m_bps: Band | null; markout_1h_bps: Band | null }; volumeLabel?: string }) {
  const v = s.volume_usd.value;
  return (
    <div className="scores">
      <Score label="Edge, 5 min after fill" p={s.markout_5m_usd} signed colored sub={bandText(s.markout_5m_bps)} primary />
      <Score label={volumeLabel} p={s.volume_usd} />
      <Score label="Edge at fill" p={s.edge_usd} signed sub={bps(s.edge_usd.value, v)} />
      <Score label="Marked 1 hour later" p={s.markout_1h_usd} signed sub={bandText(s.markout_1h_bps)} />
      <Score label="Marked 1 day later" p={s.markout_24h_usd} signed sub={bps(s.markout_24h_usd.value, v)} />
      <Score label="Position at latest prices" p={s.pnl_usd_marked} signed />
    </div>
  );
}

// One line per fill, as a sentence: what it was worth at fill time, five minutes and an hour later.
export function FillLine({ f, children }: { f: FillRow; children?: React.ReactNode }) {
  const age = Date.now() / 1000 - f.ts;
  return (
    <div className="px-4 py-2.5 text-[13px] flex items-center gap-3 flex-wrap">
      {children}
      {(f.ref_kind === "tape" || age < 20 * 60) && <span className="text-ink-faint">5 min later <Money p={f.markout_5m_usd} signed colored pending={age < 20 * 60} /></span>}
      <span className="text-ink-faint">at fill <Money p={f.edge_usd} signed colored /></span>
      <span className="text-ink-faint">1 h later <Money p={f.markout_1h_usd} signed colored pending={age < 2 * 3600} /></span>
      {f.ref_kind === "tape" ? <span className="text-ink-faint text-xs" title="reference: the pair's other fills around this one">{f.ref_fills} prints within {f.ref_window_min === 0 ? "the minute" : `${f.ref_window_min} min`}</span>
        : f.ref_kind === "pool" ? <span className="text-ink-faint text-xs" title="reference: the pair's deepest pool on this chain">{f.ref_fills} pool swaps within {f.ref_window_min === 0 ? "the minute" : `${f.ref_window_min} min`}</span>
        : f.ref_kind === "hop" ? <span className="text-ink-faint text-xs" title="reference: the dense leg on the tape, the other leg in a pool, through a hub token">{f.ref_fills} prints via a hub pool within {f.ref_window_min === 0 ? "the minute" : `${f.ref_window_min} min`}</span>
        : f.ref_kind === "hourly" ? <span className="text-ink-faint text-xs" title="no prints of this pair nearby, on the tape or in a pool">hourly reference</span> : null}
      {f.taker && <span className="text-ink-faint">taker <span className="mono">{shortAddr(f.taker)}</span></span>}
      <When ts={f.ts} className="text-ink-faint ml-auto" />
    </div>
  );
}

function FeePanel({ fees, makerFee, protocolFee, volume }: { fees: DeskFees; makerFee: Priced; protocolFee: Priced; volume: Priced }) {
  const uniform = fees.maker_fee_bps_min !== null && fees.maker_fee_bps_min === fees.maker_fee_bps_max;
  const side = fees.maker_sides.length === 1 ? (fees.maker_sides[0] === "in" ? "on the token it takes in" : "on the token it gives out") : "on one side of each swap";
  return (
    <div className="mt-3 panel px-5 py-4 text-[13px]">
      <div className="text-xs text-ink-muted">Fees, read from the programs</div>
      <p className="mt-1">
        {fees.maker_fee_bps === null ? <>Its programs charge no maker fee.</> : (
          <>Charges <b className="font-medium">{feeBps(fees.maker_fee_bps)}</b> {side}{uniform ? "" : `, from ${feeBps(fees.maker_fee_bps_min)} to ${feeBps(fees.maker_fee_bps_max)} across ${compact(fees.decoded, 0)} strategies, weighted by volume`}
            {makerFee.value !== null && volume.value !== null && <>, about <b className="font-medium fee">{usd(makerFee.value)}</b> earned on {usd(volume.value)}</>}.</>
        )}
        {" "}
        {fees.protocol_fee_bps_max === null || fees.protocol_fee_bps_max === 0 ? <>No protocol fee.</> : (
          <>The protocol pulled <b className="font-medium fee"><Money p={protocolFee} /></b> out of its fills at {fees.protocol_fee_bps_min === fees.protocol_fee_bps_max ? feeBps(fees.protocol_fee_bps_min) : `${feeBps(fees.protocol_fee_bps_min)} to ${feeBps(fees.protocol_fee_bps_max)}`}
            {fees.protocol_recipients.length > 0 && <>, paid to {fees.protocol_recipients.map((r, i) => <span key={r} className="mono" title={r}>{i > 0 ? ", " : ""}{shortAddr(r, 8, 4)}</span>)}</>}.</>
        )}
        {fees.decoded < fees.strategies && <span className="text-ink-faint"> {fees.strategies - fees.decoded} of its strategies run on a router we cannot read.</span>}
      </p>
    </div>
  );
}

export function DeskDetail() {
  const { chain = "", id = "" } = useParams();
  const [limit, setLimit] = useState(50);
  const q = useQuery({ queryKey: ["desk", chain, id, limit], queryFn: () => api.desk(chain, id, limit), placeholderData: (prev) => prev });
  if (q.isPending) return <Loading what="the desk" />;
  if (q.isError) return <Failed what="this desk" error={q.error} />;
  const d = q.data; const c = chain as Chain;
  return (
    <div className="fade">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title">{d.maker_label ? <span>{d.maker_label} <Addr value={d.maker} chars={6} className="text-base text-ink-muted" /></span> : <Addr value={d.maker} chars={10} />}</h1>
        <ChainChip chain={c} />
        <span className="chip" title={d.instructions ? d.instructions.join(" > ") : d.template}>{d.template_name ?? `template ${shortAddr(d.template, 8, 4)}`}</span>
        <span className="text-ink-muted text-[13px]"><span className="gain">{d.live}</span> live of {d.strategies_total} strategies</span>
      </div>
      <p className="mt-2 text-[13.5px]"><span className="text-ink-muted mr-2">Trades</span><Pairs pairs={d.pairs} max={4} /></p>
      <p className="page-desc">First seen <When ts={d.first_seen} />, last active <When ts={d.last_seen} />. {d.tape_ratio > 0 && <>{percent(d.tape_ratio)} of its fills are scored against prints within minutes, the pair's other fills or a same-chain pool; the rest against hourly prices. The band on a rate is one standard error, from the spread of its own fills.</>}</p>

      <ScoreTiles s={d} volumeLabel="Volume, all time" />
      <FeePanel fees={d.fees} makerFee={d.maker_fee_usd} protocolFee={d.protocol_fee_usd} volume={d.volume_usd} />

      <Section title="Strategies">
        <div className="overflow-x-auto panel">
          <table>
            <thead><tr><th>State</th><th>Strategy</th><th>Shipped</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fee</th><th className="num">Edge, 5 min</th><th className="num">Edge at fill</th><th className="num">Pair P&L</th><th className="num">Takers</th></tr></thead>
            <tbody>
              {d.strategies.map((s) => (
                <tr key={s.id}>
                  <td><StatusDot status={s.status} /></td>
                  <td><Link to={`/strategy/${chain}/${encodeURIComponent(s.id)}`} className="mono">{shortAddr(s.strategy_hash, 10, 6)}</Link> <RegistryChip registry={s.registry} /></td>
                  <td className="text-ink-muted"><When ts={s.shipped_at} /></td>
                  <td className="num">{compact(s.fills, 0)}</td>
                  <td className="num"><Money p={s.volume_usd} /></td>
                  <td className="num text-ink-muted">{feeBps(s.maker_fee_bps)}</td>
                  <td className="num"><Money p={s.markout_5m_usd} signed colored />{s.markout_5m_bps && <span className="text-ink-faint ml-1.5 text-xs">{bandText(s.markout_5m_bps)}</span>}</td>
                  <td className="num"><EdgeCell edge={s.edge_usd} volume={s.volume_usd} /></td>
                  <td className="num">{s.pnl_quote ? <span className={s.pnl_quote.value > 0 ? "gain" : s.pnl_quote.value < 0 ? "loss" : ""} title={`from its own fills, ${percent(s.pnl_quote.coverage)} of bases marked`}>{s.pnl_quote.value > 0 ? "+" : ""}{compact(s.pnl_quote.value, 4)} {s.pnl_quote.quote_symbol ?? shortAddr(s.pnl_quote.quote_token, 4, 3)}</span> : <span className="text-ink-faint">no fills</span>}</td>
                  <td className="num text-ink-muted">{s.takers}{s.self_fills > 0 && <span className="chip warn ml-1.5">{s.self_fills} self</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.strategies.length < d.strategies_total && <button onClick={() => setLimit((n) => n + 100)} className="w-full py-2.5 text-[13px] text-bronze hover:bg-water-800">Show more, {d.strategies.length} of {d.strategies_total}</button>}
        </div>
      </Section>

      <Section title="Recent economic fills">
        <div className="panel divide-y divide-water-700">
          {d.recent_fills.map((f) => (
            <FillLine key={f.id} f={f}>
              <span className="text-ink-muted">{f.shape === "TWO_SIDED" ? "two-sided fill" : f.shape.toLowerCase().replace("_", " ")}</span>
              <span>volume <Money p={f.volume_usd} /></span>
            </FillLine>
          ))}
          {d.recent_fills.length === 0 && <div className="px-4 py-3 text-ink-muted">No economic fills yet.</div>}
        </div>
      </Section>
      <Provenance at={d.volume_usd.at} />
    </div>
  );
}
