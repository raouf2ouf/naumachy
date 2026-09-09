-- What the 1inch incentive programme paid each maker, read from Merkl (the distributor). Rewards are
-- claimed on Ethereum whichever network the volume was on, so they belong to the wallet, not to a
-- maker-on-chain row; the explorer shows them next to the wallet's result with that caveat.

CREATE TABLE maker_rewards (
  maker       text NOT NULL,
  token       text NOT NULL,             -- reward token on Ethereum
  symbol      text,
  decimals    int,
  amount      numeric(78,0) NOT NULL,    -- all-time, raw units
  claimed     numeric(78,0) NOT NULL,
  pending     numeric(78,0) NOT NULL,
  price_usd   double precision,          -- Merkl's price at fetch time
  campaigns   int NOT NULL,              -- breakdown entries (one per campaign and epoch)
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (maker, token)
);

CREATE TABLE maker_rewards_checked (
  maker       text PRIMARY KEY,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  rewards     int NOT NULL               -- reward tokens found, 0 when Merkl knows nothing
);
