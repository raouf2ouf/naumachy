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

## Milestone 4: the venue as its own reference, and fees

Every two-sided fill is placed on its pair's tape: the volume-weighted price of the same pair's other fills (other makers and other takers) in the narrowest window around the fill minute that holds one, widening to 15 minutes; the references 5 minutes, 1 hour and 1 day later start at the horizon, run forward (2 then 15 minutes, 5 then 60, 30 then 360) and leave out the maker's own prints. Sums are exact numerics, prints under half a dollar do not count, and a reference outside a factor of two of the fill's own price is refused. Dollars come from the hourly price of the pair's quote token. Fills with no reference fall back to hourly dollar prices and carry `ref_kind = 'hourly'`.

Fees are decoded once per strategy from its program (`strategy_fees`): the flat maker fee and its side, the protocol fee rate and recipient, or the dynamic fee provider. Per fill, `protocol_fee_usd` is the sliver pulled out of the maker's ledger on the token it received, valued at the fill hour; `maker_fee_usd` is the program's rate applied to the fill's volume.

Sign conventions: `edge_usd` is the fill against the reference at fill time, positive when the maker captured spread; `markout_5m_usd`, `markout_1h_usd` and `markout_24h_usd` are the fill re-marked at the reference that much later (edge plus drift); `drift_1h_usd` and `drift_24h_usd` are markout minus edge, negative under adverse selection. The five-minute figure is the headline: it is the edge once the market has re-priced. Strategy and desk stats carry the volume-weighted markout in bps (`markout_5m_bps`, `markout_1h_bps`) with a standard error from the spread of their own fills.

`yarn workspace @naumachy/aquascan-enrich rollup` decodes new fees and recomputes the derived tables once, without touching the gateway.

## Milestone 5: same-chain pools where the tape is thin

Once a day the lane decides a route for every pair of the last 30 days (`pair_routes`): the tape when the pair prints at least ten times an hour; else the deepest pool of the exact pair with at least 120 swaps in 30 days; else a hop through a hub (WETH, USDC, USDT; WBNB on BSC), the dense leg on the tape and the other in a pool; else hourly. Routed pools are read from published DEX subgraphs with the Uniswap v3 schema (`pools`, `pool_swaps`, paged by timestamp with a bounded number of pages per pass so a deep pool backfills over a few passes). In the rollup, pool swaps become prints on the same tape machinery under their own source, and a hop multiplies its two legs. `ref_kind` says which route priced a fill: `tape`, `pool`, `hop` or `hourly`. Before a print can serve as a reference it must sit within a tolerance of its pair's yardstick for the hour (the hourly dollar ratio when both tokens are priced, else the pair's median print; half a percent between stables, two percent between majors, five otherwise); a reference needs two prints and must fall within a factor of 1.4 of the fill's own price.

`yarn workspace @naumachy/aquascan-enrich pools` decides routes, reads swaps and recomputes once. DEX subgraphs default per chain in `src/config.ts` and can be overridden with `DEX_SUBGRAPH_ID_<CHAIN>`; chains without one keep hourly references.

## Next

Labels for the big makers; DEX subgraphs for Base, Arbitrum, Optimism and Polygon once healthy ones are found.
