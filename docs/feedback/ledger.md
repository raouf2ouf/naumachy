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

## Findings, 2026-09-07 (headless Linux container, wallet-cli 2.1.0; no device attached)

- `npm i -g @ledgerhq/wallet-cli` on Ubuntu 24.04 x64 installs the `linux-x64` binary; `wallet-cli --version` and every `--help` answer as JSON envelopes (`{"ok": true, "data": {...}}`), which is agent-friendly but surprising in a terminal.
- `ring keys` before `ring init` says "Ledger Key Ring not initialized. Run `wallet-cli ring init` first." and does not touch the keychain; `ring init` without a device prints "Connect device, open Ledger Sync app" and after about a minute "No Ledger device found. Unlock the device and try again." Clear messages.
- The Linux keychain requirement is the Secret Service: a headless `gnome-keyring-daemon --unlock --components=secrets` under `dbus-run-session` satisfies `@napi-rs/keyring`; `secret-tool` round-trips. Worth one line in the docs for VPS users, since the skill file only says the ring commands are "blocked by OS keychain access restrictions" in sandboxes.
- The CLI's device transport is hard-coded to Node WebUSB (`src/device/dmk.ts` adds only `nodeWebUsbTransportFactory`; `register-dmk-transport.ts` reads no environment). The repository contains an APDU proxy server (`src/apdu-proxy.ts`: HTTP `POST /` with `{apduHex}`, WebSocket with an `open` handshake, port 8435) but no client side in the CLI. Consequence: `ring init` cannot enrol a machine whose Ledger is elsewhere, which is the "Key Ring on a VPS, CI runner, hosted agent" direction of the track. A `DEVICE_PROXY_URL` transport in the CLI, speaking the proxy's own protocol, would close it; our workaround is USB/IP through an SSH tunnel, see `docs/ledger-and-hosting.md`.
- `ring init` help says "creating or recovering a trustchain": the same device on a second machine joins the same trustchain (`getOrCreateTrustchain`), so encrypt-here, decrypt-there works when the device can be plugged into both. The docs do not say this in so many words; a "second machine" paragraph would help.
- `send` accepts `--amount '50 USDC'` and `--data` (EVM calldata), and `account discover --network base` accepts Base: the human-approved promotion transfer can be a plain clear-signed USDC transfer from the Flex account, no custom signer code.
- Workshop transcript, 2026-09-07: the product managers (Etienne Waldron, Oscar) explicitly asked for "hacks or experimentation to extend the limits of this feature or make it available on more setups, for example remote agent setups", and confirmed a Nano X can initialise the ring. Their model in one sentence: "agents propose, humans approve, hardware signs".

(To be completed with the ring init on the Mac, the enrollment of the arena host, timings of `ring decrypt` against the LKRP backend, and screenshots.)

## Findings, 2026-09-12 (macOS, wallet-cli 2.1.0, Ledger Flex)

- `account discover --network base` found one account, at index 1, an address the operator had never used; the funded account was at index 7. The CLI runs Ledger Live's own `scanAccounts` (live-common's currency bridge, Ledger Live's derivation paths `m/44'/60'/N'/0/0`) and that scanner stops at the first account with no history; the CLI exposes no count, index or path option, and `send --account` accepts only labels discovery produced. So any Ledger Live account beyond an unused one is unreachable from the CLI. We derived the eight first addresses with Foundry's `cast wallet address --ledger --hd-path` to find ours, and moved the prize to index 1.
- Proposed fix, self-contained in `apps/wallet-cli`: an `account add --index N` (or `--path`) command that derives the address at Ledger Live's path for that index, builds the session descriptor and syncs it through the bridge, so `--account base-7` exists without a scan. A scan knob in coin-framework would do it too but touches every Ledger product.
- Discovery's label numbering follows Ledger Live's, which is good: `base-1` is exactly Ledger Live's first Ethereum account, and money put there shows up in the app.
- Transplanting a member to a host without USB works: copy `session.yaml` and the keychain entry. Two things to know. The entry's account name is `member-private-key-` plus the first 16 hex characters of the SHA-256 of the state directory path, so it differs per machine and the copy must be stored under the destination's name. And on macOS `security find-generic-password -w` prints a value that contains a newline as hex; the entry is two lines (`ENC:` wrapped key, then the public key), so decode it before storing it in the Secret Service. Headless decrypt on Ubuntu then takes about two seconds under `dbus-run-session` with `gnome-keyring-daemon --unlock`. A documented `ring export-member` / `ring import-member` pair would replace this archaeology.
