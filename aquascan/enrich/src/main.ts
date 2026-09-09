import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, type ChainName } from "./config.js";
import { createPool, migrate } from "./db.js";
import { createPacer } from "./pacer.js";
import { Gateway } from "./gateway.js";
import { syncStrategies } from "./lanes/strategies.js";
import { syncFills } from "./lanes/fills.js";
import { syncTemplates } from "./lanes/templates.js";
import { syncPrices } from "./lanes/prices.js";
import { syncTokens } from "./lanes/tokens.js";
import { syncFees } from "./lanes/fees.js";
import { syncPools } from "./lanes/pools.js";
import { syncAqua } from "./lanes/aqua.js";
import { syncRewards } from "./lanes/rewards.js";
import { Llama } from "./llama.js";
import { rollup } from "./rollup.js";
import { status, formatStatus } from "./status.js";

const log = (...parts: unknown[]) => console.log(new Date().toISOString(), ...parts);

function parseArgs(argv: string[]) {
  const once = argv.includes("--once");
  const statusOnly = argv.includes("--status");
  const rollupOnly = argv.includes("--rollup");
  const poolsOnly = argv.includes("--pools");
  const chainsArg = argv.find((a) => a.startsWith("--chains="));
  const only = chainsArg ? (chainsArg.slice("--chains=".length).split(",") as ChainName[]) : undefined;
  return { once, statusOnly, rollupOnly, poolsOnly, only };
}

async function main() {
  const { once, statusOnly, rollupOnly, poolsOnly, only } = parseArgs(process.argv.slice(2));
  const config = loadConfig(process.env, only);
  const pool = createPool(config.databaseUrl);
  const applied = await migrate(pool, join(dirname(fileURLToPath(import.meta.url)), "..", "sql"));
  if (applied.length) log("migrations applied:", applied.join(", "));

  if (statusOnly) {
    console.log(formatStatus(await status(pool)));
    await pool.end();
    return;
  }
  const dexGateway = new Gateway(config.apiKey, createPacer(config.dexCallsPerMinute));
  if (poolsOnly) {
    const p = await syncPools(pool, dexGateway, config.dexes, config.pageSize);
    log(`pools: ${p.routed} pairs routed, ${p.pools} pools, +${p.swaps} swaps, ${p.calls} gateway calls`);
    const r = await rollup(pool);
    log(`rollup: ${r.fills} fills valued (${r.tapeFills} on the tape), ${r.strategies} strategies, ${r.desks} desks in ${r.durationMs} ms`);
    await pool.end();
    return;
  }
  if (rollupOnly) {
    const f = await syncFees(pool);
    log(`fees: ${f.decoded} decoded, ${f.unknown} unknown`);
    const r = await rollup(pool);
    log(`rollup: ${r.fills} fills valued (${r.tapeFills} on the tape), ${r.strategies} strategies, ${r.desks} desks in ${r.durationMs} ms`);
    await pool.end();
    return;
  }

  for (const c of config.chains) {
    await pool.query(`INSERT INTO chains (name, subgraph_id, source) VALUES ($1, $2, $3) ON CONFLICT (name) DO UPDATE SET subgraph_id = EXCLUDED.subgraph_id, source = EXCLUDED.source`, [c.name, c.subgraphId, c.source]);
  }
  const paced = createPacer(config.gatewayCallsPerMinute);
  const bySubgraph = new Map(config.chains.filter((c) => c.source === "subgraph").map((c) => [c.subgraphId, c.name]));
  const gateway = new Gateway(config.apiKey, paced, (subgraphId) => {
    const name = bySubgraph.get(subgraphId);
    if (name) void pool.query(`UPDATE chains SET gateway_calls = gateway_calls + 1 WHERE name = $1`, [name]);
  });
  const llama = new Llama(createPacer(config.llamaCallsPerMinute));
  const rpcPaced = createPacer(30);
  const merklPaced = createPacer(Number(process.env.MERKL_CALLS_PER_MINUTE ?? 30));
  log(`enrich: ${config.chains.map((c) => c.name).join(", ")} | ${config.gatewayCallsPerMinute} gateway calls/min | defillama ${config.llamaCallsPerMinute}/min, ${config.llamaCallsPerPass}/pass | poll ${config.pollSeconds}s`);

  for (;;) {
    for (const c of config.chains) {
      try {
        if (c.source === "substreams") {
          const rpc = config.rpcByChain[c.name];
          if (!rpc) throw new Error(`RPC_${c.name.toUpperCase()} is needed to read the head of a Substreams chain`);
          if (!config.substreams.token) throw new Error("SUBSTREAMS_API_TOKEN is not set");
          const a = await syncAqua(pool, { chain: c.name, endpoint: c.subgraphId, token: config.substreams.token, packagePath: config.substreams.packagePath, startBlock: c.startBlock ?? 0, rpc, budgetSeconds: Number(process.env.SUBSTREAMS_BUDGET_SECONDS ?? 600) });
          log(`${c.name}: substreams +${a.blocks} blocks, ships ${a.shipped} docks ${a.docked} legs ${a.legs} cursor ${a.cursor} head ${a.head}`);
          continue;
        }
        const s = await syncStrategies(pool, gateway, c.name, c.subgraphId, config.pageSize);
        const f = await syncFills(pool, gateway, c.name, c.subgraphId, config.pageSize);
        const t = await syncTemplates(pool, gateway, c.name, c.subgraphId, config.pageSize);
        log(`${c.name}: ships +${s.ships.rows} (${s.ships.pages}p) docks +${s.docks.rows} (${s.docks.pages}p) fills +${f.rows} (${f.pages}p) templates ${t.rows} cursor ${f.cursor} head ${f.head}`);
      } catch (err) {
        log(`${c.name}: error ${String(err).slice(0, 200)}`);
      }
    }
    try {
      const p = await syncPrices(pool, llama, config.llamaCallsPerPass);
      log(`prices: ${p.targets} targets, ${p.calls} calls, +${p.priced} priced, ${p.missed} missed`);
      const rpcs = Object.fromEntries(config.chains.map((c) => [c.name, config.rpcByChain[c.name]]));
      const t = await syncTokens(pool, rpcs, rpcPaced);
      if (t.asked) log(`tokens: ${t.resolved}/${t.asked} resolved from chain`);
      const f = await syncFees(pool);
      if (f.decoded || f.unknown) log(`fees: ${f.decoded} decoded, ${f.unknown} unknown`);
      const rw = await syncRewards(pool, merklPaced, Number(process.env.MERKL_MAKERS_PER_PASS ?? 60));
      if (rw.checked || rw.errors) log(`rewards: ${rw.checked} makers checked on Merkl, ${rw.withRewards} paid, ${rw.errors} errors`);
      const pl = await syncPools(pool, dexGateway, config.dexes, config.pageSize);
      if (pl.calls) log(`pools: ${pl.routed} pairs routed, ${pl.pools} pools, +${pl.swaps} swaps, ${pl.calls} gateway calls`);
    } catch (err) {
      log(`prices: error ${String(err).slice(0, 200)}`);
    }
    try {
      const r = await rollup(pool);
      log(`rollup: ${r.fills} fills valued (${r.tapeFills} on the tape), ${r.strategies} strategies, ${r.desks} desks in ${r.durationMs} ms`);
    } catch (err) {
      log(`rollup: error ${String(err).slice(0, 300)}`);
    }
    console.log(formatStatus(await status(pool)));
    if (once) break;
    await new Promise((r) => setTimeout(r, config.pollSeconds * 1000));
  }
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
