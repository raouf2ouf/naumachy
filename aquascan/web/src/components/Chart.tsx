import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Series } from "../lib/api";
import { usd } from "../lib/format";

export function VolumeChart({ series }: { series: Series }) {
  const data = series.days.map((d) => ({ date: d.date.slice(5), volume: d.volume_usd ?? 0, fills: d.fills }));
  return (
    <div className="h-44 fade">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="bronze" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-bronze)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-bronze)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fill: "var(--color-ink-faint)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
          <YAxis tick={{ fill: "var(--color-ink-faint)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} tickFormatter={(v: number) => usd(v)} />
          <Tooltip contentStyle={{ background: "var(--color-water-800)", border: "1px solid var(--color-water-600)", borderRadius: 6, fontSize: 12 }} labelStyle={{ color: "var(--color-ink-muted)" }} formatter={(v, name) => [name === "volume" ? usd(Number(v ?? 0)) : String(v ?? ""), name === "volume" ? "volume" : "fills"]} />
          <Area type="monotone" dataKey="volume" stroke="var(--color-bronze)" strokeWidth={1.6} fill="url(#bronze)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
