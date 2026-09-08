import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { anchoredSpec, type Op, type ProgramSpec } from "@naumachy/arena/program";
import type { Context } from "./context.js";
import { makeTools, SUBGRAPH_MCP, type GraphSetup, type ToolCall } from "./tools.js";

// The gladiator's mind: one call that turns what it can see into its next program, written in the
// arena's dialect, with a rationale we keep. The mind composes instructions; the compiler emits
// bytes. RiskCap wraps every program and is not the mind's to remove; the swap comes last.
const FeeSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("flatFee"), bps: z.number().min(0).max(500) }),
  z.object({ op: z.literal("toxicityFee"), baseBps: z.number().min(0).max(500), slopeBps: z.number().min(0).max(5000), maxBps: z.number().min(0).max(500), windowSeconds: z.number().int().min(0).max(86400) }),
]);
const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("gate") }),
  z.object({ op: z.literal("flatFee"), bps: z.number().min(0).max(500) }),
  z.object({ op: z.literal("toxicityFee"), baseBps: z.number().min(0).max(500), slopeBps: z.number().min(0).max(5000), maxBps: z.number().min(0).max(500), windowSeconds: z.number().int().min(0).max(86400) }),
  z.object({ op: z.literal("byTokenIn"), cases: z.array(z.object({ token: z.enum(["WETH", "USDC", "cbBTC"]), ops: z.array(FeeSchema).max(2) })).min(1).max(3), otherwise: z.array(FeeSchema).max(2) }),
  z.object({ op: z.literal("anchor"), depth: z.number().min(1).max(10000), maxStaleness: z.number().int().min(0).max(3600) }),
  z.object({ op: z.literal("xyc") }),
]);
export const ProgramSchema = z.object({
  pairs: z.array(z.enum(["WETH/USDC", "cbBTC/USDC", "cbBTC/WETH"])).min(1).max(3),
  capBps: z.number().min(100).max(5000),
  ops: z.array(OpSchema).min(1).max(8),
  parent: z.string().nullable(),          // the gladiator address whose program this mutates, or null for a fresh line
  rationale: z.string(),
});
export type Program = z.infer<typeof ProgramSchema>;
export const toSpec = (p: Program, salt?: bigint): ProgramSpec => ({ pairs: p.pairs, capBps: p.capBps, ops: p.ops as Op[], salt });

const SYSTEM = `You are a gladiator in Naumachy, an arena where market-making programs fight on 1inch Aqua and are scored by Aquascan. Your program is SwapVM bytecode shipped to Aqua from your own wallet; you write it in the arena's dialect and the compiler emits the bytes.

THE DIALECT. A program is a list of instructions, run in order for every quote and every fill. The compiler puts RiskCap first (the arena's rule: no fill may move more than capBps of either balance) and Salt last; you write what is between, and the last instruction you write must be xyc.
- gate: serve only takers that hold an arena pass. Routed flow carries a pass; anonymous flow does not. About 60% of uninformed orders and 20% of informed ones arrive with a pass (the arena's dials), so a gate trades toxic flow away together with some benign flow.
- flatFee {bps}: a fee on the token the taker pays, kept by you.
- toxicityFee {baseBps, slopeBps, maxBps, windowSeconds}: a fee that starts at baseBps and widens by slopeBps per 100% of the outgoing token's balance drained inside the window, capped at maxBps. A fill in the other direction relieves it. Your defence against one-way flow.
- byTokenIn {cases: [{token, ops}], otherwise: ops}: fee instructions chosen by the token the taker pays with. Paying WETH means the taker sells WETH to you (you buy WETH). Quote tighter on the side that reduces the inventory you are long, wider on the side that grows it: this is skew.
- anchor {depth, maxStaleness}: re-centres your curve on each pair's pool price before the swap, both ways, with virtual depth = depth times your real balance. Deeper means less slippage per fill and more exposure when the reference is wrong. Without an anchor your curve is the plain constant product of your ledger: it drifts from the market and arbitrageurs take the difference.
- xyc: the constant-product swap over the (virtual) balances. Required, last.
Order matters. A fee before the anchor measures toxicity pressure on your real balance; after the anchor, on the virtual one (depth times larger, so the same drain looks smaller). Fees stack if you write several.

PAIRS. You may ship one, two or three of WETH/USDC, cbBTC/USDC, cbBTC/WETH. One ledger backs every pair you name (WETH, USDC and cbBTC inventories, funded per token). Three pairs means three markets from one inventory, which no pool can do, and one hazard: a taker can loop USDC -> WETH -> cbBTC -> USDC through your three quotes; keep the anchor so the three prices stay coherent, and keep a fee above the pools' own discrepancy. The validator runs that loop on a private fork before you ship and rejects a program that pays it.

SCORING. The sum of your 5-minute markouts in USDC over the generation: each fill re-marked at the pool's price five minutes later, economic fills only. Both the edge per fill and the number of fills matter, and being run over by informed flow costs more than a fee earns.

THE FLOW. Every few seconds an uninformed order arrives on a random pair with a random size and a random tolerance (exponential, mean about 12 bps). It asks every gladiator on that pair for a quote at its size and goes to the best one if that beats the pool after the pool's 5 bps fee, or if it is within the tolerance; otherwise it trades the pool. Informed flow reads the tape ahead: when a pair's pool price five minutes from now differs from now by 5 bps or more, an informed taker trades that direction first against every gladiator on the pair whose quote still beats the coming price by 5 bps (a fee that has ramped past the move prices it out), so those fills are marked five minutes later at the moved price; it also arbitrages any quote that beats the pool by more than 5 bps. The mainnet desks charge 0.10 bps and bleed 3 to 5 bps to the flow.

THE RECORD. The verdict of record is the attested score of each generation, written on chain at close, against that generation's field. Aquascan's desk and leaderboard figures, and the live numbers beside the attested ones, accumulate across generations and fields: a desk that led generation 0 alone says little about a field of four. Programs are public the moment they ship, as on the venue. Minds write in a fixed order each generation: the open generation's entries in your briefing are the rivals who wrote before you this round, and those after you will see yours before they write. Nothing is hidden from anyone; the order is the arena's.

Read the generations so far, your own last program and result, the rivals' programs (public: their bytes are on chain, listed for you) and verdicts, and the pools' recent behaviour. Then write your next program. If you are mutating a rival's program, name it as parent. Say in the rationale what you changed and why, in a few sentences.`;

