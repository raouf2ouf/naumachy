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
  const d = r.data; const none = d.makers.length + d.strategies.length === 0;
  return (
    <div className="fade">
      <h1 className="page-title">Results for <span className="mono">{q}</span></h1>
      {none && <p className="page-desc">Nothing starts with that. Addresses are matched as lowercase prefixes.</p>}
      {d.strategies.length > 0 && (
        <div className="tile mt-6">
          <div className="tile-head"><h2>Strategies</h2><span className="note">{d.strategies.length}</span></div>
          <div className="tile-body">
            {d.strategies.map((x) => (
              <Link key={x.chain + x.id} to={`/strategy/${x.chain}/${encodeURIComponent(x.id)}`} className="row hover:text-bronze">
                <span className="flex items-center gap-3"><span className="mono">{shortAddr(x.strategy_hash, 10, 6)}</span><ChainChip chain={x.chain} /><StatusDot status={x.status} /></span>
                <span className="text-ink-muted text-[12.5px]">by <span className="mono">{shortAddr(x.maker)}</span></span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {d.makers.length > 0 && (
        <div className="tile mt-6">
          <div className="tile-head"><h2>Makers</h2><span className="note">{d.makers.length}</span></div>
          <div className="tile-body">
            {d.makers.map((x) => (
              <Link key={x.chain + x.maker} to={`/maker/${x.chain}/${x.maker}`} className="row hover:text-bronze">
                <span className="flex items-center gap-3"><span className="mono">{shortAddr(x.maker, 10, 6)}</span><ChainChip chain={x.chain} /></span>
                <span className="text-ink-muted text-[12.5px]">{x.strategies} strategies</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
