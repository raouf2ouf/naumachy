import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Overview } from "./pages/Overview";
import { Makers } from "./pages/Makers";
import { Leaderboard } from "./pages/Leaderboard";
import { MakerDetail } from "./pages/MakerDetail";
import { StrategyDetail } from "./pages/StrategyDetail";
import { Search } from "./pages/Search";
import { Status } from "./pages/Status";
import { Arena } from "./pages/Arena";
import { Generation } from "./pages/Generation";
import { HowItIsBuilt } from "./pages/HowItIsBuilt";

// The old desk addresses were maker-template-registry; the maker is the first 42 characters.
function DeskRedirect() { const { chain = "", id = "" } = useParams(); return <Navigate to={`/maker/${chain}/${id.slice(0, 42)}`} replace />; }

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

export function App() {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Overview />} />
            <Route path="makers" element={<Makers />} />
            <Route path="desks" element={<Navigate to="/makers" replace />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="maker/:chain/:address" element={<MakerDetail />} />
            <Route path="desk/:chain/:id" element={<DeskRedirect />} />
            <Route path="strategy/:chain/:id" element={<StrategyDetail />} />
            <Route path="search" element={<Search />} />
            <Route path="arena" element={<Arena />} />
            <Route path="arena/:number" element={<Generation />} />
            <Route path="how-it-is-built" element={<HowItIsBuilt />} />
            <Route path="status" element={<Status />} />
            <Route path="*" element={<p className="text-ink-muted">No such page. Use the search or start from the overview.</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
