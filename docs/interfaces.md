# Interfaces - the seams between packages

Draft. Fields marked TBD are decided at the milestone that first needs them. Changing anything here: edit this doc first, log it in `docs/decisions.md`, then code.

## 1. Aqua subgraph (per chain) - `subgraphs/aqua`

Source: the Aqua registry at `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` on each chain, events `Shipped`, `Docked`, `Pulled`, `Pushed`. Start block per chain = Aqua deployment block (TBD per chain, from the deployment tx).

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

type Strategy @entity { id: Bytes!  # strategyHash
  maker: Maker!  app: App!  desk: Desk!  template: Template!
  program: Bytes!  tokens: [Bytes!]!  amounts: [BigInt!]!
  shippedAt: BigInt!  shippedTx: Bytes!  dockedAt: BigInt  dockedTx: Bytes
  status: StrategyStatus!  # LIVE | DOCKED
  fills: [Fill!]! @derivedFrom(field: "strategy") }

type Fill @entity { id: ID!  # tx-strategyHash
  strategy: Strategy!  tx: Bytes!  block: BigInt!  timestamp: BigInt!
  taker: Bytes  # tx.from when available in the mapping (TBD: receipt access)
  legs: [Leg!]! @derivedFrom(field: "fill")
  shape: FillShape!  # PUSH_ONLY | PULL_ONLY | TWO_SIDED | MULTI
  economic: Boolean!  # TWO_SIDED or MULTI. The only fills that count. }

type Leg @entity { id: ID!  fill: Fill!  token: Bytes!  net: BigInt!  # push minus pull, per token
  pushed: BigInt!  pulled: BigInt! }

type DailyStrategyStat @entity { id: ID!  # strategyHash-day
  strategy: Strategy!  day: Int!  economicFills: Int!  legs: Int! }
```

Rules baked into the mappings, not into consumers: lowercase ids, the economic flag, template hashing, dialect key by app address. The Substreams package (M6) replaces the template hashing with a real disassembly and adds a `Program` entity with decoded instructions.

## 2. Arena subgraph - `subgraphs/arena`

Source: `ArenaRegistry` (contracts/src/ArenaRegistry.sol). Runs on the local graph-node for the gym and on The Graph Network for Base.

Events (draft, emitted by the contract):

```solidity
event GladiatorRegistered(address indexed gladiator, bytes32 indexed name, uint32 generation, address indexed parent);
event StrategyEntered(address indexed gladiator, bytes32 indexed strategyHash, uint32 indexed generation, bytes32 archetype);
event GenerationClosed(uint32 indexed generation, address indexed champion, bytes32 championStrategy, int256 scoreQuote);
event Promoted(address indexed gladiator, bytes32 indexed strategyHash, uint256 chainId, uint256 bankroll);
```

Entities: `Gladiator` (address, name, generation born, parent, strategies), `Generation` (number, opened, closed, champion, tape id), `Entry` (gladiator, strategy, generation, archetype), `Promotion`. Lineage is a tree through `parent`.

Score semantics: `scoreQuote` is Aquascan's pair-native P&L in the quote token at generation close, economic fills only. The contract stores it as attested by the lanista process; the subgraph does not recompute it.

## 3. Aquascan API - `aquascan/api`

Read-only JSON. All amounts as strings, all addresses lowercase, every priced number wrapped as `{ value, source, at, confidence }`.

- `GET /api/overview?window=24h|7d|30d` hero numbers, deltas, top desks, latest ships as sentences, provenance footer.
- `GET /api/desks?chain&template&window&sort&minVolume`
- `GET /api/desk/:id` identity, stats, P&L block, strategies, fills feed, takers.
- `GET /api/strategy/:hash` decoded program (sentence, pipeline, raw hex), lifecycle, P&L, fills with implied prices.
- `GET /api/leaderboard?window&chain&minVolume&sort&arena=wild|gym|live`
- `GET /api/wallet/:address`
- `GET /api/search?q=` makers, strategies, templates, gladiators.
- `GET /api/arena/generations`, `GET /api/arena/gladiator/:address`
- `GET /api/health` freshness per lane (subgraph head block, enrichment cursor, price coverage).

## 4. Aquascan MCP server - `mcp`

Tools (names final, schemas TBD):

- `aqua.desks_bleeding(window, chain, limit)` desks with negative edge or negative markout, with evidence.
- `aqua.explain_strategy(hash)` one-sentence summary, decoded pipeline, template, risk notes.
- `aqua.takers(strategyHash)` who fills this strategy, concentration, markout inflicted.
- `aqua.templates(window)` what is deployed and what earns, template-level.
- `arena.generation(n)` entries, scores, champion, lineage.
- `arena.rival_fills(gladiator, generation)` the mutation signal.

The gladiators use the Subgraph MCP against the subgraphs for raw questions and this server for derived ones.

## 5. Agents to arena contract

- Gladiator process reads: generation state, its own bankroll, rival fills (MCP), tape window.
- Gladiator process writes: a validated program, shipped to Aqua from its own wallet.
- Lanista process: opens and closes generations, attests scores, triggers promotion (device tap).

## 6. Enrichment expectations (Aquascan reads the gateway)

- Cursor per subgraph by block; idempotent upserts; one global pacer for outbound calls.
- Fills come from the subgraph already flagged economic; enrichment never recomputes the flag.
- Prices: DefiLlama per fill hour; provenance stored; negative cache.
- Marks: 24h VWAP per pair from the strategy's own economic fills.
