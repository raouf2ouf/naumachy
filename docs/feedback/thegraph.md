# The Graph - feedback

Dated developer-experience entries from building Aquascan (subgraphs per chain, a pools subgraph, an arena subgraph) and the gym (a local graph-node over an anvil fork of Base).

## Entries (dated)

- 2026-09-08 A local graph-node over a fresh anvil fork of Base stalled for good at the fork block: the block ingestor downloads the head's 50 ancestors at start (`ETHEREUM_ANCESTOR_COUNT`), and a pre-fork Base block served through anvil from the upstream RPC failed `eth_getBlockReceipts` parsing (`missing field blockNumber`) on every retry, so no subgraph advanced and `indexingStatuses` showed a null `chainHeadBlock` with `health: healthy`. A restart once the fork had mined 50 blocks fixed it. Two asks: surface the ingestor's stuck state in `indexingStatuses` (a healthy subgraph that cannot move is not healthy), and let `ETHEREUM_ANCESTOR_COUNT` be documented next to `GRAPH_ETHEREUM_REORG_THRESHOLD` for fork-based development.
- 2026-09-08 The Subgraph MCP (`subgraphs.mcp.thegraph.com`) cannot reach a local graph-node, which is the right boundary, but it means an agent developed against a fork uses a different tool than the one it uses on the network. We kept the GraphQL identical and swapped the transport (`GLADIATOR_GRAPH=local|mcp`); a documented way to point the MCP at a self-hosted node for development would remove the split.
