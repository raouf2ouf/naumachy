#!/usr/bin/env bash
# Builds both subgraphs for the gym (network base, start block = the fork block) and deploys them to
# the gym graph-node as naumachy/aqua-gym and naumachy/pools-gym.
set -euo pipefail
cd "$(dirname "$0")/../.."
BLOCK="$(cat infra/data/gym/fork-block)"
NODE=http://localhost:8120; IPFS=http://localhost:5101
for pkg in aqua pools; do
  dir=subgraphs/$pkg
  python3 - "$dir" "$BLOCK" <<'PY'
import json, sys
d, block = sys.argv[1], int(sys.argv[2])
nets = json.load(open(f"{d}/networks.json"))
gym = {"base": {name: {**src, "startBlock": block} for name, src in nets["base"].items()}}
json.dump(gym, open(f"{d}/networks.gym.json", "w"), indent=2)
PY
  (cd $dir && yarn graph codegen > /dev/null && yarn graph build --network base --network-file networks.gym.json > /dev/null && \
     (yarn graph create --node $NODE naumachy/$pkg-gym > /dev/null 2>&1 || true) && \
     yarn graph deploy --node $NODE --ipfs $IPFS --version-label gym naumachy/$pkg-gym 2>&1 | grep -E 'Deployed|error|Error' ; git checkout -- subgraph.yaml 2>/dev/null || true)
done
echo "deployed from block $BLOCK"
