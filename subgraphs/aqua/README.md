# subgraph: aqua

The Aqua registry on one chain, both registries (canonical and legacy), events `Shipped`, `Docked`, `Pulled`, `Pushed`. Schema and start blocks are specified in `docs/interfaces.md`; change that document first.

## Files

- `subgraph.yaml` is the Base instance. `networks.json` holds addresses and start blocks for all six chains; `graph build --network <name> --network-file networks.json` rewrites the manifest for that chain.
- `abis/Aqua.json` is the event subset of `IAqua` (identical across every Aqua release).
- `schema.graphql` follows `docs/interfaces.md`.
- `src/mapping.ts` holds the four handlers.

## Commands

From the repo root after `yarn install`:

```sh
yarn workspace @naumachy/subgraph-aqua codegen
yarn workspace @naumachy/subgraph-aqua build            # Base
yarn workspace @naumachy/subgraph-aqua build:mainnet    # Ethereum, and so on per chain
```

## Local graph-node

`infra/graph-node/` runs graph-node, IPFS and Postgres for one chain. Point it at an RPC that serves wide historical `eth_getLogs` ranges and `eth_getBlockReceipts`; the sync is a range scan, and every head block is loaded with all of its receipts.

- Tenderly's gateway does both (Base: million-block ranges, block receipts in one call). Set it as `GRAPH_RPC`.
- Public endpoints do not survive a graph-node ingestor: Base's own endpoint banned the machine after twenty thousand receipt requests in half an hour. Alchemy's free tier caps log ranges at ten blocks, which makes the L2s impossible to scan.
- Event handlers only. Call and block handlers need tracing APIs these endpoints do not provide.

## Studio and the network

Deploying to Studio uploads the build to The Graph's IPFS and starts a test sync on their nodes. Publishing from Studio records the deployment onchain (one transaction on Arbitrum One) and the network's indexers pick it up. Queries go through the gateway with an API key created in Studio. Only the network deployment counts for the judges.

`indexerHints.prune: auto` keeps indexers lean; time-travel queries are not part of the design.
