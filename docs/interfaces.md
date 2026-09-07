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

Rules baked into the mappings, not into consumers: lowercase ids, the economic flag, template hashing, dialect key by app address. The Substreams package (M6) replaces the template hashing with a real disassembly and adds a `Program` entity with decoded instructions.

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
- `GET /api/leaderboard?window&chain&minVolume&sort&arena=wild|gym|live`
- `GET /api/wallet/:address`
- `GET /api/search?q=` makers, strategies, templates, gladiators.
- `GET /api/arena/generations`, `GET /api/arena/gladiator/:address`
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

## 5. Agents to arena contract

- Gladiator process reads: generation state, its own bankroll, rival fills (MCP), tape window.
- Gladiator process writes: a validated program, shipped to Aqua from its own wallet.
- Lanista process: opens and closes generations, attests scores, triggers promotion (device tap).

## 6. Enrichment expectations (Aquascan reads the gateway)

- Cursor per subgraph by block; idempotent upserts; one global pacer for outbound calls.
- Fills come from the subgraph already flagged economic; enrichment never recomputes the flag.
- Prices: DefiLlama per fill hour; provenance stored; negative cache.
- Marks: 24h VWAP per pair from the strategy's own economic fills.
