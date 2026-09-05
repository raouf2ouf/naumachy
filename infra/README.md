# infra

docker compose for the gym and for a public Aquascan deployment.

Services (planned): anvil (fork), graph-node + ipfs + postgres (gym indexing), aquascan-enrich, aquascan-api, aquascan-web, agents, arena. One global outbound rate limiter for chain calls. `.env.example` at the repo root lists every key.
