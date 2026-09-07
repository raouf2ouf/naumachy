# Ledger Agent Stack: notes and feedback

Written as we go, for the "AI Agents x Ledger" track. The documentation feedback is judged with the code; this file is that feedback plus the runbook of what we actually did.

## What we use Ledger for

- **Key Ring (`wallet-cli ring`)**: the arena host keeps the gladiators' private keys and the RPC and gateway keys encrypted under the Ledger Key Ring. `ring init` is done once on Raouf's machine with the Flex and the Ledger Sync app; on the host, `ring decrypt` restores the trustchain from the LKRP backend and derives the AES-256-GCM key over HKDF, no device attached. That is the "no human at the keyboard" property the arena needs.
- **The promotion tap**: the champion's real bankroll on Base is moved by a transaction signed on the Flex through wallet-cli's `send`. Everything before that runs on gym money; that tap is the boundary between the gym and the arena, and it is the only moment the device is required after setup.

## Runbook (to run on Raouf's machine with the Flex, then on the arena host)

```sh
npx skills add ledgerhq/agent-skills          # the wallet-cli and DMK skills for the agents' IDEs
npm i -g @ledgerhq/wallet-cli                 # 2.1.0 on 2026-09-07; needs an npm prefix the daily user owns
WALLET_PASS=... wallet-cli ring init --name naumachy-mac   # device + Ledger Sync app; the password stays with Raouf
wallet-cli ring keys
wallet-cli ring encrypt --key naumachy-gym -i infra/gym/secrets.env -o infra/gym/secrets.env.enc
# on the arena host, after the ring is provisioned there from the same seed:
WALLET_PASS=... wallet-cli ring decrypt --key naumachy-gym -i infra/gym/secrets.env.enc -o infra/gym/secrets.env
```

Facts from the official wallet-cli skill (agent-skills, `skills/wallet-cli/wallet-cli-usage/SKILL.md`): `ring init` needs the device, the Ledger Sync app and a password in `WALLET_PASS`; `encrypt` and `decrypt` need no device but need network access (the LKRP backend restores the trustchain on every call) and the OS keychain; `ring destroy` wipes the membership and asks for a typed confirmation. The ring is recoverable from the seed on any machine.

## Open questions for the spike

1. Headless decrypt on a Linux host without a desktop keychain: the skill says the ring commands are "blocked by OS keychain access restrictions" in sandboxes. What backs the keychain on a headless Ubuntu box, and does `WALLET_PASS` alone suffice?
2. Provisioning the ring on a second machine from the seed: does it need the device once on that machine, or only the Ledger Sync membership?
3. Rate and latency of the LKRP backend call on every decrypt: fine for a boot-time secrets load, to be measured.

## Feedback so far

- The ETHOnline page and the developer portal describe the Key Ring in prose ("one device tap to set up, then none") but the commands, the password variable, the network requirement and the keychain requirement are only in the agent skill file. A "Key Ring in five commands" page next to the prize page would have saved the search.
- The npm registry entry of `@ledgerhq/wallet-cli` ships without a README, and there is no public repository to read; the skill file is the only reference for humans too.
- `npm i -g` on a machine where the Node prefix is owned by another user (a common Homebrew hardening) fails; `npx -y @ledgerhq/wallet-cli` needs a `wallet-cli` binary on the path to work at all. A `bunx`/`npx` friendly entry point, or a note on `npm config set prefix`, would help.

(To be completed with screenshots and the spike results.)
