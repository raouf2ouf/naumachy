# contracts

Foundry project. Owner: Rudis vertical.

- `lib/aqua`, `lib/swap-vm`: 1inch repos as git submodules (Degensoft 1.1 source-available, not copied).
- `src/NaumachyRouter.sol`: a modified SwapVM router with the custom opcode(s). See docs/plan.md M1 for the candidates and the go/no-go.
- `src/ArenaRegistry.sol`: gladiators, generations, lineage, promotions. Emits the events the arena subgraph indexes (docs/interfaces.md).
- `test/`: CoreInvariants harness, quote/swap consistency, First Blood style program traces on an anvil fork.

Not initialised yet. First commit for this package is `forge init` plus the two submodules.
