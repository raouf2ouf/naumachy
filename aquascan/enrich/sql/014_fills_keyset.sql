-- The P&L walk pages economic fills by (ts, id); without this index every page re-sorts the chain.
CREATE INDEX fills_economic_ts_id ON fills (chain, ts, id) WHERE economic;
