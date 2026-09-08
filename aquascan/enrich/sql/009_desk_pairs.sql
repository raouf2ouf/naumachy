-- What each desk trades: its two-sided fills grouped by pair, base then quote as the pair tape
-- orients them, with the fills and the priced volume. Rebuilt at every rollup.
CREATE TABLE desk_pairs (
  chain        text NOT NULL,
  desk         text NOT NULL,
  base_token   text NOT NULL,
  quote_token  text NOT NULL,
  fills        int NOT NULL,
  volume_usd   double precision,
  PRIMARY KEY (chain, desk, base_token, quote_token)
);
