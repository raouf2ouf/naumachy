-- Chains read through Substreams instead of a subgraph. subgraph_id then holds the Substreams
-- endpoint, and the stream cursor lives here; the block cursors keep their meaning.
ALTER TABLE chains ADD COLUMN source text NOT NULL DEFAULT 'subgraph';   -- subgraph | substreams
ALTER TABLE chains ADD COLUMN substreams_cursor text;
