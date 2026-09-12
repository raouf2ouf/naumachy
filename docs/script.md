# The script

Built section by section. Each section: the words spoken, then what is on screen. Facts behind the numbers are noted so every claim survives a click. Two artefacts share this order: the live judging tour, at full length, and the video, cut to under four minutes with one sentence and one screen per stop. Timings in brackets are for the video.

The stage is Aquascan itself, light theme, at `/how-it-is-built` for the first half and the live pages for the second. Presenter spotlight: press `p` on the How page; the card at the centre of the screen stays lit and the rest fades. Arena animation: click a step on the ring to hold it, space to pause or play, arrows to step, `r` to start again from generation zero.

## 1. Intro [0:00 to 1:00]

Raouf's words, unchanged:

1inch Aqua is a new way to trade liquity onchain. 
Not by depositing into a pool or posting an order, but by shipping a program that is built over a certain vocabulary, this program or strategy is actually more expressive than a pool contract or a limit order system. In fact, it is so expressive, that the biggest limiting factor is the user imagination.
So we did a deep data analysis on every strategy ever shipped to Aqua, and 99% of the volume is one type of program: concentrated pool with flat fee which is basically a pool-shaped strategy. meaning that if Aqua gives us a language, then everyone is writing the same sentence.
and so we set out to write other sentences with this language, not by hand, since our imagination is limited too, but via genetic algorithms and LLM based AI agents.
The idea is a field of AI gladiators, each with wallet, funds and an AI brain. They write programs, fight for profits, and evolve, generation after generation, each learning from the mistakes of the previous one.
That is nomachy, a colosseum flooded with Aqua, not to state naval battles, but to write innovative trading strategies.

On screen, the How page, top to bottom, one card per paragraph:

1. "Three ways to trade liquidity on chain": pool, order, program. The program card's bars flicker. Foot: "The limit is the imagination. And a program is written in a language."
2. The three stat cards: 139,028 strategies read on seven chains; 36 opcodes plus 3 of ours; 1,590 makers, $1.48B traded, 611,592 fills.
3. "SwapVM, thirty-six words": the dictionary, the six words in use lit, the venue's sentence under the rule, "99% of the venue, one template". Foot: "Aqua gives us a language. Everyone is writing the same sentence."
4. "The arena": the four gladiators write pool-shaped sentences chip by chip; then the evolution.

Two notes on the words, left to Raouf: Aquascan is never named in the intro and it is the product The Graph judges grade, one clause fixes it ("so we built Aquascan and read every program"); and "concentrated pool with flat fee" could land harder as "Uniswap, rewritten as a program". Teleprompter spelling if the text goes on screen: liquidity, Naumachy, stage, user's imagination.

Facts: 139,028 strategies and seven chains are the README's count at the time of writing; 99.4% of the top 200 Ethereum desks' volume runs the template "gated concentrated AMM, flat fee" (94 to 100 percent on every chain; Aquascan `/api/desks`, 2026-09-12); the template name is Aquascan's own; the score is the five-minute markout on economic fills, attested on chain by the lanista.

## 2. The arena, in general terms [1:00 to 1:45]

Hold the arena card. Click "write" on the ring, then let it run.

> Each gladiator is a wallet, funds and a Claude mind. Once a generation the mind reads the record and composes a program from the vocabulary. The compiler emits the bytes, RiskCap first, so the mind cannot remove it. The validator runs the draft on a private fork; a draft that pays the taker goes back with the verdict. Only what survives ships to Aqua, through our router, on Base, with real inventory, capped.
> The engine fills the programs. Aquascan re-prices every fill five minutes later. The best attested score wins the generation. The losers read the winner's sentence through The Graph and take a word from it. The winner tries a new one. Then everyone writes again.
> Watch the field: generation zero, four pool-shaped sentences. A few generations later, the three new words are in every sentence, in different mixes. That is what the gym did in eight generations, and what Base has been doing every hour since this morning.
> The one thing the arena cannot do alone is pay the champion. Every third generation here, once a season on Base: the prize sits on a Ledger account, a human taps the Flex, and only then does the lanista record the promotion on chain.

On screen: the field at the top, the ring, the four beats with their partner marks lighting in turn, the Ledger block below with its two jobs, Key Ring and the tap.

Honesty line, said here or in the tour: the gym ran on an anvil fork of Base with our own flow model, including a taker that reads the tape ahead. On Base every fill comes from our own engine, because 1inch's resolvers route only to the canonical routers.

## 3. What is new [1:45 to 2:00]

Scroll to the "What is new" card and read its four titles as the table of contents of the tour: Aquascan and its questions as tools; six subgraphs, a Substreams package, an arena subgraph; the arena on Base with Ledger and Claude; three new opcodes in NaumachyRouter, deployed and verified on Base.

