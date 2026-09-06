import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type Chain, type Priced } from "../lib/api";
import { bps, compact, percent, shortAddr } from "../lib/format";
import { Addr, ChainChip, EdgeCell, Failed, Loading, Money, Provenance, RegistryChip, Section, StatusDot, When } from "../components/ui";

export function Tile({ label, p, signed, colored, sub }: { label: string; p: Priced; signed?: boolean; colored?: boolean; sub?: string | null }) {
  return (
    <div className="panel px-4 py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="text-lg mt-0.5"><Money p={p} signed={signed} colored={colored} /></div>
      {sub && <div className="text-xs text-ink-faint">{sub}</div>}
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
        <h1 className="text-xl font-medium">{d.maker_label ? <span>{d.maker_label} <Addr value={d.maker} chars={6} className="text-base text-ink-muted" /></span> : <Addr value={d.maker} chars={10} />}</h1>
        <ChainChip chain={c} />
        <span className="chip" title={d.instructions ? d.instructions.join(" > ") : d.template}>{d.template_name ?? `template ${shortAddr(d.template, 8, 4)}`}</span>
        <span className="text-ink-muted text-[13px]"><span className="gain">{d.live}</span> live of {d.strategies_total} strategies</span>
      </div>
      <p className="text-ink-muted text-[13px] mt-2">First seen <When ts={d.first_seen} />, last active <When ts={d.last_seen} />.</p>

      <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
        <Tile label="Volume, all time" p={d.volume_usd} />
        <Tile label="Edge at fill time" p={d.edge_usd} signed colored sub={bps(d.edge_usd.value, d.volume_usd.value)} />
        <Tile label="Markout, 1 hour" p={d.markout_1h_usd} signed colored />
        <Tile label="Markout, 1 day" p={d.markout_24h_usd} signed colored />
        <Tile label="Position at latest prices" p={d.pnl_usd_marked} signed colored />
      </div>

      <Section title="Strategies">
        <div className="overflow-x-auto panel">
          <table>
            <thead><tr><th>State</th><th>Strategy</th><th>Shipped</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Edge</th><th className="num">Pair P&L</th><th className="num">Takers</th></tr></thead>
            <tbody>
              {d.strategies.map((s) => (
                <tr key={s.id}>
                  <td><StatusDot status={s.status} /></td>
                  <td><Link to={`/strategy/${chain}/${encodeURIComponent(s.id)}`} className="mono">{shortAddr(s.strategy_hash, 10, 6)}</Link> <RegistryChip registry={s.registry} /></td>
                  <td className="text-ink-muted"><When ts={s.shipped_at} /></td>
                  <td className="num">{compact(s.fills, 0)}</td>
                  <td className="num"><Money p={s.volume_usd} /></td>
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
            <div key={f.id} className="px-4 py-2.5 text-[13px] flex items-center gap-3 flex-wrap">
              <span className="text-ink-muted">{f.shape === "TWO_SIDED" ? "two-sided fill" : f.shape.toLowerCase().replace("_", " ")}</span>
              {f.taker && <span className="text-ink-faint">taken by <span className="mono">{shortAddr(f.taker)}</span></span>}
              <span>volume <Money p={f.volume_usd} /></span>
              <span>edge <Money p={f.edge_usd} signed colored /></span>
              <span>1 h later <Money p={f.markout_1h_usd} signed colored pending={Date.now() / 1000 - f.ts < 3600} /></span>
              <When ts={f.ts} className="text-ink-faint ml-auto" />
            </div>
          ))}
          {d.recent_fills.length === 0 && <div className="px-4 py-3 text-ink-muted">No economic fills yet.</div>}
        </div>
      </Section>
      <Provenance at={d.volume_usd.at} />
    </div>
  );
}
