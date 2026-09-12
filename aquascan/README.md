# aquascan

The explorer and P&L ledger for 1inch Aqua strategies.

Packages (yarn workspaces under `aquascan/*`):
- `enrich/`: reads the subgraphs through the gateway and the Substreams package for Robinhood Chain, derives economic fills, reference prices from the venue's own tape and same-chain pools, markouts at 5 minutes, 1 hour and 1 day, maker P&L, fees decoded from the programs, Merkl rewards. Postgres.
- `api/`: read-only JSON API (docs/interfaces.md).
- `web/`: Vite, React and Tailwind. The overview, makers, leaderboard, maker and strategy pages, the arena, and the How it is built page.

Chain data comes from The Graph. The read-only API is also exposed as an MCP server in `mcp/`.
