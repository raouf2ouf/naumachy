# infra/arena

The live arena on Base: the same engine, minds and lanista as the gym, on the real chain. `ARENA_LIVE=1` turns the fork-only parts off (tape replay, pool swaps by the engine, the foresight taker); the takers hold their own inventory, the gladiators hold theirs, and every fill is a real transaction re-marked five minutes later at the real pool by Aquascan.

Deployed 2026-09-12 (`contracts/broadcast/Deploy.s.sol/8453/`, verified): `infra/data/arena/addresses.json` on the operator's machine and the host. Registry `0xb709161c34b032dd5c945e3418b20444b0f73bc6` from block 51204315; router `0x7f417e540899a054bbb287de1c04a13d7d2d98c7`.

```sh
# once, on the operator's machine: generation 0 from the gym's last field (seed-from-gym.json), real transactions
ARENA_LIVE=1 GYM_ADDRESSES=infra/data/arena/addresses.json SEED_FILE=infra/arena/seed-from-gym.json ... yarn workspace @naumachy/arena generation open
# on the host: the two units, fed by /home/naumachy/arena.env (arena.env.example)
cp infra/arena/naumachy-*.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now naumachy-engine naumachy-arena
```

Promotion, the one act that needs a person, runs on the operator's machine with the Flex: `yarn workspace @naumachy/arena promote` (`--dry-run` to see the request; `docs/boundary.md` for the protocol).

The minds' briefing carries `agents/gym-record.json`, the record of the training seasons, reconstructed from the briefings kept in the gym's generation files. The Ledger path (Key Ring for `arena.env`, the promotion tap) is in `docs/ledger-and-hosting.md`.
