import type { Pool } from "../db.js";
import { upsertRows } from "../db.js";
import type { Paced } from "../pacer.js";

// Merkl distributes the 1inch Aqua incentive programme. One call per wallet returns every reward
// token with all-time amounts and per-campaign breakdowns; rewards are paid on Ethereum whichever
// network the volume was on. Each pass refreshes the makers checked longest ago, unchecked first.

export const MERKL_BASE = "https://api.merkl.xyz/v4";
// The address that created every campaign of the Aqua programme on Merkl (both the 1INCH and the USDC
// streams); a wallet's other Merkl rewards (other protocols' points, UNI campaigns) are not ours.
export const AQUA_CAMPAIGN_CREATOR = process.env.MERKL_AQUA_CREATOR ?? "0x83De93D5654abfe0778fCb9a7edd1970de061897";   // checksummed: Merkl rejects lowercase

interface Breakdown { campaignId: string; amount: string; claimed: string; pending: string; reason?: string }
interface MerklReward { token: { address: string; symbol: string; decimals: number; price?: number | null }; amount: string; claimed: string; pending: string; breakdowns?: Breakdown[] }
interface MerklChain { chain?: { id: number }; rewards?: MerklReward[] }

export interface RewardsStats { checked: number; withRewards: number; errors: number }

// The programme's campaign ids, read once per pass.
export async function aquaCampaigns(paced: Paced, fetchImpl: typeof fetch = fetch): Promise<Set<string>> {
  const res = await paced(() => fetchImpl(`${MERKL_BASE}/campaigns?creatorAddress=${AQUA_CAMPAIGN_CREATOR}&items=100`, { headers: { accept: "application/json" } }));
  if (!res.ok) throw new Error(`merkl campaigns ${res.status}`);
  const body = (await res.json()) as { campaignId: string }[];
  return new Set((Array.isArray(body) ? body : []).map((c) => c.campaignId.toLowerCase()));
}

export async function syncRewards(pool: Pool, paced: Paced, perPass = 60, fetchImpl: typeof fetch = fetch): Promise<RewardsStats> {
  const { rows } = await pool.query(`
    SELECT m.maker FROM (SELECT maker, max(volume_usd) AS volume FROM maker_stats WHERE coalesce(volume_usd, 0) > 0 GROUP BY maker) m
    LEFT JOIN maker_rewards_checked c ON c.maker = m.maker
    ORDER BY c.checked_at NULLS FIRST, m.volume DESC LIMIT $1`, [perPass]);
  const stats: RewardsStats = { checked: 0, withRewards: 0, errors: 0 };
  if (rows.length === 0) return stats;
  const campaigns = await aquaCampaigns(paced, fetchImpl);
  if (campaigns.size === 0) return stats;
  for (const { maker } of rows as { maker: string }[]) {
    try {
      const res = await paced(() => fetchImpl(`${MERKL_BASE}/users/${maker}/rewards?chainId=1`, { headers: { accept: "application/json", "user-agent": "naumachy-aquascan-enrich/0.1" } }));
      if (res.status === 429 || res.status >= 500) { stats.errors += 1; continue; }
      const body = (await res.json()) as MerklChain[] | { error?: string };
      // keep the programme's share of each reward token, summed over its campaigns and epochs
      const rewards = (Array.isArray(body) ? body.flatMap((c) => c.rewards ?? []) : []).map((r) => {
        const ours = (r.breakdowns ?? []).filter((b) => campaigns.has(b.campaignId.toLowerCase()));
        const sum = (k: "amount" | "claimed" | "pending") => ours.reduce((acc, b) => acc + BigInt(b[k] || "0"), 0n).toString();
        return { ...r, amount: sum("amount"), claimed: sum("claimed"), pending: sum("pending"), breakdowns: ours };
      }).filter((r) => r.amount !== "0");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM maker_rewards WHERE maker = $1`, [maker]);
        await upsertRows(client, "maker_rewards", ["maker", "token", "symbol", "decimals", "amount", "claimed", "pending", "price_usd", "campaigns", "fetched_at"], ["maker", "token"],
          rewards.map((r) => [maker, r.token.address.toLowerCase(), r.token.symbol, r.token.decimals, r.amount, r.claimed, r.pending, r.token.price ?? null, (r.breakdowns ?? []).length, new Date()]));
        await client.query(`INSERT INTO maker_rewards_checked (maker, checked_at, rewards) VALUES ($1, now(), $2) ON CONFLICT (maker) DO UPDATE SET checked_at = now(), rewards = EXCLUDED.rewards`, [maker, rewards.length]);
        await client.query("COMMIT");
      } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
      stats.checked += 1; if (rewards.length) stats.withRewards += 1;
    } catch { stats.errors += 1; }
  }
  return stats;
}
