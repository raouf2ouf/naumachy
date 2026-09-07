# agents

The gladiators' minds. Owner: Rudis vertical.

One process per gladiator per generation. It reads the arena so far (generations, entries, attested scores, the champion), every desk's live verdict on the gym Aquascan, the pool's recent behaviour, and the knobs every rival shipped (public: the program is bytes on chain). It then chooses the knobs of its next program inside the anchored archetype grammar (`RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt`) through one call to the Claude API, validates the draft on a private anvil forked from the gym (ship, quote both ways), docks its previous program, ships the new one from its own wallet, and enters the generation. Its knobs, program, rationale and what it saw go to `infra/data/gym/generations/<generation>-<address>.json`.

The mind has three ways in. `GLADIATOR_MIND=heuristic` is the control, no call. `GLADIATOR_TOOLS=off` is one call on the briefing alone. The default gives the mind tools and lets it read before it answers: `get_schema` (a subgraph's schema), `query_subgraph` (GraphQL against the arena, pools or aqua subgraph), `aquascan` (a path of the scorer's API); at most six reads, then the knobs. On the network (`GLADIATOR_GRAPH=mcp` with `ARENA_SUBGRAPH_ID`, `POOLS_SUBGRAPH_ID`, `AQUA_SUBGRAPH_ID`) the GraphQL goes through The Graph's hosted Subgraph MCP (`subgraphs.mcp.thegraph.com`, the gateway key as the token) via the API's MCP connector, and the local query tool steps aside. Every read, with its query, lands in the generation file next to the knobs and the rationale: the transcript of what the gladiator looked at before it chose. Measured on 2026-09-07 (one decision, the briefing cached across the reads): Sonnet 5 at medium effort, briefing only, 8.4K tokens in and 0.5K out in one call; Sonnet 5 with tools, two calls, 2.1K uncached in, 10.8K cached, 0.9K out; Opus 4.8 at high effort with tools, two calls, 3.6K uncached in, 12K cached, 1.9K out. A generation of four Opus 4.8 minds is under a dollar at the Opus list price. `GLADIATOR_MAX_READS` (3) and `GLADIATOR_READ_CHARS` (3000) bound a decision; `CONTEXT_GENERATIONS` (6) bounds the briefing; every generation file records the tokens it cost.

The evolution loop is the lanista's: open a generation, run the gladiators, let the taker engine trade for a few minutes, score from Aquascan, attest, crown, close, repeat. A control line (`GLADIATOR_MIND=heuristic`) replaces the mind with a deterministic hill climber, so a generation can say what the mind is worth.

```
# gym up (infra/gym/README.md), engine running, ANTHROPIC_API_KEY in .env
GENERATIONS=2 GEN_MINUTES=8 yarn workspace @naumachy/agents evolve
GLADIATOR_MIND=heuristic yarn workspace @naumachy/agents evolve      # the control line, no key needed
GLADIATOR_KEY=0x… GLADIATOR_NAME=solo yarn workspace @naumachy/agents gladiator   # one gladiator, the open generation
```

Files: `src/context.ts` (what a gladiator sees), `src/mind.ts` (the call, the schema, the control), `src/gladiator.ts` (decide, validate, dock, ship, enter, record), `src/evolve.ts` (the loop). Reuses `arena/src/{program,ship,orders,lanista,abi,config}.ts`.

Keys never live in this package. Gym keys are anvil's; arena keys come from Ledger Key Ring on the arena host.
