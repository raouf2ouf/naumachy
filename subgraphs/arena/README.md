# subgraphs/arena

Indexes `ArenaRegistry`: gladiators with their lineage, generations, entries, the scores the lanista attested, promotions. Scores are Aquascan's 5-minute markouts in the quote token; the subgraph never recomputes them. An entry's `strategyHash` is the Aqua strategy hash, the tail of Aquascan's strategy id, so the two subgraphs join on it.

In the gym it runs on the local graph-node against the fork (`infra/gym/deploy-subgraphs.sh` fills the address and the fork block into `networks.gym.json`); on Base it is published to the network: Studio slug `naumachy-arena-base`, network id `6gaE5WQj7UQKtnhd85N3cLsKcSohdtG37CLmmP8UyiGp` (2026-09-12, v0.1.0, registry `0xb709161c34b032dd5c945e3418b20444b0f73bc6` from block 51204315).
