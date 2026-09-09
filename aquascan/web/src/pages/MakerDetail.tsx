import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type Band, type Chain, type DeskFees, type FillRow, type MakerPnl, type MakerRewards, type PnlToken, type Priced } from "../lib/api";
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
      <Score label="Versus holding" p={s.pnl_usd_marked} signed />
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

// What the maker made: realised on closed round trips, unrealised on what it still holds, both by
// average cost since it was first seen on Aqua. Their sum is the position marked at latest prices,
// the figure liquidity providers know as impermanent loss when it is negative.
function ResultPanel({ pnl, fees, tokens, rewards }: { pnl: MakerPnl; fees: Priced; tokens: PnlToken[]; rewards: MakerRewards | null }) {
  const open = tokens.filter((t) => Math.abs(t.position) > 0);
  const total = pnl.realised_usd.value !== null && pnl.unrealised_usd.value !== null ? pnl.realised_usd.value + pnl.unrealised_usd.value : null;
  const paid = rewards?.tokens.filter((t) => t.amount > 0) ?? [];
  const rewardsUsd = rewards?.total_usd ?? null;
  return (
    <Section title="Result" description="Realised on the round trips it closed, unrealised on what it still holds, by average cost since its first fill here. Fees are inside the legs, not added again. Their sum is the versus-holding figure above, what liquidity providers call impermanent loss when it is negative.">
      <div className="scores result">
        <div className="primary"><div className="l">Made so far</div><div className="v">{total === null ? <span className="text-ink-faint">unpriced</span> : <span className={total > 0 ? "gain" : total < 0 ? "loss" : ""}>{usd(total, true)}</span>}</div>
          <div className="b">{pnl.fills > 0 ? <>{compact(pnl.fills, 0)} fills priced{pnl.unpriced_fills > 0 && <>, {compact(pnl.unpriced_fills, 0)} not</>}</> : "no priced fill"}</div></div>
        <Score label="Realised" p={pnl.realised_usd} signed sub="round trips closed" />
        <Score label="Unrealised" p={pnl.unrealised_usd} signed sub={open.length ? `${open.length} token${open.length > 1 ? "s" : ""} open` : "nothing open"} />
        <Score label="Of which fees" p={fees} sub="kept by the maker" />
        <div>
          <div className="l">Plus rewards</div>
          <div className="v">{rewards === null ? <span className="text-ink-faint" title="Merkl not read yet for this wallet">not read yet</span> : paid.length === 0 ? <span className="text-ink-faint">none</span> : rewardsUsd === null ? <span className="text-ink-faint">unpriced</span> : <span className="fee">{usd(rewardsUsd)}</span>}</div>
          <div className="b">{paid.length > 0 ? paid.map((t) => `${compact(t.amount, 0)} ${t.symbol ?? ""}`).join(" + ") : "1inch incentive programme, via Merkl"}</div>
        </div>
      </div>
      {paid.length > 0 && total !== null && rewardsUsd !== null && (
        <p className="mt-3 text-[13px] text-ink-muted">
          The incentive programme pays makers on the volume their 1INCH-paired positions handle, claimed on Ethereum whichever network they quoted on, so rewards belong to the wallet rather than to this chain. With them, the wallet made <span className={total + rewardsUsd > 0 ? "gain" : "loss"}>{usd(total + rewardsUsd, true)}</span> here{rewardsUsd > Math.abs(total) ? ", the rewards being the larger part" : ""}. Read from Merkl {new Date(rewards!.checked_at).toISOString().slice(0, 16).replace("T", " ")} UTC.
        </p>
      )}
      {tokens.length > 0 && (
        <div className="overflow-x-auto panel mt-3">
          <table>
            <thead><tr><th>Token</th><th className="num">Position</th><th className="num">Average cost</th><th className="num">Latest price</th><th className="num">Realised</th><th className="num">Unrealised</th><th className="num">Legs</th></tr></thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.token}>
                  <td><span className="mono" title={t.token}>{t.symbol ?? shortAddr(t.token)}</span></td>
                  <td className="num">{t.position === 0 ? <span className="text-ink-faint">flat</span> : <span className={t.position < 0 ? "text-ink-muted" : ""}>{t.position > 0 ? "+" : ""}{compact(t.position, 4)}</span>}</td>
                  <td className="num text-ink-muted">{t.basis_usd === null ? "" : usd(t.basis_usd)}</td>
                  <td className="num text-ink-muted">{t.mark_usd === null ? <span className="text-ink-faint">no mark</span> : usd(t.mark_usd)}</td>
                  <td className="num"><span className={t.realised_usd > 0 ? "gain" : t.realised_usd < 0 ? "loss" : ""}>{usd(t.realised_usd, true)}</span></td>
                  <td className="num text-ink-muted">{t.unrealised_usd === null ? (t.position === 0 ? <span className="text-ink-faint">0</span> : <span className="text-ink-faint">no mark</span>) : usd(t.unrealised_usd, true)}</td>
                  <td className="num text-ink-muted">{compact(t.legs, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
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

export function MakerDetail() {
  const { chain = "", address = "" } = useParams();
  const [limit, setLimit] = useState(50);
  const q = useQuery({ queryKey: ["maker", chain, address, limit], queryFn: () => api.maker(chain, address, limit), placeholderData: (prev) => prev });
  if (q.isPending) return <Loading what="the maker" />;
  if (q.isError) return <Failed what="this maker" error={q.error} />;
  const d = q.data; const c = chain as Chain;
  return (
    <div className="fade">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="page-title">{d.maker_label ? <span>{d.maker_label} <Addr value={d.maker} chars={6} className="text-base text-ink-muted" /></span> : <Addr value={d.maker} chars={10} />}</h1>
        <ChainChip chain={c} />
        <span className="text-ink-muted text-[13px]"><span className="gain">{d.live}</span> live of {d.strategies_total} strategies, {d.templates.length === 1 ? "one template" : `${d.templates.length} templates`}</span>
      </div>
      <p className="mt-2 text-[13.5px]"><span className="text-ink-muted mr-2">Trades</span><Pairs pairs={d.pairs} max={4} /></p>
      <p className="page-desc">First seen <When ts={d.first_seen} />, last active <When ts={d.last_seen} />. {d.tape_ratio > 0 && <>{percent(d.tape_ratio)} of its fills are scored against prints within minutes, the pair's other fills or a same-chain pool; the rest against hourly prices. The band on a rate is one standard error, from the spread of its own fills.</>}</p>

      <ScoreTiles s={d} volumeLabel="Volume, all time" />
      <FeePanel fees={d.fees} makerFee={d.maker_fee_usd} protocolFee={d.protocol_fee_usd} volume={d.volume_usd} />
      <ResultPanel pnl={d.pnl} fees={d.maker_fee_usd} tokens={d.pnl_tokens} rewards={d.rewards} />

      <Section title="Templates" description="The shapes of the programs this maker ships here: the opcode sequence with the arguments ignored. A maker re-ships the same template many times with new parameters.">
        <div className="overflow-x-auto panel">
          <table>
            <thead><tr><th>Template</th><th className="num">Strategies</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fees earned</th><th className="num">Edge, 5 min after fill</th><th className="num">Edge at fill</th></tr></thead>
            <tbody>
              {d.templates.map((t) => (
                <tr key={t.template}>
                  <td><span title={t.instructions ? t.instructions.join(" > ") : t.template}>{t.name ?? `template ${shortAddr(t.template, 8, 4)}`}</span></td>
                  <td className="num"><span className="gain">{t.live}</span><span className="text-ink-faint"> / {t.strategies}</span></td>
                  <td className="num">{compact(t.fills, 0)}</td>
                  <td className="num"><Money p={t.volume_usd} /></td>
                  <td className="num"><Money p={t.maker_fee_usd} className="fee" /><span className="sub">{feeBps(t.maker_fee_bps)}</span></td>
                  <td className="num"><Money p={t.markout_5m_usd} signed colored className="font-medium" />{t.markout_5m_bps && <span className="band">{bandText(t.markout_5m_bps)}</span>}</td>
                  <td className="num text-ink-muted"><EdgeCell edge={t.edge_usd} volume={t.volume_usd} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Strategies" description="Every program this maker shipped here, newest first. Docked means revoked: the tokens never left the wallet.">
        <div className="overflow-x-auto panel">
          <table>
            <thead><tr><th>State</th><th>Strategy</th><th>Template</th><th>Shipped</th><th className="num">Fills</th><th className="num">Volume</th><th className="num">Fees earned</th><th className="num">Edge, 5 min</th><th className="num">Edge at fill</th><th className="num">Pair P&L</th><th className="num">Takers</th></tr></thead>
            <tbody>
              {d.strategies.map((s) => (
                <tr key={s.id}>
                  <td><StatusDot status={s.status} /></td>
                  <td><Link to={`/strategy/${chain}/${encodeURIComponent(s.id)}`} className="mono">{shortAddr(s.strategy_hash, 10, 6)}</Link> <RegistryChip registry={s.registry} /></td>
                  <td className="text-ink-muted text-[12.5px]">{s.template_name ?? ""}</td>
                  <td className="text-ink-muted"><When ts={s.shipped_at} /></td>
                  <td className="num">{compact(s.fills, 0)}</td>
                  <td className="num"><Money p={s.volume_usd} /></td>
                  <td className="num"><Money p={s.maker_fee_usd} className="fee" /><span className="sub">{feeBps(s.maker_fee_bps)}</span></td>
                  <td className="num"><Money p={s.markout_5m_usd} signed colored className="font-medium" />{s.markout_5m_bps && <span className="band">{bandText(s.markout_5m_bps)}</span>}</td>
                  <td className="num text-ink-muted"><EdgeCell edge={s.edge_usd} volume={s.volume_usd} /></td>
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
        <div className="panel list">
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
