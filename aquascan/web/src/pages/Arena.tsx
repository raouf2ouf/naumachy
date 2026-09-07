import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type ArenaEntry, type ArenaGeneration, type Knobs } from "../lib/api";
import { absTime, bandText, relTime, shortAddr, usd } from "../lib/format";
import { Failed, Loading, Provenance, Section } from "../components/ui";

export const MIND_LABEL: Record<string, string> = { heuristic: "control", seed: "seed", briefing: "mind", "tools-local": "mind, read the gym", "tools-mcp": "mind, read The Graph", unknown: "" };

export function MindChip({ mind }: { mind: string | null }) {
  if (!mind || !MIND_LABEL[mind]) return null;
  const isMind = mind.startsWith("tools") || mind === "briefing";
  return <span className={`text-[11px] px-1.5 py-0.5 rounded ${isMind ? "bg-water-700 text-bronze" : "bg-water-800 text-ink-muted"}`}>{MIND_LABEL[mind]}</span>;
}

export function KnobCells({ k, parent }: { k: Knobs | null; parent?: Knobs | null }) {
  const cell = (key: keyof Knobs, fmt: (v: number) => string) => {
    if (!k) return <td className="num text-ink-faint">-</td>;
    const v = k[key] as number; const changed = parent && parent[key] !== undefined && parent[key] !== v;
    return <td className={`num ${changed ? "text-bronze" : ""}`} title={changed ? `was ${fmt(parent![key] as number)}` : undefined}>{fmt(v)}</td>;
  };
  return (<>
    {cell("feeBaseBps", (v) => `${v} bps`)}{cell("feeSlopeBps", (v) => `${v}`)}{cell("feeMaxBps", (v) => `${v} bps`)}{cell("windowSeconds", (v) => `${v} s`)}{cell("depth", (v) => `${v}×`)}{cell("capBps", (v) => `${v / 100}%`)}
  </>);
}

export function AttestedCell({ e }: { e: ArenaEntry }) {
  if (!e.attested) return <span className="text-ink-faint">not yet</span>;
  return <span className={e.attested.score_usd > 0 ? "gain" : e.attested.score_usd < 0 ? "loss" : ""}>{usd(e.attested.score_usd, true)}<span className="text-ink-faint text-xs"> ± {usd(e.attested.se_usd).replace("$", "")} on {e.attested.fills} fills</span></span>;
}
export function LiveCell({ e }: { e: ArenaEntry }) {
  if (!e.live || !e.live.markout_5m_bps) return <span className="text-ink-faint">no fills marked</span>;
  const b = e.live.markout_5m_bps;
  return <span className={b.bps > 0 ? "gain" : b.bps < 0 ? "loss" : ""}>{bandText(b)}<span className="text-ink-faint text-xs"> on {e.live.fills} fills</span></span>;
}

