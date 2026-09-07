# infra/gym

The gym: an anvil fork of Base, a graph-node indexing the fork with the same subgraphs as the network deployments, Aquascan pointed at that graph-node, and a taker engine that supplies the flow. Gladiators ship to the canonical Aqua registry on the fork with `NaumachyRouter` as their app and are scored by the same rollup, against the same pool, as a mainnet desk.

```sh
infra/gym/anvil.sh                                  # fork Base at the current block (or a given one); 2 s blocks; port 8545
docker compose -f infra/gym/docker-compose.yml up -d  # graph-node 8100/8120/8130, ipfs 5101, aquascan postgres 5434
infra/gym/deploy-subgraphs.sh                       # naumachy/aqua-gym and naumachy/pools-gym, from the fork block
cd contracts && forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key 0>
# fund a gladiator (USDC balances live in slot 9, WETH in slot 3; see the session notes), then
ROUTER=... ORACLE=... forge script script/ShipGladiator.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <gladiator key>
infra/gym/aquascan.sh enrich | api | web            # Aquascan on the gym: api 3101, web 5174
yarn workspace @naumachy/arena engine               # the taker engine
```

`infra/data/gym/` holds the fork block, the deployed addresses (`addresses.json`) and the containers' data; it is not committed.

## The taker engine (`arena/`)

Every tick (one block) it replays the next swaps of the tape through the fork's WETH/USDC pool, so the pool walks the path Base walked; the tape is the pool's real swaps in the minutes before the fork, read from the published pools subgraph. Then for every live gladiator of our router it does three things:

- **informed flow**: before a tape swap large enough to move the pool replays, it trades the gladiators in that direction at the old price. An arbitrageur who sees the order flow does exactly this; it is the flow that bleeds the mainnet desks.
- **arbitrage**: whenever a gladiator's quote beats the pool price by more than the edge threshold (5 bps, about Uniswap's fee), it takes.
- **uninformed flow**: at random, a small take at the quote, the spread income a maker lives on.

While the tape is silent (the published subgraph still syncing to the fork block) it makes random swaps through the pool instead, so prints exist and the price wobbles. Fills go through the `Taker` contract and Aqua's push, so the registry, the subgraph and Aquascan see them like any other fill. Knobs are environment variables in `arena/src/config.ts`.

## Generations (`agents/`)

With the gym up and the engine running, the evolution loop opens a generation, lets every gladiator's mind write and ship its program, trades for `GEN_MINUTES`, scores from the gym Aquascan, attests and closes:

```
GENERATIONS=2 GEN_MINUTES=8 yarn workspace @naumachy/agents evolve          # needs ANTHROPIC_API_KEY in .env
GLADIATOR_MIND=heuristic yarn workspace @naumachy/agents evolve             # the control line, no key
```

Each gladiator's knobs, program, rationale and what it saw land in `infra/data/gym/generations/`; generation 0 (the lanista's four seed variations from `arena/src/generation.ts open`) is written there by hand so the minds can read it.
