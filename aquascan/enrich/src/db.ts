import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 4 });
}

// Applies sql/*.sql in name order, once each, inside a transaction.
export async function migrate(pool: Pool, dir: string): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const { rowCount } = await pool.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file]);
    if (rowCount) continue;
    const sql = await readFile(join(dir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}

// Multi-row upsert in chunks. `columns` are inserted in order; `conflict` names the key;
// every non-key column is updated on conflict so a re-read of the same rows is idempotent.
export async function upsertRows(
  client: Client,
  table: string,
  columns: string[],
  conflict: string[],
  rows: unknown[][],
  chunkSize = 500,
): Promise<void> {
  if (rows.length === 0) return;
  const updates = columns.filter((c) => !conflict.includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => { params.push(value); return `$${params.length}`; });
      return `(${placeholders.join(",")})`;
    });
    const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}
      ON CONFLICT (${conflict.join(",")}) DO UPDATE SET ${updates.join(", ")}`;
    await client.query(sql, params);
  }
}
