-- The unit of judgement is a maker on a chain: the wallet that holds the inventory, across every
-- template and strategy it shipped there. Same columns as desk_stats, one row per maker and chain.
CREATE TABLE maker_stats (
  chain              text NOT NULL,
  maker              text NOT NULL,
  templates          int NOT NULL,
  strategies         int NOT NULL,
  live               int NOT NULL,
  fills              bigint NOT NULL,
  volume_usd         double precision,
  edge_usd           double precision,
  markout_1h_usd     double precision,
  markout_24h_usd    double precision,
  pnl_usd_marked     double precision,
  priced_ratio       real NOT NULL,
  first_seen         bigint,
  last_seen          bigint,
  markout_5m_usd     double precision,
  drift_1h_usd       double precision,
  drift_24h_usd      double precision,
  protocol_fee_usd   double precision,
  maker_fee_usd      double precision,
  tape_fills         bigint NOT NULL,
  maker_fee_bps      real,
  maker_fee_bps_min  real,
  maker_fee_bps_max  real,
  markout_5m_bps     real,
  markout_5m_bps_se  real,
  markout_1h_bps     real,
  markout_1h_bps_se  real,
  PRIMARY KEY (chain, maker)
);
-- Pairs carry the maker too, so a maker's pairs are one group by.
ALTER TABLE desk_pairs ADD COLUMN maker text;
CREATE INDEX desk_pairs_maker ON desk_pairs (chain, maker);
