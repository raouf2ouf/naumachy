import { useEffect, useRef } from "react";
import "./how.css";

// How it is built: the story of Naumachy as a page of the app. Three ways to trade, the vocabulary
// and the one sentence the venue writes, the arena as a running story (four agents putting opcodes
// together, then the evolution), what is new, the partners' circuit, and one prompt that pays the
// champion after a tap on the Flex. The animated parts drive the DOM directly inside this page's
// root, with every timer cleared on unmount; the page is otherwise static and scrolls like any other.

const KINDS: [string, string[]][] = [
  ["gates", ["OnlyTakerTokenBalanceNonZero", "OnlyTakerTokenBalanceGte", "OnlyTakerTokenSupplyShareGte", "OnlyTxOriginTokenBalanceNonZero", "Deadline"]],
  ["curves", ["XYCSwap", "XYCConcentrateSwap", "LimitSwap", "LimitSwapFullAmount", "PeggedSwap", "TWAPSwap"]],
  ["fees", ["FeeFlatIn", "FeeFlatOut", "FeeProgressiveIn", "FeeProgressiveOut", "ProtocolFeeIn", "ProtocolFeeOut", "AquaProtocolFeeIn", "AquaProtocolFeeOut", "DynamicProtocolFeeIn", "AquaDynamicProtocolFeeIn"]],
  ["prices", ["Decay", "RequireMinRate", "AdjustMinRate", "DutchAuctionBalanceIn", "DutchAuctionBalanceOut", "BaseFeeAdjuster"]],
  ["balances", ["StaticBalances", "DynamicBalances", "InvalidateBit", "InvalidateTokenIn", "InvalidateTokenOut"]],
  ["control", ["Jump", "JumpIfTokenIn", "JumpIfTokenOut", "Extruction", "Salt"]],
];
const NEW_WORDS = ["RiskCap", "ToxicityFee", "OracleAnchor"];
const WILD = ["OnlyTxOriginTokenBalanceNonZero", "AquaProtocolFeeIn", "XYCConcentrateSwap", "FeeFlatIn", "XYCSwap", "Salt"];   // the template: gated concentrated AMM, flat fee
const GLADS: [string, string][] = [["steady", "#2f6bff"], ["flat", "#0f9f8f"], ["tight", "#d98a1f"], ["wide", "#8a4fd8"]];
const START = [["OnlyTakerTokenBalanceNonZero", "FeeFlatIn", "XYCConcentrateSwap", "Salt"], ["FeeFlatIn", "XYCSwap", "Salt"], ["OnlyTakerTokenBalanceNonZero", "FeeFlatIn", "XYCSwap", "Salt"], ["FeeFlatIn", "XYCConcentrateSwap", "Salt"]];
const STEPS = ["write", "fight", "score", "read"] as const;
const RING_POS: [number, number][] = [[250, 70], [430, 250], [250, 430], [70, 250]];

type Station = { id: string; x: number; y: number; who: string; partner?: boolean; side?: boolean; step: string; title: string; text: string };
const LOGO: Record<string, string> = { Claude: "claude", "1inch Aqua": "1inch", "The Graph": "thegraph", Ledger: "ledger" };
const STATIONS: Station[] = [
  { id: "mind", x: 150, y: 90, who: "Claude", partner: true, step: "write", title: "The mind writes a program", text: "One call per gladiator per generation. It reads the record and answers in the dialect." },
  { id: "check", x: 450, y: 90, who: "Naumachy", step: "compile, validate", title: "Compiler and validator", text: "RiskCap first, Salt last, bytes emitted; the draft is quoted and looped on a private fork." },
  { id: "ship", x: 750, y: 90, who: "1inch Aqua", partner: true, step: "ship, on Base", title: "Shipped to Aqua through NaumachyRouter", text: "SwapVM v1.0.2 plus ToxicityFee, RiskCap, OracleAnchor. Real inventory, capped." },
  { id: "fill", x: 1050, y: 90, who: "Naumachy", step: "fight", title: "The engine takes the quotes", text: "Uninformed flow, an arbitrage rule, a raider. Every fill is a real transaction." },
  { id: "graph", x: 1050, y: 320, who: "The Graph", partner: true, step: "index", title: "Subgraphs and Substreams", text: "Six chains by subgraph, Robinhood by Substreams, the arena over our registry. One schema." },
  { id: "scan", x: 750, y: 320, who: "Naumachy", step: "score", title: "Aquascan re-prices every fill", text: "Five minutes later, at the pool. Fees on one side, what the fill was worth on the other." },
  { id: "attest", x: 450, y: 320, who: "Naumachy", step: "attest, on Base", title: "The lanista attests on ArenaRegistry", text: "Score and fills per entry on chain. Champion crowned, generation closed." },
  { id: "read", x: 150, y: 320, who: "The Graph", partner: true, step: "read", title: "The record, through the Subgraph MCP", text: "The next mind queries the arena and pools subgraphs while it writes. Aquascan MCP for everyone else." },
  { id: "ring", x: 150, y: 555, who: "Ledger", partner: true, side: true, step: "at boot", title: "Key Ring seals the host", text: "Keys, RPC and API secrets encrypted under the Flex; unsealed headless into tmpfs at boot." },
  { id: "tap", x: 450, y: 555, who: "Ledger", partner: true, side: true, step: "once a season", title: "The tap on the Flex", text: "The prize sits on the operator's Ledger account. One clear-signed transfer, then promote() on the registry." },
];
const WIRES: [string, string][] = [["mind", "check"], ["check", "ship"], ["ship", "fill"], ["fill", "graph"], ["graph", "scan"], ["scan", "attest"], ["attest", "read"], ["read", "mind"]];
const SIDE: [string, string][] = [["ring", "mind"], ["tap", "attest"]];

