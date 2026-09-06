-- Templates: one row per (app, opcode sequence). Instructions and names come from the router's
-- dialect table; apps we do not know keep NULL instructions and stay "unparsed" or "unknown app".

CREATE TABLE templates (
  chain          text NOT NULL,
  id             text NOT NULL,           -- keccak(app, opcodes), as in the subgraph
  app            text NOT NULL,
  opcodes        int[] NOT NULL,
  instructions   text[],                  -- decoded through the app's dialect, NULL when unknown
  name           text,                    -- human name derived from the instructions
  kind           text,                    -- amm | concentrated | limit | dutch | twap | pegged | custom | unknown
  strategy_count int NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain, id)
);
CREATE INDEX templates_app ON templates (chain, app);
