-- The overview and the series scan fill_values by time; the rows are written in time order per
-- chain, so a BRIN index on ts is a few hundred kilobytes and lets the short windows (24h, 7d)
-- skip most of the table. The 30-day window still reads most of it, by design.
CREATE INDEX IF NOT EXISTS fill_values_ts_brin ON fill_values USING brin (ts) WITH (pages_per_range = 32);
