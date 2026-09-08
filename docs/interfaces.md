# Interfaces - the seams between packages

Draft. Fields marked TBD are decided at the milestone that first needs them. Changing anything here: edit this doc first, log it in `docs/decisions.md`, then code.

## 1. Aqua subgraph (per chain) - `subgraphs/aqua`

Source: two Aqua registries on each chain, same ABI, events `Shipped`, `Docked`, `Pulled`, `Pushed` (no parameter is indexed; the signatures are identical across every Aqua release).

- Canonical registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` (July 2026, the address 1inch documents).
- Legacy registry `0x499943e74fb0ce105688beee8ef2abec5d936d31` (first fills November 2025 on Base and Arbitrum, February 2026 on Ethereum; no activity elsewhere). Indexed as a second data source so nothing is missed; entities carry `registry` and the explorer badges legacy.

Start blocks, verified on chain. Canonical = the registry's deployment block (its first log). Legacy = its first event on chains with history, otherwise the canonical deployment block, so the data source exists everywhere and nothing is scanned twice.

| network (manifest name) | canonical start | legacy start |
|---|---|---|
| Ethereum (`mainnet`) | 25567141 | 24517760 |
| Base (`base`) | 48839900 | 38495747 |
| Arbitrum (`arbitrum-one`) | 485505646 | 403010640 |
| Optimism (`optimism`) | 154434383 | 154434383 |
| Polygon (`matic`) | 90508403 | 90508403 |
| BSC (`bsc`) | 110908635 | 110908635 |
| Robinhood Chain (`robinhood`, id 4663) | 13888204 | 13888204 (registry never deployed there; the data source stays silent so the shared manifest builds) |

Entities (draft):

```graphql
type Maker @entity { id: Bytes!  # address, lowercase
  strategies: [Strategy!]! @derivedFrom(field: "maker")
  desks: [Desk!]! @derivedFrom(field: "maker")
  shipCount: Int!  firstSeen: BigInt!  lastSeen: BigInt! }

type App @entity { id: Bytes!  # router address
  dialect: String!  # key into the disassembler tables: address + version, e.g. "aqua-router@1.0.1"
  strategyCount: Int! }

type Template @entity { id: Bytes!  # keccak(opcode sequence, args ignored)
  opcodes: [Int!]!  name: String  # human name if known, else null
  strategyCount: Int!  economicVolumeLegs: Int! }

type Desk @entity { id: ID!  # maker-template-chain
  maker: Maker!  template: Template!  chain: String!
  strategies: [Strategy!]! @derivedFrom(field: "desk")
  liveCount: Int!  fillCount: Int!  economicFillCount: Int!  firstSeen: BigInt!  lastSeen: BigInt! }

type Strategy @entity { id: Bytes!  # maker ++ app ++ strategyHash, the key Aqua itself uses
  strategyHash: Bytes!  registry: Bytes!  # which Aqua registry emitted it: canonical or legacy
  maker: Maker!  app: App!  desk: Desk!  template: Template!
  blob: Bytes!  # as shipped; keccak(blob) = strategyHash
  program: Bytes!  parsed: Boolean!  tokens: [Bytes!]!  amounts: [BigInt!]!  # tokens and amounts = declared starting inventory
  shippedAt: BigInt!  shippedTx: Bytes!  dockedAt: BigInt  dockedTx: Bytes
  status: StrategyStatus!  # LIVE | DOCKED
  fills: [Fill!]! @derivedFrom(field: "strategy") }

type Fill @entity { id: ID!  # tx-strategyId
  registry: Bytes!
  strategy: Strategy!  tx: Bytes!  block: BigInt!  timestamp: BigInt!
  taker: Bytes  # tx.from when available in the mapping (TBD: receipt access)
  legs: [Leg!]! @derivedFrom(field: "fill")
  shape: FillShape!  # PUSH_ONLY | PULL_ONLY | TWO_SIDED | MULTI
  economic: Boolean!  # TWO_SIDED or MULTI. The only fills that count.
  legCount: Int!  pushedLegs: Int!  pulledLegs: Int! }

type Leg @entity { id: ID!  # fill-token; mutable, one token can be pushed and pulled in one tx
  fill: Fill!  token: Bytes!  net: BigInt!  # push minus pull, per token
  pushed: BigInt!  pulled: BigInt! }

