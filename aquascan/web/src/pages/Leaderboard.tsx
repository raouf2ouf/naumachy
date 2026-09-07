import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Chain } from "../lib/api";
import { Failed, Loading, Provenance } from "../components/ui";
import { ChainFilter, DeskTable } from "./Desks";

const MODES: [string, string, string][] = [
  ["edge", "best edge at fill", "the edge they kept against the venue's price at fill time"],
  ["markout", "worst after 1 h", "what their fills were worth one hour later, worst first"],
  ["adverse", "most adverse flow", "how far the price moved against them in the hour after filling, worst first"],
];

export function Leaderboard() {
  const [chain, setChain] = useState<Chain | null>(null);
  const [mode, setMode] = useState("edge");
  const q = useQuery({ queryKey: ["leaderboard", chain, mode], queryFn: () => api.leaderboard(chain, mode, 50, 1000) });
  const text = MODES.find((m) => m[0] === mode)?.[2];
  return (
    <div className="fade">
      <h1 className="text-xl font-medium">Leaderboard</h1>
      <p className="text-ink-muted text-[13px] mt-1 max-w-2xl">Desks with at least $1K of priced volume, ranked by {text}.</p>
      <div className="mt-5 flex items-center justify-between gap-4 flex-wrap">
        <ChainFilter value={chain} onChange={setChain} />
        <div className="inline-flex gap-1 text-xs">
          {MODES.map(([k, label]) => <button key={k} onClick={() => setMode(k)} className={`px-2 py-0.5 rounded ${mode === k ? "bg-water-600 text-ink" : "text-ink-muted hover:text-ink"}`}>{label}</button>)}
        </div>
      </div>
      <div className="mt-4">
        {q.isPending ? <Loading what="the leaderboard" /> : q.isError ? <Failed what="the leaderboard" error={q.error} /> : <DeskTable rows={q.data} rank />}
      </div>
      {q.data && <Provenance at={q.data[0]?.volume_usd.at ?? new Date().toISOString()} />}
    </div>
  );
}
