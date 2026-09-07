import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Context } from "./context.js";

// The gladiator's mind: one call that turns what it can see into the knobs of its next program,
// inside the archetype grammar, with a rationale we keep. The grammar is the arena's: the mind
// chooses parameters, never bytes, and RiskCap is not its to remove.
export const KnobsSchema = z.object({
  feeBaseBps: z.number().min(0.1).max(100),
  feeSlopeBps: z.number().min(0).max(2000),
  feeMaxBps: z.number().min(0.1).max(300),
  windowSeconds: z.number().int().min(30).max(3600),
  depth: z.number().min(1).max(1000),
  capBps: z.number().min(100).max(5000),
  parent: z.string().nullable(),          // the gladiator address whose program this mutates, or null for a fresh line
  rationale: z.string(),
});
export type Knobs = z.infer<typeof KnobsSchema>;

const SYSTEM = `You are a gladiator in Naumachy, an arena where market-making programs fight on 1inch Aqua and are scored by Aquascan.

Your program is fixed in shape: RiskCap > ToxicityFee > OracleAnchor > XYCSwap > Salt. You choose its knobs:
- feeBaseBps: the fee you charge at rest, in basis points (1 bps = 0.01%). The mainnet desks charge 0.10 bps and bleed 3 to 5 bps to the flow.
- feeSlopeBps: how much the fee widens per 100% of your outgoing balance drained inside the window; feeMaxBps caps it. This is your defence against one-way flow.
- windowSeconds: how long the flow memory lasts.
- depth: your curve's virtual depth as a multiple of your real balance. Deeper means less slippage per fill and more exposure to being wrong.
- capBps: the largest share of either balance one fill may move. It is the arena's risk rule; keep it between 1000 and 3000 unless you have a reason.

You are scored on the sum of your 5-minute markouts in USDC: each fill re-marked at the pool's price five minutes later, economic fills only. The attested score is the verdict of record; the Aquascan numbers beside it are live and keep moving. The band beside a score is one standard error; a rival whose band overlaps yours has not beaten you. Uninformed flow pays your fee; informed flow trades against you just before the pool moves, and a fee that does not widen under it loses. A wider fee earns more per fill and gets fewer fills.

Read the generations so far, your own last result and knobs, the rivals' verdicts and fee levels, and the pool's recent behaviour. Then choose the knobs for your next program. If you are mutating a rival's or your own previous program, say whose in "parent" (its address); otherwise null. Explain your choice in two or three sentences of plain prose in "rationale": what you saw, what you changed, what you expect. Be decisive: choose numbers, not ranges.`;

export async function decide(client: Anthropic, ctx: Context): Promise<Knobs> {
  if (process.env.GLADIATOR_MIND === "heuristic") return heuristic(ctx);
  const response = await client.messages.parse({
    model: process.env.GLADIATOR_MODEL ?? "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: (process.env.GLADIATOR_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "high", format: zodOutputFormat(KnobsSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Here is what you can see, as JSON:\n${JSON.stringify(ctx, null, 1)}\n\nChoose your knobs.` }],
  });
  if (response.stop_reason === "refusal") throw new Error(`the mind refused: ${response.stop_details?.explanation ?? ""}`);
  const knobs = response.parsed_output;
  if (!knobs) throw new Error("the mind answered without knobs");
  return knobs;
}

// The control line: no mind, a hill climber. It copies the last champion's knobs and moves one of
// them by a fixed factor; the champion itself nudges its own fee. A generation of these beside the
// minded gladiators says whether the mind earns anything over blind mutation. Explicit only:
// GLADIATOR_MIND=heuristic. Deterministic per name and generation, so a run can be replayed.
export function heuristic(ctx: Context): Knobs {
  const closed = [...ctx.generations].reverse().find((g) => g.closed && g.champion);
  const champion = closed ? closed.verdicts.find((v) => v.gladiator.toLowerCase() === closed.champion!.toLowerCase()) ?? null : null;
  const base = (champion?.knobs as Partial<Knobs> | null) ?? ctx.me.lastKnobs as Partial<Knobs> | null ?? { feeBaseBps: 5, feeSlopeBps: 200, feeMaxBps: 50, windowSeconds: 600, depth: 100, capBps: 2000 };
  const seed = [...`${ctx.me.name}-${ctx.generations.length}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const knobNames = ["feeBaseBps", "feeSlopeBps", "feeMaxBps", "windowSeconds", "depth"] as const;
  const iAmChampion = champion?.gladiator.toLowerCase() === ctx.me.address.toLowerCase();
  const which = iAmChampion ? "feeBaseBps" : knobNames[seed % knobNames.length];
  const factor = iAmChampion ? 1.1 : (seed >> 3) % 2 === 0 ? 0.7 : 1.4;
  const next: Record<string, number> = { feeBaseBps: base.feeBaseBps ?? 5, feeSlopeBps: base.feeSlopeBps ?? 200, feeMaxBps: base.feeMaxBps ?? 50, windowSeconds: base.windowSeconds ?? 600, depth: base.depth ?? 100, capBps: base.capBps ?? 2000 };
  const before = next[which]; next[which] = which === "windowSeconds" ? Math.round(before * factor) : Number((before * factor).toFixed(2));
  if (next.feeMaxBps < next.feeBaseBps) next.feeMaxBps = next.feeBaseBps;
  const rationale = champion
    ? `Heuristic control, no mind: ${iAmChampion ? "kept my own champion program" : `copied ${champion.name}'s champion knobs`} and moved ${which} from ${before} to ${next[which]}.`
    : `Heuristic control, no mind: no scored generation yet, started from the archetype's default knobs with ${which} at ${next[which]}.`;
  return KnobsSchema.parse({ ...next, parent: champion && !iAmChampion ? champion.gladiator : null, rationale });
}
