# Naumachy

**AI gladiators author trading strategies as 1inch SwapVM programs, fight on Aqua, and evolve. Aquascan keeps score.**

The Romans flooded the Colosseum to stage naval battles. We flooded ours with 1inch Aqua.

> Draft README. Grows with the milestones in `docs/plan.md`. Nothing below is shipped yet.

## Why a program and not a pool

A market maker needs three things at once that no single primitive gives it: to be always on without a bot that requotes, to keep its funds in its own wallet with a budget per strategy, and pricing that depends on what just happened, on chain signals and on who is asking. A pool gives the first, a limit order the second, neither the third. SwapVM on Aqua gives all three because the maker's pricing logic is data that sits on chain next to its inventory: the maker runs nothing after shipping, the taker trusts nothing because the program is readable and made of audited parts, and anything that can write bytes can be a market maker. Naumachy exists because of that last point.

## The story in three beats

1. **The wild is naive.** Aquascan reads every strategy ever shipped to Aqua through The Graph. On mainnet, one template accounts for most of the corpus and the biggest desks are losing on adverse selection. Nobody uses oracles, gates by direction, or serves several markets from one inventory in the wild.
2. **The gym.** A swarm of agents, each with its own wallet and bankroll, writes SwapVM programs in the arena's dialect (a pass gate, fees that widen with one-way flow or differ by the token the taker pays, an oracle anchor per pair, one ledger behind up to three markets), ships them to Aqua on a fork, and gets scored by Aquascan on economic fills only. Losers read the winners' programs (bytes on chain, listed) and mutate. Generations pass.
3. **The arena.** The champion goes live on Base with a real bankroll, after a tap on a Ledger Flex, and lands on Aquascan's mainnet leaderboard next to the real desks. After four generations, one strategy earned the rudis.

## Parts

- **Rudis**: contracts (a modified SwapVM router with custom opcodes: a toxicity fee, a risk cap, a multi-pair oracle anchor; an arena pass; an arena registry), the gladiators and their compiler, the gym with its two takers (one routed, one anonymous), the live arena, the Ledger gate.
- **Aquascan**: the explorer and P&L ledger for Aqua strategies. Subgraphs per chain, a Substreams package for the chain The Graph reaches only through Firehose (Robinhood Chain), an enrichment service for prices and markouts, a web UI with the arena and every program as compiled, and an MCP server so Claude, Cursor and the gladiators can ask it questions.

## Partner tracks

1inch "Build an Aqua App" (custom opcodes, official contracts, onchain execution on fork and on Base), The Graph (composable products and AI use case), Ledger "AI Agents x Ledger" (Key Ring on the arena host, device approval before real money moves).

## Repo

See `CLAUDE.md` for the map and the working agreement, `docs/plan.md` for gates and milestones, `docs/interfaces.md` for the seams between packages.

## License

MIT for everything in this repository.
