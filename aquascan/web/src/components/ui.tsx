import { Link } from "react-router-dom";
import type { Chain, DeskPair, MakerTemplate, Priced } from "../lib/api";
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
  return <span><Money p={edge} signed />{b && <span className="band">{b}</span>}</span>;
}

export function When({ ts, className = "" }: { ts: number | null | undefined; className?: string }) {
  return <span className={className} title={absTime(ts)}>{relTime(ts)}</span>;
}

// A maker in a table: who and where on the first line, what it trades on the second, its templates in faint.
export function MakerLink({ chain, maker, makerLabel, templates, pairs, className = "" }: { chain: Chain; maker: string; makerLabel?: string | null; templates?: MakerTemplate[]; pairs?: DeskPair[]; className?: string }) {
  const kinds = (templates ?? []).map((t) => t.name ?? "unnamed template");
  return (
    <Link to={`/maker/${chain}/${maker}`} className={`desk-cell ${className}`}>
      <span className="desk-who">
        {makerLabel ? <span className="font-medium">{makerLabel}</span> : <span className="mono">{shortAddr(maker)}</span>}
        <ChainChip chain={chain} />
      </span>
      {pairs && <span className="desk-what"><Pairs pairs={pairs} /></span>}
      {kinds.length > 0 && <span className="desk-kind" title={kinds.join("; ")}>{kinds.slice(0, 2).join("; ")}{kinds.length > 2 ? ` and ${kinds.length - 2} more` : ""}</span>}
    </Link>
  );
}

export function ThemeToggle() {
  const current = document.documentElement.dataset.theme ?? "light";
  const flip = () => {
    const next = (document.documentElement.dataset.theme ?? "light") === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("aquascan-theme", next); } catch { /* private mode */ }
  };
  const label = current === "dark" ? "Switch to the light theme" : "Switch to the dark theme";
  return (
    <button onClick={flip} className="icon-button" aria-label={label} title={label}>
      {current === "dark"
        ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>}
      <span>{current === "dark" ? "Light theme" : "Dark theme"}</span>
    </button>
  );
}

// Every page opens the same way: what it is, in one sentence, and its controls on the right.
export function PageHeader({ title, description, children }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {children && <div className="page-controls">{children}</div>}
    </div>
  );
}

// One control for every choice among a few values: window, chain, sort.
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([k, text]) => <button key={k} type="button" onClick={() => onChange(k)} className={k === value ? "on" : ""} aria-pressed={k === value}>{text}</button>)}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <div className="loading" role="status">Loading {what}…</div>;
}

export function Failed({ what, error }: { what: string; error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="panel p-5 text-ink-muted">Could not load {what}. {msg === "not found" ? "Nothing here by that name." : `The API answered: ${msg}. Check that the enrichment service and API are running.`}</div>;
}

export function Section({ title, aside, description, children }: { title: string; aside?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description && <p className="section-desc">{description}</p>}
        </div>
        {aside && <div className="section-aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Windows({ value, onChange }: { value: string; onChange: (w: string) => void }) {
  return <Segmented value={value} onChange={onChange} label="Window" options={[["24h", "24h"], ["7d", "7d"], ["30d", "30d"], ["all", "all time"]]} />;
}

export function Provenance({ at, extra }: { at: string; extra?: string }) {
  const d = new Date(at);
  return <footer className="provenance">Chain data from six subgraphs on The Graph Network. Reference prices are the venue's own fills by the minute, or the pair's deepest pool on the same chain when the tape is thin; DefiLlama's hourly prices turn them into dollars and stand in where neither exists. Rolled up {relTime(d.getTime() / 1000)}. Only economic fills count.{extra ? ` ${extra}` : ""} <Link to="/status">Status</Link></footer>;
}

// What a maker trades: its top pairs by volume, each with its share of the maker's priced volume.
export function Pairs({ pairs, max = 2, className = "" }: { pairs?: DeskPair[]; max?: number; className?: string }) {
  if (!pairs || pairs.length === 0) return <span className={`text-ink-faint ${className}`}>no two-sided fills</span>;
  const shown = pairs.slice(0, max); const rest = pairs.length - shown.length;
  return (
    <span className={`pairs ${className}`}>
      {shown.map((p) => <span key={p.base_token + p.quote_token} title={`${p.fills} fills`}><span className="pair">{p.base_symbol ?? p.base_token.slice(0, 6)}/{p.quote_symbol ?? p.quote_token.slice(0, 6)}</span><span className="share">{Math.round(p.share * 100)}%</span></span>)}
      {rest > 0 && <span className="share">+{rest}</span>}
    </span>
  );
}
