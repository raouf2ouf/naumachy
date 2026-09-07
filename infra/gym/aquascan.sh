#!/usr/bin/env bash
# Aquascan on the gym: the same enrichment, API and web, pointed at the gym graph-node and its own
# Postgres (127.0.0.1:5434), Base only. Overrides win over the repo .env.
#   infra/gym/aquascan.sh enrich | api | web | rollup | pools
set -euo pipefail
cd "$(dirname "$0")/../.."
export AQUASCAN_DATABASE_URL=postgres://aquascan:aquascan@localhost:5434/aquascan
export GRAPH_SUBGRAPH_ID_BASE=http://localhost:8100/subgraphs/name/naumachy/aqua-gym
export DEX_SUBGRAPH_ID_BASE=http://localhost:8100/subgraphs/name/naumachy/pools-gym
export NAUMACHY_ROUTERS=$(python3 -c "import json;print(json.load(open('infra/data/gym/addresses.json'))['router'])")
export AQUASCAN_API_PORT=3101
export ARENA_SUBGRAPH=http://localhost:8100/subgraphs/name/naumachy/arena-gym
export ARENA_CHAIN=base
export POOL_MIN_SWAPS_30D=${POOL_MIN_SWAPS_30D:-1}     # the fork has hours of pool history, not a month
export ENRICH_POLL_SECONDS=${ENRICH_POLL_SECONDS:-60}
export LLAMA_CALLS_PER_PASS=${LLAMA_CALLS_PER_PASS:-100}
case "${1:-}" in
  enrich) exec yarn workspace @naumachy/aquascan-enrich dev --chains=base ;;
  rollup) exec yarn workspace @naumachy/aquascan-enrich rollup ;;
  pools)  exec yarn workspace @naumachy/aquascan-enrich pools ;;
  api)    exec yarn workspace @naumachy/aquascan-api dev ;;
  web)    VITE_API_URL=http://127.0.0.1:3101 exec yarn workspace @naumachy/aquascan-web dev --port 5174 ;;
  *) echo "usage: $0 enrich|rollup|pools|api|web"; exit 1 ;;
esac
