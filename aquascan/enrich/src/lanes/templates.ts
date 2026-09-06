import type { Gateway } from "../gateway.js";
import type { Pool } from "../db.js";
import { upsertRows } from "../db.js";
import { decodeInstructions } from "../dialects.js";
import { nameTemplate } from "../naming.js";

interface TemplateRow { id: string; app: { id: string }; opcodes: number[]; name: string | null; strategyCount: number }
interface TemplatesData { _meta: { block: { number: string } }; templates: TemplateRow[] }

const QUERY = `query Templates($after: Bytes!, $first: Int!) {
  _meta { block { number } }
  templates(first: $first, orderBy: id, orderDirection: asc, where: { id_gt: $after }) { id app { id } opcodes name strategyCount }
}`;

// Templates are few (dozens per chain) and have no timestamp, so every pass re-reads them all,
// paged by id. Names are derived here, not in the subgraph, so the dialect tables can evolve.
export async function syncTemplates(pool: Pool, gateway: Gateway, chain: string, subgraphId: string, pageSize: number): Promise<{ pages: number; rows: number }> {
  let after = "0x00"; let pages = 0; let rows = 0;
  for (;;) {
    const { data } = await gateway.query<TemplatesData>(subgraphId, QUERY, { after, first: pageSize });
    pages += 1;
    const batch = data.templates;
    if (batch.length === 0) break;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await upsertRows(client, "templates", ["chain", "id", "app", "opcodes", "instructions", "name", "kind", "strategy_count", "updated_at"], ["chain", "id"],
        batch.map((t) => {
          const parsed = t.name !== "unparsed";
          const instructions = parsed ? decodeInstructions(t.app.id, t.opcodes) : null;
          const n = nameTemplate(instructions, parsed);
          return [chain, t.id, t.app.id, t.opcodes, instructions, n.name, n.kind, t.strategyCount, new Date()];
        }));
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    rows += batch.length;
    if (batch.length < pageSize) break;
    after = batch[batch.length - 1].id;
  }
  return { pages, rows };
}
