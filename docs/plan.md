# Naumachy - plan

Objectives are judge gates. Milestones are submittable states. Sequencing is by dependency, not by day. Time budgets are deliberately absent.

## 1. Judge gates

Every gate is a checkbox. A task that moves no gate is a task we question.

### 1inch - Build an Aqua App ($5,000: 2,500 / 1,500 / 1,000)

- [ ] G1.1 A custom Aqua app: a modified SwapVM router (`NaumachyRouter`) redeployed with at least one custom opcode. "Projects that utilize SwapVM will be scored higher."
- [ ] G1.2 Official Aqua and SwapVM contracts used (modified redeployment is explicitly allowed).
- [ ] G1.3 Onchain execution of token transfers shown in the final demo. Local forks are OK per the track page. We show both: the gym on a fork and the arena on Base.
- [ ] G1.4 A sophisticated DeFi position: gladiator programs compose a pass gate, fees that widen with one-way flow or differ by the token the taker pays, a per-pair oracle anchor, a risk cap, and one ledger behind three markets (2026-09-08: built, on the fork; flash liquidity is possible through SwapVM's maker hooks but kept out as custody, not pricing).
- [ ] G1.5 Positions demonstrated through tests and a UI (Foundry tests plus Aquascan).
- [ ] G1.6 A `docs/feedback/1inch.md` worth reading, plus any protocol findings routed to HackenProof first.

### The Graph ($10,000 across two from-scratch tracks, 3 places each)

Track A, composable or standardized products:
- [x] GA.1 Two or more Graph products composed: subgraphs (Aqua per chain, arena) and a Substreams package (`substreams/aqua`, the Aqua registry events for Robinhood Chain, which The Graph reaches only through Firehose) feeding the same explorer, plus the Subgraph MCP as the agents' query layer. Done 2026-09-08.
- [x] GA.2 Live data from a Graph provider: published on The Graph Network, queried through the gateway with an API key. Studio-only does not count. Done 2026-09-06: six Aqua subgraphs published (ids in `subgraphs/aqua/README.md`), served through the gateway, read by `aquascan/enrich`.
- [ ] GA.3 Public repo, 2 to 4 minute demo.

Track B, AI tooling or AI use case:
- [ ] GB.1 The Graph is load-bearing: the gladiators read the corpus and rivals' fills through the Subgraph MCP; Aquascan's chain data is Graph-sourced with no other chain lane. Aquascan side done 2026-09-06: the enrichment service reads only the six gateways; prices come from DefiLlama, which is not chain data. Gladiator side open.
- [ ] GB.2 Meaningful work with the data: strategy authoring and mutation decisions, plus the Aquascan analyst.
- [ ] GB.3 Correct pool selected at submission: from scratch.

Verify with The Graph mentor: a network-published subgraph on Base that indexes our own ArenaRegistry counts as live data from a Graph provider. We are confident, and it is the load-bearing assumption.

### Ledger - AI Agents x Ledger ($3,500: 2,000 / 1,000 / 500)

- [ ] GL.1 Built on the Ledger Agent Stack: Ledger Key Ring CLI (`wallet-cli ring`) holds gladiator keys and API secrets on the arena host, decrypted headless. Key Ring on a host without USB is one of their named directions.
- [ ] GL.2 A clear boundary between autonomous behaviour and explicit approval: gladiators trade autonomously in the gym and with capped bankrolls in the arena; promotion of a champion (a real bankroll move) requires device confirmation on the Flex. Written down and shown in the video.
- [ ] GL.3 Concrete Ledger primitives, not branding: Key Ring, DMK skills or wallet-cli for the approval tap, Clear Signing where it applies.
- [ ] GL.4 `docs/feedback/ledger.md` filled with dated developer-experience entries. Mandatory.
- [ ] GL.5 Runnable repo or recorded walkthrough of the Ledger path.

### ETHGlobal finalist (top 10 of the event)

- [ ] GF.1 One protagonist, one video, 2 to 4 minutes, narrated by a human, 720p or better.
- [ ] GF.2 A public live URL for Aquascan and a public arena state.
- [ ] GF.3 Honesty: recorded real runs, losing generations shown, hold-out tape scored.

## 2. Milestones

Each milestone is something we could submit if everything after it failed. Order protects the 1inch prize first, then The Graph, then Ledger.

### M0 - Skeleton and agreement (this)

Repo, `CLAUDE.md`, plan, lessons, interfaces, decisions, commit queue.

### M1 - First blood on our router

- `forge init`, `aqua` and `swap-vm` as submodules, compile.
- `NaumachyRouter`: full SwapVM opcode set plus custom opcode(s). Candidates, pick at the go/no-go:
  - **RiskCap**: an arena rule enforced in bytecode. Caps per-fill exposure or drawdown relative to the strategy's Aqua balance. Every gladiator must compose with it. Cheap, honest, and it makes "sophisticated position" true for every program.
  - **FlashRebalance**: flash-liquidity aware instruction (the workshop hint). A gladiator can borrow inside the settlement to rebalance atomically.
  - **ToxicityFee**: a fee that widens with recent adverse selection, using per-order storage the way DynamicBalances does.
  - **ArenaExtruction**: an Extruction target that reads generation state from ArenaRegistry.
- One hand-written gladiator program. `quote()` both directions. `swap()` on an anvil fork with real token transfers. CoreInvariants pass.
- Go/no-go: if the custom opcode cannot be made to run on our router on the fork, fall back to canonical router plus Extruction. The arena survives either way.
- Gates moved: G1.1, G1.2, G1.3 (fork), G1.4, G1.5 (tests).

### M2 - Aquascan sees mainnet

- Aqua subgraph: schema from `docs/interfaces.md`, mappings for Shipped, Docked, Pulled, Pushed, template hashing, economic-fill flag computed in the mapping. Deploy to Studio, publish to the network for Ethereum, then Base.
- Enrichment service reads the gateway: fills, numeraire, 24h VWAP marks, USD at fill hour, provenance.
- Web: overview as a pulse (hero claim, one chart, top desks, latest ships as sentences, provenance footer), desk and strategy pages.
- Public URL.
- Gates moved: GA.2, GB.1 (data side), GF.2.

### M3 - The gym

- ArenaRegistry contract and its subgraph on a local graph-node against the anvil fork. Same Aqua subgraph indexes the fork.
- Taker engine: replays market movement on the fork and takes gladiator quotes (the replay engine is the taker, which is Aqua's own model). Uniswap pools on the fork are the market reference.
- Agent runtime: archetype-constrained authoring, validator loop, ship. One full generation of 4 to 6 gladiators. Aquascan-on-fork scores it. Leaderboard renders.
- Gates moved: GB.2 (authoring), G1.5 (UI).

### M4 - Evolution

- Generation loop: losers read winners' fills through the Subgraph MCP, mutate, re-ship. Lineage recorded in ArenaRegistry. (2026-09-07: loop built in `agents/`, reads the gym subgraphs and Aquascan directly, not the MCP yet; lineage on chain at registration only, per entry in the generation files; control line beside the minds; the minds wait for an API key.)
- Hold-out tape: train on tape A, score on unseen tape B. (Label alternates per generation; segment replay waits for the tape.)
- Explainability: debug router traces per fill, decoded bytecode diffs between generations. (Generation files carry knobs, program, rationale, context; the diff of two files is the decoded diff. Router traces open.)
- Gates moved: GB.1, GB.2 in full.

### M5 - Steel

- Key Ring on the arena host: `wallet-cli ring` holds gladiator keys and RPC keys, headless decrypt. Setup log goes to the feedback doc the same day.
- Promotion gate: champion bankroll move requires a tap on the Flex. Documented boundary.
- Live arena on Base: small real bankrolls, ArenaRegistry deployed, arena subgraph published to the network, champion visible on the mainnet leaderboard.
- Gates moved: GL.1 to GL.5, G1.3 (real chain), GA.2 (arena subgraph).

### M6 - Instruments

- Substreams package for the chains Studio does not serve, replayed by the enrichment (GA.1). Done 2026-09-08 for Robinhood Chain.
- Aquascan MCP server and the analyst (GB.2 for Aquascan).
- Markouts 1h/24h, taker stats and self-trade flag, labels for the top makers.
- Overview polish for cognitive load.

### M7 - Spectacle

- Video: one protagonist, two Aquascan beats, closing line. Human narration.
- README final, feedback docs final, submission form, pool selection.
- Gates moved: GF.1, GF.3, GL.4, G1.6.

## 3. Sequencing by dependency

Agreed 2026-09-07 evening, after M1 to M4 ran on the gym. Each step unblocks the next; no time budgets.

1. **Flow fix in the taker engine** (Raouf's vertical). Uninformed orders pick the best quote among the gladiators and the pool within a random tolerance; the informed flow stays. Generation 3's champion was the highest fee because the old flow took any price; nothing recorded before this fix is worth recording.
2. **Keys and devices** (Raouf, in parallel): Opus 4.8 key in `.env`; Ledger Sync app on the Flex, `ring init`, the Base account discovered; the VPS ordered and a subdomain pointed at it; Kate told an Arena page is coming in her app.
3. **First minded season on the gym**, on the baked context, as soon as the key is in.
4. **Subgraph MCP inside the minds**: the mind queries the arena and pools subgraphs itself through The Graph's Subgraph MCP (fallback: a tool of ours running the same GraphQL against the gateway); its queries land in the generation file. Second season with it. This is the composition claim (GA.1) and the load-bearing claim (GB.1).
5. **Arena page in Aquascan**: generations, entries, attested score beside the live figure, champion, lineage, knobs diff, rationale. Interface written first, Kate informed.
6. **Base**: six keys generated into the encrypted secrets file, the lean float funded by Raouf, contracts deployed, arena subgraph published to the network, mainnet Aquascan pointed at our router.
7. **VPS and Ledger**: Aquascan migrated, Caddy, the hourly arena loop booting from Key Ring; one attempt at USB/IP enrollment, then the transplant fallback, documented either way. The promotion step in the lanista, then Raouf's first tap on the Flex.
8. **Aquascan MCP server** (`mcp/`): the analyst over the API including the arena endpoints. Built by Raouf's vertical, Kate informed.
9. **Predator versus defended maker** in the gym, recorded and scored: the pool-manipulation take against a flat-fee maker, then against ToxicityFee plus RiskCap.
10. **Proof pieces**: root README for judges, the boundary document, feedback pages for The Graph and Ledger completed, the Graph composition story written explicitly; the repo flipped public here, not at the last hour. If time remains: the fillable-liquidity lane through The Graph's Token API as a second composition.
11. **Video** (Kate and Raouf), from recorded runs and the live Arena page; feature freeze before it; submission form the morning before the deadline.

Added 2026-09-08, after Raouf's question "what does SwapVM add": (a) **structural authoring**, the minds write instruction lists in the dialect and the compiler emits bytes (done; the decoded listing is the "AI wrote it" proof); (b) **the gate and direction-aware fees** for the defended maker of step 9 (done in the dialect; the raider is the engine's second taker); (c) **one inventory, three markets**, the multi-pair anchor with the triangle test and validator (done). These land before step 6, since the Base deployment ships the new router.

Worst odds: the enrollment hack (fallback exists), minds producing boring knobs (step 1 is the remedy), Base needing enough hours of generations to look like an arena before the video (which is why step 6 precedes steps 8 to 10).

## 4. Ownership

- **Rudis vertical (Raouf)**: M1, M3, M4, M5, the Ledger path, the taker engine.
- **Aquascan vertical (Kate)**: M2, M6, labels, overview, analyst, MCP, video script and storyboard, both feedback docs.
- Shared: `docs/interfaces.md`, `docs/decisions.md`, the README.

## 5. Open verifications

- The Graph mentor: Base subgraph of our own contracts counts as live data from a Graph provider.
- The Graph mentor: a network-published subgraph over our own registry, read by the gladiators through the Subgraph MCP, counts as composing two Graph products; and whether a fillable-liquidity lane through the Token API counts as a second composition.
- The Graph: a Substreams package read by our own consumer counts as a composed product next to the subgraphs (the package is registry-publishable; publish if they want it visible on substreams.dev).
- Ledger: Key Ring headless decrypt mechanics on a VPS, from the docs at developers.ledger.com and the Telegram group.
- 1inch: which router variant sits at the canonical Base address, and the license line for submodules in the README.
- Chain for the live arena: Base assumed (cheap gas, Aqua deployed, Graph supported). Arbitrum is the alternate.
- Bankroll size per gladiator for the live arena: Raouf's call, small.
