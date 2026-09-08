import { readFile } from "node:fs/promises";
import { createRegistry, createRequest, createSubstream, fetchSubstream, isEmptyMessage, streamBlocks, unpackMapOutput } from "@substreams/core";
import { createNodeTransport } from "@substreams/node/createNodeTransport";

// One decoded registry event as the package's JSON encoding delivers it (camelCase, numbers as
// strings, bytes as base64 or hex). See substreams/aqua/proto/aqua.proto.
export interface EventRef { blockNumber: string; blockTime: string; txHash: string; txFrom: string; logIndex?: number; ordinal?: string; registry: string }
export interface ShippedEvent { at: EventRef; maker: string; app: string; strategyHash: string; strategy: string }
export interface DockedEvent { at: EventRef; maker: string; app: string; strategyHash: string }
export interface LegEvent { at: EventRef; maker: string; app: string; strategyHash: string; token: string; amount: string }
export interface AquaEvents { shipped?: ShippedEvent[]; docked?: DockedEvent[]; pushed?: LegEvent[]; pulled?: LegEvent[] }

export interface AquaBlock { number: number; timestamp: number; cursor: string; events: AquaEvents }

export interface StreamOptions {
  endpoint: string;        // https://host:443
  token: string;
  packagePath: string;     // local .spkg or URL
  startBlock: number;
  stopBlock: number;       // exclusive, as Substreams counts it
  startCursor?: string | null;
  outputModule?: string;
  signal?: AbortSignal;    // aborting cancels the request; the generator then throws
}

// Streams the package's map output from a cursor (or a block) to a stop block, in production mode
// so the provider serves cached ranges in parallel. Only blocks with events come through.
export async function* streamAquaBlocks(opts: StreamOptions): AsyncGenerator<AquaBlock> {
  const pkg = /^https?:\/\//.test(opts.packagePath) ? await fetchSubstream(opts.packagePath) : createSubstream(await readFile(opts.packagePath));
  const registry = createRegistry(pkg);
  // the token is a Graph Market JWT: it travels as a bearer, not as the X-Api-Key the node
  // transport would send for a Pinax key
  const transport = createNodeTransport(opts.endpoint, "", registry, new Headers({ "X-User-Agent": "naumachy-aquascan-enrich/0.1", Authorization: `Bearer ${opts.token}` }));
  const request = createRequest({
    substreamPackage: pkg,
    outputModule: opts.outputModule ?? "map_events",
    productionMode: true,
    startBlockNum: opts.startBlock,
    stopBlockNum: opts.stopBlock,
    startCursor: opts.startCursor ?? undefined,
  });
  for await (const response of streamBlocks(transport, request, { signal: opts.signal })) {
    const msg = response.message;
    if (msg.case === "blockUndoSignal") {
      // we stop a safety lag behind the head, so an undo means the lag was too short
      throw new Error(`substreams undo signal at block ${msg.value.lastValidBlock?.number ?? "?"}`);
    }
    if (msg.case !== "blockScopedData") continue;
    const data = msg.value;
    const clock = data.clock;
    if (!clock) continue;
    const output = unpackMapOutput(response, registry);
    if (!output || isEmptyMessage(output)) continue;
    const events = output.toJson({ typeRegistry: registry }) as AquaEvents;
    yield {
      number: Number(clock.number),
      timestamp: Number(clock.timestamp?.seconds ?? 0),
      cursor: data.cursor,
      events,
    };
  }
}

// The chain head from a JSON-RPC endpoint; the stream stops a lag behind it.
export async function rpcHead(rpc: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const res = await fetchImpl(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) });
  const body = (await res.json()) as { result?: string; error?: unknown };
  if (!body.result) throw new Error(`eth_blockNumber failed: ${JSON.stringify(body.error ?? body).slice(0, 200)}`);
  return parseInt(body.result, 16);
}
