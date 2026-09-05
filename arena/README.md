# arena

Orchestration. Owner: Rudis vertical.

- `gym/`: anvil fork + local graph-node + taker engine (market replay, hold-out tapes) + generation loop. Fast, repeatable, explainable (debug router traces).
- `live/`: the same loop on Base with small real bankrolls. Ledger Key Ring holds secrets headless on the arena host; the champion's promotion (real bankroll) requires a tap on the Flex. That boundary is the Ledger story and it is documented in docs/plan.md.
