import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type Chain, type Leg, type StrategyFees } from "../lib/api";
import { absTime, amount, compact, feeBps, percent, relTime, shortAddr, usd } from "../lib/format";
import { Addr, ChainChip, Failed, Loading, Money, Provenance, RegistryChip, Section, StatusDot, When } from "../components/ui";
import { FillLine, ScoreTiles } from "./MakerDetail";
import { ProgramCard } from "../components/ProgramCard";

function LegsSentence({ legs }: { legs: Leg[] }) {
  const received = legs.filter((l) => !l.net.startsWith("-") && l.net !== "0");
  const gave = legs.filter((l) => l.net.startsWith("-"));
  return (
    <span>
      {received.length > 0 && <>received <b className="font-medium">{received.map((l) => amount(l.net, l.decimals, l.symbol)).join(", ")}</b></>}
      {received.length > 0 && gave.length > 0 && ", "}
      {gave.length > 0 && <>gave <b className="font-medium">{gave.map((l) => amount(l.net.slice(1), l.decimals, l.symbol)).join(", ")}</b></>}
    </span>
  );
}

function FeeSentence({ fees, makerFee, protocolFee }: { fees: StrategyFees | null; makerFee?: { value: number | null }; protocolFee?: { value: number | null } }) {
  if (!fees || !fees.decoded) return <>Fee instructions could not be read: the router's dialect is unknown.</>;
  const maker = fees.maker_fee_kind === null ? "No maker fee instruction" : fees.maker_fee_kind === "progressive"
    ? `A progressive maker fee on the token it ${fees.maker_fee_side === "in" ? "takes in" : "gives out"}`
    : `A flat maker fee of ${feeBps(fees.maker_fee_bps)} on the token it ${fees.maker_fee_side === "in" ? "takes in" : "gives out"}, kept by the maker`;
  const protocol = fees.protocol_fee_kind === null ? "no protocol fee" : fees.protocol_fee_kind === "dynamic"
    ? <>a protocol fee set per swap by provider <span className="mono" title={fees.protocol_fee_provider ?? ""}>{shortAddr(fees.protocol_fee_provider ?? "", 8, 4)}</span></>
    : <>a protocol fee of {feeBps(fees.protocol_fee_bps)} pulled out of the maker's ledger, paid to <span className="mono" title={fees.protocol_fee_to ?? ""}>{shortAddr(fees.protocol_fee_to ?? "", 8, 4)}</span></>;
  return (
    <>{maker}; {protocol}.
      {makerFee?.value != null && <> About <span className="fee">{usd(makerFee.value)}</span> of maker fees earned</>}
      {protocolFee?.value != null && protocolFee.value > 0 && <>{makerFee?.value != null ? " and " : " "}<span className="fee">{usd(protocolFee.value)}</span> of protocol fees paid</>}
      {(makerFee?.value != null || (protocolFee?.value != null && protocolFee.value > 0)) && " so far."}
    </>
  );
}