const rnd = (a: number, b: number) => Math.round(a + Math.random() * (b - a));
const pick = <T,>(arr: T[]) => arr[rnd(0, arr.length - 1)];

function Logo({ who, big = false }: { who: string; big?: boolean }) {
  return <span className={`logo${big ? " big" : ""}`}><img src={`/logos/${LOGO[who]}.svg`} alt="" />{who}</span>;
}

function Dictionary({ used, extra }: { used?: string[]; extra?: Record<string, string[]> }) {
  return (
    <div className="dict">
      {KINDS.map(([kind, words]) => {
        const all = extra?.[kind] ? [...words, ...extra[kind]] : words;
        return (
          <div className="kind" key={kind}><span className="k">{kind}</span>
            <div className="chips">{all.map((w) => <span key={w} className={`chip${extra?.[kind]?.includes(w) ? " new" : ""}${used?.includes(w) ? " used" : ""}`}>{w}</span>)}</div>
          </div>
        );
      })}
    </div>
  );
}

function Sentence({ words, news = [], who }: { words: string[]; news?: string[]; who: string }) {
  return (
    <div className="sentence">
      {words.map((w, i) => (
        <span key={w}>
          {i > 0 && <span className="arrow" style={{ ["--d" as string]: `${0.2 + i * 0.3}s` }}>→</span>}
          <span className={`chip${news.includes(w) ? " new" : ""}`} style={{ ["--d" as string]: `${0.2 + i * 0.3}s` }}>{w}</span>
        </span>
      ))}
      <span className="badge who">{who}</span>
    </div>
  );
}

