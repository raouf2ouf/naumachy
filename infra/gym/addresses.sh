#!/usr/bin/env bash
# Writes infra/data/gym/addresses.json from the last Deploy.s.sol broadcast on the gym (chain 8453).
# Two Takers are deployed in order: the first holds an arena pass (routed flow), the second is the
# anonymous raider. Tokens and pools are Base's; the gym is a fork of Base.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import json, os
run = json.load(open("contracts/broadcast/Deploy.s.sol/8453/run-latest.json"))
created = [t for t in run["transactions"] if t.get("transactionType") == "CREATE"]
by = {}
for t in created:
    by.setdefault(t["contractName"], []).append(t["contractAddress"].lower())
block = int(open("infra/data/gym/fork-block").read().strip())
receipts = {r["contractAddress"].lower(): int(r["blockNumber"], 16) for r in run.get("receipts", []) if r.get("contractAddress")}
arena = by["ArenaRegistry"][0]
oracles = by["PoolPriceOracle"]
out = {
    "chainId": 8453,
    "router": by["NaumachyRouter"][0],
    "oracle": oracles[0], "pool": "0xd0b53d9277642d899df5c87a3966a349a798f224",
    "oracles": {"WETH/USDC": oracles[0], "USDC/cbBTC": oracles[1], "WETH/cbBTC": oracles[2]},
    "pools": {"WETH/USDC": "0xd0b53d9277642d899df5c87a3966a349a798f224", "USDC/cbBTC": "0xfbb6eed8e7aa03b138556eedaf5d271a5e1e43ef", "WETH/cbBTC": "0x7aea2e8a3843516afa07293a10ac8e49906dabd1"},
    "taker": by["Taker"][0], "raider": by["Taker"][1], "takerData": by["TakerData"][0], "pass": by["ArenaPass"][0],
    "arena": arena, "arenaBlock": receipts.get(arena, block),
    "lanista": run["transactions"][0]["transaction"]["from"].lower(),
    "aqua": "0x1111113ccf1426a8e30e2bff5e005d929bf6a90a",
    "weth": "0x4200000000000000000000000000000000000006",
    "usdc": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "cbbtc": "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
}
os.makedirs("infra/data/gym", exist_ok=True)
json.dump(out, open("infra/data/gym/addresses.json", "w"), indent=2)
print(json.dumps(out, indent=2))
PY
