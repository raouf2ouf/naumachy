import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { shortAddr } from "../lib/format";
import { ChainChip, Failed, Loading, StatusDot } from "../components/ui";

export function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const r = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: q.length >= 3 });
  if (q.length < 3) return <p className="text-ink-muted">Type at least three characters of an address or hash.</p>;
  if (r.isPending) return <Loading what="results" />;
  if (r.isError) return <Failed what="search" error={r.error} />;
  const d = r.data; const none = d.makers.length + d.strategies.length + d.desks.length === 0;
  return (
    <div className="fade">
      <h1 className="page-title">Results for <span className="mono">{q}</span></h1>
      {none && <p className="text-ink-muted mt-3">Nothing starts with that. Addresses are matched as lowercase prefixes.</p>}
      {d.desks.length > 0 && <div className="mt-6"><h2 className="text-[16px] font-semibold mb-2">Desks</h2><div className="panel list">{d.desks.map((x) => <Link key={x.chain + x.desk} to={`/desk/${x.chain}/${encodeURIComponent(x.desk)}`} className="flex items-center gap-3 px-4 py-2.5"><span className="mono">{shortAddr(x.maker)}</span><ChainChip chain={x.chain} /><span className="text-ink-faint ml-auto">{x.fills} fills</span></Link>)}</div></div>}
      {d.strategies.length > 0 && <div className="mt-6"><h2 className="text-[16px] font-semibold mb-2">Strategies</h2><div className="panel list">{d.strategies.map((x) => <Link key={x.chain + x.id} to={`/strategy/${x.chain}/${encodeURIComponent(x.id)}`} className="flex items-center gap-3 px-4 py-2.5"><span className="mono">{shortAddr(x.strategy_hash, 10, 6)}</span><ChainChip chain={x.chain} /><StatusDot status={x.status} /></Link>)}</div></div>}
      {d.makers.length > 0 && <div className="mt-6"><h2 className="text-[16px] font-semibold mb-2">Makers</h2><div className="panel list">{d.makers.map((x) => <Link key={x.chain + x.maker} to={`/search?q=${x.maker}`} className="flex items-center gap-3 px-4 py-2.5"><span className="mono">{x.maker}</span><ChainChip chain={x.chain} /></Link>)}</div></div>}
    </div>
  );
}
