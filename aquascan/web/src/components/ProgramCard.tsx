import { useEffect, useRef, useState } from "react";
import type { CardInstruction, Curve, ProgramCard as Card } from "../lib/api";
import { compact } from "../lib/format";

// A program as a reader sees it: the instructions in the order they run, each with its arguments
// said in words; a jump points at the byte it lands on; a middleware instruction says that the rest
// of the program runs inside it. Below, for the curve families, the price the program would quote.

const ROLE_LABEL: Record<CardInstruction["role"], string> = {
  gate: "gate", branch: "branch", fee: "fee", curve: "curve", balances: "balances", guard: "guard", time: "clock", salt: "salt", other: "",
};

function price(p: number | null, sym: string | null) {
  if (p === null) return "";
  const digits = p >= 1000 ? 0 : p >= 10 ? 2 : p >= 0.1 ? 4 : 6;
  return `${p.toLocaleString("en-US", { maximumFractionDigits: digits })}${sym ? ` ${sym}` : ""}`;
}

export function ProgramCard({ card, bytes }: { card: Card; bytes: number }) {
  return (
    <div className="panel">
      <div className="px-5 py-3 text-xs text-ink-muted border-b border-water-700 flex items-center gap-3 flex-wrap">
        <span>{card.dialect ?? "unknown router"}</span>
        <span>{card.instructions.length} instruction{card.instructions.length === 1 ? "" : "s"}, {bytes} bytes</span>
        {!card.parsed && <span className="chip warn">not fully parsed</span>}
      </div>
      <ol className="card">
        {card.instructions.map((i, n) => (
          <li key={i.at} className={`card-row ${i.role}`}>
            <span className="card-at mono">{i.landing ? "▸" : ""}@{i.at}</span>
            <span className="card-role">{ROLE_LABEL[i.role]}</span>
            <span className="card-body">
              <span className="card-name">{i.name}</span>
              {i.text && <span className="card-text">{i.text}</span>}
              {(i.wraps || i.target !== undefined) && (
                <span className="card-note">
                  {i.wraps && <span>everything below runs inside this one, then it finishes</span>}
                  {i.target !== undefined && <span>lands on @{i.target}{card.instructions.find((x) => x.at === i.target) ? "" : ", past the end"}</span>}
                </span>
              )}
            </span>
            <span className="card-n mono">{n + 1}</span>
          </li>
        ))}
      </ol>
      {card.curve && <CurvePanel c={card.curve} />}
    </div>
  );
}

function sizeLabel(n: number) { return n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n); }

function CurvePanel({ c }: { c: Curve }) {
  const q = c.quote_symbol ?? "quote", b = c.base_symbol ?? "base";
  const pts = c.depth.filter((d) => d.buy !== null || d.sell !== null);
  const canDraw = c.spot !== null && pts.length > 1;
  const at100k = c.depth.find((d) => d.size === 1e5);
  const virtual = (c.base_balance ?? 0) > 1e9 || (c.quote_balance ?? 0) > 1e9;
  return (
    <div className="border-t border-water-700 px-5 py-4">
      <div className="text-xs text-ink-muted">
        {c.kind === "concentrated" ? "Concentrated curve" : c.kind === "xyc" ? "Constant-product curve" : "Fixed rate"}, {b} priced in {q}, from the balances {c.balances_from === "ship" ? "declared when it shipped" : "written in the program"}
      </div>
      <p className="mt-1 text-[13px]">
        {c.spot === null ? <>The balances do not set a price yet.</> : (
          <>Quotes <b className="font-medium">{price(c.spot, q)}</b> per {b}
            {c.kind === "concentrated" && c.min !== null && c.max !== null && <> inside a range of <b className="font-medium">{price(c.min, null)}</b> to <b className="font-medium">{price(c.max, q)}</b></>}.
            {c.base_balance !== null && c.quote_balance !== null && <> Declared depth {compact(c.base_balance, 2)} {b} and {compact(c.quote_balance, 2)} {q}{virtual ? ", far beyond any wallet: the numbers shape the curve, and Aqua caps each fill at what the wallet holds" : ""}.</>}
            {at100k && at100k.buy !== null && c.spot > 0 && <> A taker buying {sizeLabel(1e5)} {q} worth of {b} pays {price(at100k.buy, q)}, {((at100k.buy / c.spot - 1) * 100).toFixed(2)}% above the quote.</>}
          </>
        )}
      </p>
      {canDraw && <CurveChart c={c} />}
    </div>
  );
}

