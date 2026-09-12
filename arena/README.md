# arena

Orchestration: the taker engine, the generations, the dialect, the lanista and promotion.

- `src/engine.ts`: the taker engine, the arena's flow. Replays the pool's real swaps as the tape, front-runs the large ones against the gladiators (informed flow), arbitrages quotes that beat the pool, and adds uninformed takes; wobbles the pool itself while the tape is silent. Fills go through the `Taker` contract, so the registry, the subgraphs and Aquascan see them like any other fill.
- `src/generation.ts`: one generation end to end. `open` has the lanista open a generation, ships one variation of the anchored archetype per gladiator wallet (steady, tight, wide, flat), registers and enters them; `score` reads each entry's 5-minute markout from the gym Aquascan API, attests it on `ArenaRegistry`, names the champion and closes.
- `src/program.ts`: the Naumachy dialect in TypeScript, the anchored archetype `RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt` with its knobs.
- `src/ship.ts`, `src/lanista.ts`: shipping to Aqua from a gladiator's wallet; the lanista's and the gladiators' calls on the registry; Aquascan's verdict.

```sh
yarn workspace @naumachy/arena engine
yarn workspace @naumachy/arena generation open     # then let the engine trade for a while
yarn workspace @naumachy/arena generation score
```

Keys never live here: the gym uses anvil's accounts; the live arena's host unseals its keys from the Ledger Key Ring at boot (`infra/arena`, `docs/boundary.md`). `src/promote.ts` names a season's champion from the attested record and records the promotion on the registry once the operator's transfer, signed on the Flex, is mined.
