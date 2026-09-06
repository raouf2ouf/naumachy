import { BigInt, Bytes, Address, crypto, dataSource } from "@graphprotocol/graph-ts";
import { Shipped, Docked, Pulled, Pushed } from "../generated/AquaCanonical/Aqua";
import { Maker, App, Template, Desk, Strategy, Fill, Leg, DailyStrategyStat } from "../generated/schema";

// Both registries (canonical and legacy) route to these four handlers. The registry that
// emitted an event is event.address and is stored on Strategy and Fill.

const ZERO = BigInt.zero();
const UNPARSED = Bytes.fromUTF8("unparsed");

// ---------- program parsing ----------

// A shipped strategy is either abi.encode(Order{maker, traits, data}) as one tuple, where the
// program starts inside `data` at the offset held in traits bits 208..223, or the raw program.
function extractProgram(blob: Bytes): Bytes {
  if (blob.length >= 160) {
    let wrapper = true;
    for (let i = 0; i < 31; i++) {
      if (blob[i] != 0) { wrapper = false; break; }
    }
    if (wrapper && blob[31] != 0x20) wrapper = false;
    if (wrapper) {
      for (let i = 96; i < 127; i++) {
        if (blob[i] != 0) { wrapper = false; break; }
      }
    }
    if (wrapper && blob[127] != 0x60) wrapper = false;
    if (wrapper) {
      let len: i32 = (<i32>blob[156] << 24) | (<i32>blob[157] << 16) | (<i32>blob[158] << 8) | <i32>blob[159];
      let programStart: i32 = (<i32>blob[68] << 8) | <i32>blob[69];
      if (len >= 0 && 160 + len <= blob.length && programStart <= len) {
        return Bytes.fromUint8Array(blob.subarray(160 + programStart, 160 + len));
      }
    }
  }
  return blob;
}

// Program encoding: [opcode:1][argsLen:1][args:N] per instruction. Returns the opcode
// sequence when the walk lands exactly on the end of the program, null otherwise.
function opcodeSequence(program: Bytes): i32[] | null {
  let ops = new Array<i32>();
  let pc = 0;
  let n = program.length;
  while (pc < n) {
    if (pc + 1 >= n) return null;
    ops.push(<i32>program[pc]);
    let argsLen = <i32>program[pc + 1];
    pc += 2 + argsLen;
  }
  if (pc != n) return null;
  return ops;
}

function keccak(b: Bytes): Bytes {
  return Bytes.fromByteArray(crypto.keccak256(b));
}

// ---------- ids ----------

// Aqua keys balances by (maker, app, strategyHash); so do we.
function strategyId(maker: Address, app: Address, hash: Bytes): Bytes {
  return Bytes.fromByteArray(maker.concat(app).concat(hash));
}

function sign(x: BigInt): i32 {
  if (x.gt(ZERO)) return 1;
  if (x.lt(ZERO)) return -1;
  return 0;
}

// ---------- entity helpers ----------

function ensureMaker(addr: Address, ts: BigInt): Maker {
  let m = Maker.load(addr);
  if (m == null) {
    m = new Maker(addr);
    m.shipCount = 0;
    m.firstSeen = ts;
    m.lastSeen = ts;
  }
  return m as Maker;
}

function ensureApp(addr: Address): App {
  let a = App.load(addr);
  if (a == null) {
    a = new App(addr);
    a.dialect = addr.toHexString();
    a.strategyCount = 0;
  }
  return a as App;
}

function ensureTemplate(app: App, ops: i32[] | null): Template {
  let id: Bytes;
  let opcodes: i32[];
  if (ops == null) {
    id = keccak(app.id.concat(UNPARSED));
    opcodes = new Array<i32>();
  } else {
    let seq = ops as i32[];
    let arr = new Uint8Array(seq.length);
    for (let i = 0; i < seq.length; i++) arr[i] = <u8>seq[i];
    id = keccak(app.id.concat(Bytes.fromUint8Array(arr)));
    opcodes = seq;
  }
  let t = Template.load(id);
  if (t == null) {
    t = new Template(id);
    t.app = app.id;
    t.opcodes = opcodes;
    if (ops == null) t.name = "unparsed";
    t.strategyCount = 0;
    t.economicVolumeLegs = 0;
  }
  return t as Template;
}

