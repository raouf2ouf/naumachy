# subgraphs

The Graph. Owner: Aquascan vertical.

- `aqua/`: the Aqua registry subgraph, one deployment per chain (Ethereum first, then Base). Schema in docs/interfaces.md.
- `arena/`: the ArenaRegistry subgraph on Base (live arena) and on the local graph-node (gym).
- `substreams/`: the SwapVM dialect disassembler as a Substreams package feeding a substreams-powered subgraph (composable-products track).

Rule: what the judges query must be published on The Graph Network and read through the gateway, not only Subgraph Studio. The same subgraph also runs on a local graph-node against the anvil fork for the gym.
