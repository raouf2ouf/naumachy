# subgraphs/pools

Swaps of a fixed set of Uniswap v3 pools on Base, in the field names the Uniswap subgraphs use (`pools`, `swaps`, `poolDayData`), so Aquascan's pool lane reads this subgraph or a published Uniswap one without caring which. Thirteen pools cover WETH/USDC at three fee tiers, cbBTC, AERO, cbETH, USDT, USDbC, DAI and EURC against their usual quote, indexed from block 49,700,000 (about thirty days before 2026-09-07). Dollars are not computed here: `volumeUSD` stays 0 and Aquascan prices what it needs.

The same manifest indexes an anvil fork of Base through the local graph-node in `infra/graph-node`, which is how the gym scores gladiators against the pool at the block.

```sh
yarn workspace @naumachy/subgraph-pools codegen
yarn workspace @naumachy/subgraph-pools build
yarn workspace @naumachy/subgraph-pools deploy:studio --version-label v0.1.0
```

## Published

| Chain | Studio slug | Network id | Version |
|---|---|---|---|
| Base | naumachy-pools-base | `6k7nx7L8JJu5bCuo6nQdiV7vn1uTxtXsBjUZy7XHzmNQ` | v0.1.0 (QmTkLk1NRJ67oraCq3mK2Pt3bqbAiydf8R9Yr1yBSv8z4R) |

Gateway: `https://gateway.thegraph.com/api/<GRAPH_API_KEY>/subgraphs/id/6k7nx7L8JJu5bCuo6nQdiV7vn1uTxtXsBjUZy7XHzmNQ`. Aquascan reads it through `DEX_SUBGRAPH_ID_BASE`.