export function StrategyDetail() {
  const { chain = "", id = "" } = useParams();
  const [limit, setLimit] = useState(50);
  const q = useQuery({ queryKey: ["strategy", chain, id, limit], queryFn: () => api.strategy(chain, id, limit), placeholderData: (prev) => prev });
  if (q.isPending) return <Loading what="the strategy" />;
  if (q.isError) return <Failed what="this strategy" error={q.error} />;
  const s = q.data; const c = chain as Chain; const st = s.stats;
  const bytes = (s.program.length - 2) / 2;
  return (
    <div className="fade">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title"><Addr value={s.strategy_hash} chars={10} /></h1>
        <StatusDot status={s.status} />
        <ChainChip chain={c} />
        <span className="chip" title={s.instructions ? s.instructions.join(" > ") : s.template}>{s.template_name ?? `template ${shortAddr(s.template, 8, 4)}`}</span>
        <RegistryChip registry={s.registry} />
      </div>
      <p className="page-desc">
        Shipped <When ts={s.shipped_at} /> by <Link to={`/maker/${chain}/${s.maker}`} className="mono text-ink">{shortAddr(s.maker)}</Link> through {s.app_label ? <span title={s.app}>{s.app_label}</span> : <>router <span className="mono" title={s.app}>{shortAddr(s.app)}</span></>}
        {s.docked_at ? <>, docked <When ts={s.docked_at} />. Docked means revoked: tokens never left the wallet.</> : <>. Still live.</>}
      </p>

      {st ? <ScoreTiles s={st} /> : <p className="mt-5 text-ink-muted">No economic fills yet, so nothing to score.</p>}
      {st && (
        <p className="text-xs text-ink-muted mt-2">{compact(st.fills, 0)} economic fills, first <When ts={st.first_fill_ts} />, last <When ts={st.last_fill_ts} />. {st.tape_ratio > 0 ? <>{percent(st.tape_ratio)} of them scored against prints within minutes, the pair's other fills or a same-chain pool; the rest against hourly prices.</> : <>Scored against hourly prices: no prints of this pair nearby, on the tape or in a pool.</>}</p>
      )}

      <div className="mt-4 panel px-5 py-4 text-[13px]">
        <div className="text-xs text-ink-muted">Fees, read from the program</div>
        <p className="mt-1"><FeeSentence fees={s.fees} makerFee={st?.maker_fee_usd} protocolFee={st?.protocol_fee_usd} /></p>
      </div>

      {st?.pnl_quote && (
        <div className="mt-4 panel px-5 py-4">
          <div className="text-xs text-ink-muted">Pair-native P&L, no oracle involved</div>
          <div className="text-lg mt-0.5"><span className={st.pnl_quote.value > 0 ? "gain" : st.pnl_quote.value < 0 ? "loss" : ""}>{st.pnl_quote.value > 0 ? "+" : ""}{compact(st.pnl_quote.value, 4)} {st.pnl_quote.quote_symbol ?? shortAddr(st.pnl_quote.quote_token, 6, 4)}</span></div>
          <div className="text-xs text-ink-faint mt-1">Net flows valued at the strategy's own 24-hour VWAP marks. {percent(st.pnl_quote.coverage)} of its base tokens have a mark{st.pnl_quote.mark_age_s ? `, the oldest ${relTime(Date.now() / 1000 - st.pnl_quote.mark_age_s)}` : ""}. {st.takers} distinct takers{st.top_taker_share !== null ? `, the largest took ${percent(st.top_taker_share)} of fills` : ""}{st.self_fills > 0 ? `, ${st.self_fills} fills taken by the maker itself` : ""}.</div>
        </div>
      )}

      {s.marks.length > 0 && (
        <Section title="Marks">
          <div className="overflow-x-auto panel">
            <table>
              <thead><tr><th>Pair</th><th className="num">Mark</th><th className="num">Fills in window</th><th>Anchored at</th></tr></thead>
              <tbody>{s.marks.map((m) => (
                <tr key={m.base_token}>
                  <td>{m.base_symbol ?? shortAddr(m.base_token)} in {m.quote_symbol ?? shortAddr(m.quote_token)}</td>
                  <td className="num">{m.price === null ? <span className="text-ink-faint">decimals unknown</span> : compact(m.price, 6)}</td>
                  <td className="num">{m.fills}</td>
                  <td className="text-ink-muted" title={absTime(m.mark_ts)}>{relTime(m.mark_ts)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Program" description="What the maker wrote, instruction by instruction, in the order the router runs them. A fee or a guard placed before the curve wraps it: the swap is priced inside, then the wrapper takes its cut or checks its rule.">
        <ProgramCard card={s.card} bytes={bytes} />
        <details className="mt-2 text-[13px]">
          <summary className="cursor-pointer text-ink-muted">Raw bytes{s.instructions && <span className="mono text-ink-faint"> · {s.instructions.join(" > ")}</span>}</summary>
          <pre className="mono text-xs mt-2 whitespace-pre-wrap break-all text-ink-muted">{s.program}</pre>
        </details>
      </Section>

      <Section title="Economic fills" aside={`${s.fills.length} of ${s.fills_total}, newest first`}>
        <div className="panel divide-y divide-water-700">
          {s.fills.map((f) => (
            <FillLine key={f.id} f={f}>{f.legs && <LegsSentence legs={f.legs} />}</FillLine>
          ))}
          {s.fills.length === 0 && <div className="px-4 py-3 text-ink-muted">No economic fills yet.</div>}
          {s.fills.length < s.fills_total && <button onClick={() => setLimit((n) => n + 100)} className="w-full py-2.5 text-[13px] text-bronze hover:bg-water-800">Show more, {s.fills.length} of {s.fills_total}</button>}
        </div>
      </Section>
      <Provenance at={st?.volume_usd.at ?? new Date().toISOString()} />
    </div>
  );
}
