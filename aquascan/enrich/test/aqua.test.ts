import { describe, expect, it } from "vitest";
import { deskId, extractProgram, opcodeSequence, strategyId, templateId } from "../src/aqua.js";

const hex = (s: string) => Uint8Array.from(Buffer.from(s.replace(/^0x/, ""), "hex"));

// abi.encode(Order{maker, traits, data}) around a program, the way Aqua's ship blob arrives
function wrap(program: Uint8Array, programStart: number, prefix: Uint8Array): Uint8Array {
  const word = (n: number) => { const w = Buffer.alloc(32); w.writeUInt32BE(n, 28); return w; };
  const traits = Buffer.alloc(32); traits.writeUInt16BE(programStart, 4);   // bits 208..223 land at bytes 4..5
  const data = Buffer.concat([prefix, program]);
  const padded = Buffer.concat([data, Buffer.alloc((32 - (data.length % 32)) % 32)]);
  return Uint8Array.from(Buffer.concat([word(0x20), Buffer.alloc(32), traits, word(0x60), word(data.length), padded]));
}

describe("program extraction", () => {
  const program = hex("0x0a0201020b00");   // two instructions: 0x0a with 2 arg bytes, 0x0b with none
  it("returns a raw program untouched", () => {
    expect(Buffer.from(extractProgram(program)).toString("hex")).toBe("0a0201020b00");
  });
  it("unwraps the order tuple and skips to the program start", () => {
    const prefix = hex("0xdeadbeef");
    expect(Buffer.from(extractProgram(wrap(program, prefix.length, prefix))).toString("hex")).toBe("0a0201020b00");
  });
  it("walks the opcode sequence and rejects a torn program", () => {
    expect(opcodeSequence(program)).toEqual([0x0a, 0x0b]);
    expect(opcodeSequence(hex("0x0a05ff"))).toBeNull();
  });
});

describe("ids match the subgraph", () => {
  const maker = "0xbc6538407c1da2218da2f12d26cd843c6ac2d60e";
  const app = "0x1111113db0e0ef9d0e3a50d5f094a3a57a26c0de";
  const hash = "0x5ab417cb12b266f3349e75a0ab5adff8781091c165f307406c058628f2f9d411";
  it("concatenates maker, app and hash", () => {
    expect(strategyId(maker, app, hash)).toBe(maker + app.slice(2) + hash.slice(2));
    expect(strategyId(maker, app, hash)).toHaveLength(2 + 40 + 40 + 64);
  });
  it("hashes app and opcodes, or app and 'unparsed'", () => {
    expect(templateId(app, [1, 2, 3])).toMatch(/^0x[0-9a-f]{64}$/);
    expect(templateId(app, [1, 2, 3])).not.toBe(templateId(app, [1, 2]));
    expect(templateId(app, null)).not.toBe(templateId(app, []));
  });
  it("names desks with The Graph network name", () => {
    expect(deskId(maker, "0xabc", "arbitrum")).toBe(`${maker}-0xabc-arbitrum-one`);
    expect(deskId(maker, "0xabc", "robinhood")).toBe(`${maker}-0xabc-robinhood`);
  });
});