> Four things did not exist ten days ago. Here they are, in the order we will visit them.

For live judging, the circuit card below it is the detailed answer to "how does it actually work": ten stations, the pulse following one program through one generation, Ledger on the dashed wires outside the loop. Skip it in the video.

## 4. Aquascan: the overview [2:00 to 2:20]

Switch to the Overview, Ethereum, 30 days.

> Aquascan keeps score. Every strategy ever shipped to Aqua, read through The Graph on seven chains, every fill re-priced five minutes later. Four numbers: strategies live, traded, fees the makers charged, and the makers' result five minutes after their fills. Fees are the revenue side of making. This is the cost side.

On screen: the four stat cards, the daily volume chart, the top makers table.

## 5. Three makers [2:20 to 2:50]

Pick from the makers table, three for contrast, not for size. Numbers from the live API, 30 days, 2026-09-12.

1. The programme desk, `0x5510…f4f8`: $222M of volume, 26,022 fills, -0.82 bps per fill at five minutes, $2.9K of fees, $42.6K of Merkl rewards. Open its program card: the pool-shaped sentence.
   > The biggest desks on Aqua are paid to be there, and the programme works. Look at the fills alone and you see what a pool-shaped program costs: more than it earns, five minutes later.
2. The maker who earns, `0x8182…0c22`: $500K, 1,441 fills, +2.02 bps at five minutes, $121 of fees, stablecoin pairs.
   > The score can be won. This one is positive after the market re-priced, on many fills.
3. The Base bridge: on Base, sorted by markout, the top of the board is the arena's own gladiators, +5 to +11 bps on $54 to $73 each.
   > Tiny volume, our own flow, and we say so. But it is the same scoreboard, and it takes us to the arena.

Alternates for the second slot: `0xa99f…4e1f1` on USDC/USDT with a realised profit of $93, or `0x5852…216d` on wstETH/WETH at +5.3 bps and $1,025 realised on 94 fills. The makers table sorts by volume or by markout only.

## 6. The leaderboard [2:50 to 3:00]

> 1inch ranks makers by volume. We rank them by what the fills were worth five minutes later. The order changes.

## 7. The arena page [3:00 to 3:25]

Open `/arena`. Newest generation first, the gladiators' cards, the attested scores beside Aquascan's live figures.

> Generations run hourly with nobody watching. Generation 0 closed this morning; tight won it. Generation 1 was the first the minds wrote on Base: steady's first draft was refused by the validator and its mind repaired it. Generation 4 closed without a champion: all four drafts were refused on the fork. That is in the record too.

Losing generations shown, as the plan requires. If a promotion has happened by then, the Promotions section shows it with both transaction hashes.

## 8. The prompt and the tap [3:25 to 3:55]

Claude Code with the Aquascan MCP added and wallet-cli installed. The Flex connected, Ethereum app open, Ledger Live closed. Two windows: the terminal, and the arena page. A phone on the device.

The prompt:

```
Who is the season champion of the Naumachy arena on Base, and why?
Prepare the promotion: pay the champion 30 USDC from my Ledger account base-1,
then record it on the registry. Do not send anything yourself; I sign on the device.
```

> Aquascan's questions are MCP tools. Claude asks the arena who it would pay: the attested record, ranked by wins then by score, and the exact transfer. It starts the promotion and waits. I run the line; the Flex shows the recipient and the amount; one tap. The address on the device is the one the subgraph attested. That is the whole check a human has to make. Transfer mined, the lanista writes promote(), and the arena page shows the champion promoted.

Say "wallet-cli", not "Ledger MCP": Ledger ships a CLI and agent skills, not an MCP; our MCP is the eyes, their CLI is the hand. The tap is real money once: rehearse the whole prompt with `promote --dry-run` and without the send, then record the real one in a single take. As of 2026-09-12 20:40 CEST the arena would pay wide (two wins, generations 2 and 3, 0.0121 USDC attested; flat second with two wins on lower scores).

## 9. Close [3:55 to 4:00]

On the arena page or the How page's closing line.

> Volume is not the score. The score is what your fills are worth five minutes later. Naumachy: AI gladiators write 1inch SwapVM programs, fight on Aqua, and evolve. Aquascan keeps score.

## Recording notes

- Record the tap first; it happens once. Then the rest can be recorded in any order.
- Feature freeze once the tap is recorded. Everything in the app as of tonight (theme, How page, MCP tool, validator fixes) is committed or ready to commit before that.
- The How page's animation timing: eight seconds per generation, a season every third; hold "read" to talk about the evolution, hold "score" to talk about the champion.
- The video wants 720p or better; the app is laid out for 1600 px wide, which fits a 1080p capture with the browser chrome hidden.