export interface Usage { input: number; output: number; cache_read: number; cache_write: number; calls: number }
export interface Decision { program: Program; transcript: ToolCall[]; mode: "heuristic" | "briefing" | "tools-local" | "tools-mcp"; usage: Usage }
const emptyUsage = (): Usage => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, calls: 0 });
const addUsage = (u: Usage, m: { usage?: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } } | null | undefined) => {
  if (!m?.usage) return; u.input += m.usage.input_tokens ?? 0; u.output += m.usage.output_tokens ?? 0; u.cache_read += m.usage.cache_read_input_tokens ?? 0; u.cache_write += m.usage.cache_creation_input_tokens ?? 0; u.calls += 1;
};
const MAX_READS = () => Number(process.env.GLADIATOR_MAX_READS ?? 3);

// The mind decides. Three ways in: the heuristic control (no call), the briefing alone (one call
// on the baked context), or the briefing plus tools, where the mind reads the subgraphs and the
// scorer itself before it answers; on the network the GraphQL goes through The Graph's Subgraph
// MCP. What it asked is kept beside what it decided. `problem` is the compiler's or the validator's
// verdict on the previous attempt, when there was one.
export async function decide(client: Anthropic, ctx: Context, graph?: GraphSetup, api?: string, problem?: string): Promise<Decision> {
  if (process.env.GLADIATOR_MIND === "heuristic") return { program: heuristic(ctx, problem), transcript: [], mode: "heuristic", usage: emptyUsage() };
  if (process.env.GLADIATOR_TOOLS === "off" || !graph || !api) return briefingOnly(client, ctx, problem);
  return withTools(client, ctx, graph, api, problem);
}

const effort = () => (process.env.GLADIATOR_EFFORT as "low" | "medium" | "high" | "xhigh" | "max" | undefined) ?? "high";
const model = () => process.env.GLADIATOR_MODEL ?? "claude-opus-5";
const rejected = (problem?: string) => (problem ? `\n\nYour previous program was rejected before shipping: ${problem}\nWrite one that passes.` : "");

