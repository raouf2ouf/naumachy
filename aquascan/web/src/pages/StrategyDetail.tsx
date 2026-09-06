import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type Chain, type Leg } from "../lib/api";
import { absTime, amount, bps, compact, percent, relTime, shortAddr } from "../lib/format";
import { Addr, ChainChip, Failed, Loading, Money, Provenance, RegistryChip, Section, StatusDot, When } from "../components/ui";
import { Tile } from "./DeskDetail";

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
        <h1 className="text-xl font-medium"><Addr value={s.strategy_hash} chars={10} /></h1>
        <StatusDot status={s.status} />
        <ChainChip chain={c} />
        <span className="chip" title={s.instructions ? s.instructions.join(" > ") : s.template}>{s.template_name ?? `template ${shortAddr(s.template, 8, 4)}`}</span>
        <RegistryChip registry={s.registry} />
      </div>
      <p className="text-ink-muted text-[13px] mt-2">
        Shipped <When ts={s.shipped_at} /> by <Link to={`/desk/${chain}/${encodeURIComponent(s.desk)}`} className="mono text-ink">{shortAddr(s.maker)}</Link> through {s.app_label ? <span title={s.app}>{s.app_label}</span> : <>router <span className="mono" title={s.app}>{shortAddr(s.app)}</span></>}
        {s.docked_at ? <>, docked <When ts={s.docked_at} />. Docked means revoked: tokens never left the wallet.</> : <>. Still live.</>}
      </p>

      {st ? (
        <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="panel px-4 py-3"><div className="text-xs text-ink-muted">Economic fills</div><div className="text-lg mt-0.5">{compact(st.fills, 0)}</div><div className="text-xs text-ink-faint">first <When ts={st.first_fill_ts} />, last <When ts={st.last_fill_ts} /></div></div>
          <Tile label="Volume" p={st.volume_usd} />
          <Tile label="Edge at fill time" p={st.edge_usd} signed colored sub={bps(st.edge_usd.value, st.volume_usd.value)} />
          <Tile label="Markout, 1 hour" p={st.markout_1h_usd} signed colored />
          <Tile label="Position at latest prices" p={st.pnl_usd_marked} signed colored />
        </div>
      ) : <p className="mt-5 text-ink-muted">No economic fills yet, so nothing to score.</p>}

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

      <Section title="Program">
        <div className="panel px-5 py-4 text-[13px]">
          <p>{bytes} bytes of SwapVM bytecode, {s.parsed ? <span className="chip">parsed</span> : <span className="chip warn">not parsed</span>}{s.instructions && <>: <span className="mono text-ink-muted">{s.instructions.join(" > ")}</span></>}. Declared starting inventory: {s.tokens.length === 0 ? "none" : s.tokens.map((t, i) => <span key={t} className="mono">{i > 0 ? ", " : ""}{shortAddr(t)} × {compact(Number(s.amounts[i]), 3)} raw</span>)}.</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-ink-muted">Raw bytes</summary>
            <pre className="mono text-xs mt-2 whitespace-pre-wrap break-all text-ink-muted">{s.program}</pre>
          </details>
        </div>
      </Section>

      <Section title="Economic fills" aside={`${s.fills.length} of ${s.fills_total}, newest first`}>
        <div className="panel divide-y divide-water-700">
          {s.fills.map((f) => (
            <div key={f.id} className="px-4 py-2.5 text-[13px] flex items-center gap-3 flex-wrap">
              {f.legs && <LegsSentence legs={f.legs} />}
              <span className="text-ink-faint">edge <Money p={f.edge_usd} signed colored /></span>
              <span className="text-ink-faint">1 h later <Money p={f.markout_1h_usd} signed colored pending={Date.now() / 1000 - f.ts < 3600} /></span>
              {f.taker && <span className="text-ink-faint">taker <span className="mono">{shortAddr(f.taker)}</span></span>}
              <When ts={f.ts} className="text-ink-faint ml-auto" />
            </div>
          ))}
          {s.fills.length === 0 && <div className="px-4 py-3 text-ink-muted">No economic fills yet.</div>}
          {s.fills.length < s.fills_total && <button onClick={() => setLimit((n) => n + 100)} className="w-full py-2.5 text-[13px] text-bronze hover:bg-water-800">Show more, {s.fills.length} of {s.fills_total}</button>}
        </div>
      </Section>
      <Provenance at={st?.volume_usd.at ?? new Date().toISOString()} />
    </div>
  );
}
