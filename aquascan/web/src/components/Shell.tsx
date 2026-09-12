import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ThemeToggle } from "./ui";

// The sections, in two groups: the venue, and Naumachy's own pages. Each with a line icon.
const ICONS = {
  overview: <svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>,
  makers: <svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-5-6.3" /></svg>,
  leaderboard: <svg viewBox="0 0 24 24"><path d="M4 19V10M10 19V5M16 19v-8M22 19H2" /></svg>,
  arena: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3" /></svg>,
  how: <svg viewBox="0 0 24 24"><path d="M4 19V5h9l3 3v11zM8 12h6M8 15.5h6" /></svg>,
  status: <svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 3 10 3-6 2 1h4" /></svg>,
};
const groups: { label: string; items: { to: string; label: string; icon: React.ReactNode; end?: boolean }[] }[] = [
  { label: "Venue", items: [{ to: "/", label: "Overview", icon: ICONS.overview, end: true }, { to: "/makers", label: "Makers", icon: ICONS.makers }, { to: "/leaderboard", label: "Leaderboard", icon: ICONS.leaderboard }] },
  { label: "Naumachy", items: [{ to: "/arena", label: "Arena", icon: ICONS.arena }, { to: "/how-it-is-built", label: "How it is built", icon: ICONS.how }, { to: "/status", label: "Status", icon: ICONS.status }] },
];

// A rail on the left with the name and the sections; the page takes the rest of the width.
// The search sits in a bar at the top of the page.
export function Shell() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="brand" aria-label="Aquascan, overview">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--color-bronze)" /><path d="M5 20c3-4 6-4 9 0s6 4 9 0 3-4 4-3" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" /></svg>
          <span><span className="brand-name">Aquascan</span><span className="brand-tag">every Aqua strategy, re-priced</span></span>
        </NavLink>
        <div>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="nav-group">{g.label}</div>
              <nav className="nav" aria-label={g.label}>
                {g.items.map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.icon}{n.label}</NavLink>)}
              </nav>
            </div>
          ))}
        </div>
        <div className="rail-foot">
          <ThemeToggle />
        </div>
      </aside>
      <div className="content">
        <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <label className="search">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a maker, a strategy, a hash" aria-label="Search" spellCheck={false} autoComplete="off" />
            <span className="search-hint" aria-hidden="true">Enter</span>
          </label>
        </form>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
