import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { CHAIN_NAME, compact, relTime } from "../lib/format";
import { Failed, Loading } from "../components/ui";

export function Status() {
  const q = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 30_000 });
  if (q.isPending) return <Loading what="status" />;
  if (q.isError) return <Failed what="status" error={q.error} />;
  const h = q.data;
  return (
    <div className="fade">
      <h1 className="text-xl font-medium">Status</h1>
      <p className="text-ink-muted text-[13px] mt-1 max-w-2xl">Where each chain's lane stands against its subgraph, and how much of it is priced. Rolled up {relTime(new Date(h.rollup_at).getTime() / 1000)}.</p>
      <div className="overflow-x-auto panel mt-5">
        <table>
          <thead><tr><th>Chain</th><th className="num">Read up to block</th><th className="num">Subgraph head</th><th className="num">Behind</th><th className="num">Economic fills</th><th className="num">Priced</th><th className="num">By the minute</th><th className="num">Updated</th></tr></thead>
          <tbody>{h.chains.map((c) => (
            <tr key={c.chain}>
              <td>{CHAIN_NAME[c.chain]}</td>
              <td className="num mono">{c.cursor.toLocaleString()}</td>
              <td className="num mono">{c.subgraph_head?.toLocaleString() ?? "-"}</td>
              <td className={`num ${c.blocks_behind !== null && c.blocks_behind > 1000 ? "loss" : "text-ink-muted"}`}>{c.blocks_behind?.toLocaleString() ?? "-"}</td>
              <td className="num">{compact(c.economic_fills, 0)}</td>
              <td className="num"><span className="inline-block w-24 h-1.5 bg-water-700 rounded align-middle mr-2"><span className="block h-1.5 rounded bg-bronze-deep" style={{ width: `${Math.round(c.priced_ratio * 100)}%` }} /></span>{Math.round(c.priced_ratio * 100)}%</td>
              <td className="num text-ink-muted">{Math.round(c.tape_ratio * 100)}%</td>
              <td className="num text-ink-muted">{relTime(new Date(c.updated_at).getTime() / 1000)}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <p className="text-xs text-ink-faint mt-4 max-w-2xl">Behind counts blocks between the last fill read and the subgraph's own head; a few hundred is normal, since it only advances when a fill happens. Priced is the share of economic fills that carry a dollar figure; by the minute is the share of those whose reference price came from prints within minutes, the pair's other fills or a same-chain pool, rather than from DefiLlama's hourly price.</p>
    </div>
  );
}
