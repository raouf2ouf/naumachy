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
- 2026-09-05 Submodule pins: `swap-vm` v1.0.2 (the release line the deployed routers run and the published `@1inch/swap-vm-sdk` 0.4.1 encodes for; `main` moved to a sparse 256-slot opcode numbering the SDK does not use), `aqua` v1.0.0 (interface identical to 0.1.0), `forge-std` v1.16.2.
- 2026-09-05 Opcode bytes are positional: the table's first static slot becomes the array length word, so runtime byte = static index minus one (full router: jump 0x0a, dynamicBalances 0x12, salt 0x22, last 0x2d; Aqua router: concentrate 0x12, last 0x21). SDK 0.4.1 encodes exactly this. Custom opcodes are appended after the last slot by overriding `_opcodes()` in `NaumachyRouter`, so the first custom byte is 0x2e. On the SDK side the same byte falls out of a `ProgramBuilder` subclass whose instruction list is the SDK's full list plus ours.

- 2026-09-06 Chain roster for the Aqua subgraph: all six chains where Aqua has activity (Ethereum, BSC, Polygon, Base, Arbitrum, Optimism). One codebase, one manifest per network from a shared template. Publish order: Ethereum first, Base second, the other four as one batch once the mappings are proven on Ethereum, so a mapping bug never costs six resyncs.
- 2026-09-06 Both Aqua registries are indexed. The canonical registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` (July 2026, the one 1inch documents) and the legacy registry `0x499943e74fb0ce105688beee8ef2abec5d936d31` (active since November 2025; fills on Ethereum, Base and Arbitrum only, verified on chain). Same ABI and handlers as a second data source, a `registry` field on Strategy and Fill, the explorer defaults to canonical and badges legacy. Start block per chain and registry is the deployment block.

- 2026-09-06 Prices. No oracle subgraph: an on-chain price subgraph would mean one data source per feed per chain, aggregator upgrades to track, and thin coverage of the long tail Aqua makers trade. Three kinds of price instead. Pair-native prices and 24h VWAP marks come from a strategy's own fills in the Aqua subgraph and need no oracle; the arena scores on these. Dollar prices per token and hour come from DefiLlama as the primary source, which blends venues itself, with a negative cache for uncovered hours. Markout references come from The Graph Token API's hourly candles on the deepest pool of the exact pair a desk quotes; pool choice is a written rule (known factories, minimum age and activity, direct stable pool else one hop through WETH, median of qualifying pools, cross-checked against DefiLlama), stored in a routes table and overridable. Every priced number carries provenance and confidence; a token with no acceptable price stays unpriced rather than wrong. Granularity is hourly; no sub-hour markouts.

## Assumed (proceeding, not yet confirmed)

- Live arena chain = Base. Alternate: Arbitrum.
- A network-published subgraph on Base indexing ArenaRegistry counts as live Graph data.
- The canonical Base Aqua router is the 16-opcode AquaSwapVMRouter; NaumachyRouter is a modified redeployment of the full router.
- Tenderly virtual testnets count as local forks for 1inch. We use anvil regardless.

- 2026-09-06 Enrichment rollup, taken while building, to review: markout references are the hourly dollar prices at fill hour plus one hour and one day (DefiLlama), the same source as the edge, so the two are comparable; same-pair pool candles from the Token API are the planned refinement, not the first cut. Volume of a fill is the dollar value of what the maker received at the fill hour. The numeraire is a stablecoin when the strategy touched one (matched on symbol against a fixed list in `aquascan/enrich/src/rollup.ts`), else its most traded token, ties broken by address. The rollup recomputes every derived table in one transaction after each pass; with a quarter million fills it takes under half a minute, so incremental rollups can wait.

## Open

- Which custom opcode(s) ship first: RiskCap, FlashRebalance, ToxicityFee, ArenaExtruction. Decided at M1.
- Bankroll per gladiator on Base.
- Whether the taker on Base is only our engine or also real takers (real takers are the truest fitness function; state it in the video either way).
- ENS lineage subnames: only if it costs nothing after M5.