// The arena story and the circuit both animate the DOM inside the page's root.
function useStory(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = root.current; if (!el) return;
    const $ = <T extends Element = HTMLElement>(sel: string) => el.querySelector<T>(sel);
    const $$ = <T extends Element = HTMLElement>(sel: string) => [...el.querySelectorAll<T>(sel)];
    let timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
    const clearPhase = () => { timers.forEach((t) => { clearTimeout(t); clearInterval(t as unknown as number); }); timers = []; document.querySelectorAll(".hb-fly").forEach((f) => f.remove()); };

    // ---- the arena: four phases per generation, a state machine that can be paused and jumped ----
    let programs = START.map((p) => [...p]);
    const PHASE = 2000; const SEASON = 3;
    const A = { n: 0, phase: -1, auto: true, fills: [] as number[], target: [] as number[], score: [] as number[], champ: -1, evolved: false };
    const glads = () => [0, 1, 2, 3].map((i) => $(`#glad${i}`)!); const tallies = () => [0, 1, 2, 3].map((i) => $(`#tally${i}`)!);
    const chipHTML = (w: string) => `<span class="chip mini${NEW_WORDS.includes(w) ? " new" : ""}">${w}</span>`;
    const write = (i: number, words: string[], delay = 0) => { const s = $(`#sent${i}`)!; s.innerHTML = words.map(chipHTML).join(""); [...s.children].forEach((c, k) => later(() => c.classList.add("in"), delay + k * 180)); };
    const fly = (fromI: number, toI: number, word: string) => {
      const src = [...$(`#sent${fromI}`)!.children].find((c) => c.textContent === word) as HTMLElement | undefined; const dst = $(`#sent${toI}`)!;
      if (!src) return; const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
      const f = document.createElement("span"); f.className = "chip fly hb-fly"; f.textContent = word; f.style.left = `${a.left}px`; f.style.top = `${a.top}px`; el.appendChild(f);
      src.classList.add("hot"); later(() => src.classList.remove("hot"), 900);
      requestAnimationFrame(() => { f.style.left = `${b.left + b.width / 2 - a.width / 2}px`; f.style.top = `${b.bottom - a.height}px`; });
      later(() => { f.style.opacity = "0"; }, 800); later(() => f.remove(), 1100);
    };
    const adopt = (words: string[], w: string) => {
      const out = words.filter((x) => x !== w);
      if (w === "RiskCap") return [w, ...out.filter((x) => x !== "OnlyTakerTokenBalanceNonZero")];
      if (w === "ToxicityFee") { const k = out.indexOf("FeeFlatIn"); if (k >= 0) out[k] = w; else out.splice(Math.max(1, out.length - 2), 0, w); return out; }
      const k = out.findIndex((x) => x.startsWith("XYC")); out.splice(k < 0 ? out.length - 1 : k, 0, w); return out;
    };
    const strength = (words: string[]) => words.filter((w) => NEW_WORDS.includes(w)).length * 4 + (words.includes("OnlyTakerTokenBalanceNonZero") ? -2 : 0);
    const light = (i: number) => { $$(".arena-ring .node").forEach((e, k) => e.classList.toggle("lit", k === i)); STEPS.forEach((st, k) => $(`#b-${st}`)?.classList.toggle("lit", k === i)); };
    const phases: (() => void)[] = [
      () => {
        glads().forEach((g) => g.classList.remove("champ", "paid")); tallies().forEach((t) => (t.textContent = "")); programs.forEach((p, i) => write(i, p, i * 120));
        A.target = programs.map((p) => rnd(3, 6) + strength(p)); A.fills = programs.map(() => 0); A.score = programs.map((p) => +(2 + strength(p) * 1.1 + Math.random() * 4).toFixed(1)); A.champ = A.score.indexOf(Math.max(...A.score)); A.evolved = false;
        $("#genlabel")!.textContent = "generation";
      },
      () => { for (let k = 1; k <= 8; k += 1) later(() => programs.forEach((_, i) => { A.fills[i] = Math.round(A.target[i] * k / 8); tallies()[i].textContent = `${A.fills[i]} fills`; }), k * 200); },
      () => {
        A.fills = [...A.target]; programs.forEach((_, i) => (tallies()[i].innerHTML = `${A.fills[i]} fills · <b>${A.score[i] > 0 ? "+" : ""}${A.score[i]} bps</b>`)); glads()[A.champ].classList.add("champ");
        if ((A.n + 1) % SEASON === 0) {
          const pulse = $("#tappulse")!, flex = $("#flex")!, promoted = $("#promoted")!;
          $("#genlabel")!.textContent = "season champion"; pulse.setAttribute("opacity", "1"); let y = 432;
          const mv = setInterval(() => { y += 4; pulse.setAttribute("cy", String(y)); if (y >= 500) { clearInterval(mv); pulse.setAttribute("opacity", "0"); pulse.setAttribute("cy", "432"); flex.classList.add("tapped"); flex.querySelector(".flextext")!.textContent = "tapped"; glads()[A.champ].classList.add("paid"); promoted.classList.add("on"); } }, 30);
          timers.push(mv as unknown as ReturnType<typeof setTimeout>);
          later(() => { flex.classList.remove("tapped"); flex.querySelector(".flextext")!.textContent = "tap to pay"; promoted.classList.remove("on"); }, 3600);
        }
      },
      () => {
        if (A.evolved) return; A.evolved = true; const champ = A.champ; const have = (i: number) => NEW_WORDS.filter((w) => programs[i].includes(w));
        programs.forEach((p, i) => {
          if (i === champ) { const missing = NEW_WORDS.filter((w) => !p.includes(w)); if (missing.length && (A.n === 0 || Math.random() < 0.7)) programs[i] = adopt(p, A.n === 0 ? "ToxicityFee" : pick(missing)); return; }
          const learn = have(champ).filter((w) => !p.includes(w)); if (learn.length && Math.random() < 0.8) { const w = pick(learn); later(() => fly(champ, i, w), 200 + i * 150); programs[i] = adopt(p, w); }
        });
        later(() => { A.n += 1; $("#gen")!.textContent = String(A.n); }, PHASE - 150);
      },
    ];
    const go = (k: number) => { clearPhase(); A.phase = k; light(k); phases[k](); if (A.auto) later(() => go((k + 1) % 4), PHASE); };
    const setAuto = (on: boolean) => { A.auto = on; $("#ringwrap")?.classList.toggle("paused", !on); if (on) go((A.phase + 1) % 4); else clearPhase(); };
    const restart = () => { clearPhase(); A.n = 0; $("#gen")!.textContent = "0"; programs = START.map((p) => [...p]); go(0); };
    const jump = (k: number) => { if (A.auto) setAuto(false); go(k); (document.activeElement as HTMLElement | null)?.blur?.(); };
    $$("#nodes .hit").forEach((g) => { const k = Number((g as HTMLElement).dataset.k); g.addEventListener("click", () => jump(k)); g.addEventListener("keydown", (e) => { const ke = e as KeyboardEvent; if (ke.key === "Enter" || ke.key === " ") { ke.preventDefault(); ke.stopPropagation(); jump(k); } }); });
    STEPS.forEach((st, k) => $(`#b-${st}`)?.addEventListener("click", () => jump(k)));

    // ---- the circuit: wires drawn between the stations, one pulse per wire in sequence ----
    const CYCLE = 15; const circuit = $("#circuit")!; const wires = $<SVGSVGElement>("#wires")!;
    let lightTimer: ReturnType<typeof setInterval> | null = null;
    const layout = () => {
      const W = circuit.clientWidth, H = circuit.clientHeight; if (!W) return; const sx = W / 1200, sy = H / 640;
      const at = (id: string) => { const st = STATIONS.find((x) => x.id === id)!; const n = $(`#n-${id}`)!; const px = st.x * sx, py = st.y * sy; n.style.left = `${px}px`; n.style.top = `${py}px`; return { x: px, y: py, w: n.offsetWidth, h: n.offsetHeight }; };
      const pos = Object.fromEntries(STATIONS.map((st) => [st.id, at(st.id)]));
      wires.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const path = (a: string, b: string) => {
        const P = pos[a], Q = pos[b];
        if (Math.abs(P.y - Q.y) < 2) { const dir = Q.x > P.x ? 1 : -1; return `M${P.x + dir * P.w / 2} ${P.y} L${Q.x - dir * Q.w / 2} ${Q.y}`; }
        if (Math.abs(P.x - Q.x) < 2) { const dir = Q.y > P.y ? 1 : -1; return `M${P.x} ${P.y + dir * P.h / 2} L${Q.x} ${Q.y - dir * Q.h / 2}`; }
        const dir = Q.y > P.y ? 1 : -1; return `M${P.x} ${P.y + dir * P.h / 2} C ${P.x} ${(P.y + Q.y) / 2}, ${Q.x} ${(P.y + Q.y) / 2}, ${Q.x} ${Q.y - dir * Q.h / 2}`;
      };
      const slot = CYCLE / (WIRES.length + 1.6);
      const pulse = (href: string, t0: number, t1: number, halo: boolean) => `<circle class="pulse${halo ? " halo" : ""}" r="${halo ? 9 : 4.5}"><animateMotion dur="${CYCLE}s" repeatCount="indefinite" keyPoints="0;0;1;1" keyTimes="0;${t0.toFixed(4)};${t1.toFixed(4)};1" calcMode="linear"><mpath href="${href}"/></animateMotion><animate attributeName="opacity" values="0;0;${halo ? ".35;.35" : "1;1"};0;0" keyTimes="0;${t0.toFixed(4)};${(t0 + 0.001).toFixed(4)};${t1.toFixed(4)};${(t1 + 0.001).toFixed(4)};1" dur="${CYCLE}s" repeatCount="indefinite"/></circle>`;
      wires.innerHTML = [
        ...SIDE.map(([a, b], i) => `<path class="wire side" id="w-side-${i}" d="${path(a, b)}"/>`),
        ...WIRES.map(([a, b], i) => `<path class="wire" id="w-${i}" d="${path(a, b)}"/>`),
        ...WIRES.map((_, i) => { const t0 = (i * slot) / CYCLE, t1 = ((i + 0.8) * slot) / CYCLE; return pulse(`#w-${i}`, t0, t1, true) + pulse(`#w-${i}`, t0, t1, false); }),
        pulse("#w-side-1", (WIRES.length * slot) / CYCLE, ((WIRES.length + 1.4) * slot) / CYCLE, false),
      ].join("");
      if (lightTimer) clearInterval(lightTimer);
      const order = WIRES.map(([, b]) => b);
      lightTimer = setInterval(() => { const t = (performance.now() / 1000) % CYCLE; const i = Math.floor(t / slot); $$(".station").forEach((n) => n.classList.remove("lit")); const lit = i < WIRES.length ? (t % slot > slot * 0.8 ? order[i] : WIRES[i][0]) : "tap"; $(`#n-${lit}`)?.classList.add("lit"); }, 120);
    };
    layout(); window.addEventListener("resize", layout);

    // ---- reveal, keyboard, spotlight ----
    const reveal = (card: Element) => { card.classList.add("on"); if (card.id === "s6") restart(); };
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { reveal(e.target); io.unobserve(e.target); } }), { threshold: 0.25 });
    $$(".card").forEach((c) => io.observe(c));
    const focusables = () => $$(".card, .stats");
    const spotlight = () => {
      if (!el.classList.contains("present")) return;
      const mid = window.innerHeight / 2; let best: Element | null = null, d = Infinity;
      focusables().forEach((x) => { const r = x.getBoundingClientRect(); const dd = (r.top <= mid && r.bottom >= mid) ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid)); if (dd < d) { d = dd; best = x; } });
      const group = (x: Element | null) => (x && (x.id === "s1" || x.classList.contains("stats"))) ? "opening" : x;
      focusables().forEach((x) => x.classList.toggle("focus", group(x) === group(best)));
    };
    const setPresent = (on: boolean) => { el.classList.toggle("present", on); document.body.classList.toggle("hb-present", on); if (on) spotlight(); else focusables().forEach((x) => x.classList.remove("focus")); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest("input, textarea, button, a")) return;
      if (e.key === " ") { e.preventDefault(); setAuto(!A.auto); }
      if (e.key === "ArrowRight") { if (A.auto) setAuto(false); go((A.phase + 1) % 4); }
      if (e.key === "ArrowLeft") { if (A.auto) setAuto(false); go((A.phase + 3) % 4); }
      if (e.key === "r") { A.auto = true; $("#ringwrap")?.classList.remove("paused"); restart(); }
      if (e.key === "p") setPresent(!el.classList.contains("present"));
    };
    window.addEventListener("keydown", onKey); window.addEventListener("scroll", spotlight, { passive: true }); window.addEventListener("resize", spotlight);
    if (window.location.hash.includes("present")) setPresent(true);

    return () => {
      clearPhase(); if (lightTimer) clearInterval(lightTimer); io.disconnect();
      window.removeEventListener("resize", layout); window.removeEventListener("keydown", onKey); window.removeEventListener("scroll", spotlight); window.removeEventListener("resize", spotlight);
      document.body.classList.remove("hb-present");
    };
  }, [root]);
}

