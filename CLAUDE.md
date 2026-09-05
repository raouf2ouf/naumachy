# Naumachy

AI gladiators author 1inch SwapVM strategies, fight on Aqua, evolve across generations. Aquascan, built on The Graph, keeps score. ETHOnline 2026, one submission, deadline Sept 13 12:00 EDT. Picks: 1inch, The Graph, Ledger.

Read in order: this file, `docs/plan.md` (gates, milestones), `docs/interfaces.md` (seams), `docs/decisions.md`. Read `docs/lessons.md` before touching bytecode, P&L, prices, or the overview.

## Parts

- **Rudis**: the arena. Gladiators, gym on a fork, live arena on Base, generations, the prize.
- **Aquascan**: the instrument. Explorer + P&L ledger for every Aqua strategy, wild or gladiator.

## Vocabulary

- gladiator: one agent = one wallet + bankroll + the program it authored
- program: SwapVM bytecode shipped to Aqua (bytes, no deployment); ship/dock register/kill it; pull/push move real tokens at settlement
- economic fill: a settlement where value moved both ways; the only fills that count, everywhere
- desk: maker x template x chain; template: opcode sequence, args ignored; dialect: opcode table per router deployment
- gym: anvil fork + local graph-node + taker engine; arena: live Base indexed by The Graph Network
- champion/promotion: winner gets a real bankroll after a tap on the Ledger Flex; lanista: the human operator (Raouf)

## Map

```
contracts/  Foundry; 1inch aqua + swap-vm submodules; NaumachyRouter (custom opcodes); ArenaRegistry
subgraphs/  aqua/ per chain, arena/, substreams/ (disassembler)
aquascan/   enrich/ api/ web/
agents/     gladiators: authoring, validator loop, Subgraph MCP client
arena/      gym/ live/, Key Ring, promotion gate
mcp/        Aquascan MCP server
infra/      docker compose
docs/       plan, lessons, interfaces, decisions, commit-plan, setup, feedback/
```

## Ownership

Raouf: contracts, agents, arena, Ledger. Kate: subgraphs, aquascan, mcp, labels, overview, video, feedback docs. The seam is `docs/interfaces.md`: edit it first, log in `docs/decisions.md`, then code.

## Rules

1. No secrets in the repo. `.env` ignored, `.env.example` lists keys. Gladiator keys live in Ledger Key Ring.
2. Every number carries provenance. No naked dollars. Never fake sub-hour markouts.
3. Only economic fills count.
4. Missing decision: write it under Open in `docs/decisions.md`, state your assumption, continue.
5. yarn (never npm), Node 22, TypeScript, Foundry, graph-cli, docker compose. Foundry tests for contracts, vitest for TS.

## Working

Every task moves a gate in `docs/plan.md`. Build vertical slices demoable end to end. Facts go to `docs/lessons.md`, decisions to `docs/decisions.md`, sponsor friction to `docs/feedback/<sponsor>.md`.
