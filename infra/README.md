# infra

Everything that runs outside the packages.

- `aquascan/`: the Postgres compose file for the enrichment database, local and on the host.
- `gym/`: the gym, an anvil fork of Base with a graph-node, Aquascan and the taker engine (`gym/README.md`).
- `graph-node/`: a local graph-node, IPFS and Postgres for indexing the fork.
- `arena/`: the live arena on Base, its two systemd units and the script that unseals their secrets from the Ledger Key Ring at boot (`arena/README.md`).
- `vps/`: the host that serves naumachy.xyz: bootstrap, deploy, Caddy and the service units (`vps/README.md`).

`.env.example` at the repository root lists every key the services read.