export function HowItIsBuilt() {
  const root = useRef<HTMLDivElement>(null);
  useStory(root);
  return (
    <div className="hb fade" ref={root}>
      <h1 className="page-title">How it is <span style={{ color: "var(--color-bronze)" }}>built</span></h1>
      <p className="lede">A language, one sentence everyone writes, and a Colosseum where AI gladiators write the others.</p>

      <section className="card on" id="s1" style={{ marginTop: 28 }}>
        <div className="venue">
          <div className="venue-mark"><img src="/logos/1inch.svg" alt="1inch" /></div>
          <div className="venue-text">
            <div className="venue-k">the venue</div>
            <h2 className="venue-name">1inch Aqua</h2>
            <p className="venue-lede">A new way to trade liquidity on chain. You do not deposit into a pool. You do not post an order. <b>You ship a program.</b></p>
          </div>
        </div>
        <div className="card-head"><h2>Three ways to trade liquidity on chain</h2><span className="note">more expressive than either</span></div>
        <div className="card-body ways">
          <div className="way rise" style={{ ["--d" as string]: ".1s" }}><svg viewBox="0 0 120 80"><path className="pool" d="M8 12 C 40 12, 60 30, 70 60 C 76 74, 100 74, 112 74" /></svg><small>a pool</small><h3>You deposit</h3><p>One curve, fixed.</p></div>
          <div className="way rise" style={{ ["--d" as string]: ".25s" }}><svg viewBox="0 0 120 80"><line className="order" x1="8" y1="40" x2="112" y2="40" /><line className="order" x1="60" y1="22" x2="60" y2="58" /></svg><small>an order</small><h3>You post</h3><p>One price, one size.</p></div>
          <div className="way program rise" style={{ ["--d" as string]: ".4s" }}><svg viewBox="0 0 120 80" className="glyph aqua"><rect x="8" y="14" width="70" height="12" rx="3" /><rect x="8" y="34" width="46" height="12" rx="3" /><rect x="8" y="54" width="96" height="12" rx="3" /></svg><small>a program</small><h3>You ship</h3><p>Runs at every fill. Prices on anything.</p></div>
        </div>
        <div className="card-foot"><span className="claim">The limit is the imagination. <span>And a program is written in a language.</span></span></div>
      </section>

      <div className="stats">
        <div className="stat"><div className="top"><span className="l"><span className="ico"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg></span>Strategies read</span><span className="badge">seven chains</span></div><div className="v">139,028</div><div className="sub">every program ever shipped to Aqua</div></div>
        <div className="stat"><div className="top"><span className="l"><span className="ico"><svg viewBox="0 0 24 24"><path d="M5 7h14M5 12h9M5 17h11" /></svg></span>Vocabulary</span><span className="badge aqua">SwapVM 1.0.2</span></div><div className="v">36<sup>opcodes</sup></div><div className="sub">plus <b>3</b> of ours</div></div>
        <div className="stat"><div className="top"><span className="l"><span className="ico"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3" /></svg></span>Makers</span><span className="badge aqua">$1.48B traded</span></div><div className="v">1,590</div><div className="sub">611,592 fills, every dollar with its source</div></div>
      </div>

      <section className="card on sent" id="s2">
        <div className="card-head"><h2>SwapVM, thirty-six words</h2><span className="note">every instruction, grouped by what it does. The words the venue uses stay lit.</span></div>
        <div className="card-body"><Dictionary used={WILD} /><Sentence words={WILD} who="99% of the venue, one template" /></div>
        <div className="card-foot">Any curve. Any fee. Any gate. Any order of them. <b>The venue writes one sentence:</b> <span className="badge">gated concentrated AMM, flat fee</span> &nbsp;<b>a pool-shaped strategy.</b></div>
        <div className="card-foot"><span className="claim">Aqua gives us a language. <span>Everyone is writing the same sentence.</span></span></div>
      </section>

      <section className="card" id="s6">
        <div className="card-head"><h2>The arena</h2></div>
        <div className="card-body arena">
          <svg width="0" height="0" style={{ position: "absolute" }}><defs>
            <symbol id="bust" viewBox="0 0 80 90">
              <path d="M22 54 C22 34 30 22 40 22 C50 22 58 34 58 54 Z" fill="#c9d2dc" /><path d="M26 24 C30 10 50 10 54 24 L52 30 C46 22 34 22 28 30 Z" fill="currentColor" /><path d="M40 8 C46 10 52 16 54 24 L26 24 C28 16 34 10 40 8 Z" fill="currentColor" />
              <rect x="30" y="40" width="20" height="4" rx="2" fill="#2b3545" /><path d="M24 54 L24 66 L56 66 L56 54 Z" fill="#dfe5ec" /><path d="M14 90 C14 74 26 68 40 68 C54 68 66 74 66 90 Z" fill="#8a94a6" /><path d="M34 68 L46 68 L44 80 L36 80 Z" fill="#e7ebf0" />
            </symbol>
          </defs></svg>
          <div className="field">
            {GLADS.map(([name, hue], i) => (
              <div className="glad" id={`glad${i}`} key={name}><svg className="bust" style={{ color: hue }}><use href="#bust" /></svg><div className="name">{name}</div><div className="sent" id={`sent${i}`} /><div className="tally" id={`tally${i}`} /><span className="laurel badge aqua">champion</span><span className="coin badge gain">+30 USDC</span></div>
            ))}
          </div>
          <div className="loop">
            <div className="col">
              <div className="beat" id="b-write" role="button" tabIndex={0}><div className="who"><b>Write</b><Logo who="Claude" /></div><p>A Claude mind reads the record and composes a program from the vocabulary. The compiler emits the bytes, RiskCap first. The validator runs the draft on a private fork; a draft that pays the taker goes back with the verdict. Only what survives ships.</p></div>
              <div className="beat" id="b-read" role="button" tabIndex={0}><div className="who"><b>Read</b><Logo who="The Graph" /></div><p>The losers read the winner's sentence through the Subgraph MCP and take a word from it. The winner tries a new one. Then everyone writes again.</p></div>
            </div>
            <div className="arena-ring" id="ringwrap">
              <svg viewBox="0 0 500 560">
                <circle className="orbit" cx="250" cy="250" r="180" />
                <g id="nodes">{RING_POS.map(([x, y], i) => <g className="hit" data-k={i} role="button" tabIndex={0} aria-label={`go to ${STEPS[i]}`} key={STEPS[i]}><circle className="node" cx={x} cy={y} r="48" /><text className="step" x={x} y={y + 5}>{STEPS[i]}</text></g>)}</g>
                <circle className="runner" cx="250" cy="70" r="8" />
                <text className="gen" x="250" y="228" id="genlabel">generation</text>
                <text className="gen-n" x="250" y="290" id="gen">0</text>
                <line className="tapwire" x1="250" y1="432" x2="250" y2="500" />
                <circle className="tappulse" id="tappulse" cx="250" cy="432" r="5" opacity="0" />
                <g id="flex" className="device"><rect x="190" y="500" width="120" height="44" rx="10" /><rect x="204" y="510" width="92" height="24" rx="5" className="screen" /><text x="250" y="527" className="flextext">tap to pay</text></g>
              </svg>
              <div className="promoted badge gain" id="promoted">champion promoted · 30 USDC</div>
            </div>
            <div className="col">
              <div className="beat" id="b-fight" role="button" tabIndex={0}><div className="who"><b>Fight</b><Logo who="1inch Aqua" /><span className="logo"><img src="/logos/base.svg" alt="" />on Base</span></div><p>The program ships to Aqua through our router and trades real flow with real inventory, capped so no fill can break the bankroll.</p></div>
              <div className="beat" id="b-score" role="button" tabIndex={0}><div className="who"><b>Score</b><Logo who="The Graph" /><span className="badge">Aquascan</span></div><p>Fills come back through the subgraphs; Aquascan re-prices each one five minutes later. The best attested score wins the generation.</p></div>
            </div>
          </div>
        </div>
        <div className="card-foot ledger">
          <div className="who"><Logo who="Ledger" big /><b>Two jobs in the arena.</b></div>
          <div className="two">
            <div><b>Key Ring seals the arena.</b> The gladiators' keys, the RPC and API secrets live encrypted under the Flex. The host unseals them into memory at boot, no device attached, and nothing sits in clear on its disk. Destroy the ring from your desk and the host is dark at its next boot.</div>
            <div><b>The tap pays the champion.</b> The prize never touches the host. Once a season, one clear-signed transfer from the Ledger account, on the device, then <span className="mono">promote()</span> on the registry. Agents propose, a human approves, hardware signs.</div>
          </div>
        </div>
      </section>

      <section className="card" id="s10">
        <div className="card-head"><h2>What is new</h2><span className="note">built between 4 and 13 September 2026. Then the tour, in this order.</span></div>
        <div className="card-body newgrid">
          <div className="new"><div className="marks"><span className="badge aqua">Aquascan</span><span className="badge">MCP</span></div><h3>Aquascan, and its questions as tools</h3><p>The explorer and P&amp;L ledger for every Aqua strategy on seven chains: each program read back instruction by instruction, each fill re-priced five minutes later, every number with its source. Nine questions as an MCP server.</p><a className="see" href="/">Overview<span className="mono">/mcp</span></a></div>
          <div className="new"><div className="marks"><Logo who="The Graph" /></div><h3>Six subgraphs, a Substreams package, an arena subgraph</h3><p>Aqua indexed on six chains through subgraphs on the network, on Robinhood Chain through Substreams, plus the Base pools and the arena over our own registry. One schema; the minds and the lanista read it, Aquascan has no other lane.</p><a className="see" href="/arena">the arena subgraph<span className="mono">6gaE5W…UyiGp</span></a></div>
          <div className="new"><div className="marks"><span className="logo"><img src="/logos/base.svg" alt="" />on Base</span><Logo who="Ledger" /><Logo who="Claude" /></div><h3>The arena</h3><p>ArenaRegistry, the taker engine and the lanista on Base; Claude minds writing hourly generations since 12 September with real inventory, capped. Secrets sealed under a Ledger Flex; the champion paid only after a tap on it.</p><a className="see" href="/arena">Arena<span className="mono">0xb709…3bc6</span></a></div>
          <div className="new"><div className="marks"><Logo who="1inch Aqua" /></div><h3>Three new opcodes</h3><p>NaumachyRouter is SwapVM v1.0.2 redeployed with ToxicityFee, RiskCap and OracleAnchor appended, against the unmodified Aqua registry. Deployed and verified on Base; every program in the arena is written with them.</p><a className="see" href="https://basescan.org/address/0x7f417e540899a054bbb287de1c04a13d7d2d98c7" target="_blank" rel="noreferrer">NaumachyRouter on Basescan<span className="mono">0x7f41…98c7</span></a></div>
        </div>
      </section>

      <section className="card" id="s8">
        <div className="card-head"><h2>How the partners build the arena</h2><span className="note">one generation, station by station. The pulse is the program's journey.</span></div>
        <div className="card-body">
          <div className="circuit" id="circuit">
            <svg className="wires" id="wires" />
            {STATIONS.map((st) => (
              <div className={`station${st.side ? " side" : ""}`} id={`n-${st.id}`} key={st.id}>
                <div className="who">{st.partner ? <Logo who={st.who} /> : <span className="badge">{st.who}</span>}<span className="step">{st.step}</span></div>
                <h4>{st.title}</h4><p>{st.text}</p>
              </div>
            ))}
          </div>
          <div className="legend"><span><i />the pulse follows one program through one generation</span><span>partner in blue, Naumachy in grey</span><span>dashed: Ledger, outside the loop by design</span></div>
        </div>
        <div className="card-foot">Nothing in the loop holds a signer. <b>The only hand on money is the one on the Flex.</b></div>
      </section>

      <section className="card" id="s9">
        <div className="card-head"><h2>Ask the arena</h2><span className="note">Aquascan is an MCP server. One prompt, one tool, one tap.</span></div>
        <div className="card-body chat">
          <div className="turns">
            <div className="turn human"><div className="from"><span className="badge">you</span></div><div className="msg">Who is the season champion of the Naumachy arena on Base, and why? Prepare the promotion: pay the champion 30 USDC from my Ledger account base-1, then record it on the registry. Do not send anything yourself; I sign on the device.</div></div>
            <div className="turn"><div className="from"><Logo who="Claude" /></div><div className="msg">Calling <code>arena_promotion</code> on the Aquascan MCP.</div></div>
            <div className="turn"><div className="from"><span className="badge aqua">Aquascan MCP</span></div><div className="msg">Seven closed generations. <b>wide</b> leads: two wins, generations 2 and 3, 0.0121 USDC attested. flat two wins on lower scores; tight and steady one each; generation 4 closed without a champion. Proposal: 30 USDC from <span className="mono">base-1</span> to <span className="mono">0xd11a…2b59f</span>.<span className="mono cmd">wallet-cli send --account base-1 --to 0xd11a775925dc52947343cdd624c4486c7602b59f --amount '30 USDC'</span></div></div>
            <div className="turn"><div className="from"><Logo who="Claude" /></div><div className="msg">wide is the champion by wins, then by attested score. I have started <code>promote</code>; it is waiting for the transfer. Run the line above with your Flex connected and confirm the recipient and the amount on the device.</div></div>
            <div className="turn device"><div className="from"><Logo who="Ledger" /></div><div className="msg"><b>Send 30 USDC to 0xd11a…2b59f on Base.</b> Clear-signed. One tap.</div></div>
            <div className="turn"><div className="from"><Logo who="Claude" /></div><div className="msg">Transfer mined. The lanista wrote <code>promote()</code> on ArenaRegistry. <code>arena_generations</code> now shows wide promoted with a 30 USDC bankroll.</div></div>
          </div>
          <div className="aside">
            <h3>Agents propose. A human approves. Hardware signs.</h3>
            <p>The tool is read-only: it ranks the attested record and writes the command, and never holds a key. <b>The address on the device's screen is the one the subgraph attested.</b> That is the whole check a human has to make.</p>
            <p>Eight more tools ask the venue's questions: which Base makers are bleeding this week, what a strategy does instruction by instruction, who fills it, what the champion shipped last generation.</p>
            <div className="cfg">{'{ "mcpServers": { "aquascan": { "url": "https://naumachy.xyz/mcp" } } }'}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
