import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Context } from "./context.js";
import { makeTools, SUBGRAPH_MCP, type GraphSetup, type ToolCall } from "./tools.js";

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

You are scored on the sum of your 5-minute markouts in USDC over the generation: each fill re-marked at the pool's price five minutes later, economic fills only. So both the edge per fill and the number of fills count. The attested score is the verdict of record; the Aquascan numbers beside it are live, cover the program's whole life (older programs were live for hours, so their fill counts are not comparable across generations), and keep moving. The band beside a score is one standard error; a rival whose band overlaps yours has not beaten you.

How the flow works. Every few seconds an uninformed order arrives with a random size and a random tolerance (exponential, mean about 12 bps). It asks every gladiator for a quote at its size and takes the best one only if that beats the pool after the pool's 5 bps fee, or if it is within the order's tolerance of the pool's mid; otherwise it trades the pool and nobody fills. Gladiators compete on price for every order: the tightest quote wins the flow, the others get only the lazy orders. Informed flow trades against you just before the pool moves, and a fee that does not widen under it loses. Depth sets the slippage per fill on top of the fee; a shallower depth is a wider effective spread.

Read the generations so far, your own last result and knobs, the rivals' verdicts and fee levels, and the pool's recent behaviour. Then choose the knobs for your next program. If you are mutating a rival's or your own previous program, say whose in "parent" (its address); otherwise null. Explain your choice in two or three sentences of plain prose in "rationale": what you saw, what you changed, what you expect. Be decisive: choose numbers, not ranges.`;

export interface Usage { input: number; output: number; cache_read: number; cache_write: number; calls: number }
export interface Decision { knobs: Knobs; transcript: ToolCall[]; mode: "heuristic" | "briefing" | "tools-local" | "tools-mcp"; usage: Usage }
const emptyUsage = (): Usage => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 });
const addUsage = (u: Usage, m: { usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } } | undefined) => {
  if (!m?.usage) return; u.input += m.usage.input_tokens ?? 0; u.output += m.usage.output_tokens ?? 0; u.cache_read += m.usage.cache_read_input_tokens ?? 0; u.cache_write += m.usage.cache_creation_input_tokens ?? 0; u.calls += 1;
};
const MAX_READS = () => Number(process.env.GLADIATOR_MAX_READS ?? 3);

// The mind decides. Three ways in: the heuristic control (no call), the briefing alone (one call
// on the baked context), or the briefing plus tools, where the mind reads the subgraphs and the
// scorer itself before it answers; on the network the GraphQL goes through The Graph's Subgraph
// MCP. What it asked is kept beside what it decided.
export async function decide(client: Anthropic, ctx: Context, graph?: GraphSetup, api?: string): Promise<Decision> {
  if (process.env.GLADIATOR_MIND === "heuristic") return { knobs: heuristic(ctx), transcript: [], mode: "heuristic", usage: emptyUsage() };
  if (process.env.GLADIATOR_TOOLS === "off" || !graph || !api) return briefingOnly(client, ctx);
  return withTools(client, ctx, graph, api);
}

const effort = () => (process.env.GLADIATOR_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "high";
const model = () => process.env.GLADIATOR_MODEL ?? "claude-opus-5";

async function withTools(client: Anthropic, ctx: Context, graph: GraphSetup, api: string): Promise<Decision> {
  const transcript: ToolCall[] = [];
  const tools = makeTools(graph, api, transcript);
  const mcp = graph.mode === "mcp";
  const ids = Object.entries(graph.ids).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");
  const briefing = `Here is your briefing, as JSON:\n${JSON.stringify(ctx, null, 1)}\n\nBefore you decide you may read more: the schema of a subgraph, then a query against it${mcp ? ` through The Graph's Subgraph MCP (execute_query_by_subgraph_id; ids ${ids})` : ""}, or an Aquascan path. Look at what actually filled your rivals and at what price, and at how the pool moved. At most ${MAX_READS()} reads, then answer with your knobs.`;
  const usage = emptyUsage();
  const runner = client.beta.messages.toolRunner({
    model: model(), max_tokens: 16000, max_iterations: MAX_READS() + 2,
    thinking: { type: "adaptive" },
    output_config: { effort: effort(), format: betaZodOutputFormat(KnobsSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: [{ type: "text", text: briefing, cache_control: { type: "ephemeral" } }] }],
    tools: [...tools, ...(mcp ? [{ type: "mcp_toolset" as const, mcp_server_name: SUBGRAPH_MCP.name }] : [])],
    ...(mcp ? { mcp_servers: [{ type: "url" as const, url: SUBGRAPH_MCP.url, name: SUBGRAPH_MCP.name, authorization_token: graph.gatewayKey }], betas: [SUBGRAPH_MCP.beta] } : {}),
  });
  let final: Awaited<ReturnType<typeof runner.runUntilDone>> | null = null;
  for await (const message of runner) { addUsage(usage, message); final = message; }
  if (!final) throw new Error("the mind said nothing");
  // the MCP calls happen on the server; they show up as blocks in the assistant turns
  for (const m of runner.params.messages) if (m.role === "assistant" && Array.isArray(m.content)) for (const b of m.content) if (b.type === "mcp_tool_use") transcript.push({ tool: `mcp:${b.name}`, input: b.input, chars: 0, ms: 0 });
  const text = final.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  let knobs: Knobs;
  try { knobs = KnobsSchema.parse(JSON.parse(text)); }
  catch {
    // the loop ended on a tool turn or a stray sentence: one more request, no tools, the answer only
    const again = await client.beta.messages.create({ model: model(), max_tokens: 4000, output_config: { format: betaZodOutputFormat(KnobsSchema) },
      system: SYSTEM, messages: [...runner.params.messages, { role: "user", content: "Answer now with your knobs as JSON, nothing else." }] });
    addUsage(usage, again);
    knobs = KnobsSchema.parse(JSON.parse(again.content.filter((b) => b.type === "text").map((b) => b.text).join("")));
  }
  return { knobs, transcript, mode: mcp ? "tools-mcp" : "tools-local", usage };
}

async function briefingOnly(client: Anthropic, ctx: Context): Promise<Decision> {
  const response = await client.messages.parse({
    model: model(),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: effort(), format: zodOutputFormat(KnobsSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Here is what you can see, as JSON:\n${JSON.stringify(ctx, null, 1)}\n\nChoose your knobs.` }],
  });
  if (response.stop_reason === "refusal") throw new Error(`the mind refused: ${response.stop_details?.explanation ?? ""}`);
  const knobs = response.parsed_output;
  if (!knobs) throw new Error("the mind answered without knobs");
  const usage = emptyUsage(); addUsage(usage, response);
  return { knobs, transcript: [], mode: "briefing", usage };
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
