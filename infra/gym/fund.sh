#!/usr/bin/env bash
# Funds the gym's wallets by writing token balances straight into storage on the anvil fork.
# USDC (FiatTokenV2_2) keeps balances in slot 9, WETH9 in slot 3, cbBTC in slot 9 (same FiatToken
# lineage; verified with a probe at bring-up). Amounts: gladiators (anvil accounts 1, 3, 4, 5) and
# the engine (account 2), plus both takers, which hold what they trade with.
#   infra/gym/fund.sh                   # defaults below
#   GLADIATOR_WETH=100 ... infra/gym/fund.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
RPC=${GYM_RPC:-http://127.0.0.1:8545}
USDC=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913; WETH=0x4200000000000000000000000000000000000006; CBBTC=0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf
A=$(python3 -c "import json;print(json.load(open('infra/data/gym/addresses.json'))['taker'])")
R=$(python3 -c "import json;print(json.load(open('infra/data/gym/addresses.json'))['raider'])")
GLADIATORS="0x70997970C51812dc3A010C7d01b50e0d17dc79C8 0x90F79bf6EB2c4f870365E785982E1f101E93b906 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"
ENGINE=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
set_balance() {   # token slot holder amount
  local key; key=$(cast index address "$3" "$2")
  cast rpc --rpc-url "$RPC" anvil_setStorageAt "$1" "$key" "$(cast to-uint256 "$4")" > /dev/null
}
fund() {   # holder weth usdc cbbtc
  set_balance $WETH 3 "$1" "$2"; set_balance $USDC 9 "$1" "$3"; set_balance $CBBTC 9 "$1" "$4"
  bal() { cast call --rpc-url $RPC "$1" 'balanceOf(address)(uint256)' "$2" | awk '{print $1}'; }
  printf '%s  WETH %s  USDC %s  cbBTC %s\n' "$1" "$(cast from-wei "$(bal $WETH $1)")" "$(bal $USDC $1)" "$(bal $CBBTC $1)"
}
GW=${GLADIATOR_WETH:-100}; GU=${GLADIATOR_USDC:-200000}; GB=${GLADIATOR_CBBTC:-2}
for g in $GLADIATORS; do fund $g $((GW))000000000000000000 $((GU))000000 $((GB))00000000; done
fund $ENGINE 2000000000000000000000 5000000000000 10000000000
fund $A 1000000000000000000000 3000000000000 5000000000
fund $R 1000000000000000000000 3000000000000 5000000000
