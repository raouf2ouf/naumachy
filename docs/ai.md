# How AI is used

Two halves: the AI inside the product, and the AI that helped build it. Written for ETHGlobal's disclosure and for anyone who wants to know which decisions were a model's and which were ours.

## In the product: the gladiators' minds

Each gladiator is a wallet with a bankroll and a mind. Once per generation the mind gets one job: read the record and write the next program in the arena's dialect. It is one call to the Claude API (`agents/src/mind.ts`): a system prompt that explains the dialect, the pairs, the scoring, the flow and the record; a briefing as JSON (the last generations with entries, programs listed instruction by instruction, attested scores, the rivals' verdicts, the pool's recent behaviour, the gladiator's own last program and rationale; on Base also the gym's record); and a structured answer checked against a schema (`ProgramSchema`: pairs, cap, an ordered list of instructions, a parent address when it mutates a rival, a rationale in prose). By default the mind may read before it answers, at most three times: a subgraph's schema, a GraphQL query (on the network through The Graph's Subgraph MCP), or a path of the Aquascan API. What it read, what it wrote and what it spent are kept in that generation's file.

The mind composes; it never emits bytes. The compiler (`arena/src/program.ts`) puts `RiskCap` first, where the mind cannot remove it, and `Salt` last; the validator ships the draft on a private fork, quotes it both ways on every pair and takes a loop through three pairs; a program the compiler or the validator refuses goes back to the mind once with the verdict, then the gladiator sits the generation out. The lanista scores from Aquascan and attests on chain; the mind never touches money, keys or the prize.

Numbers from the gym, eight generations on a fork of Base (`agents/gym-record.json`): 31 minded programs by `claude-opus-4-8` at high effort with tools, 65 API calls, 174K input and 158K output tokens plus 750K cached, 63 reads (61 of the Aquascan scorer, one schema, one query), one draft refused by the validator. The control line, `GLADIATOR_MIND=heuristic`, is a hill climber with no model, kept so a season can say whether the mind earns anything over blind mutation. On Base the minds run `claude-opus-5`; their programs, rationales and transcripts land in `infra/data/arena/generations/` on the host and are copied to the repository's data for the record.

What the minds did in eight generations is in `docs/decisions.md`, entries of 2026-09-08: one copied a rival's dropped gate a generation later, two kept re-shipping the generation 0 recipe because Aquascan's accumulated desk figures looked larger than the attested verdicts (the prompt now says which is the record), and ungated programs won while the informed taker was toothless, because a gate that trades toxic flow away also trades benign flow away.

## In the making

The two of us designed and directed; Claude Code (Anthropic's agentic assistant, running Claude models) wrote most of the code, the first drafts of most documents, and ran the operations under our instructions, in sessions on our machines from 2026-09-04 to the deadline.

Ours: the idea and the three beats; the choice of tracks; the dialect and which instructions exist; the scoring rule (5-minute markouts on economic fills, the attested score as the record); the flow model of the engine; the decision that the arena on Base keeps a little uninformed flow; the size of the float; every entry in `docs/decisions.md`, dated, which is the log of what a human decided and why; the funding transactions and every tap on the Ledger; every commit and push, made on our word, small and one concern each.

The assistant's: the code in `contracts/`, `arena/`, `agents/`, `aquascan/`, `subgraphs/`, `substreams/`, `mcp/`, `infra/`, written to our specifications and reviewed by us, with the design conversations recorded in `docs/decisions.md`; the drafts of the documents, edited by us; the running of deployments, migrations and units; the reconstruction of the gym record from the generation files when the fork was gone. Findings the assistant made and we verified are attributed as findings, not as decisions: the Ledger CLI's fixed derivation path, the RPC read replicas that lag, the macOS keychain printing hex.

How we checked it: Foundry tests on a fork with real transfers for every instruction; vitest for the compiler, the P&L book and the engine's pure parts; dry runs on private forks before anything touched Base; Aquascan's numbers validated against 1inch's own dashboard on the same fills (`docs/lessons.md`); and the live chain, which does not care who wrote the code.

No generated content is presented as human work, and no human work is presented as generated. Commit history carries no AI attribution since 2026-09-07 at ETHGlobal's own guidance; this page is the disclosure.
