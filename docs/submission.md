# Submission form text

Drafted from `README.md`, `docs/feedback/*.md`, `docs/ai.md`, `docs/boundary.md`. Paste, then trim to the form's limits.

## Project name

Naumachy

## Short description (one line)

AI gladiators author trading strategies as 1inch SwapVM programs, fight on Aqua, and evolve. Aquascan keeps score.

## Description

Naumachy is an arena where AI gladiators write market-making strategies as 1inch SwapVM programs, ship them to Aqua, fight with real inventory on Base, and evolve generation after generation. Aquascan keeps score: the explorer and P&L ledger for every Aqua strategy on seven chains, with its questions exposed as an MCP server.

It starts from a measurement. Aqua lets a maker ship a program instead of a pool or an order, and the program can price on anything the chain knows. Aquascan read all 139,028 strategies ever shipped: on every chain, over 90 percent of the volume runs one template, a gated concentrated pool with a flat fee. Aqua gives makers a language, and everyone writes the same sentence.

So the gladiators write the other sentences. Each is a wallet, a bankroll and a Claude mind that composes a program from the vocabulary, extended with three new instructions we appended to the SwapVM router: ToxicityFee, RiskCap and OracleAnchor. A validator checks every draft on a private fork before it ships. The programs trade, Aquascan re-prices every fill five minutes later, the lanista attests the scores on chain and crowns a champion, and the losers read the winner's program through The Graph and mutate. Eight generations ran in the gym on a fork; since 12 September 2026 the arena runs live on Base, hourly.

The one act the arena cannot do alone is pay the champion: the prize sits on a Ledger account, an agent proposes the transfer through the MCP, a human confirms it on a Ledger Flex, and only then is the promotion recorded on chain. The same Ledger Key Ring seals every secret the arena runs on.

Everything is public at naumachy.xyz: the explorer, every generation with every program and the rationale its mind wrote, the MCP server, and the story of how it is built.

## How it's made

Contracts, in Foundry. NaumachyRouter is the SwapVM v1.0.2 router redeployed with three instructions appended: ToxicityFee, a maker fee that widens with one-way flow and decays; RiskCap, which bounds what one fill can move, read from the ledger; OracleAnchor, which re-centres the curve on a pool oracle and lets one inventory quote three markets. Aqua and swap-vm are the official releases, unmodified, as submodules, and programs ship to the canonical Aqua registry. An ArenaRegistry records generations, attested scores, champions, lineage and promotions. Tests run on a fork of Base with real tokens: quote equals swap, a loop through three pairs never pays the taker, the fee widens and forgets, the cap holds.

The minds, in TypeScript. One Claude API call per gladiator per generation, briefed from Graph data and given tools that query our subgraphs through The Graph's Subgraph MCP. The compiler emits the bytes with RiskCap first; a validator ships each draft on a private anvil fork, quotes every pair and runs the three-leg loop, and refusals come back named so the mind can repair them. A model-free control line exists so a season can say what the mind is worth. Our own taker engine supplies the flow, since 1inch's resolvers route only to the canonical routers.

Aquascan, on The Graph. Six Aqua subgraphs published on the network, a Substreams package in Rust for Robinhood Chain, which The Graph serves through Firehose only, plus a pools subgraph and the arena subgraph over our registry. One enrichment in Postgres prices every fill from the venue's own tape and same-chain pools, computes markouts at 5 minutes, 1 hour and 1 day, maker P&L, fees decoded from bytecode and Merkl rewards. A read-only API carries the source of every number; a React app renders it; an MCP server exposes nine tools, including arena_promotion, which ranks the attested record and writes the exact wallet-cli command for the prize without holding a key.

Ledger. The host's secrets are sealed with wallet-cli's Key Ring under the operator's Flex and unsealed into tmpfs at boot. The CLI's transport is WebUSB only, so we enrolled the headless VPS by transplanting a ring member into a GNOME keyring under dbus-run-session. Promotion is a clear-signed transfer confirmed on the device; the lanista records it on chain only once mined. The findings are written up with a proposed fix.

Two hacks: the overview aggregates a gigabyte of fills, so it is cached per rollup, served stale while recomputing and snapshotted to disk across deploys; and a full router with three more instructions exceeds Base's bytecode limit, so unused upstream slots stay in the table but revert. Claude Code wrote most of the code under our direction; docs/ai.md is the disclosure.

## 1inch: Build an Aqua App

A custom Aqua app on Base: `NaumachyRouter`, the full SwapVM v1.0.2 router redeployed with three instructions appended (a toxicity fee that widens with recent one-way flow and decays, a risk cap read from the ledger so a virtual curve cannot lift it, a multi-pair oracle anchor), against the unmodified Aqua registry. Programs compose a pass gate (`OnlyTakerTokenBalanceNonZero` on our pass), fees by the token the taker pays (`JumpIfTokenIn` branches), the anchor and the swap; a language model writes them in our dialect and the compiler emits the bytes. Four AI-authored programs are live on Base with real inventory, filled through our `Taker` contracts, re-marked by Aquascan. Aquascan reads every program on the venue back into a card, ours and the wild's, and re-prices every fill on seven chains. Feedback with dated entries in `docs/feedback/1inch.md` (maker hooks in Aqua mode, the one-byte argument length, jumps around middleware, resolver routing to custom routers, fee base). Honesty: on Base only our engine fills our programs; resolvers do not route to a custom router.

## The Graph: composable products

Six Aqua subgraphs published on the network (Ethereum, Base, Arbitrum, Optimism, Polygon, BSC), a Substreams package for Robinhood Chain, which the network serves only through Firehose, a pools subgraph and an arena subgraph over our own registry on Base, The Graph's Subgraph MCP as the gladiators' query layer, and one enrichment reading all of them into one schema with two consumers on top: the minds and the Aquascan MCP. Aquascan has no chain lane other than The Graph; stop the gateway and the arena stops. One schema for seven chains meant the rollup, API, web, minds' tools and MCP were written once; adding a chain that carries a third of the venue's volume changed nothing downstream. Dated developer-experience entries in `docs/feedback/thegraph.md`.

## The Graph: AI use case

The gladiators' minds reason on Graph data to write programs: the briefing (generations, entries, attested scores, rivals' programs, the pool's recent behaviour) is Graph data, the tools they call while writing query the subgraphs through the Subgraph MCP, and the lanista's scoring reads Graph data. On top, the Aquascan MCP turns the same data into questions any agent can ask, every answer carrying its sources. Built from scratch during the hackathon.

## Ledger: AI Agents x Ledger

Agents propose, humans approve, hardware signs. The arena's secrets (gladiator keys, RPC and gateway keys, the mind's API key) are sealed under the operator's Flex with the Ledger Key Ring and unsealed headless on the host at boot, no device attached; the host became a ring member without a USB port, by transplant, documented with its gotchas. The only irreversible act, promoting a champion with a real bankroll, is a clear-signed USDC transfer from the operator's Ledger account through `wallet-cli send`, tapped on the Flex; the lanista records the promotion on chain only after the transfer is mined. The boundary between autonomous and approved is written in `docs/boundary.md` and enforced by where the keys live. Findings and feedback with dates in `docs/feedback/ledger.md`: the discovery scanner stops at the first empty account with no index option (a proposed `account add --index` fix), the WebUSB-only transport, the headless Secret Service, the keychain hex gotcha on macOS, the second-machine paragraph the docs lack.
