import type { Pool } from "../db.js";
import type { Paced } from "../pacer.js";

export interface TokenLaneStats { asked: number; resolved: number }

// Decimals and symbols for tokens DefiLlama did not describe, read from the chain in one
// batched JSON-RPC request per chain. decimals() = 0x313ce567, symbol() = 0x95d89b41.
export async function syncTokens(pool: Pool, rpcByChain: Record<string, string | undefined>, paced: Paced, perChain = 50, fetchImpl: typeof fetch = fetch): Promise<TokenLaneStats> {
  const stats: TokenLaneStats = { asked: 0, resolved: 0 };
  for (const [chain, rpc] of Object.entries(rpcByChain)) {
    if (!rpc) continue;
    const { rows } = await pool.query<{ token: string }>(`
      SELECT DISTINCT l.token FROM legs l
      LEFT JOIN tokens t ON t.chain = l.chain AND t.address = l.token
      WHERE l.chain = $1 AND (t.address IS NULL OR t.decimals IS NULL) LIMIT $2`, [chain, perChain]);
    if (rows.length === 0) continue;
    stats.asked += rows.length;
    const calls = rows.flatMap((r, i) => [
      { jsonrpc: "2.0", id: i * 2, method: "eth_call", params: [{ to: r.token, data: "0x313ce567" }, "latest"] },
      { jsonrpc: "2.0", id: i * 2 + 1, method: "eth_call", params: [{ to: r.token, data: "0x95d89b41" }, "latest"] },
    ]);
    const res = await paced(() => fetchImpl(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls) }));
    if (!res.ok) throw new Error(`rpc ${chain} ${res.status}`);
    const results = (await res.json()) as { id: number; result?: string }[];
    const byId = new Map(results.map((r) => [r.id, r.result]));
    for (let i = 0; i < rows.length; i++) {
      const dec = byId.get(i * 2); const sym = byId.get(i * 2 + 1);
      const decimals = dec && dec.length >= 66 ? Number(BigInt(dec)) : null;
      const symbol = sym ? decodeString(sym) : null;
      if (decimals === null && symbol === null) continue;
      await pool.query(`INSERT INTO tokens (chain, address, symbol, decimals, source) VALUES ($1, $2, $3, $4, 'rpc')
        ON CONFLICT (chain, address) DO UPDATE SET symbol = COALESCE(tokens.symbol, EXCLUDED.symbol), decimals = COALESCE(tokens.decimals, EXCLUDED.decimals), source = COALESCE(tokens.source, 'rpc'), updated_at = now()`,
        [chain, r(rows, i), symbol, decimals]);
      stats.resolved += 1;
    }
  }
  return stats;
}

function r(rows: { token: string }[], i: number): string { return rows[i].token; }

// ABI string return (offset, length, bytes) or a bytes32 symbol on very old tokens.
export function decodeString(hex: string): string | null {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length === 0) return null;
  try {
    if (data.length === 64) return Buffer.from(data, "hex").toString("utf8").replace(/\0+$/, "") || null;
    const offset = Number(BigInt("0x" + data.slice(0, 64))) * 2;
    const len = Number(BigInt("0x" + data.slice(offset, offset + 64))) * 2;
    const s = Buffer.from(data.slice(offset + 64, offset + 64 + len), "hex").toString("utf8");
    return s.replace(/\0+$/, "") || null;
  } catch {
    return null;
  }
}
