import type { Pool } from "../db.js";
import { upsertRows } from "../db.js";
import { decodeFees } from "../fees.js";

// Decodes the fee instructions of every strategy that has no row yet. Programs never change,
// so one decode per strategy is final; a dialect change is applied by truncating the table.
export async function syncFees(pool: Pool, batch = 5000): Promise<{ decoded: number; unknown: number }> {
  let decoded = 0; let unknown = 0;
  for (;;) {
    const { rows } = await pool.query(`
      SELECT s.chain, s.id, s.app, s.program FROM strategies s
      LEFT JOIN strategy_fees f ON f.chain = s.chain AND f.strategy_id = s.id
      WHERE f.strategy_id IS NULL LIMIT $1`, [batch]);
    if (rows.length === 0) break;
    const out = rows.map((r) => {
      const fees = decodeFees(r.app, new Uint8Array(r.program));
      if (fees === null) unknown += 1; else decoded += 1;
      return [r.chain, r.id, fees?.makerFeeBps ?? null, fees?.makerFeeSide ?? null, fees?.makerFeeKind ?? null,
        fees?.protocolFeeBps ?? null, fees?.protocolFeeTo ?? null, fees?.protocolFeeKind ?? null, fees?.protocolFeeProvider ?? null, fees !== null];
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await upsertRows(client, "strategy_fees", ["chain", "strategy_id", "maker_fee_bps", "maker_fee_side", "maker_fee_kind", "protocol_fee_bps", "protocol_fee_to", "protocol_fee_kind", "protocol_fee_provider", "decoded"], ["chain", "strategy_id"], out);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    if (rows.length < batch) break;
  }
  return { decoded, unknown };
}
