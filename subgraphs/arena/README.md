# subgraphs/arena

Indexes `ArenaRegistry`: gladiators with their lineage, generations, entries, the scores the lanista attested, promotions. Scores are Aquascan's 5-minute markouts in the quote token; the subgraph never recomputes them. An entry's `strategyHash` is the Aqua strategy hash, the tail of Aquascan's strategy id, so the two subgraphs join on it.

In the gym it runs on the local graph-node against the fork (`infra/gym/deploy-subgraphs.sh` fills the address and the fork block into `networks.gym.json`); on Base it is published to the network once the registry is deployed there.
