# Ledger as the third bounty, and where the arena runs

Written 2026-09-07 evening from the Ledger workshop transcript (Granola, "Ledger x ETHOnline"), the prize pages re-read the same day, the wallet-cli source on GitHub, and a headless Ubuntu container running wallet-cli 2.1.0. Decision memo for Raouf and Kate.

## 1. The prizes, re-read

| Sponsor | Track we target | Pool | Places | Notes |
|---|---|---|---|---|
| 1inch | Build an Aqua App | $5,000 | 2,500 / 1,500 / 1,000 | SwapVM projects scored higher; on-chain transfers in the demo (forks allowed); real commit history |
| The Graph | Composable or standardized products | $5,000 | 2,500 / 1,500 / 1,000 | two or more Graph products composed; live gateway data; "what became easier because a shared schema was used" |
| The Graph | AI tooling or AI use case, from scratch | $5,000 | 2,500 / 1,500 / 1,000 | The Graph load-bearing; "reasoning, decisions, automation, not printing a raw query result" |
| Ledger | AI Agents x Ledger | $3,500 | 2,000 / 1,000 / 500 | must be built on the Ledger Agent Stack, in particular the Key Ring CLI; net-new |

Continuity tracks are not ours. Addressable total: $18,500 across four tracks, plus the finalist gate. Nothing else on the page fits without inventing work: ENS (lineage subnames) stays "only if free after M5"; Uniswap Foundation's stack contribution would need our pools subgraph to be a contribution to their stack, which it is not; Chainlink, Arc, Hedera, World, Privy, Bazantic are off-topic.

## 2. Should Ledger be the third bounty? Yes.

What the Ledger judges said they want (workshop, 2026-09-07, and the track page):

- "device-backed security is central to the product": agents that hold secrets they cannot leak; systems that ask for a human before anything irreversible.
- Named directions: "Key Ring enrollment on systems without USB ports (VPS, CI runners, hosted agents)"; "scoped capabilities distributed by brokers, never raw API keys"; human-in-the-loop for high-risk actions.
- Judging: real user value, a clear boundary between autonomous and approved actions, a practical device-trust demonstration, a reproducible demo ("we will run your code"), and documentation feedback ("a simple page would do").

Why it fits without bending the project:

1. The arena host is a hosted agent that holds secrets that matter: six private keys with real money, the Anthropic key, the Graph and RPC keys. Today they would sit in a `.env`. In the Key Ring they are encrypted under the Flex and decrypted headless at boot.
2. Promotion is the one irreversible act: the champion's real bankroll moves. It is signed on the Flex, clear-signed, by Raouf. Everything before it is autonomous and capped (RiskCap, small ledgers).
3. The arena host has no USB port. Enrolling it is exactly their first named direction, and nobody else in the room will have a hosted agent that needs it.
4. The marginal work is about a day and a half of the five and a half left, and the Flex is already here.

Risks, stated: the enrollment hack may not work (fallbacks below); every `ring decrypt` calls the LKRP backend, so an outage blocks a boot (measure it, say it in the feedback); the judges need their own Ledger to run our path, so the runbook must work with a fresh ring and their own secrets, not ours.

## 3. What the Ledger path needs

Facts established today (details and dates in `docs/feedback/ledger.md`):

- `wallet-cli` 2.1.0 installs and runs on headless Ubuntu 24.04 x64. `ring init` needs the device on that machine's USB; without one it waits, then "No Ledger device found".
- Its device transport is hard-coded to Node WebUSB (`src/device/dmk.ts`, `register-dmk-transport.ts`). The repository ships an APDU proxy server (`src/apdu-proxy.ts`, WebSocket, port 8435) but the CLI has no client mode for it. So the CLI itself cannot enrol a remote machine.
- The trustchain is per device seed (`getOrCreateTrustchain`), so every machine initialised with the same Flex shares the same encryption root: encrypt on the Mac, decrypt on the host.
- On Linux the member key lives in the Secret Service; a headless `gnome-keyring-daemon` under `dbus-run-session` satisfies it (tested).
- `wallet-cli send` takes `--amount '50 USDC'` and an optional `--data` calldata; `account discover --network base` accepts Base. The promotion transfer can be a plain clear-signed USDC transfer on Base from the Flex account.