function ensureDesk(maker: Maker, template: Template, ts: BigInt): Desk {
  let id = maker.id.toHexString() + "-" + template.id.toHexString() + "-" + dataSource.network();
  let d = Desk.load(id);
  if (d == null) {
    d = new Desk(id);
    d.maker = maker.id;
    d.template = template.id;
    d.chain = dataSource.network();
    d.liveCount = 0;
    d.fillCount = 0;
    d.economicFillCount = 0;
    d.firstSeen = ts;
    d.lastSeen = ts;
  }
  return d as Desk;
}

function ensureDaily(strategy: Strategy, ts: BigInt): DailyStrategyStat {
  let day = ts.toI32() / 86400;
  let id = strategy.id.toHexString() + "-" + day.toString();
  let s = DailyStrategyStat.load(id);
  if (s == null) {
    s = new DailyStrategyStat(id);
    s.strategy = strategy.id;
    s.day = day;
    s.economicFills = 0;
    s.legs = 0;
  }
  return s as DailyStrategyStat;
}

// ---------- handlers ----------

export function handleShipped(event: Shipped): void {
  let ts = event.block.timestamp;
  let makerAddr = event.params.maker;
  let appAddr = event.params.app;
  let hash = event.params.strategyHash;
  let blob = event.params.strategy;

  let maker = ensureMaker(makerAddr, ts);
  maker.shipCount += 1;
  maker.lastSeen = ts;
  maker.save();

  let app = ensureApp(appAddr);
  app.save();

  let id = strategyId(makerAddr, appAddr, hash);
  let existing = Strategy.load(id);
  if (existing != null) {
    // Aqua lets the same (maker, app, hash) ship again with tokens it has not used
    // before. One entity, re-armed: the new ship transaction's pushes extend the
    // declared inventory, and a docked strategy becomes live again.
    let desk = Desk.load(existing.desk);
    if (existing.status == "DOCKED" && desk != null) desk.liveCount += 1;
    if (desk != null) {
      desk.lastSeen = ts;
      desk.save();
    }
    existing.status = "LIVE";
    existing.shippedAt = ts;
    existing.shippedTx = event.transaction.hash;
    existing.dockedAt = null;
    existing.dockedTx = null;
    existing.save();
    return;
  }

  app.strategyCount += 1;
  app.save();

  let program = extractProgram(blob);
  let ops = opcodeSequence(program);
  let template = ensureTemplate(app, ops);
  template.strategyCount += 1;
  template.save();

  let desk = ensureDesk(maker, template, ts);
  desk.liveCount += 1;
  desk.lastSeen = ts;
  desk.save();

  let s = new Strategy(id);
  s.registry = event.address;
  s.strategyHash = hash;
  s.maker = maker.id;
  s.app = app.id;
  s.desk = desk.id;
  s.template = template.id;
  s.blob = blob;
  s.program = program;
  s.parsed = ops != null;
  s.tokens = new Array<Bytes>();
  s.amounts = new Array<BigInt>();
  s.shippedAt = ts;
  s.shippedTx = event.transaction.hash;
  s.status = "LIVE";
  s.save();
}

export function handleDocked(event: Docked): void {
  let s = Strategy.load(strategyId(event.params.maker, event.params.app, event.params.strategyHash));
  if (s == null) return;
  if (s.status == "DOCKED") return;
  let ts = event.block.timestamp;
  s.status = "DOCKED";
  s.dockedAt = ts;
  s.dockedTx = event.transaction.hash;
  s.save();

  let desk = Desk.load(s.desk);
  if (desk != null) {
    desk.liveCount -= 1;
    desk.lastSeen = ts;
    desk.save();
  }
  let maker = Maker.load(s.maker);
  if (maker != null) {
    maker.lastSeen = ts;
    maker.save();
  }
}

export function handlePushed(event: Pushed): void {
  applyLeg(event.address, event.params.maker, event.params.app, event.params.strategyHash,
    event.params.token, event.params.amount, true,
    event.transaction.hash, event.transaction.from, event.block.number, event.block.timestamp);
}

