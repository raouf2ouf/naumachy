# aquascan

The explorer and P&L ledger for 1inch Aqua strategies. Owner: Aquascan vertical.

Planned packages (yarn workspaces under `aquascan/*`):
- `enrich/`: reads the subgraphs through the gateway, derives fills (economic only), marks, USD at fill hour (DefiLlama), markouts 1h/24h, taker stats, labels. Postgres.
- `api/`: read-only JSON API (docs/interfaces.md).
- `web/`: Vite + React + Tailwind. Overview is a pulse, not a wall (docs/lessons.md, UX section).

Chain data comes from The Graph.
