# aquascan/api

Read-only JSON over the enrichment database, on `127.0.0.1:3100` by default. All addresses lowercase, amounts as strings, and every priced number wrapped as `{ value, source, at, confidence }` where `confidence` is the share of underlying fills that were fully priced.

- `GET /api/health` cursors, subgraph heads, priced ratios, last rollup.
- `GET /api/overview?window=24h|7d|30d|all&chain=` the pulse: hero numbers, totals, top five desks by volume, latest ships.
- `GET /api/desks?chain&sort=volume|edge|fills|markout|recent&limit&minVolume`
- `GET /api/leaderboard?chain&sort&limit&minVolume` desks ranked, default by edge with a volume floor.
- `GET /api/desk/:chain/:id` a desk with its strategies and recent fills.
- `GET /api/strategy/:chain/:id` by strategy id or hash: program, lifecycle, stats, pair marks, fills with legs.
- `GET /api/search?q=` makers, strategies, desks by prefix.

```sh
yarn workspace @naumachy/aquascan-api dev
```
