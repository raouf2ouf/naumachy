import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Chain } from "../lib/api";
import { Failed, Loading, Provenance, PageHeader, Segmented } from "../components/ui";
import { ChainFilter, MakerTable } from "./Makers";

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
      <PageHeader title="Leaderboard" description={<>Makers with at least $1K of priced volume, ranked by {text}.</>} />
      <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
        <ChainFilter value={chain} onChange={setChain} />
        <Segmented value={mode} onChange={setMode} label="Ranking" options={MODES.map(([k, label]) => [k, label] as [string, string])} />
      </div>
      <div className="mt-4">
        {q.isPending ? <Loading what="the leaderboard" /> : q.isError ? <Failed what="the leaderboard" error={q.error} /> : <MakerTable rows={q.data} rank highlight={mode === "edge" ? "edge" : mode === "markout" || mode === "adverse" ? "m1h" : "m5"} />}
      </div>
      {q.data && <Provenance at={q.data[0]?.volume_usd.at ?? new Date().toISOString()} />}
    </div>
  );
}
