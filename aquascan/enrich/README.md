# aquascan/enrich

Reads the six published Aqua subgraphs through The Graph gateway and derives what the explorer shows. Postgres, TypeScript, one outbound pacer per destination.

## Milestone 1: fills landed

Two lanes per chain, each with its own cursor in the `chains` table:

- strategies, paged by `shippedAt`, plus a second pass paged by `dockedAt` so docks reach rows the first pass has already passed;
- fills with their legs, paged by `block`.

A full page steps the cursor back to just before its last key, so ties are re-read; a full page made of one key is drained with skip paging. Every write is an upsert, so re-reading is harmless. `_meta.block.number` from each response is stored as the subgraph head, which is what `status` compares the cursor against.

## Run

```sh
docker compose -f infra/aquascan/docker-compose.yml up -d     # Postgres on 127.0.0.1:5433
yarn workspace @naumachy/aquascan-enrich once                  # one pass over every configured chain
yarn workspace @naumachy/aquascan-enrich once --chains=base    # one chain
yarn workspace @naumachy/aquascan-enrich dev                   # loop, ENRICH_POLL_SECONDS between passes
yarn workspace @naumachy/aquascan-enrich status
```

Environment (repo root `.env`): `GRAPH_API_KEY`, `GRAPH_SUBGRAPH_ID_<CHAIN>` per chain, optional `AQUASCAN_DATABASE_URL`, `GATEWAY_CALLS_PER_MINUTE` (default 30), `ENRICH_POLL_SECONDS` (default 300). At the defaults the steady state is a handful of gateway queries per chain per pass, far inside the free plan.

## Milestone 2: prices

For every leg token of every economic fill, the fill hour plus one hour and one day later are priced through DefiLlama's batchHistorical, with source, data point timestamp and confidence on every row and a negative cache for hours the source cannot price. Symbols and decimals come from the same responses; tokens DefiLlama does not describe are read from the chain in one batched request per chain.

## Milestone 3: derived tables

The rollup runs after each pass and recomputes, in one transaction: `fill_values` (volume, edge and markouts per economic fill, NULL when any leg is unpriced), `strategy_marks` (the strategy's own 24h VWAP per base against its numeraire), `strategy_stats` (fills, dollar figures with a priced ratio, pair-native P&L in the quote token with its coverage, position marked at latest prices, taker concentration, self fills), `desk_stats` and `daily_stats`. The numeraire is a stablecoin when the strategy touched one, else its most traded token.

Sign conventions: `edge_usd` is the value of the maker's net legs at the fill hour, positive when the maker gained; `markout_1h_usd` is how the position taken in the fill moved one hour later, negative under adverse selection.

## Next

Token API candles for same-pair markout references; labels; the read-only API.
