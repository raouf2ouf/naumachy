-- Milestone 4: reference prices from the venue's own tape, standard markouts, fees.
-- The tape reference of a fill is the volume-weighted price of the same pair's other fills around
-- the fill minute (other makers and other takers only), then all fills around 5 minutes, 1 hour and
-- 1 day later. Dollars still come from the hourly price of the pair's quote token.

CREATE TABLE strategy_fees (
  chain                 text NOT NULL,
  strategy_id           text NOT NULL,
  maker_fee_bps         real,             -- basis points, from the program's fee instruction (1e9 base in Fee.sol)
  maker_fee_side        text,             -- in | out
  maker_fee_kind        text,             -- flat | progressive
  protocol_fee_bps      real,
  protocol_fee_to       text,
  protocol_fee_kind     text,             -- static | dynamic
  protocol_fee_provider text,
  decoded               boolean NOT NULL, -- false when the router is unknown or the program does not walk
  decoded_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, strategy_id)
);

ALTER TABLE fill_values
  ADD COLUMN ref_kind         text,               -- tape | hourly: what the edge and markouts are measured against
  ADD COLUMN ref_window_min   int,                -- half-width in minutes of the tape window at fill time
  ADD COLUMN ref_fills        int,                -- other fills inside that window
  ADD COLUMN markout_5m_usd   double precision,   -- the fill re-marked five minutes later (tape only)
  ADD COLUMN drift_1h_usd     double precision,   -- markout minus edge: how the reference moved after the fill
  ADD COLUMN drift_24h_usd    double precision,
  ADD COLUMN protocol_fee_usd double precision,   -- pulled out of the maker's ledger for the protocol in this fill
  ADD COLUMN maker_fee_usd    double precision;   -- the maker's own fee, volume times the program's rate
COMMENT ON COLUMN fill_values.edge_usd IS 'the fill against the reference at fill time: what the maker captured';
COMMENT ON COLUMN fill_values.markout_1h_usd IS 'the fill re-marked at the reference one hour later: edge plus drift';
COMMENT ON COLUMN fill_values.markout_24h_usd IS 'the fill re-marked at the reference one day later';

ALTER TABLE strategy_stats
  ADD COLUMN markout_5m_usd double precision, ADD COLUMN drift_1h_usd double precision, ADD COLUMN drift_24h_usd double precision,
  ADD COLUMN protocol_fee_usd double precision, ADD COLUMN maker_fee_usd double precision,
  ADD COLUMN tape_fills int NOT NULL DEFAULT 0;
ALTER TABLE desk_stats
  ADD COLUMN markout_5m_usd double precision, ADD COLUMN drift_1h_usd double precision, ADD COLUMN drift_24h_usd double precision,
  ADD COLUMN protocol_fee_usd double precision, ADD COLUMN maker_fee_usd double precision,
  ADD COLUMN tape_fills int NOT NULL DEFAULT 0,
  ADD COLUMN maker_fee_bps real,                  -- volume-weighted across the desk's strategies
  ADD COLUMN maker_fee_bps_min real, ADD COLUMN maker_fee_bps_max real;
ALTER TABLE daily_stats
  ADD COLUMN markout_5m_usd double precision, ADD COLUMN drift_1h_usd double precision,
  ADD COLUMN protocol_fee_usd double precision, ADD COLUMN maker_fee_usd double precision;