// Depth: the price a taker gets against the size of the trade in quote units, buying base above the
// quote and selling base below it; the range, when the program has one, as a band. The chart is
// drawn at the width it is given, in pixels, so its type stays the size of the page's type; a hover
// reads one size off both lines.
function useWidth(ref: React.RefObject<HTMLDivElement | null>, fallback = 640) {
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(el); setW(Math.max(320, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo; if (span <= 0) return [lo];
  const raw = span / n; const mag = 10 ** Math.floor(Math.log10(raw)); const norm = raw / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = []; for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-12; t += step) out.push(+t.toPrecision(12));
  return out;
}

function CurveChart({ c }: { c: Curve }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref); const H = 230, L = 76, R = 20, T = 22, B = 34;
  const [hover, setHover] = useState<number | null>(null);
  const pts = c.depth;
  const q = c.quote_symbol ?? "quote", b = c.base_symbol ?? "base";
  const prices = pts.flatMap((d) => [d.buy, d.sell]).filter((p): p is number => p !== null).concat(c.spot !== null ? [c.spot] : [], c.min !== null ? [c.min] : [], c.max !== null ? [c.max] : []);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo) { lo *= 0.98; hi *= 1.02; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const sizes = pts.map((d) => d.size); const lmin = Math.log10(Math.min(...sizes)), lmax = Math.log10(Math.max(...sizes));
  const x = (size: number) => L + ((Math.log10(size) - lmin) / (lmax - lmin || 1)) * (W - L - R);
  const y = (p: number) => T + (1 - (p - lo) / (hi - lo)) * (H - T - B);
  const line = (key: "buy" | "sell") => pts.filter((d) => d[key] !== null).map((d, i) => `${i ? "L" : "M"}${x(d.size).toFixed(1)},${y(d[key] as number).toFixed(1)}`).join(" ");
  const ticks = niceTicks(lo + pad * 0.5, hi - pad * 0.5);
  const last = pts.filter((d) => d.buy !== null || d.sell !== null).at(-1);
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect(); const px = e.clientX - rect.left;
    let best = 0, dist = Infinity; sizes.forEach((sz, i) => { const d = Math.abs(x(sz) - px); if (d < dist) { dist = d; best = i; } });
    setHover(best);
  };
  const h = hover !== null ? pts[hover] : null;
  const rel = (p: number | null) => (p === null || c.spot === null || c.spot === 0 ? null : ((p / c.spot - 1) * 100));
  const fmtRel = (r: number | null) => (r === null ? "" : `${r > 0 ? "+" : ""}${r.toFixed(2)}%`);
  return (
    <div ref={ref} className="relative mt-3 select-none" style={{ height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="curve block" role="img" aria-label={`price of ${b} in ${q} against trade size`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {c.min !== null && c.max !== null && <rect x={L} y={y(c.max)} width={W - L - R} height={Math.max(0, y(c.min) - y(c.max))} className="curve-range" />}
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="curve-grid" /><text x={L - 8} y={y(t) + 3.5} textAnchor="end" className="curve-tick">{price(t, null)}</text></g>)}
        {sizes.map((s, i) => <g key={s}><line x1={x(s)} x2={x(s)} y1={H - B} y2={H - B + 4} className="curve-grid" /><text x={x(s)} y={H - 12} textAnchor={i === 0 ? "start" : i === sizes.length - 1 ? "end" : "middle"} className="curve-tick">{sizeLabel(s)} {q}</text></g>)}
        {c.spot !== null && <g><line x1={L} x2={W - R} y1={y(c.spot)} y2={y(c.spot)} className="curve-spot" /><text x={L + 6} y={y(c.spot) - 5} className="curve-tick">quote {price(c.spot, q)}</text></g>}
        <path d={line("buy")} className="curve-line" />
        <path d={line("sell")} className="curve-line sell" />
        {pts.map((d) => <g key={d.size}>{d.buy !== null && <circle cx={x(d.size)} cy={y(d.buy)} r={2.5} className="curve-dot" />}{d.sell !== null && <circle cx={x(d.size)} cy={y(d.sell)} r={2.5} className="curve-dot sell" />}</g>)}
        {last && last.buy !== null && <text x={x(last.size) - 8} y={y(last.buy) - 6} textAnchor="end" className="curve-label">taker buys {b}</text>}
        {last && last.sell !== null && <text x={x(last.size) - 8} y={y(last.sell) + 14} textAnchor="end" className="curve-label">taker sells {b}</text>}
        {c.min !== null && <text x={W - R} y={y(c.min) + 12} textAnchor="end" className="curve-tick">range floor {price(c.min, q)}</text>}
        {c.max !== null && <text x={W - R} y={y(c.max) - 5} textAnchor="end" className="curve-tick">range cap {price(c.max, q)}</text>}
        {h && <g><line x1={x(h.size)} x2={x(h.size)} y1={T} y2={H - B} className="curve-cursor" />{h.buy !== null && <circle cx={x(h.size)} cy={y(h.buy)} r={4.5} className="curve-hot" />}{h.sell !== null && <circle cx={x(h.size)} cy={y(h.sell)} r={4.5} className="curve-hot" />}</g>}
      </svg>
      {h && (
        <div className="curve-tip" style={{ left: Math.min(W - 230, Math.max(L, x(h.size) + 10)), top: T }}>
          <div className="t">{sizeLabel(h.size)} {q} of {b}</div>
          {h.buy !== null && <div><span className="k">taker buys at</span><span className="v">{price(h.buy, q)}</span><span className="r">{fmtRel(rel(h.buy))}</span></div>}
          {h.sell !== null && <div><span className="k">taker sells at</span><span className="v">{price(h.sell, q)}</span><span className="r">{fmtRel(rel(h.sell))}</span></div>}
          {c.spot !== null && <div className="s">against the quote of {price(c.spot, q)}</div>}
        </div>
      )}
    </div>
  );
}
