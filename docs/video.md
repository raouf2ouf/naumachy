# The video

One protagonist, one video, 2 to 4 minutes, narrated by us, 720p or better, recorded real runs, losing generations shown, honest about what runs on the fork and what runs on Base (GF.1, GF.3, GL.2). Feature freeze before recording. This page is the script, the shot list and the open choices; `docs/submission.md` is the form text.

## The protagonist

**steady**, the gladiator line. It won 5 of the gym's 8 closed generations on the fork, seeded generation 0 on Base, took the most fills there (11) and still lost the generation to tight on the attested score. In generation 1, the first the minds wrote on Base, its first draft was refused by the validator (a leg of the loop reverted) and its mind read the verdict, raised the anchor's staleness from 15 s to 300 s and shipped. Whether steady is ever promoted is not ours to decide, which is the point: the arena does not care who we root for.

## The spine, four beats, one running example

Timings are targets for a 3:15 cut. Kate narrates the Aquascan beats (1 and 4), Raouf the arena beats (2 and 3). Every figure on screen comes from the live site or from a recorded run; nothing is mocked.

### Beat 1. The wild is naive (0:00 to 0:35)

Screen: naumachy.xyz, Ethereum, 30 days. The overview's four numbers, then the makers table sorted by the five-minute markout, then one big desk's page: fees on one side, what the same fills were worth five minutes later on the other. Then a program card: a wild strategy read back instruction by instruction.

> The Romans flooded the Colosseum to stage naval battles. We flooded ours with 1inch Aqua.
> On Aqua, market makers ship programs instead of running bots. Aquascan reads every one of them on seven chains through The Graph and re-prices every fill five minutes later.
> The biggest desks on Ethereum earn a tenth of a basis point in fees and give more than that back to the takers who knew where the price was going. Volume looks like winning. Markout says otherwise.
> So: can a program learn to stop bleeding?

### Beat 2. The gym (0:35 to 1:25)

Screen: the arena journal from a recorded run, a mind's rationale and listing scrolling as it is written; then a generation file diff: two programs of one line, one readable change; then the gym record, eight generations, champions per generation, steady's five wins and its three losses.

> A gladiator is a wallet, a bankroll and a mind. Once a generation the mind reads the record and writes the next program in a small dialect: a risk cap it cannot remove, fees that widen with one-way flow, an oracle anchor per pair, one ledger behind three markets. The compiler emits SwapVM bytes; a validator refuses on a private fork any draft that pays the taker.
> The taker engine trades the field. Aquascan scores every fill five minutes later. The lanista attests the score on chain, crowns a champion, closes the generation.
> Eight generations on a fork of Base. The field converged in two on one shape: toxicity fee, anchor, curve. Gates lost every time. steady won five and lost three, and the three are in the record too.

Honesty line, said on camera: the gym runs on an anvil fork with a local graph-node and a flow model of our own, including the foresight taker. That is where the eight generations happened.

### Beat 3. The arena on Base (1:25 to 2:35)

Screen: naumachy.xyz/arena, generation 0 closed, champion tight, steady second on fills and not on score; a fill on Basescan; generation 1 open with four programs the minds wrote on Base, steady's refused first draft and its repair in the journal. Then the tap: a terminal with `promote` printing the request and waiting; the Flex in frame showing the recipient and the amount, one tap; the terminal seeing the transfer and the lanista writing `promote`; the Arena page showing "promoted"; the USDC transfer on Basescan.

> On the twelfth of September the gym's last field went live on Base: about eighteen dollars per token per gladiator, no fill above a fifth of either balance. Real fills, re-marked at the real pools.
> Honesty first: on Base every fill comes from our own engine. 1inch's resolvers route only to the canonical routers, so a custom router never sees third-party flow.
> Generation 0: steady took the most fills, tight won on the attested score. Generation 1, the first the minds wrote on Base: steady's draft was refused, its mind read the verdict and fixed the staleness window.
> Generations run hourly with nobody watching. The one thing the arena cannot do alone is pay the champion. The prize sits on a Ledger account, not on any wallet an agent holds. `promote` names the champion from the attested record, prints the transfer and waits. I sign on the Flex, one tap. Only then does the lanista record the promotion on chain.

### Beat 4. The instruments (2:35 to 3:05)

Screen: Claude with the Aquascan MCP added, one question, one tool call, one answer with sources. Then a still of the composition: six subgraphs, one Substreams package, two subgraphs over our own registry, one schema, two consumers.

> Aquascan's questions are MCP tools. Ask Claude which Base makers are bleeding this week and it answers from the same data with the source of every number.
> Everything reads through The Graph: six Aqua subgraphs, a Substreams package for the chain subgraphs cannot reach, the pools and the arena over our own registry, one schema. Stop the gateway and the arena stops.
> The boundary is enforced by where the keys live: the host's secrets are sealed under the Flex with the Ledger Key Ring; the minds never see a signer; the one irreversible act needs a person and a tap.

### Close (3:05 to 3:15)

Screen: the Arena page, the promoted champion, the address.

> Volume is not the score. The score is what your fills are worth five minutes later. Naumachy: AI gladiators write 1inch SwapVM programs, fight on Aqua, and evolve. Aquascan keeps score.

## Shot list, in recording order

1. **The tap** first, since it is live and singular: two cameras, the screen (terminal with `promote`, the Arena page in a second window, Basescan in a third) and a phone on the Flex. Ledger Live closed, Ethereum app open. Record the whole thing once, no retakes possible without another prize.
2. Arena page: generation 0 closed, generation 1 with the minds' programs, a program card of a gladiator's Base desk.
3. Journal capture: `journalctl -u naumachy-arena --since "2026-09-12 09:56"` from steady's refusal to its ship; scroll slowly.
4. Aquascan Ethereum: overview, makers by five-minute markout, one big desk's page, one wild program card.
5. MCP: Claude Code or Claude Desktop with `https://naumachy.xyz/mcp` added; the question "which Base makers are bleeding this week"; the tool call visible.
6. Gym artifacts: `agents/gym-record.json`, two generation files side by side, `docs/decisions.md` entries of 2026-09-08.
7. Voice, recorded after the cuts are known, over the footage.

## Open choices

**Who is the protagonist.**
- steady (recommended): the record, the loss in generation 0, the refused draft repaired. Whoever the tap goes to, the story holds.
- tight: the champion of generation 0; simplest if the tap happens on a season of one generation, weakest if tight loses generation 1.
- the operator: Raouf's hands, the Flex; the human boundary as the story. Strong for Ledger, thin for 1inch and The Graph.

**When to tap.**
- After generation 1 closes: two closed generations, ranked by wins then attested score; the stronger record, and a generation the minds wrote is in the season.
- Now, on generation 0: champion tight, season of one; no dependency on the rollup landing the five-minute marks in time.
- Later today, after three or four generations: the best record, the highest odds of an empty or unmarked generation on the way.

**The gym on screen.**
- Artifacts only (recommended): generation files, gym record, decisions; no bring-up, no risk before recording.
- Bring the gym up and record one six-minute generation live: the bring-up has worked many times and has known gotchas (graph-node needs the fork to have mined 50 blocks); it adds a moving picture and a way to break the freeze.

**Length.** A 3:15 cut as written; a 2:30 cut drops the gym record and the Graph still.

## Freeze list before recording

- `agents/src/gladiator.ts`: the validator funds the taker contract on the private fork (the fix for generation 1's empty field). Uncommitted, live on the host.
- Nothing else changes after the tap is recorded.
