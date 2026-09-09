-- Realised and unrealised P&L per maker and chain, average-cost method over the legs of economic
-- fills since the maker was first seen on Aqua. Every fill is self-financing: the leg with the
-- best-priced token (a stable first, then a major) is valued at the hour's USD price and the other
-- leg at the rate the fill itself set, so realised + unrealised equals the position marked at
-- latest prices whenever every fill is priced. Fees are inside the legs and are not added again.

CREATE TABLE maker_pnl (
  chain           text NOT NULL,
  maker           text NOT NULL,
  token           text NOT NULL,
  position        double precision NOT NULL,   -- net units received minus given since first seen, token units
  basis_usd       double precision,            -- average cost per unit of the open position
  realised_usd    double precision NOT NULL,
  unrealised_usd  double precision,            -- NULL when the token has no mark
  mark_usd        double precision,
  mark_hour       bigint,
  legs            int NOT NULL,
  PRIMARY KEY (chain, maker, token)
);

ALTER TABLE maker_stats ADD COLUMN realised_usd double precision;
ALTER TABLE maker_stats ADD COLUMN unrealised_usd double precision;
ALTER TABLE maker_stats ADD COLUMN pnl_fills bigint NOT NULL DEFAULT 0;         -- economic fills the walk could price
ALTER TABLE maker_stats ADD COLUMN pnl_unpriced_fills bigint NOT NULL DEFAULT 0;
ALTER TABLE maker_stats ADD COLUMN pnl_mark_hour bigint;                         -- oldest mark among the maker's open tokens
