# infra/vps

Aquascan on naumachy.xyz: a Hostinger KVM in Frankfurt (4 vCPU, 16 GB, 200 GB NVMe, Ubuntu 26.04), reached over SSH. The gym runs on a development machine; the live arena's two units run on this host (`infra/arena`).

What runs where:

- Postgres in Docker (`infra/aquascan/docker-compose.yml`, data under `infra/data/aquascan/postgres` of the clone), bound to 127.0.0.1:5433.
- The enrichment loop, the API and the MCP server as systemd units (`aquascan-enrich.service`, `aquascan-api.service`, `aquascan-mcp.service`), and the arena's engine and loop (`infra/arena/naumachy-*.service`), user `naumachy`, Node 22 from nvm behind the `/home/naumachy/node-current` symlink, yarn through corepack. The API listens on 127.0.0.1:3100.
- Caddy serves the built web app from `/srv/naumachy/web` and proxies `/api/*` to the API; certificates come from Let's Encrypt once `naumachy.xyz` and `www` point at the host.
- The firewall allows 22, 80 and 443 only.

First time: `bootstrap.sh` as root (packages, service user, firewall, node), clone the public repo into `/home/naumachy/naumachy`, write `.env` there (the Aquascan keys only: gateway key, subgraph ids, Token API JWT, the Base pools subgraph id, DefiLlama and RPC limits, `AQUASCAN_DATABASE_URL`), `docker compose -f infra/aquascan/docker-compose.yml up -d`, restore a `pg_dump -Fc` of the corpus with `pg_restore --no-owner --no-privileges`, then `deploy.sh`. The corpus moved as a dump, not as the data directory: the Mac's Postgres is arm64, the host is x86.

Every time: `deploy.sh` as root pulls main, installs, builds the web, publishes it, reinstalls the Caddyfile and the units, restarts the services.

Set up 2026-09-08: 517,942 fills and 129,136 strategies restored from a 601 MB dump; the loop resumed from the Mac's cursor.

Robinhood Chain comes through Substreams, not a subgraph: `.env` carries `SUBSTREAMS_API_TOKEN` (from `substreams auth` on The Graph Market), `SUBSTREAMS_ENDPOINT_ROBINHOOD=default`, `RPC_ROBINHOOD`, and `SUBSTREAMS_PACKAGE` pointing at a copy of the built package, `scp`'d to `/home/naumachy/substreams/` since the box has no Rust toolchain. A first read spans 44M blocks and takes hours in `SUBSTREAMS_BUDGET_SECONDS` slices; the status page shows the cursor advancing.
