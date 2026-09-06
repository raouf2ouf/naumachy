-- Milestone 3: what the explorer reads. Recomputed by the rollup after each pass.
-- Every dollar figure is NULL when any leg it depends on is unpriced; ratios say how much is covered.

CREATE TABLE fill_values (
  chain            text NOT NULL,
  fill_id          text NOT NULL,
  strategy_id      text NOT NULL,
  ts               bigint NOT NULL,
  hour             bigint NOT NULL,
  legs             int NOT NULL,
  priced_legs      int NOT NULL,
  priced           boolean NOT NULL,
  volume_usd       double precision,       -- value of what the maker received, at the fill hour
  edge_usd         double precision,       -- value of all net legs at the fill hour: the maker's instant gain
  markout_1h_usd   double precision,       -- how the position taken moved one hour later
  markout_24h_usd  double precision,       -- and one day later
  PRIMARY KEY (chain, fill_id)
);
CREATE INDEX fill_values_strategy ON fill_values (chain, strategy_id);
CREATE INDEX fill_values_hour ON fill_values (chain, hour);

-- Pair marks: the strategy's own 24h VWAP of quote per base, anchored at the pair's last fill.
CREATE TABLE strategy_marks (
  chain        text NOT NULL,
  strategy_id  text NOT NULL,
  base_token   text NOT NULL,
  quote_token  text NOT NULL,
  vwap_raw     double precision NOT NULL,  -- raw quote units per raw base unit
  fills        int NOT NULL,
  mark_ts      bigint NOT NULL,
  PRIMARY KEY (chain, strategy_id, base_token)
);

CREATE TABLE strategy_stats (
  chain              text NOT NULL,
  strategy_id        text NOT NULL,
  maker              text NOT NULL,
  desk               text NOT NULL,
  template           text NOT NULL,
  registry           text NOT NULL,
  status             text NOT NULL,
  fills              int NOT NULL,
  first_fill_ts      bigint,
  last_fill_ts       bigint,
  volume_usd         double precision,
  edge_usd           double precision,
  markout_1h_usd     double precision,
  markout_24h_usd    double precision,
  priced_fills       int NOT NULL,
  priced_ratio       real NOT NULL,
  quote_token        text,                 -- numeraire: a stable if the strategy touched one, else its most traded token
  pnl_quote          double precision,     -- pair-native P&L in the quote token, no oracle involved
  pnl_quote_coverage real,                 -- share of base tokens that have a mark
  mark_age_s         bigint,
  pnl_usd_marked     double precision,     -- net position valued at the latest known prices
  takers             int NOT NULL,
  top_taker_share    real,
  self_fills         int NOT NULL,         -- taker is the maker itself
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, strategy_id)
);
CREATE INDEX strategy_stats_desk ON strategy_stats (chain, desk);

CREATE TABLE desk_stats (
  chain            text NOT NULL,
  desk             text NOT NULL,
  maker            text NOT NULL,
  template         text NOT NULL,
  strategies       int NOT NULL,
  live             int NOT NULL,
  fills            int NOT NULL,
  volume_usd       double precision,
  edge_usd         double precision,
  markout_1h_usd   double precision,
  markout_24h_usd  double precision,
  pnl_usd_marked   double precision,
  priced_ratio     real NOT NULL,
  first_seen       bigint,
  last_seen        bigint,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, desk)
);

CREATE TABLE daily_stats (
  chain           text NOT NULL,
  strategy_id     text NOT NULL,
  day             int NOT NULL,             -- unix days
  fills           int NOT NULL,
  volume_usd      double precision,
  edge_usd        double precision,
  markout_1h_usd  double precision,
  PRIMARY KEY (chain, strategy_id, day)
);

CREATE TABLE rollups (
  name        text PRIMARY KEY,
  ran_at      timestamptz NOT NULL,
  duration_ms int NOT NULL
);
