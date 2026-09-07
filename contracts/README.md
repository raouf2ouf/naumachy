# contracts

Foundry project. Owner: Rudis vertical.

- `src/NaumachyRouter.sol`: the full SwapVM v1.0.2 router redeployed with Naumachy's instructions appended. Strategies ship to the canonical Aqua registry with this router as their app.
- `src/NaumachyOpcodes.sol`: the instruction table. Upstream bytes are unchanged (runtime byte = static slot minus one, `0x0a` jump through `0x2d` aquaDynamicProtocolFeeAmountIn); ours follow.
- `src/instructions/ToxicityFee.sol` (`0x2e`): a maker fee that widens with recent one-way flow. Per-order memory of what left, linear decay over a window, fee = base + slope times the share of the outgoing balance drained, capped. Middleware, keeps the fee with the maker, quote and swap agree within a block.
- `src/instructions/RiskCap.sol` (`0x2f`): no single fill may take more than a share of the outgoing balance or add more than a share of the incoming one, read from the ledger at entry so a virtual curve cannot lift the cap. Reverts in quote mode too.
- `src/instructions/OracleAnchor.sol` (`0x30`): re-centres the curve on an oracle price before the swap instruction: virtual incoming balance = real balance times a depth multiplier, virtual outgoing balance = its worth at the oracle price. A constant-product swap then executes at the oracle price with slippage set by the depth, both ways. The ledger still bounds what can leave.
- Reverting slots: a full router with three more instructions does not fit Base's 24,576-byte limit, so the bytes of the pegged swap, the experimental fee variants, the order invalidators and the gas adjuster stay in the table but revert (`UnsupportedInstruction`). No gladiator archetype composes them; a program that names one fails loudly. The upstream `OraclePriceAdjuster1D` is not dispatched: it only ever improves the taker's side of a limit order, which is why OracleAnchor exists.
- `src/arena/Taker.sol`: the arena's taker, paying the maker through Aqua's push in the router's callback; `src/arena/TakerData.sol` packs the taker traits for off-chain engines.
- `script/ShipGladiator.s.sol`: ships the gladiator above from the broadcaster's wallet, knobs by environment.
- `src/oracles/PoolPriceOracle.sol`: a Chainlink-shaped view of a Uniswap v3 pool, `latestRoundData()` answering token1 per token0 with 18 decimals from the pool's current sqrt price. Aquascan scores the same pool's swaps, so a strategy anchored here is judged against the reference it quotes from.
- `test/NaumachyRouter.t.sol`: first blood on a fork of Base. A gladiator program `RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt` ships to the canonical registry with real WETH and USDC; quotes track the pool both ways, swaps move tokens between the wallets, quote equals swap, the round trip never pays the taker, the fee widens after a drain and forgets after the window, the cap stops oversized fills.
- `script/Deploy.s.sol`: deploys the router and one pool oracle; the same script serves the gym fork and Base.

Pins: `swap-vm` v1.0.2 (the release line the deployed routers and the published SDK speak; `main` rewrote the opcode dispatch), `aqua` v1.0.0, `forge-std` v1.16.2. `swap-vm` needs `yarn install` inside `lib/swap-vm` once: its remappings for OpenZeppelin and solidity-utils point into its own node_modules.

```sh
set -a; source ../.env; set +a                # RPC_BASE_TENDERLY or RPC_BASE for the fork tests
forge build
forge test --match-path test/NaumachyRouter.t.sol -vv
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key <anvil key>
```

Fee arguments are on SwapVM's 1e9 base: 1 bps is 100,000. The first gladiator charges 5 bps at rest, up to 50 bps under a drain, caps a fill at 20% of either balance, and quotes at 100x virtual depth.
