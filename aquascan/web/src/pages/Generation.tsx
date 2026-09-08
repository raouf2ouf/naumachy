import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type GenerationEntry, type Knobs, type ToolRead } from "../lib/api";
import { absTime, shortAddr, usd } from "../lib/format";
import { Failed, Loading, Provenance, Section } from "../components/ui";
import { AttestedCell, LiveCell, MindChip } from "./Arena";

const KNOB_LABEL: [keyof Knobs, string, (v: number) => string][] = [
  ["feeBaseBps", "fee at rest", (v) => `${v} bps`], ["feeSlopeBps", "slope per drained balance", (v) => `${v} bps`], ["feeMaxBps", "fee ceiling", (v) => `${v} bps`],
  ["windowSeconds", "flow memory", (v) => `${v} s`], ["depth", "virtual depth", (v) => `${v}× the balance`], ["capBps", "largest fill", (v) => `${v / 100}% of a balance`],
];

function Read({ r }: { r: ToolRead }) {
  const i = r.input as { subgraph?: string; query?: string; path?: string };
  const what = r.tool === "get_schema" ? `schema of ${i.subgraph}` : r.tool === "query_subgraph" ? `${i.subgraph}: ${(i.query ?? "").replace(/\s+/g, " ").slice(0, 110)}` : r.tool === "aquascan" ? `aquascan ${i.path}` : r.tool.startsWith("mcp:") ? `${r.tool.slice(4)} ${JSON.stringify(r.input).slice(0, 100)}` : JSON.stringify(r.input).slice(0, 100);
  return <li className="text-xs text-ink-muted mono truncate" title={JSON.stringify(r.input)}>{what}{r.chars ? <span className="text-ink-faint"> · {r.chars} chars</span> : null}</li>;
}

