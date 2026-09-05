# Naumachy

**AI gladiators author trading strategies as 1inch SwapVM programs, fight on Aqua, and evolve. Aquascan keeps score.**

The Romans flooded the Colosseum to stage naval battles. We flooded ours with 1inch Aqua.

> Draft README. Grows with the milestones in `docs/plan.md`. Nothing below is shipped yet.

## The story in three beats

1. **The wild is naive.** Aquascan reads every strategy ever shipped to Aqua through The Graph. On mainnet, one template accounts for most of the corpus and the biggest desks are losing on adverse selection. Nobody uses oracles, auctions or time-weighted programs in the wild.
2. **The gym.** A swarm of agents, each with its own wallet and bankroll, authors SwapVM programs, ships them to Aqua on a fork, and gets scored by Aquascan on economic fills only. Losers read the winners' fills and mutate. Generations pass.
3. **The arena.** The champion goes live on Base with a real bankroll, after a tap on a Ledger Flex, and lands on Aquascan's mainnet leaderboard next to the real desks. After four generations, one strategy earned the rudis.

## Parts

- **Rudis**: contracts (a modified SwapVM router with custom opcodes, an arena registry), the gladiators, the gym, the live arena, the Ledger gate.
- **Aquascan**: the explorer and P&L ledger for Aqua strategies. Subgraphs per chain, a Substreams disassembler for SwapVM dialects, an enrichment service for prices and markouts, a web UI, and an MCP server so Claude, Cursor and the gladiators can ask it questions.

## Partner tracks

1inch "Build an Aqua App" (custom opcodes, official contracts, onchain execution on fork and on Base), The Graph (composable products and AI use case), Ledger "AI Agents x Ledger" (Key Ring on the arena host, device approval before real money moves).

## Repo

See `CLAUDE.md` for the map and the working agreement, `docs/plan.md` for gates and milestones, `docs/interfaces.md` for the seams between packages.

## License

MIT for everything in this repository.
