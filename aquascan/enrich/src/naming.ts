// A template's human name is derived from what its instructions do, in the order a reader
// wants: gate, then the core, then the modifiers. Plumbing (salt, protocol fees) is silent.

export interface TemplateName { name: string; kind: string }

const GATES = new Set(["OnlyTxOriginTokenBalanceNonZero", "OnlyTakerTokenBalanceNonZero", "OnlyTakerTokenBalanceGte", "OnlyTakerTokenSupplyShareGte"]);

export function nameTemplate(instructions: string[] | null, parsed = true): TemplateName {
  if (!parsed) return { name: "unparsed program", kind: "unknown" };
  if (!instructions) return { name: "unknown router", kind: "unknown" };
  const has = (n: string) => instructions.includes(n);
  const parts: string[] = [];
  if (instructions.some((i) => GATES.has(i))) parts.push("gated");

  let core = "program"; let kind = "custom";
  if (has("XYCConcentrateSwap")) { core = "concentrated AMM"; kind = "concentrated"; }
  else if (has("PeggedSwap")) { core = "pegged-swap AMM"; kind = "pegged"; }
  else if (has("TWAPSwap")) { core = "TWAP order"; kind = "twap"; }
  else if (has("LimitSwap") || has("LimitSwapFullAmount")) { core = "limit order"; kind = "limit"; }
  else if (has("DutchAuctionBalanceIn") || has("DutchAuctionBalanceOut")) { core = "Dutch auction"; kind = "dutch"; }
  else if (has("XYCSwap")) { core = "constant-product AMM"; kind = "amm"; }
  else if (has("Extruction")) { core = "custom logic"; kind = "custom"; }
  if (has("Extruction") && core !== "custom logic") parts.push("custom-logic");
  parts.push(core);

  const mods: string[] = [];
  if (has("FeeFlatIn") || has("FeeFlatOut")) mods.push("flat fee");
  if (has("FeeProgressiveIn") || has("FeeProgressiveOut")) mods.push("progressive fee");
  if (has("Decay")) mods.push("decay");
  if (has("DynamicBalances")) mods.push("self re-arming");
  if (has("StaticBalances")) mods.push("static balances");
  if (has("RequireMinRate") || has("AdjustMinRate")) mods.push("rate floor");
  if (has("BaseFeeAdjuster")) mods.push("gas-adjusted");
  if (has("Deadline")) mods.push("deadline");
  if (has("Jump") || has("JumpIfTokenIn") || has("JumpIfTokenOut")) mods.push("branching");
  return { name: mods.length ? `${parts.join(" ")}, ${mods.join(", ")}` : parts.join(" "), kind };
}