function EntryCard({ e, closed, generation, names }: { e: GenerationEntry; closed: boolean; generation: number; names: Record<string, string> }) {
  const parent = e.parent_line?.knobs ?? null;
  const who = (a: string) => names[a.toLowerCase()] ?? shortAddr(a);
  const parentName = e.parent_line ? (e.parent_line.address.toLowerCase() === e.gladiator.toLowerCase() ? "its own program" : `${who(e.parent_line.address)}'s program`) + ` of generation ${e.parent_line.generation}` : null;
  // the draft's prices per pair: the new files carry them per pair name, the first files WETH/USDC only
  const draftPairs: [string, { sell: number; buy: number }][] = e.draft?.pairs ? Object.entries(e.draft.pairs)
    : e.draft?.usdcFor1Weth ? [["WETH/USDC", { sell: Number(e.draft.usdcFor1Weth) / 1e6, buy: 1e21 / Number(e.draft.wethFor1000Usdc) }]] : [];
  const loop = e.draft?.loop ?? null;
  return (
    <div className={`panel px-4 py-3 ${e.champion ? "border-bronze-deep" : ""}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[15px]"><span className={`font-medium ${e.champion ? "text-bronze" : ""}`}>{e.name ?? shortAddr(e.gladiator)}</span>{e.champion && <span className="text-[11px] text-bronze ml-2">champion</span>} <MindChip mind={e.mind} /></div>
        <div className="text-xs text-ink-muted">attested <AttestedCell e={e} /> · live <LiveCell e={e} /></div>
      </div>
      <div className="mt-3 grid md:grid-cols-[1fr_1fr] gap-x-8 gap-y-3">
        <div>
          <table className="w-full">
            <thead><tr><th>Knob</th><th className="num">This program</th><th className="num">{parentName ? "Parent line" : ""}</th></tr></thead>
            <tbody>
              {KNOB_LABEL.map(([key, label, fmt]) => {
                const v = e.knobs?.[key] as number | undefined; const p = parent?.[key] as number | undefined; const changed = v !== undefined && p !== undefined && v !== p;
                return <tr key={key}><td className="text-ink-muted">{label}</td><td className={`num ${changed ? "text-bronze" : ""}`}>{v === undefined ? "-" : fmt(v)}</td><td className="num text-ink-faint">{p === undefined ? "" : fmt(p)}</td></tr>;
              })}
            </tbody>
          </table>
          {parentName && <p className="text-xs text-ink-faint mt-1.5">Compared with {parentName}; changed knobs in bronze.</p>}
          {e.listing && e.listing.length > 0 && (
            <div className="mt-3">
              <div className="text-xs text-ink-muted mb-1">The program, as compiled{e.pairs && e.pairs.length ? ` (${e.pairs.join(", ")})` : ""}</div>
              <pre className="text-[11px] mono leading-relaxed whitespace-pre overflow-x-auto bg-ink/5 rounded px-2 py-1.5">{e.listing.join("\n")}</pre>
            </div>
          )}
          {draftPairs.length > 0 && <p className="text-xs text-ink-muted mt-2">Before shipping, on a private fork of the gym, this draft priced {draftPairs.map(([name, px]) => `${name} at ${px.sell.toFixed(2)} selling and ${px.buy.toFixed(2)} buying`).join("; ")}.{loop ? ` A 50 USDC loop through its three pairs came back as ${loop.usdcOut.toFixed(2)} USDC.` : ""}</p>}
          {e.rejected && e.rejected.length > 0 && <p className="text-xs text-ink-faint mt-1">{e.rejected.length === 1 ? "One draft was refused first" : `${e.rejected.length} drafts were refused first`}: {e.rejected.map((r) => r.split(":")[0]).join("; ")}.</p>}
        </div>
        <div>
          {closed ? (
            <>
              <p className="text-[13px]">{e.rationale ?? <span className="text-ink-faint">No rationale was recorded.</span>}</p>
              {e.transcript.length > 0 && <div className="mt-3"><div className="text-xs text-ink-muted mb-1">What it read first, in order</div><ol className="list-decimal list-inside">{e.transcript.map((r, i) => <Read key={i} r={r} />)}</ol></div>}
            </>
          ) : <p className="text-[13px] text-ink-faint">The rationale stays private until the generation closes.</p>}
          <div className="mt-3 text-xs text-ink-muted">
            {e.strategy_id ? <Link to={`/strategy/base/${encodeURIComponent(e.strategy_id)}`} className="text-ink hover:text-bronze">Every fill of this program, scored</Link> : "Aquascan has not indexed this program yet"}
            <span className="mono text-ink-faint ml-2">{shortAddr(e.strategy_hash, 10, 6)}</span>
            {generation > 0 && e.parent_line && <Link to={`/arena/${e.parent_line.generation}`} className="ml-2 hover:text-ink">generation {e.parent_line.generation}</Link>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Generation() {
  const { number = "" } = useParams();
  const n = Number(number);
  const q = useQuery({ queryKey: ["generation", n], queryFn: () => api.generation(n), refetchInterval: 30_000 });
  return (
    <div className="fade">
      <div className="text-xs text-ink-muted"><Link to="/arena" className="hover:text-ink">Arena</Link> / generation {n}</div>
      {q.isPending ? <Loading what="the generation" /> : q.isError ? <Failed what="the generation" error={q.error} /> : (
        <>
          <h1 className="text-xl font-medium mt-1">Generation {q.data.number}</h1>
          <p className="text-ink-muted text-[13px] mt-1">Opened {absTime(q.data.opened_at)}{q.data.closed_at !== null ? `, closed ${absTime(q.data.closed_at)}` : ", still open"} · tape <span className="mono">{shortAddr(q.data.tape, 8, 6)}</span>{q.data.champion && <> · champion <b className="text-ink font-medium">{q.data.champion.name ?? shortAddr(q.data.champion.address)}</b>{q.data.champion.score_usd !== null && ` with ${usd(q.data.champion.score_usd, true)}`}</>}</p>
          <Section title="Programs" aside={`${q.data.entries.length} entered`}>
            <div className="flex flex-col gap-4">{q.data.entries.map((e) => <EntryCard key={e.strategy_hash} e={e} closed={q.data.closed_at !== null} generation={q.data.number} names={Object.fromEntries(q.data.entries.filter((x) => x.name).map((x) => [x.gladiator.toLowerCase(), x.name as string]))} />)}</div>
          </Section>
          <Provenance at={q.data.rollup_at} extra="Knobs, rationales and reads come from the gladiators' own generation files; the attested score is what the lanista wrote on chain." />
        </>
      )}
    </div>
  );
}
