-- Milestone 5: same-chain pools as references. A pair whose own tape is thin is routed to the
-- deepest active pool of the exact pair, or through a hub (WETH, a stable) with the dense leg
-- on the tape and the other leg in a pool. Pools and their swaps come from published DEX
-- subgraphs on The Graph Network.

CREATE TABLE pools (
  chain          text NOT NULL,
  id             text NOT NULL,           -- pool address
  protocol       text NOT NULL,           -- uniswap-v3 | pancakeswap-v3
  subgraph       text NOT NULL,
  token0         text NOT NULL,
  token1         text NOT NULL,
  fee_tier       int,
  swaps_30d      int,
  volume_30d_usd double precision,
  cursor_ts      bigint NOT NULL DEFAULT 0,   -- swaps read up to this timestamp
  swaps_loaded   int NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, id)
);

CREATE TABLE pool_swaps (
  chain    text NOT NULL,
  id       text NOT NULL,                 -- swap id in the subgraph
  pool     text NOT NULL,
  ts       bigint NOT NULL,
  amount0  numeric NOT NULL,              -- token units, signed as the subgraph reports them
  amount1  numeric NOT NULL,
  PRIMARY KEY (chain, id)
);
CREATE INDEX pool_swaps_pool_ts ON pool_swaps (chain, pool, ts);

-- One row per pair seen in the last 30 days, in the rollup's orientation (a base, b quote).
-- A leg is a pair on the tape (src tape) or in a pool (src pool); the reference price of the
-- pair is leg1 times leg2 (leg2 absent for a direct route), each leg inverted when flagged.
CREATE TABLE pair_routes (
  chain          text NOT NULL,
  a              text NOT NULL,
  b              text NOT NULL,
  kind           text NOT NULL,           -- tape | pool | hop | hourly
  tape_per_hour  real,                    -- the pair's own prints per hour over 30 days
  volume_30d_usd double precision,
  leg1_a text, leg1_b text, leg1_src text, leg1_inv boolean,
  leg2_a text, leg2_b text, leg2_src text, leg2_inv boolean,
  pool           text,                    -- the pool behind the pool leg
  hub            text,                    -- the hub token of a hop
  decided_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, a, b)
);