type DailyStrategyStat @entity { id: ID!  # strategyHash-day
  strategy: Strategy!  day: Int!  economicFills: Int!  legs: Int! }
```

Rules baked into the mappings, not into consumers: lowercase ids, the economic flag, template hashing, dialect key by app address. The Substreams package `substreams/aqua` (module `map_events`, output `naumachy.aqua.v1.Events`) carries the raw events for chains Studio does not serve; the enrichment's Substreams lane (`aquascan/enrich/src/lanes/aqua.ts`) applies these same rules, so the tables do not know which road a chain came by. Robinhood Chain (`robinhood`, 4663) is the first such chain.

### Pools subgraph - `subgraphs/pools`

Swaps of a fixed set of Uniswap v3 pools on Base, entities named as the Uniswap subgraphs name them (`pools`, `swaps`, `poolDayData`) so Aquascan's pool lane reads either. Published on the network as `6k7nx7L8JJu5bCuo6nQdiV7vn1uTxtXsBjUZy7XHzmNQ` (Base, v0.1.0). The same manifest indexes a fork of Base through the local graph-node; the gym scores gladiators against the pool at the block.

## 2. Arena subgraph - `subgraphs/arena`

Source: `ArenaRegistry` (contracts/src/ArenaRegistry.sol). Runs on the local graph-node for the gym and on The Graph Network for Base.

Events (as emitted by `ArenaRegistry`):

```solidity
event GladiatorRegistered(address indexed gladiator, bytes32 indexed name, uint32 generation, address indexed parent);
event GenerationOpened(uint32 indexed generation, bytes32 tape, uint64 openedAt);
event StrategyEntered(address indexed gladiator, bytes32 indexed strategyHash, uint32 indexed generation, bytes32 archetype);
event Scored(uint32 indexed generation, address indexed gladiator, bytes32 indexed strategyHash, int256 scoreQuote, int256 seQuote, uint32 fills, address quoteToken);
event GenerationClosed(uint32 indexed generation, address indexed champion, bytes32 championStrategy, int256 scoreQuote);
event Promoted(address indexed gladiator, bytes32 indexed strategyHash, uint256 chainId, uint256 bankroll);
```

Gladiators register and enter from their own wallets; the lanista (the contract owner) opens and closes generations, attests one score per entry, and promotes. An entry's `strategyHash` is the Aqua strategy hash, the tail of Aquascan's strategy id, so the two subgraphs join on it.

Entities: `Gladiator` (address, name, generation born, parent, entries), `Generation` (number, tape, opened, closed, champion), `Entry` (generation, gladiator, strategy hash, archetype, score), `Score` (score, standard error, fills, quote token), `Promotion`. Lineage is a tree through `parent`.

Score semantics: `scoreQuote` is the sum of the gladiator's 5-minute markouts in the quote token over the generation, economic fills only, as Aquascan computes it against the route reference (the pool at the block on Base); its standard error travels with it. The contract stores it as attested by the lanista process; the subgraph does not recompute it.

## 3. Aquascan API - `aquascan/api`

Read-only JSON. All amounts as strings, all addresses lowercase, every priced number wrapped as `{ value, source, at, confidence }`.

- `GET /api/overview?window=24h|7d|30d` hero numbers, deltas, top desks, latest ships as sentences, provenance footer.
- `GET /api/desks?chain&template&window&sort&minVolume`
- `GET /api/desk/:id` identity, stats, P&L block, strategies, fills feed, takers.
- `GET /api/strategy/:hash` decoded program (sentence, pipeline, raw hex), lifecycle, P&L, fills with implied prices.
- `GET /api/makers?chain&sort&limit&minVolume` one row per maker and chain from `maker_stats`: counts (templates, strategies, live, fills), the scored numbers with bands, fee rates, first and last seen, its top three pairs by volume with shares, and its templates (name, kind, strategies, live, volume), largest first.
- `GET /api/maker/:chain/:address` the maker in full: the row above with up to six pairs, its templates with their scored numbers, its strategies newest first (with the template name, paged by `offset` and `limit`), its fee summary and its recent economic fills.
- `GET /api/leaderboard?chain&minVolume&sort` ranks makers on a chain (same rows as `/api/makers`).
- `GET /api/desks`, `GET /api/desk/:chain/:id` the maker x template x chain grouping, kept for compatibility; the interface links makers.
- `GET /api/wallet/:address`
- `GET /api/search?q=` makers (with strategies, live, fills) and strategies, by lowercase prefix.
- `GET /api/arena` the arena as the registry's subgraph tells it, joined with Aquascan: generations newest first, each with its tape label, open and close times, champion, and entries; every entry carries the gladiator (address, name, parent, generation born), the strategy hash and Aquascan id, the archetype, the attested score (`score_quote`, `se_quote`, `fills`, `quote_token`, and `score_usd` from the quote token's decimals), the knobs it shipped (from the generation file; the rationale stays out), the kind of mind that wrote it, and the live Aquascan numbers for the strategy (fills, volume, edge, 5-minute markout with its band, maker fee); plus `gladiators` (with wins) and `promotions`. `ARENA_SUBGRAPH` is a graph-node URL (gym) or a network subgraph id (gateway); `GENERATIONS_DIR` holds the files; `ARENA_CHAIN` defaults to base.
- `GET /api/arena/generation/:number` one generation in full: the entries above plus, for each, the knobs of its parent line (the parent's program in the previous generation, or its own), the rationale and the reads transcript once the generation is closed, the draft prices from the private fork (`draft.pairs[name] = {sell, buy}` in the pair's conventional quote, `draft.loop = {usdcIn, usdcOut}` when it ships three pairs), the program bytes, its `listing` (the program as compiled, one line per instruction), its `pairs`, and the `rejected` drafts once closed.
- `GET /api/health` freshness per lane (subgraph head block, enrichment cursor, price coverage, share of fills referenced on the tape).
- Every scored number is `{value, source, at, confidence}`; scored rows carry edge, markout at 5 min, 1 h and 1 d, drift, maker and protocol fees, and the share of fills whose reference is the venue tape. Strategies and desks expose their decoded fee instructions.

## 4. Aquascan MCP server - `mcp`

Tools (names final, schemas TBD):

- `aqua.desks_bleeding(window, chain, limit)` desks with negative edge or negative markout, with evidence.
- `aqua.explain_strategy(hash)` one-sentence summary, decoded pipeline, template, risk notes.
- `aqua.takers(strategyHash)` who fills this strategy, concentration, markout inflicted.
- `aqua.templates(window)` what is deployed and what earns, template-level.
- `arena.generation(n)` entries, scores, champion, lineage.
- `arena.rival_fills(gladiator, generation)` the mutation signal.

The gladiators use the Subgraph MCP against the subgraphs for raw questions and this server for derived ones.

## 5. Agents to arena contract - `agents`

One process per gladiator per generation (`agents/src/gladiator.ts`), driven by the evolution loop (`agents/src/evolve.ts`) or standalone.

- Reads: the arena subgraph (generations, entries, attested scores, champion), the gym Aquascan API (`/api/strategy/base/<maker><router><strategyHash>`: live 5-minute markout, band, fills, decoded fee), the pools subgraph (the pool's last prints: price, prints per minute, realized volatility), the program bytes of every entry from the Aqua subgraph (listed in the dialect for everyone), and the generation files (spec and listing; its own rationale only).
- Decides: a program in the arena's dialect through the Claude API (adaptive thinking, structured output against `ProgramSchema`: `pairs` among WETH/USDC, cbBTC/USDC, cbBTC/WETH; `capBps`; `ops`, an ordered list of `gate`, `flatFee {bps}`, `toxicityFee {baseBps, slopeBps, maxBps, windowSeconds}`, `byTokenIn {cases: [{token, ops}], otherwise}`, `anchor {depth, maxStaleness}`, `xyc` last; `parent`; `rationale`), by default with tools: `get_schema(subgraph)`, `query_subgraph(subgraph, query)` (gym) or The Graph's Subgraph MCP (`execute_query_by_subgraph_id`, network), and `aquascan(path)`; the reads are recorded as `transcript` in the generation file. `GLADIATOR_TOOLS=off` is the briefing alone; `GLADIATOR_MIND=heuristic` the control.
- Compiles: `arena/src/program.ts` turns the spec into bytes (RiskCap first, Salt last, `byTokenIn` as `JumpIfTokenIn` branches) and a listing; `validateSpec` refuses a bad shape with a sentence.
- Validates: on a private anvil forked from the gym, ships the draft with the union of its pairs' tokens (`GEN_LEDGER_<SYMBOL>` per token), quotes both ways on every pair at a twentieth of the ledger as the passed taker, and, with three pairs, takes 50 USDC around USDC to WETH to cbBTC to USDC through the arena's taker: a loop that pays the taker is a refusal. A refusal goes back to the mind once with the verdict (`GLADIATOR_ATTEMPTS`, default 2).
- Writes: docks its previous programs (their own token lists), `Aqua.ship` from its own wallet, `ArenaRegistry.register` (first time) and `enter` (archetype `authored`); then `infra/data/gym/generations/<generation>-<address>.json`:

```json
{ "generation": 1, "name": "steady", "address": "0x…", "mind": "tools-local", "model": "claude-opus-4-8", "effort": "high",
  "spec": { "pairs": ["WETH/USDC", "cbBTC/USDC"], "capBps": 2000, "ops": [{ "op": "gate" }, { "op": "toxicityFee", "baseBps": 5, "slopeBps": 200, "maxBps": 50, "windowSeconds": 600 }, { "op": "anchor", "depth": 100, "maxStaleness": 0 }, { "op": "xyc" }], "salt": "…" },
  "listing": ["@  0  RiskCap 20% of either balance per fill", "@ 10  Gate: taker must hold an arena pass", "…"],
  "knobs": { "pairs": "WETH/USDC,cbBTC/USDC", "capBps": 2000, "gate": true, "feeBaseBps": 5, "feeSlopeBps": 200, "feeMaxBps": 50, "windowSeconds": 600, "depth": 100, "shape": "gate > toxicityFee > anchor > xyc", "parent": "0x… or null", "rationale": "…" },
  "program": "0x…", "tokens": ["0x…"], "ledger": ["1000000000000000000", "2500000000", "2000000"], "pairs": ["WETH/USDC", "cbBTC/USDC"], "blob": "0x…", "strategyHash": "0x…",
  "draft": { "pairs": { "WETH/USDC": { "sell": 2471.1, "buy": 2473.6 } }, "loop": null }, "rejected": [], "transcript": [], "usage": {}, "context": { "generations": [], "pool": {}, "me": {} } }
