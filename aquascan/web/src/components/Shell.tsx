import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ThemeToggle } from "./ui";

const nav = [
  { to: "/", label: "Overview", end: true },
  { to: "/desks", label: "Desks" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/status", label: "Status" },
];

export function Shell() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <div className="min-h-screen md:grid md:grid-cols-[200px_1fr]">
      <aside className="border-b md:border-b-0 md:border-r border-water-700 bg-water-900 px-5 py-5 md:py-7 flex flex-wrap md:flex-col items-center md:items-start gap-4 md:gap-8">
        <NavLink to="/" className="flex items-center gap-2.5">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="6" fill="var(--color-water-700)" /><path d="M5 20c3-4 6-4 9 0s6 4 9 0 3-4 4-3" fill="none" stroke="var(--color-bronze)" strokeWidth="2.5" strokeLinecap="round" /></svg>
          <span>
            <span className="block font-semibold leading-tight">Aquascan</span>
            <span className="block text-[11px] text-ink-muted leading-tight">keeps score on Aqua</span>
          </span>
        </NavLink>
        <nav className="flex flex-wrap md:flex-col gap-1 md:gap-0.5 text-[13px]">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `px-2 py-1 rounded ${isActive ? "text-bronze bg-water-800" : "text-ink-muted hover:text-ink"}`}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="md:mt-auto ml-auto md:ml-0"><ThemeToggle /></div>
      </aside>
      <div className="min-w-0">
        <form className="px-6 md:px-8 pt-6" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a maker address, a strategy hash, or a desk" aria-label="Search"
            className="w-full max-w-2xl bg-water-900 border border-water-700 rounded-md px-3.5 py-2 text-[13px] placeholder:text-ink-faint focus:border-bronze-deep outline-none" />
        </form>
        <main className="px-6 md:px-8 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
