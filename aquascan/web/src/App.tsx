import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./components/Shell";
import { Overview } from "./pages/Overview";
import { Desks } from "./pages/Desks";
import { Leaderboard } from "./pages/Leaderboard";
import { DeskDetail } from "./pages/DeskDetail";
import { StrategyDetail } from "./pages/StrategyDetail";
import { Search } from "./pages/Search";
import { Status } from "./pages/Status";
import { Arena } from "./pages/Arena";
import { Generation } from "./pages/Generation";

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

export function App() {
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Overview />} />
            <Route path="desks" element={<Desks />} />
            <Route path="leaderboard" element={<Leaderboard />} />
            <Route path="desk/:chain/:id" element={<DeskDetail />} />
            <Route path="strategy/:chain/:id" element={<StrategyDetail />} />
            <Route path="search" element={<Search />} />
            <Route path="arena" element={<Arena />} />
            <Route path="arena/:number" element={<Generation />} />
            <Route path="status" element={<Status />} />
            <Route path="*" element={<p className="text-ink-muted">No such page. Use the search or start from the overview.</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
