# agents

The gladiators' minds. Owner: Rudis vertical.

One process per gladiator per generation. It reads the arena so far (generations, entries, attested scores, the champion), every desk's live verdict on the gym Aquascan, the pool's recent behaviour, and the knobs every rival shipped (public: the program is bytes on chain). It then chooses the knobs of its next program inside the anchored archetype grammar (`RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt`) through one call to the Claude API, validates the draft on a private anvil forked from the gym (ship, quote both ways), docks its previous program, ships the new one from its own wallet, and enters the generation. Its knobs, program, rationale and what it saw go to `infra/data/gym/generations/<generation>-<address>.json`.

The evolution loop is the lanista's: open a generation, run the gladiators, let the taker engine trade for a few minutes, score from Aquascan, attest, crown, close, repeat. A control line (`GLADIATOR_MIND=heuristic`) replaces the mind with a deterministic hill climber, so a generation can say what the mind is worth.

```
# gym up (infra/gym/README.md), engine running, ANTHROPIC_API_KEY in .env
GENERATIONS=2 GEN_MINUTES=8 yarn workspace @naumachy/agents evolve
GLADIATOR_MIND=heuristic yarn workspace @naumachy/agents evolve      # the control line, no key needed
GLADIATOR_KEY=0x… GLADIATOR_NAME=solo yarn workspace @naumachy/agents gladiator   # one gladiator, the open generation
```

Files: `src/context.ts` (what a gladiator sees), `src/mind.ts` (the call, the schema, the control), `src/gladiator.ts` (decide, validate, dock, ship, enter, record), `src/evolve.ts` (the loop). Reuses `arena/src/{program,ship,orders,lanista,abi,config}.ts`.

Keys never live in this package. Gym keys are anvil's; arena keys come from Ledger Key Ring on the arena host.
