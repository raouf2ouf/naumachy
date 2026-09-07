import { BigInt } from "@graphprotocol/graph-ts";
import { GladiatorRegistered, GenerationOpened, StrategyEntered, Scored, GenerationClosed, Promoted } from "../generated/ArenaRegistry/ArenaRegistry";
import { Gladiator, Generation, Entry, Score, Promotion } from "../generated/schema";

export function handleGladiatorRegistered(event: GladiatorRegistered): void {
  let g = new Gladiator(event.params.gladiator.toHexString());
  g.name = event.params.name;
  g.generationBorn = event.params.generation.toI32();
  if (event.params.parent.toHexString() != "0x0000000000000000000000000000000000000000") g.parent = event.params.parent.toHexString();
  g.registeredAt = event.block.timestamp;
  g.registeredTx = event.transaction.hash;
  g.save();
}

export function handleGenerationOpened(event: GenerationOpened): void {
  let id = event.params.generation.toString();
  let gen = new Generation(id);
  gen.number = event.params.generation.toI32();
  gen.tape = event.params.tape;
  gen.openedAt = event.params.openedAt;
  gen.save();
}

export function handleStrategyEntered(event: StrategyEntered): void {
  let id = event.params.generation.toString() + "-" + event.params.strategyHash.toHexString();
  let e = new Entry(id);
  e.generation = event.params.generation.toString();
  e.gladiator = event.params.gladiator.toHexString();
  e.strategyHash = event.params.strategyHash;
  e.archetype = event.params.archetype;
  e.enteredAt = event.block.timestamp;
  e.save();
}

export function handleScored(event: Scored): void {
  let id = event.params.generation.toString() + "-" + event.params.strategyHash.toHexString();
  let s = Score.load(id);
  if (s == null) s = new Score(id);
  s.entry = id;
  s.scoreQuote = event.params.scoreQuote;
  s.seQuote = event.params.seQuote;
  s.fills = event.params.fills.toI32();
  s.quoteToken = event.params.quoteToken;
  s.attestedAt = event.block.timestamp;
  s.save();
  let e = Entry.load(id);
  if (e != null) { e.score = id; e.save(); }
}

export function handleGenerationClosed(event: GenerationClosed): void {
  let gen = Generation.load(event.params.generation.toString());
  if (gen == null) return;
  gen.closedAt = event.block.timestamp;
  if (event.params.champion.toHexString() != "0x0000000000000000000000000000000000000000") {
    gen.champion = event.params.champion.toHexString();
    gen.championStrategy = event.params.championStrategy;
    gen.championScore = event.params.scoreQuote;
  }
  gen.save();
}

export function handlePromoted(event: Promoted): void {
  let p = new Promotion(event.transaction.hash.toHexString() + "-" + event.logIndex.toString());
  p.gladiator = event.params.gladiator.toHexString();
  p.strategyHash = event.params.strategyHash;
  p.chainId = event.params.chainId;
  p.bankroll = event.params.bankroll;
  p.at = event.block.timestamp;
  p.tx = event.transaction.hash;
  p.save();
}