function GenerationPanel({ g }: { g: ArenaGeneration }) {
  return (
    <div className="panel overflow-x-auto">
      <div className="flex items-baseline justify-between gap-4 flex-wrap px-4 pt-3 pb-2">
        <div className="text-[14px]">
          <Link to={`/arena/${g.number}`} className="font-medium text-bronze">Generation {g.number}</Link>
          <span className="text-ink-muted ml-2 text-xs">{g.closed_at === null ? `open since ${relTime(g.opened_at)}` : `closed ${relTime(g.closed_at)}`} · tape {shortAddr(g.tape, 6, 4)}</span>
        </div>
        <div className="text-xs text-ink-muted">{g.champion ? <>champion <b className="text-ink font-medium">{g.champion.name ?? shortAddr(g.champion.address)}</b>{g.champion.score_usd !== null && <> with {usd(g.champion.score_usd, true)} of 5-minute markout</>}</> : g.closed_at === null ? "the engine is trading them" : "closed without a champion"}</div>
      </div>
      <table>
        <thead><tr><th>Gladiator</th><th>Mind</th><th className="num">Fee at rest</th><th className="num">Slope</th><th className="num">Ceiling</th><th className="num">Window</th><th className="num">Depth</th><th className="num">Cap</th><th className="num">Attested score</th><th className="num">Live, 5 min after fill</th></tr></thead>
        <tbody>
          {g.entries.map((e) => (
            <tr key={e.strategy_hash} className={e.champion ? "bg-water-800/60" : ""}>
              <td>
                <span className={e.champion ? "text-bronze font-medium" : ""}>{e.name ?? shortAddr(e.gladiator)}</span>{e.champion && <span className="text-[11px] text-bronze ml-1.5">champion</span>}
                {e.parent_choice && e.parent_choice.toLowerCase() !== e.gladiator.toLowerCase() && <span className="block text-[11px] text-ink-faint">mutates {g.entries.find((x) => x.gladiator.toLowerCase() === e.parent_choice!.toLowerCase())?.name ?? shortAddr(e.parent_choice)}</span>}
                {e.strategy_id && <Link to={`/strategy/base/${encodeURIComponent(e.strategy_id)}`} className="block text-[11px] text-ink-faint mono hover:text-ink">{shortAddr(e.strategy_hash, 8, 4)}</Link>}
              </td>
              <td><MindChip mind={e.mind} /></td>
              <KnobCells k={e.knobs} />
              <td className="num"><AttestedCell e={e} /></td>
              <td className="num"><LiveCell e={e} /></td>
            </tr>
          ))}
          {g.entries.length === 0 && <tr><td colSpan={10} className="text-ink-muted">Nobody entered.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Arena() {
  const q = useQuery({ queryKey: ["arena"], queryFn: () => api.arena(), refetchInterval: 30_000 });
  return (
    <div className="fade">
      <h1 className="text-xl font-medium">Arena</h1>
      <p className="text-ink-muted text-[13px] mt-1 max-w-2xl">Gladiators are market-making programs written by an AI, shipped to Aqua from their own wallets and fought in generations. Each generation the lanista opens the floor, every gladiator writes its next program inside the archetype, the taker engine trades them, and Aquascan scores each program by the sum of its 5-minute markouts in the quote token. The lanista attests the scores on chain and crowns a champion; losers read the champion's program and mutate. A control line with no mind runs beside them so the mind's worth can be measured.</p>
      {q.isPending ? <Loading what="the arena" /> : q.isError ? <Failed what="the arena" error={q.error} /> : !q.data.configured ? <p className="mt-6 text-ink-muted text-[13px]">This Aquascan is not pointed at an arena registry.</p> : (
        <>
          <Section title="Gladiators" aside={`${q.data.gladiators.length} registered`}>
            <div className="flex flex-wrap gap-2">
              {q.data.gladiators.map((x) => (
                <div key={x.address} className="panel px-3 py-2 text-[13px]">
                  <div><span className="font-medium">{x.name ?? shortAddr(x.address)}</span> <span className="text-ink-faint text-xs mono">{shortAddr(x.address)}</span></div>
                  <div className="text-xs text-ink-muted">born in generation {x.generation_born}{x.parent ? `, child of ${x.parent.name ?? shortAddr(x.parent.address)}` : ""} · {x.entries} entries · {x.wins} {x.wins === 1 ? "win" : "wins"}</div>
                </div>
              ))}
            </div>
          </Section>
          <Section title="Generations" aside={`${q.data.generations.length} so far, newest first`}>
            <div className="flex flex-col gap-4">{q.data.generations.map((g) => <GenerationPanel key={g.number} g={g} />)}</div>
          </Section>
          {q.data.promotions.length > 0 && (
            <Section title="Promotions" aside="a real bankroll, moved after a tap on the Ledger">
              <ul className="text-[13px]">{q.data.promotions.map((p) => <li key={p.tx}>{p.name ?? shortAddr(p.gladiator)} promoted to chain {p.chain_id} with a bankroll of {p.bankroll}, {absTime(p.at)}</li>)}</ul>
            </Section>
          )}
          <Provenance at={q.data.rollup_at ?? new Date().toISOString()} extra="The arena itself comes from the ArenaRegistry subgraph; the scores it shows are the ones the lanista attested on chain, beside Aquascan's live figures, which keep moving while a program stays shipped." />
        </>
      )}
    </div>
  );
}
