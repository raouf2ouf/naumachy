# The boundary

What runs alone, what needs a person, what an agent never sees. Written for the Ledger track and for anyone running the arena; every line here is enforced by code or by where a key lives, not by convention.

## What runs alone

- **The gym** on a fork: minds write programs, the engine trades them, Aquascan scores, the lanista attests. Play money.
- **The live arena on Base**, under caps. Four gladiator wallets hold about $18 per token each; every program is compiled with `RiskCap` first (no fill may move more than a fifth of either balance) and the mind cannot remove it; the engine's takers hold a similar float; the lanista holds gas and nothing else. The loop opens, scores, attests and closes generations hourly with no one watching. The worst an errant mind or a bug can do is lose that float.
- **Unsealing at boot.** The host decrypts its own secrets from the Ledger Key Ring with no device attached (`infra/arena/unseal.sh`): the sealed file, the host's ring member and the ring password meet in tmpfs and nowhere else.

## What needs a person

- **Promotion.** The champion's real bankroll is the one irreversible act. The prize sits on the operator's Ledger account, not on any wallet the agents hold. `yarn workspace @naumachy/arena promote` names the season's champion from the attested record, prints the exact `wallet-cli send` line, and waits. The transfer is signed on the Flex, clear-signed, by the operator. Only once it is mined does the lanista write `promote` on the registry, which is how the Arena page and the subgraph learn of it. No code path reaches the prize; the lanista can only record what the device already did.
- **Sealing and rotating secrets.** `wallet-cli ring encrypt` runs on the operator's machine; a new key, a new RPC, a new mind's API key all pass through it.
- **Enrolling a host.** A machine becomes a ring member with the device (`ring init`), or by transplant from one that did.
- **Revocation.** `ring destroy` from the operator's machine, or ejecting the host's member, makes the sealed file unreadable on the host at its next boot: a kill switch that needs no access to the host.

## What an agent never sees

- The ring password and the sealed file's contents on the operator's machine.
- The Ledger seed, and therefore the prize account. `wallet-cli` signs on the device; the minds call an HTTP API and a compiler, never a signer.
- Each other's rationales. Programs are public the moment they ship (bytes on chain, listed in the dialect); the reasoning stays in that gladiator's generation file.

## What the Key Ring does and does not protect

It protects the secrets at rest: disk images, backups, the repository, a laptop left open, and it gives revocation from afar. It does not protect a running host from whoever roots it: the host holds its ring member, the keyring's password and the ring password, so a root compromise yields the float. That is why the float is small and capped, and why the prize is not on the host at all. Said plainly so nobody has to discover it.

## The promotion protocol, step by step

1. The lanista's `promote` command reads the last closed generations from the network arena subgraph and ranks champions by wins, then by attested score.
2. It prints the request: champion, amount, the `wallet-cli send --account base-1 --to <champion> --amount '30 USDC'` line.
3. The operator runs it with the Flex connected; the device shows the recipient and the amount; one tap.
4. The command watches the chain for a USDC transfer of at least the prize to the champion (or verifies a hash given with `--tx`).
5. The lanista signs `ArenaRegistry.promote(gladiator, strategyHash, chainId, bankroll)`; the subgraph indexes `Promoted`; the Arena page shows it.
6. A record with both transaction hashes lands under `infra/data/arena/promotions/`.
