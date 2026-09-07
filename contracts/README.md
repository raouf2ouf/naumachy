# contracts

Foundry project. Owner: Rudis vertical.

- `lib/aqua`, `lib/swap-vm`: 1inch repos as git submodules (Degensoft 1.1 source-available, not copied).
- `src/NaumachyRouter.sol`: a modified SwapVM router with the custom opcode(s). See docs/plan.md M1 for the candidates and the go/no-go.
- `src/ArenaRegistry.sol`: gladiators, generations, lineage, promotions. Emits the events the arena subgraph indexes (docs/interfaces.md).
- `test/`: CoreInvariants harness, quote/swap consistency, First Blood style program traces on an anvil fork.

Pins: `swap-vm` v1.0.2 (the release line the deployed routers and the published SDK speak; `main` rewrote the opcode dispatch), `aqua` v1.0.0, `forge-std` v1.16.2. `swap-vm` needs `yarn install` inside `lib/swap-vm` once: its remappings for OpenZeppelin and solidity-utils point into its own node_modules.
