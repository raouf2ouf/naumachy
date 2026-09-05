# Setup - one machine, same as the other

Both machines should match so a session on either can run any package.

## Tooling

- Node 22 via nvm (`nvm use` reads `.nvmrc`).
- Yarn 4 via corepack (`corepack enable`; the version is pinned in `package.json`). Never npm.
- Foundry (`forge`, `cast`, `anvil`): `curl -L https://foundry.sh | bash` then `foundryup`. Tested with forge 1.5.1.
- Docker Desktop (compose v2) for the gym stack and Aquascan.
- graph-cli: added as a workspace dev dependency, run with `yarn graph ...`. No global install needed.
- Substreams CLI (M6 only): follow The Graph docs when we get there.
- Ledger: `npm i -g @ledgerhq/wallet-cli` is what Ledger documents; we prefer `yarn dlx @ledgerhq/wallet-cli` or a workspace dependency. DMK skills: `npx skills add ledgerhq/agent-skills`. Details at developers.ledger.com/ethonline. Rudis vertical only.

## Keys

Copy `.env.example` to `.env` and fill it. Real values are shared privately, never committed, never pasted into chat with an AI session if avoidable (a session can read `.env` from disk when it needs to run something).

- The Graph: create an API key in Subgraph Studio (query key) and a deploy key (per subgraph).
- RPCs: public endpoints are fine for reads; Tenderly is optional for forks.
- Anthropic key for the gladiators.
- No private keys in `.env`. Gym keys are generated locally by the arena; live keys live in Ledger Key Ring.

## First run (once packages exist)

```sh
nvm use && corepack enable && yarn install
cd contracts && forge build
```

## Editor

Zed, with the repo root open so CLAUDE.md is picked up by every session.