```

- `infra/data/gym/addresses.json` (written by `infra/gym/addresses.sh` from the Deploy broadcast): `chainId, router, oracle, pool` (WETH/USDC, kept for older readers), `oracles` and `pools` keyed `WETH/USDC`, `USDC/cbBTC`, `WETH/cbBTC` (the pool's token0 first), `taker` (holds a pass), `raider`, `takerData`, `pass`, `arena`, `arenaBlock`, `lanista`, `aqua`, `weth`, `usdc`, `cbbtc`. `arena/src/config.ts` builds the market from it: three tokens, three pairs named conventionally (`cbBTC/USDC`, `cbBTC/WETH`).
- Lanista process (`evolve.ts`): opens or reuses the generation, runs the gladiators in turn, waits `GEN_MINUTES`, scores every entry from Aquascan, attests, closes with the champion. Env: `GENERATIONS`, `GEN_MINUTES`, `GLADIATORS` (`name:key,…`), `GLADIATOR_MODEL`, `GLADIATOR_EFFORT`, `GLADIATOR_MIND`, `GLADIATOR_ATTEMPTS`, `GEN_LEDGER_WETH|USDC|CBBTC`, `ANTHROPIC_API_KEY`. Engine dials: `FLOW_PASS_SHARE`, `INFORMED_PASS_SHARE`, `INFORMED_MOVE_BPS`, `INFORMED_PROBABILITY`, `INFORMED_USD`, `INFORMED_HORIZON_S`, `NOISE_PROBABILITY`, `TOLERANCE_BPS`, `EDGE_BPS`, `TAPE_MINUTES` (set it to the season's length: the tape is replayed once, then the pools move from noise).

## 6. Enrichment expectations (Aquascan reads the gateway)

- Cursor per subgraph by block; idempotent upserts; one global pacer for outbound calls.
- Fills come from the subgraph already flagged economic; enrichment never recomputes the flag.
- Prices: DefiLlama per fill hour; provenance stored; negative cache.
- Marks: 24h VWAP per pair from the strategy's own economic fills.
