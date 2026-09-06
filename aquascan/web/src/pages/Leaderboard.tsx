import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Chain } from "../lib/api";
import { Failed, Loading, Provenance } from "../components/ui";
import { ChainFilter, DeskTable } from "./Desks";

export function Leaderboard() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [mode, setMode] = useState<"edge" | "markout">("edge");
  const q = useQuery({ queryKey: ["leaderboard", chain, mode], queryFn: () => api.leaderboard(chain, mode, 50, 1000) });
  return (
    <div className="fade">
      <h1 className="text-xl font-medium">Leaderboard</h1>
      <p className="text-ink-muted text-[13px] mt-1 max-w-2xl">Desks with at least $1K of priced volume, ranked by {mode === "edge" ? "the edge they kept at fill time" : "how badly their positions moved one hour after filling"}.</p>
      <div className="mt-5 flex items-center justify-between gap-4 flex-wrap">
        <ChainFilter value={chain} onChange={setChain} />
        <div className="inline-flex gap-1 text-xs">
          <button onClick={() => setMode("edge")} className={`px-2 py-0.5 rounded ${mode === "edge" ? "bg-water-600 text-ink" : "text-ink-muted hover:text-ink"}`}>best edge</button>
          <button onClick={() => setMode("markout")} className={`px-2 py-0.5 rounded ${mode === "markout" ? "bg-water-600 text-ink" : "text-ink-muted hover:text-ink"}`}>most adverse flow</button>
        </div>
      </div>
      <div className="mt-4">
        {q.isPending ? <Loading what="the leaderboard" /> : q.isError ? <Failed what="the leaderboard" error={q.error} /> : <DeskTable rows={q.data} rank />}
      </div>
      {q.data && <Provenance at={q.data[0]?.volume_usd.at ?? new Date().toISOString()} />}
    </div>
  );
}
