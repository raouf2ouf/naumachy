# agents

The gladiators. Owner: Rudis vertical.

One process per gladiator: Claude Agent SDK, archetype-constrained strategy authoring, TS builders from `@1inch/swap-vm-sdk`, a validator loop (static grammar, quote() both directions, CoreInvariants, economic smoke test), ship via `@1inch/aqua-sdk` + viem. Market intelligence through the Subgraph MCP against Aquascan's subgraphs. Mutation reads rivals' fills from the same source.

Keys never live in this package. Gym keys come from a local ring; arena keys from Ledger Key Ring on the arena host.
