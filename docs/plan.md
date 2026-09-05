# Naumachy - plan

Objectives are judge gates. Milestones are submittable states. Sequencing is by dependency, not by day. Time budgets are deliberately absent.

## 1. Judge gates

Every gate is a checkbox. A task that moves no gate is a task we question.

### 1inch - Build an Aqua App ($5,000: 2,500 / 1,500 / 1,000)

- [ ] G1.1 A custom Aqua app: a modified SwapVM router (`NaumachyRouter`) redeployed with at least one custom opcode. "Projects that utilize SwapVM will be scored higher."
- [ ] G1.2 Official Aqua and SwapVM contracts used (modified redeployment is explicitly allowed).
- [ ] G1.3 Onchain execution of token transfers shown in the final demo. Local forks are OK per the track page. We show both: the gym on a fork and the arena on Base.
- [ ] G1.4 A sophisticated DeFi position: gladiator programs compose concentrated ranges, oracle anchoring, fee tiers, a risk cap, and flash liquidity (the workshop hinted at flashloans as a differentiator).
- [ ] G1.5 Positions demonstrated through tests and a UI (Foundry tests plus Aquascan).
- [ ] G1.6 A `docs/feedback/1inch.md` worth reading, plus any protocol findings routed to HackenProof first.

### The Graph ($10,000 across two from-scratch tracks, 3 places each)

Track A, composable or standardized products:
- [ ] GA.1 Two or more Graph products composed: subgraphs (Aqua per chain, arena), a Substreams package (SwapVM dialect disassembler) feeding a substreams-powered subgraph, and the Subgraph MCP as the agents' query layer.
- [ ] GA.2 Live data from a Graph provider: published on The Graph Network, queried through the gateway with an API key. Studio-only does not count.
- [ ] GA.3 Public repo, 2 to 4 minute demo.

Track B, AI tooling or AI use case:
- [ ] GB.1 The Graph is load-bearing: the gladiators read the corpus and rivals' fills through the Subgraph MCP; Aquascan's chain data is Graph-sourced with no other chain lane.
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

- Generation loop: losers read winners' fills through the Subgraph MCP, mutate, re-ship. Lineage recorded in ArenaRegistry.
- Hold-out tape: train on tape A, score on unseen tape B.
- Explainability: debug router traces per fill, decoded bytecode diffs between generations.
- Gates moved: GB.1, GB.2 in full.

### M5 - Steel

- Key Ring on the arena host: `wallet-cli ring` holds gladiator keys and RPC keys, headless decrypt. Setup log goes to the feedback doc the same day.
- Promotion gate: champion bankroll move requires a tap on the Flex. Documented boundary.
- Live arena on Base: small real bankrolls, ArenaRegistry deployed, arena subgraph published to the network, champion visible on the mainnet leaderboard.
- Gates moved: GL.1 to GL.5, G1.3 (real chain), GA.2 (arena subgraph).

### M6 - Instruments

- Substreams disassembler package and substreams-powered subgraph (GA.1).
- Aquascan MCP server and the analyst (GB.2 for Aquascan).
- Markouts 1h/24h, taker stats and self-trade flag, labels for the top makers.
- Overview polish for cognitive load.

### M7 - Spectacle

- Video: one protagonist, two Aquascan beats, closing line. Human narration.
- README final, feedback docs final, submission form, pool selection.
- Gates moved: GF.1, GF.3, GL.4, G1.6.

## 3. Sequencing by dependency

1. M1 before any agent code: the opcode design decides what programs can express.
2. The subgraph schema (interfaces) before enrichment, web, agents, or MCP: everything downstream reads it.
3. Local graph-node on the fork before the gym loop: the scorer must exist before the first generation.
4. Key Ring spike early, in parallel with M2: if headless decrypt on a host without USB does not work, the Ledger story degrades to device approval only, and we want to know that before M5.
5. Substreams and the MCP server can start any time after the schema; they do not block the arena.
6. Video last, but the recorded gym runs that feed it come from M4.

## 4. Ownership

- **Rudis vertical (Raouf)**: M1, M3, M4, M5, the Ledger path, the taker engine.
- **Aquascan vertical (Kate)**: M2, M6, labels, overview, analyst, MCP, video script and storyboard, both feedback docs.
- Shared: `docs/interfaces.md`, `docs/decisions.md`, the README.

## 5. Open verifications

- The Graph mentor: Base subgraph of our own contracts counts as live data from a Graph provider.
- The Graph: Substreams support on Base and Ethereum for the disassembler (expected yes).
- Ledger: Key Ring headless decrypt mechanics on a VPS, from the docs at developers.ledger.com and the Telegram group.
- 1inch: which router variant sits at the canonical Base address, and the license line for submodules in the README.
- Chain for the live arena: Base assumed (cheap gas, Aqua deployed, Graph supported). Arbitrum is the alternate.
- Bankroll size per gladiator for the live arena: Raouf's call, small.
