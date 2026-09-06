# Decisions log

Short, dated, one line each. Newest at the top of each list. Anyone's AI session reads this before deciding something a teammate could disagree with.

## Decided

- 2026-09-05 Name: Naumachy (submission and repo). Rudis is the prize and the closing line. Aquascan is the instrument. naumachy.eth, .xyz, .fi, GitHub and npm were free at check time.
- 2026-09-05 Partner picks: 1inch, The Graph, Ledger. Uniswap dropped (peripheral in a 1inch-first project). ENS is the alternate to Ledger if Key Ring proves unusable.
- 2026-09-05 One submission, one monorepo. Aquascan's chain data comes from The Graph only. Prices and derived metrics in an enrichment service, disclosed.
- 2026-09-05 Gym on an anvil fork with a local graph-node; arena live on Base with small real bankrolls, indexed by the network.
- 2026-09-05 Only economic fills count, everywhere, including the arena scorer.
- 2026-09-05 Ownership by vertical: Raouf = Rudis (contracts, agents, arena, Ledger); Kate = Aquascan (subgraphs, substreams, aquascan, mcp, video script, feedback docs). Equal skills assumed.
- 2026-09-05 License: MIT for our code; 1inch repos as submodules under Degensoft 1.1.

- 2026-09-06 Chain roster for the Aqua subgraph: all six chains where Aqua has activity (Ethereum, BSC, Polygon, Base, Arbitrum, Optimism). One codebase, one manifest per network from a shared template. Publish order: Ethereum first, Base second, the other four as one batch once the mappings are proven on Ethereum, so a mapping bug never costs six resyncs.
- 2026-09-06 Both Aqua registries are indexed. The canonical registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` (July 2026, the one 1inch documents) and the legacy registry `0x499943e74fb0ce105688beee8ef2abec5d936d31` (March 2026; activity on Ethereum, Base and Arbitrum only, verified on chain). Same ABI and handlers as a second data source, a `registry` field on Strategy and Fill, the explorer defaults to canonical and badges legacy. Start block per chain and registry is the deployment block.

## Assumed (proceeding, not yet confirmed)

- Live arena chain = Base. Alternate: Arbitrum.
- A network-published subgraph on Base indexing ArenaRegistry counts as live Graph data.
- The canonical Base Aqua router is the 16-opcode AquaSwapVMRouter; NaumachyRouter is a modified redeployment of the full router.
- Tenderly virtual testnets count as local forks for 1inch. We use anvil regardless.

## Open

- Which custom opcode(s) ship first: RiskCap, FlashRebalance, ToxicityFee, ArenaExtruction. Decided at M1.
- Bankroll per gladiator on Base.
- Whether the taker on Base is only our engine or also real takers (real takers are the truest fitness function; state it in the video either way).
- ENS lineage subnames: only if it costs nothing after M5.
