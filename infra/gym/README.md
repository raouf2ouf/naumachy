# infra/gym

The gym: an anvil fork of Base, a graph-node indexing the fork with the same subgraphs as the network deployments, Aquascan pointed at that graph-node, and a taker engine that supplies the flow. Gladiators ship to the canonical Aqua registry on the fork with `NaumachyRouter` as their app and are scored by the same rollup, against the same pool, as a mainnet desk.

```sh
infra/gym/anvil.sh                                  # fork Base at the current block (or a given one); 2 s blocks; port 8545
docker compose -f infra/gym/docker-compose.yml up -d  # graph-node 8100/8120/8130, ipfs 5101, aquascan postgres 5434
infra/gym/deploy-subgraphs.sh                       # naumachy/aqua-gym, pools-gym and arena-gym, from the fork block (needs addresses.json for the arena)
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key 0>
infra/gym/addresses.sh                              # infra/data/gym/addresses.json from the broadcast (router, oracles, takers, pass, registry)
infra/gym/fund.sh                                   # WETH, USDC and cbBTC into the gladiators, the engine and both takers (storage writes)
yarn workspace @naumachy/arena generation open      # generation 0: four seed programs, one of them gated on all three pairs
infra/gym/aquascan.sh enrich | api | web            # Aquascan on the gym: api 3101, web 5174
yarn workspace @naumachy/arena engine               # the taker engine
```

`infra/data/gym/` holds the fork block, the deployed addresses (`addresses.json`) and the containers' data; it is not committed.

## The taker engine (`arena/`)

Every tick (one block) it replays the next swaps of the tape through the fork's three pools (WETH/USDC, cbBTC/USDC, cbBTC/WETH, all 0.05%), so the pools walk the path Base walked; the tape is each pool's real swaps in the minutes before the fork, read from the published pools subgraph. Then for every live gladiator, on every pair it ships, it does three things:

- **informed flow**: the taker reads the tape ahead. When a pair's price five minutes from now (the median of the tape's prints around that horizon) differs from the pool's price now by 5 bps or more, it trades that direction first against every gladiator on the pair whose quote still beats the coming price by the edge (a fee that has ramped past the move prices it out), with a probability per tick (`INFORMED_MOVE_BPS`, `INFORMED_HORIZON_S`, `INFORMED_PROBABILITY`, `INFORMED_USD`). Those fills are marked five minutes later at the moved price. An arbitrageur who sees the order flow does exactly this; it is the flow that bleeds the mainnet desks.
- **arbitrage**: whenever a gladiator's quote beats the pair's pool price by more than the edge threshold (5 bps, about Uniswap's fee), it takes.
- **uninformed flow**: at random, one order on a random pair that shops every gladiator at its size and goes to the best quote if that beats the pool or sits within its own tolerance; otherwise the pool gets it.

Orders arrive through one of two takers: one holds an arena pass (routed flow, `FLOW_PASS_SHARE` of uninformed orders and `INFORMED_PASS_SHARE` of informed ones), the other is anonymous, the raider. A gladiator that gates on the pass never sees the raider and never sees the passless share of the flow; quotes are simulated as the taker that would take, so the gate answers each differently. While the tape is silent or exhausted it makes random swaps through the pools instead, so prints exist and prices wobble; `TAPE_MINUTES` (60) should cover a season. Fills go through the `Taker` contracts and Aqua's push, so the registry, the subgraph and Aquascan see them like any other fill.

## Generations (`agents/`)

With the gym up and the engine running, the evolution loop opens a generation, lets every gladiator's mind write and ship its program, trades for `GEN_MINUTES`, scores from the gym Aquascan, attests and closes:

```
GENERATIONS=2 GEN_MINUTES=8 yarn workspace @naumachy/agents evolve          # needs ANTHROPIC_API_KEY in .env
GLADIATOR_MIND=heuristic yarn workspace @naumachy/agents evolve             # the control line, no key
```

Each gladiator's program (as a spec and as a listing), rationale, draft prices and what it saw land in `infra/data/gym/generations/`; generation 0 (the lanista's four seeds from `arena/src/generation.ts open`) is written there too so the minds can read it. Gotcha: start graph-node once anvil has mined about 50 blocks past the fork; its block ingestor downloads the head's 50 ancestors, and a pre-fork Base block fetched through anvil can fail receipt parsing forever (restart graph-node if `indexingStatuses` shows no `chainHeadBlock`).
