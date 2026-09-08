import { keccak_256 } from "@noble/hashes/sha3.js";

// The pure half of the Aqua replay: the same derivations the subgraph mapping makes
// (subgraphs/aqua/src/mapping.ts), so a chain read through Substreams lands in the tables with
// the same ids as a chain read through a subgraph. Keep the two in step.

// A shipped strategy is either abi.encode(Order{maker, traits, data}) as one tuple, where the
// program starts inside `data` at the offset held in traits bits 208..223, or the raw program.
export function extractProgram(blob: Uint8Array): Uint8Array {
  if (blob.length >= 160) {
    let wrapper = true;
    for (let i = 0; i < 31 && wrapper; i++) if (blob[i] !== 0) wrapper = false;
    if (wrapper && blob[31] !== 0x20) wrapper = false;
    for (let i = 96; i < 127 && wrapper; i++) if (blob[i] !== 0) wrapper = false;
    if (wrapper && blob[127] !== 0x60) wrapper = false;
    if (wrapper) {
      const len = (blob[156] << 24) | (blob[157] << 16) | (blob[158] << 8) | blob[159];
      const programStart = (blob[68] << 8) | blob[69];
      if (len >= 0 && 160 + len <= blob.length && programStart <= len) return blob.subarray(160 + programStart, 160 + len);
    }
  }
  return blob;
}

// Program encoding: [opcode:1][argsLen:1][args:N] per instruction. The opcode sequence when the
// walk lands exactly on the end of the program, null otherwise.
export function opcodeSequence(program: Uint8Array): number[] | null {
  const ops: number[] = [];
  let pc = 0;
  while (pc < program.length) {
    if (pc + 1 >= program.length) return null;
    ops.push(program[pc]);
    pc += 2 + program[pc + 1];
  }
  return pc === program.length ? ops : null;
}

export function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex.startsWith("0x") ? hex.slice(2) : hex, "hex"));
}

// Bytes as the stream delivers them: hex from the CLI, base64 from the protobuf JSON encoding.
export function decodeBytes(value: string): Uint8Array {
  return value.startsWith("0x") ? hexToBytes(value) : Uint8Array.from(Buffer.from(value, "base64"));
}

const hex = (b: Uint8Array) => "0x" + Buffer.from(b).toString("hex");

// Aqua keys balances by (maker, app, strategyHash); so do we: the three concatenated.
export function strategyId(maker: string, app: string, strategyHash: string): string {
  return (maker + app.slice(2) + strategyHash.slice(2)).toLowerCase();
}

// keccak(app ++ opcodes), or keccak(app ++ "unparsed") when the program did not walk.
export function templateId(app: string, ops: number[] | null): string {
  const tail = ops === null ? Buffer.from("unparsed", "utf8") : Buffer.from(ops);
  return hex(keccak_256(Buffer.concat([Buffer.from(hexToBytes(app)), tail])));
}

// The subgraph names desks with The Graph's network name; ours differ for three chains.
export const GRAPH_NETWORK: Record<string, string> = {
  ethereum: "mainnet", base: "base", arbitrum: "arbitrum-one", optimism: "optimism", polygon: "matic", bsc: "bsc", robinhood: "robinhood",
};

export function deskId(maker: string, template: string, chain: string): string {
  return `${maker}-${template}-${GRAPH_NETWORK[chain] ?? chain}`;
}

export function fillId(tx: string, strategy: string): string { return `${tx}-${strategy}`; }
export function legId(fill: string, token: string): string { return `${fill}-${token}`; }
