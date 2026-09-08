import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ThemeToggle } from "./ui";

const nav = [
  { to: "/", label: "Overview", end: true },
  { to: "/desks", label: "Desks" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/arena", label: "Arena" },
  { to: "/status", label: "Status" },
];

// A rail on the left with the name and the five sections; the page takes the rest of the width.
// The search is a full row at the top of the page, the width of the content.
export function Shell() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  return (
    <div className="shell">
      <aside className="rail">
        <NavLink to="/" className="brand" aria-label="Aquascan, overview">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="var(--color-water-700)" /><path d="M5 20c3-4 6-4 9 0s6 4 9 0 3-4 4-3" fill="none" stroke="var(--color-bronze)" strokeWidth="2.5" strokeLinecap="round" /></svg>
          <span><span className="brand-name">Aquascan</span><span className="brand-tag">keeps score on Aqua</span></span>
        </NavLink>
        <nav className="nav" aria-label="Sections">
          {nav.map((n) => <NavLink key={n.to} to={n.to} end={n.end}>{n.label}</NavLink>)}
        </nav>
        <div className="rail-foot">
          <ThemeToggle />
        </div>
      </aside>
      <div className="content">
        <form className="searchbar" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}>
          <label className="search">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a maker address, a strategy hash or a desk" aria-label="Search" spellCheck={false} autoComplete="off" />
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