export function handlePulled(event: Pulled): void {
  applyLeg(event.address, event.params.maker, event.params.app, event.params.strategyHash,
    event.params.token, event.params.amount, false,
    event.transaction.hash, event.transaction.from, event.block.number, event.block.timestamp);
}

// One Pushed or Pulled event becomes a leg of the fill (tx, strategy). Fill shape and the
// economic flag are recomputed on every leg; the final values stand after the last leg of
// the transaction, and all of it commits in the same block.
function applyLeg(registry: Address, makerAddr: Address, appAddr: Address, hash: Bytes,
  token: Address, amount: BigInt, isPush: boolean,
  tx: Bytes, from: Address, block: BigInt, ts: BigInt): void {
  let s = Strategy.load(strategyId(makerAddr, appAddr, hash));
  if (s == null) return;

  // Pushes in the ship transaction are the declared starting inventory, not a fill.
  if (isPush && s.shippedTx.equals(tx)) {
    let tokens = s.tokens;
    let amounts = s.amounts;
    tokens.push(token);
    amounts.push(amount);
    s.tokens = tokens;
    s.amounts = amounts;
    s.save();
    return;
  }

  let fillId = tx.toHexString() + "-" + s.id.toHexString();
  let fill = Fill.load(fillId);
  let newFill = false;
  if (fill == null) {
    newFill = true;
    fill = new Fill(fillId);
    fill.registry = registry;
    fill.strategy = s.id;
    fill.tx = tx;
    fill.block = block;
    fill.timestamp = ts;
    fill.taker = from;
    fill.shape = isPush ? "PUSH_ONLY" : "PULL_ONLY";
    fill.economic = false;
    fill.legCount = 0;
    fill.pushedLegs = 0;
    fill.pulledLegs = 0;
  }

  let legId = fillId + "-" + token.toHexString();
  let leg = Leg.load(legId);
  let newLeg = false;
  if (leg == null) {
    newLeg = true;
    leg = new Leg(legId);
    leg.fill = fill.id;
    leg.token = token;
    leg.pushed = ZERO;
    leg.pulled = ZERO;
    leg.net = ZERO;
  }
  let before = sign(leg.net);
  if (isPush) leg.pushed = leg.pushed.plus(amount);
  else leg.pulled = leg.pulled.plus(amount);
  leg.net = leg.pushed.minus(leg.pulled);
  let after = sign(leg.net);
  leg.save();

  if (newLeg) fill.legCount += 1;
  if (before == 1) fill.pushedLegs -= 1;
  if (before == -1) fill.pulledLegs -= 1;
  if (after == 1) fill.pushedLegs += 1;
  if (after == -1) fill.pulledLegs += 1;

  let wasEconomic = fill.economic;
  let bothWays = fill.pushedLegs > 0 && fill.pulledLegs > 0;
  if (bothWays) fill.shape = fill.legCount == 2 ? "TWO_SIDED" : "MULTI";
  else if (fill.pulledLegs > 0) fill.shape = "PULL_ONLY";
  else fill.shape = "PUSH_ONLY";
  fill.economic = bothWays;
  fill.save();

  let desk = Desk.load(s.desk);
  let template = Template.load(s.template);
  let daily = ensureDaily(s, ts);
  daily.legs += 1;

  if (desk != null) {
    if (newFill) desk.fillCount += 1;
    desk.lastSeen = ts;
  }
  if (!wasEconomic && fill.economic) {
    if (desk != null) desk.economicFillCount += 1;
    if (template != null) template.economicVolumeLegs += fill.legCount;
    daily.economicFills += 1;
  } else if (wasEconomic && !fill.economic) {
    if (desk != null) desk.economicFillCount -= 1;
    if (template != null) template.economicVolumeLegs -= fill.legCount;
    daily.economicFills -= 1;
  } else if (fill.economic && newLeg) {
    if (template != null) template.economicVolumeLegs += 1;
  }
  if (desk != null) desk.save();
  if (template != null) template.save();
  daily.save();

  let maker = Maker.load(s.maker);
  if (maker != null) {
    maker.lastSeen = ts;
    maker.save();
  }
}
