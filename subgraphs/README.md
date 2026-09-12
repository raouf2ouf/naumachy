# subgraphs

The subgraphs, one manifest per source, published on The Graph Network.

- `aqua/`: the Aqua registry subgraph, one deployment per chain (Ethereum first, then Base). Schema in docs/interfaces.md.
- `arena/`: the ArenaRegistry subgraph on Base (live arena) and on the local graph-node (gym).
- `pools/`: the swaps of a fixed set of Uniswap v3 pools on Base, the pool lane's reference prices.

Robinhood Chain is not indexable by subgraph; `substreams/aqua` at the repository root covers it and the enrichment replays its events into the same tables.

Every production query goes through the network deployments and the gateway. The same manifests run on a local graph-node against the anvil fork for the gym.