The work, in order:

1. **Raouf, with the Flex (30 min):** install the Ledger Sync app on the Flex from Ledger Live; `npm config set prefix ~/.npm-global` then `npm i -g @ledgerhq/wallet-cli`; put the ring password in the macOS keychain (`security add-generic-password -a default -s ledger-wallet-cli -w`); `WALLET_PASS=$(security find-generic-password -a default -s ledger-wallet-cli -w) wallet-cli ring init --name naumachy-mac`; `wallet-cli account discover --network base` to get `base-1`, the prize wallet; fund it with the prize (see the lean budget) and gas.
2. **Secrets (me, then Raouf encrypts):** `infra/arena/secrets.env` holds the six Base keys (generated fresh, never used elsewhere), the Anthropic key, the Graph and RPC keys. `wallet-cli ring encrypt --key naumachy-arena -i secrets.env -o secrets.env.enc`, then the clear file is shredded. The host's boot script decrypts to stdout straight into the process environment; the clear text never touches the host's disk.
3. **Enrolling the host without USB (the hack, 2 h budget):** a Linux VM on the Mac (UTM) with the Flex passed through runs `usbipd`; an SSH tunnel carries port 3240 to the host; the host does `usbip attach` and the Flex appears as a local USB HID device; `wallet-cli ring init --name naumachy-arena` runs unmodified with the tap on the Flex. Fallback A: copy the Mac member (wrapped key from the keychain plus `session.yaml`) into the host's keyring, one member on two machines, documented as the weaker model. Fallback B: run the arena on the Mac.
4. **The tap (me):** the lanista process ends a day with a promotion request: it prints the champion, the amount, and the exact `wallet-cli send --account base-1 --to <champion> --amount '30 USDC'` line; Raouf runs it, the Flex shows the clear-signed transfer, and only after the transfer is mined does the lanista call `ArenaRegistry.promote` so the arena subgraph carries it. Nothing in the agents' code can move the prize.
5. **The boundary, written:** `docs/boundary.md`: what runs alone (gym, arena trading under RiskCap with capped ledgers), what needs a person (promotion, key rotation, ring init), what an agent never sees (the ring password, the clear secrets file).
6. **Runnable for judges:** `infra/arena/README.md` with the five commands, working with any Ledger and a fresh ring; a recorded walkthrough for the ones without a device.
7. **Feedback page:** the enrollment finding is the useful one for them: the CLI's transport is hard-coded although the proxy server exists; a `DEVICE_PROXY_URL` client transport would make `ring init` work on a VPS with the device on a laptop. If time allows, that is a pull request to `apps/wallet-cli`, which they invited.

## 4. Where it all runs

Two things need uptime for days and a public address: the Base arena (engine, agents, lanista) and Aquascan for the judges (GF.2). The gym needs neither.

| | Raouf's Mac | Hetzner CX33, Ubuntu 24.04 (4 vCPU, 8 GB, 80 GB, EUR 8.49/month) |
|---|---|---|
| Gym: anvil fork, graph-node stack, gym Aquascan, engine, agents | yes (24 GB, 10 cores; today under 2 GB used) | no |
| Base arena: engine, agents, lanista, Key Ring | possible, but the laptop must stay awake for days | yes; the Key Ring on a USB-less host is the Ledger story |
| Mainnet Aquascan: postgres (8.2 GB today), enrichment loop, API, web | runs today | move by `pg_dump` and restore; Caddy with automatic TLS on a subdomain of a domain we already own |
| Public URL | Cloudflare tunnel from the laptop | plain DNS + Caddy |

Recommendation: the gym stays on the Mac; the arena and the public Aquascan go to one CX33 (a CX43 at EUR 15.99 if we want headroom; prices rose in April and June 2026, verify at order time). Cost for the hackathon month: under EUR 20. A free RPC tier is enough if the Base engine ticks every 10 to 30 seconds; The Graph's free query tier covers Aquascan's polling. If Raouf would rather not run a server, everything works on the Mac with `caffeinate` and a Cloudflare tunnel, and the Ledger story loses the "no USB" chapter but keeps the Key Ring and the tap.
