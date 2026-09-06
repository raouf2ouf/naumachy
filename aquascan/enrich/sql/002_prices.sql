-- Milestone 2: token metadata and dollar prices per token and hour, with provenance.

CREATE TABLE tokens (
  chain      text NOT NULL,
  address    text NOT NULL,
  symbol     text,
  name       text,
  decimals   int,
  source     text,                        -- where symbol/decimals came from: defillama | rpc
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, address)
);

-- One row per (chain, token, hour) that was priced. Never deleted: a permanent cache.
CREATE TABLE prices (
  chain      text NOT NULL,
  token      text NOT NULL,
  hour       bigint NOT NULL,             -- unix seconds, floored to the hour
  usd        double precision NOT NULL,
  source     text NOT NULL,               -- defillama | tokenapi
  source_ts  bigint NOT NULL,             -- timestamp of the actual data point used
  confidence real,                        -- the source's own confidence when it reports one
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, token, hour)
);

-- Hours a source could not price. Recent hours are retried; old ones become permanent misses.
CREATE TABLE price_misses (
  chain     text NOT NULL,
  token     text NOT NULL,
  hour      bigint NOT NULL,
  tries     int NOT NULL DEFAULT 0,
  permanent boolean NOT NULL DEFAULT false,
  last_try  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, token, hour)
);
