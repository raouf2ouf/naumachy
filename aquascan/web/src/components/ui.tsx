import { Link } from "react-router-dom";
import type { Chain, Priced } from "../lib/api";
import { CHAIN_HUE, CHAIN_NAME, REGISTRY_CANONICAL, absTime, bps, relTime, shortAddr, usd } from "../lib/format";

export function ChainChip({ chain }: { chain: Chain }) {
  return <span className="chip"><span className="dot" style={{ background: CHAIN_HUE[chain] }} />{CHAIN_NAME[chain]}</span>;
}

export function StatusDot({ status }: { status: string }) {
  const live = status === "LIVE";
  return <span className="inline-flex items-center gap-1.5 text-ink-muted"><span className="dot" style={{ background: live ? "var(--color-gain)" : "var(--color-ink-faint)" }} />{live ? "live" : "docked"}</span>;
}

export function RegistryChip({ registry }: { registry: string }) {
  return registry.toLowerCase() === REGISTRY_CANONICAL ? null : <span className="chip warn">legacy registry</span>;
}

export function Addr({ value, chars = 6, className = "" }: { value: string; chars?: number; className?: string }) {
  const copy = () => { void navigator.clipboard?.writeText(value); };
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <span className="mono" title={value}>{shortAddr(value, chars, 4)}</span>
      <button onClick={copy} aria-label="copy address" title="copy" className="text-ink-faint hover:text-bronze text-[11px] leading-none">⧉</button>
    </span>
  );
}

// A priced number never appears alone: unpriced stays a word, a partial price gets a tilde and its coverage.
export function Money({ p, signed = false, colored = false, pending = false, className = "" }: { p: Priced; signed?: boolean; colored?: boolean; pending?: boolean; className?: string }) {
  if (p.value === null && pending) return <span className={`text-ink-faint ${className}`} title="the reference hour has not passed yet">pending</span>;
  if (p.value === null) return <span className={`text-ink-faint ${className}`} title="no acceptable price for at least one leg">unpriced</span>;
  const partial = p.confidence < 0.995;
  const tone = colored ? (p.value > 0 ? "gain" : p.value < 0 ? "loss" : "") : "";
  return (
    <span className={`${tone} ${className}`} title={`${p.source}, as of ${p.at.replace("T", " ").slice(0, 16)} UTC, ${Math.round(p.confidence * 100)}% of fills priced`}>
      {partial ? "~" : ""}{usd(p.value, signed)}
      {partial && <span className="chip ml-1.5">priced {Math.round(p.confidence * 100)}%</span>}
    </span>
  );
}

export function EdgeCell({ edge, volume }: { edge: Priced; volume: Priced }) {
  const b = bps(edge.value, volume.value);
  return <span><Money p={edge} signed colored />{b && <span className="text-ink-faint ml-1.5 text-xs">{b}</span>}</span>;
}

export function When({ ts, className = "" }: { ts: number | null | undefined; className?: string }) {
  return <span className={className} title={absTime(ts)}>{relTime(ts)}</span>;
}

export function DeskLink({ chain, desk, maker, makerLabel, templateName, className = "" }: { chain: Chain; desk: string; maker: string; makerLabel?: string | null; templateName?: string | null; className?: string }) {
  return (
    <Link to={`/desk/${chain}/${encodeURIComponent(desk)}`} className={`inline-flex items-center gap-2 ${className}`}>
      {makerLabel ? <span className="font-medium">{makerLabel}</span> : <span className="mono">{shortAddr(maker)}</span>}
      <ChainChip chain={chain} />
      {templateName && <span className="text-ink-muted text-xs">{templateName}</span>}
    </Link>
  );
}

export function ThemeToggle() {
  const current = document.documentElement.dataset.theme ?? "dark";
  const flip = () => {
    const next = (document.documentElement.dataset.theme ?? "dark") === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("aquascan-theme", next); } catch { /* private mode */ }
  };
  return <button onClick={flip} className="text-xs text-ink-muted hover:text-ink">{current === "dark" ? "Light theme" : "Dark theme"}</button>;
}

export function Loading({ what }: { what: string }) {
  return <div className="text-ink-muted py-10 text-center">Loading {what}…</div>;
}

export function Failed({ what, error }: { what: string; error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="panel p-5 text-ink-muted">Could not load {what}. {msg === "not found" ? "Nothing here by that name." : `The API answered: ${msg}. Check that the enrichment service and API are running.`}</div>;
}

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[15px] font-medium">{title}</h2>
        {aside && <div className="text-xs text-ink-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Windows({ value, onChange }: { value: string; onChange: (w: string) => void }) {
  return (
    <div className="inline-flex gap-1 text-xs">
      {["24h", "7d", "30d", "all"].map((w) => (
        <button key={w} onClick={() => onChange(w)} className={`px-2 py-0.5 rounded ${w === value ? "bg-water-600 text-ink" : "text-ink-muted hover:text-ink"}`}>{w === "all" ? "all time" : w}</button>
      ))}
    </div>
  );
}

export function Provenance({ at, extra }: { at: string; extra?: string }) {
  const d = new Date(at);
  return <footer className="mt-12 pt-4 border-t border-water-700 text-xs text-ink-faint">Chain data from six subgraphs on The Graph Network. Dollar prices from DefiLlama, hourly. Rolled up {relTime(d.getTime() / 1000)}. Only economic fills count.{extra ? ` ${extra}` : ""} <Link to="/status" className="text-ink-muted">Status</Link></footer>;
}