async function withTools(client: Anthropic, ctx: Context, graph: GraphSetup, api: string, problem?: string): Promise<Decision> {
  const transcript: ToolCall[] = [];
  const tools = makeTools(graph, api, transcript);
  const mcp = graph.mode === "mcp";
  const ids = Object.entries(graph.ids).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ");
  const briefing = `Here is your briefing, as JSON:\n${JSON.stringify(ctx, null, 1)}\n\nBefore you decide you may read more: the schema of a subgraph, then a query against it${mcp ? ` through The Graph's Subgraph MCP (subgraph ids ${ids})` : ""}, or a path of the Aquascan API. At most ${MAX_READS()} reads, then answer with your program as JSON.${rejected(problem)}`;
  const usage = emptyUsage();
  const runner = client.beta.messages.toolRunner({
    model: model(), max_tokens: 16000, max_iterations: MAX_READS() + 2,
    thinking: { type: "adaptive" },
    output_config: { effort: effort(), format: betaZodOutputFormat(ProgramSchema) },
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
  let program: Program;
  try { program = ProgramSchema.parse(JSON.parse(text)); }
  catch {
    // the loop ended on a tool turn or a stray sentence: one more request, no tools, the answer only
    const again = await client.beta.messages.create({ model: model(), max_tokens: 4000, output_config: { format: betaZodOutputFormat(ProgramSchema) },
      system: SYSTEM, messages: [...runner.params.messages, { role: "user", content: "Answer now with your program as JSON, nothing else." }] });
    addUsage(usage, again);
    program = ProgramSchema.parse(JSON.parse(again.content.filter((b) => b.type === "text").map((b) => b.text).join("")));
  }
  return { program, transcript, mode: mcp ? "tools-mcp" : "tools-local", usage };
}

async function briefingOnly(client: Anthropic, ctx: Context, problem?: string): Promise<Decision> {
  const response = await client.messages.parse({
    model: model(),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { effort: effort(), format: zodOutputFormat(ProgramSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Here is what you can see, as JSON:\n${JSON.stringify(ctx, null, 1)}\n\nWrite your program.${rejected(problem)}` }],
  });
  if (response.stop_reason === "refusal") throw new Error(`the mind refused: ${response.stop_details?.explanation ?? ""}`);
  const program = response.parsed_output;
  if (!program) throw new Error("the mind answered without a program");
  const usage = emptyUsage(); addUsage(usage, response);
  return { program, transcript: [], mode: "briefing", usage };
}

// The control line: no mind, a hill climber. It copies the last champion's program and moves one
// of its numbers by a fixed factor; the champion itself nudges its own first fee. A generation of
// these beside the minded gladiators says whether the mind earns anything over blind mutation.
// Explicit only: GLADIATOR_MIND=heuristic. Deterministic per name and generation, so a run can be
// replayed. A rejection moves the next number instead.
export function heuristic(ctx: Context, problem?: string): Program {
  const closed = [...ctx.generations].reverse().find((g) => g.closed && g.champion);
  const champion = closed ? closed.verdicts.find((v) => v.gladiator.toLowerCase() === closed.champion!.toLowerCase()) ?? null : null;
  const fallback = anchoredSpec({ capBps: 2000, feeBaseBps: 5, feeSlopeBps: 200, feeMaxBps: 50, windowSeconds: 600, depth: 100 });
  const base: ProgramSpec = structuredClone((champion?.spec as ProgramSpec | null) ?? (ctx.me.lastSpec as ProgramSpec | null) ?? fallback);
  const seed = [...`${ctx.me.name}-${ctx.generations.length}${problem ? "-again" : ""}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const iAmChampion = champion?.gladiator.toLowerCase() === ctx.me.address.toLowerCase();
  // every number in the program, addressable
  const slots: { get: () => number; set: (v: number) => void; name: string; lo: number; hi: number; int?: boolean }[] = [
    { name: "capBps", get: () => base.capBps, set: (v) => { base.capBps = v; }, lo: 100, hi: 5000 },
  ];
  const feeSlots = (f: Op, where: string) => {
    if (f.op === "flatFee") slots.push({ name: `${where}flatFee.bps`, get: () => f.bps, set: (v) => { f.bps = v; }, lo: 0, hi: 500 });
    if (f.op === "toxicityFee") {
      slots.push({ name: `${where}toxicityFee.baseBps`, get: () => f.baseBps, set: (v) => { f.baseBps = v; if (f.maxBps < v) f.maxBps = v; }, lo: 0, hi: 500 });
      slots.push({ name: `${where}toxicityFee.slopeBps`, get: () => f.slopeBps, set: (v) => { f.slopeBps = v; }, lo: 0, hi: 5000 });
      slots.push({ name: `${where}toxicityFee.windowSeconds`, get: () => f.windowSeconds, set: (v) => { f.windowSeconds = v; }, lo: 30, hi: 86400, int: true });
    }
  };
  for (const o of base.ops) {
    if (o.op === "anchor") slots.push({ name: "anchor.depth", get: () => o.depth, set: (v) => { o.depth = v; }, lo: 1, hi: 10000 });
    else if (o.op === "byTokenIn") { o.cases.forEach((c) => c.ops.forEach((f) => feeSlots(f, `paying ${c.token} `))); o.otherwise.forEach((f) => feeSlots(f, "otherwise ")); }
    else feeSlots(o, "");
  }
  const slot = iAmChampion ? slots.find((s) => s.name.includes("Fee")) ?? slots[0] : slots[seed % slots.length];
  const factor = iAmChampion ? 1.1 : (seed >> 3) % 2 === 0 ? 0.7 : 1.4;
  const before = slot.get();
  let next = Math.min(slot.hi, Math.max(slot.lo, before === 0 ? (factor > 1 ? 1 : 0) : before * factor));
  next = slot.int ? Math.round(next) : Number(next.toFixed(2));
  slot.set(next);
  const rationale = champion
    ? `Heuristic control, no mind: ${iAmChampion ? "kept my own champion program" : `copied ${champion.name}'s champion program`} and moved ${slot.name} from ${before} to ${next}.`
    : `Heuristic control, no mind: no scored generation yet, started from ${ctx.me.lastSpec ? "my last program" : "the archetype"} with ${slot.name} at ${next}.`;
  return ProgramSchema.parse({ pairs: base.pairs, capBps: base.capBps, ops: base.ops, parent: champion && !iAmChampion ? champion.gladiator : null, rationale });
}
