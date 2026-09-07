#!/usr/bin/env bash
# The gym's chain: anvil forking Base at a pinned block, producing a block every two seconds like Base,
# reachable from docker as host.docker.internal:8545. Accounts are unlocked so the taker engine can
# impersonate whales and set balances.
#   infra/gym/anvil.sh [fork-block]        # reads RPC_BASE_TENDERLY (or RPC_BASE) from the repo .env
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; source .env; set +a
RPC="${RPC_BASE_TENDERLY:-${RPC_BASE:?set RPC_BASE_TENDERLY or RPC_BASE in .env}}"
BLOCK="${1:-$(cast block-number --rpc-url "$RPC")}"
mkdir -p infra/data/gym
echo "$BLOCK" > infra/data/gym/fork-block
exec anvil --fork-url "$RPC" --fork-block-number "$BLOCK" --chain-id 8453 --block-time 2 \
  --host 0.0.0.0 --port 8545 --auto-impersonate --no-rate-limit --silent
