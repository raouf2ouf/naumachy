-- Human names for addresses the explorer shows. Seeded with what is known from the contracts;
-- makers get labels later, as evidence, never as badges.

CREATE TABLE labels (
  chain   text NOT NULL,                  -- '*' applies on every chain
  address text NOT NULL,
  label   text NOT NULL,
  kind    text NOT NULL,                  -- registry | router | maker | taker | token
  source  text NOT NULL,                  -- where the name comes from
  PRIMARY KEY (chain, address)
);

INSERT INTO labels (chain, address, label, kind, source) VALUES
  ('*', '0x1111113ccf1426a8e30e2bff5e005d929bf6a90a', 'Aqua registry (canonical)', 'registry', '1inch aqua README'),
  ('*', '0x499943e74fb0ce105688beee8ef2abec5d936d31', 'Aqua registry (legacy)', 'registry', '1inch aqua README, superseded 2026-08'),
  ('*', '0x111111338c5091e8440b67b168bae16a668ac0de', 'SwapVM router (1inch)', 'router', '1inch aqua README');
