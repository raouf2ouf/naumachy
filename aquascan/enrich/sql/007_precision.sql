-- Precision of the headline: the standard error of the mean per-fill markout, in basis points of
-- volume, from the dispersion of the fills themselves. A desk with few fills gets a wide band.
ALTER TABLE strategy_stats
  ADD COLUMN markout_5m_bps real,            -- mean per-fill 5-minute markout, bps of the fill's volume
  ADD COLUMN markout_5m_bps_se real,         -- its standard error
  ADD COLUMN markout_1h_bps real, ADD COLUMN markout_1h_bps_se real;
ALTER TABLE desk_stats
  ADD COLUMN markout_5m_bps real, ADD COLUMN markout_5m_bps_se real,
  ADD COLUMN markout_1h_bps real, ADD COLUMN markout_1h_bps_se real;
