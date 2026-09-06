-- Milestone 1: chain cursors, strategies, fills, legs, straight from the subgraphs.
-- Amounts are uint256 and stay exact: numeric(78,0). Addresses and hashes are lowercase hex text.

CREATE TABLE chains (
  name               text PRIMARY KEY,
  subgraph_id        text NOT NULL,
  ships_cursor_ts    bigint NOT NULL DEFAULT 0,   -- strategies paged by shippedAt
  docks_cursor_ts    bigint NOT NULL DEFAULT 0,   -- docked strategies paged by dockedAt
  fills_cursor_block bigint NOT NULL DEFAULT 0,   -- fills paged by block
  subgraph_head      bigint,                      -- _meta.block.number from the last response
  gateway_calls      bigint NOT NULL DEFAULT 0,   -- lifetime gateway queries for this chain
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE strategies (
  chain         text NOT NULL,
  id            text NOT NULL,           -- maker ++ app ++ strategyHash, as in the subgraph
  strategy_hash text NOT NULL,
  registry      text NOT NULL,           -- canonical or legacy Aqua registry address
  maker         text NOT NULL,
  app           text NOT NULL,
  desk          text NOT NULL,
  template      text NOT NULL,
  program       bytea NOT NULL,
  parsed        boolean NOT NULL,
  tokens        text[] NOT NULL,
  amounts       numeric(78,0)[] NOT NULL,
  shipped_at    bigint NOT NULL,
  shipped_tx    text NOT NULL,
  docked_at     bigint,
  docked_tx     text,
  status        text NOT NULL,           -- LIVE | DOCKED
  PRIMARY KEY (chain, id)
);
CREATE INDEX strategies_maker ON strategies (chain, maker);
CREATE INDEX strategies_desk ON strategies (chain, desk);
CREATE INDEX strategies_shipped ON strategies (chain, shipped_at);

CREATE TABLE fills (
  chain       text NOT NULL,
  id          text NOT NULL,             -- tx-strategyId, as in the subgraph
  strategy_id text NOT NULL,
  registry    text NOT NULL,
  tx          text NOT NULL,
  block       bigint NOT NULL,
  ts          bigint NOT NULL,
  taker       text,
  shape       text NOT NULL,             -- PUSH_ONLY | PULL_ONLY | TWO_SIDED | MULTI
  economic    boolean NOT NULL,          -- the only fills that count, everywhere
  leg_count   int NOT NULL,
  PRIMARY KEY (chain, id)
);
CREATE INDEX fills_strategy ON fills (chain, strategy_id);
CREATE INDEX fills_block ON fills (chain, block);
CREATE INDEX fills_economic_ts ON fills (chain, ts) WHERE economic;

CREATE TABLE legs (
  chain   text NOT NULL,
  id      text NOT NULL,                 -- fill-token, as in the subgraph
  fill_id text NOT NULL,
  token   text NOT NULL,
  net     numeric(78,0) NOT NULL,        -- pushed minus pulled
  pushed  numeric(78,0) NOT NULL,
  pulled  numeric(78,0) NOT NULL,
  PRIMARY KEY (chain, id)
);
CREATE INDEX legs_fill ON legs (chain, fill_id);
CREATE INDEX legs_token ON legs (chain, token);
