# Lessons

Facts and rules about Aqua, SwapVM, the mainnet corpus, P&L, and explorer UX that shape this codebase. Read before touching bytecode, P&L, prices, or the overview. Dated additions go at the bottom of each section.

## SwapVM and Aqua facts

- Aqua is a registry of virtual balances. Tokens never leave the maker's wallet. `ship` registers an immutable strategy (emits `Shipped`), `dock` kills it, `pull` and `push` move real tokens at settlement. Balances are tracked per (maker, app, strategyHash, token). Ships and docks move no tokens.
- A strategy is signed bytes shipped to Aqua, no contract deployment. A 137-byte program is a full concentrated-liquidity market maker.
- Program format: `[opcode:1][args_len:1][args:N]` per instruction. Registers: balanceIn, balanceOut, amountIn, amountOut. `quote()` is a free deterministic dry run of the exact settle bytecode: it is the validator oracle.
- Takers trigger execution. There are no keepers. The arena's taker engine is the taker.
- Three routers: full SwapVM (about 40 opcodes), LimitSwapVM (24), AquaSwapVM (16). The canonical Aqua router on every chain is the 16-opcode one: no OraclePriceAdjuster, TWAP, DutchAuction, StaticBalances or LimitSwap. A modified redeployment is allowed by the track; that is what `NaumachyRouter` is.
- Deterministic addresses on every chain: Aqua `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`, canonical Aqua SwapVM router `0x111111338c5091E8440b67B168bAe16a668AC0De`. Verify the router variant at the Base address before relying on it.
- `DynamicBalances` persists reserves per order hash: one program self re-arms and serves both directions. A grid is one program.
- Debug opcodes (`PrintSwapRegisters`, 0x10) run only on Debug routers. The gym runs a Debug router variant for traces; ship-grade programs strip debug opcodes.
- A full swap-vm compile takes seconds with forge 1.5.x, not the minutes the repo warns about. `yarn install` without a frozen lockfile is needed for forge remappings into node_modules.
- Order construction: MakerTraits build, EIP-712 sign or `useAquaInsteadOfSignature`, TakerTraits build. The SDK e2e tests show a working anvil fork setup.
- License: Degensoft 1.1, source-available. Submodules, never pasted. Mentioned in the README.

## Traps

1. sqrt-price orientation is inverted versus intuition: XYCConcentrateSwap prices the lower-address token in units of the higher one. A wrong orientation lets a taker drain a whole reserve for pocket change. Rule: the strategy compiler owns orientation; agents never touch raw sqrt prices; the validator quotes one unit and compares with the intended spot.
2. Fee instructions are middleware: FeeFlatIn/Out run the rest of the program nested inside their own execution. Instruction order changes economics; this was 1inch's own audit hotspot. Rule: the validator enforces fee placement; debug traces are how you see composition bugs.
3. Partial-fill clamping: with `allowPartialFill`, the VM consumes only what the curve can serve and the fee gross-up applies to the consumed amount. Rule: P&L uses returned amounts and reserve deltas, never the requested size.
4. Opcode dialects: the deployed routers (v1.0.1) use an index-shifted dispatch that differs from repo HEAD, and the two mainnet routers differ from each other (Aqua router 0x12 = XYCConcentrate, full router 0x12 = DynamicBalances). Decoding with the wrong table produces garbage. Rule: decoder tables are keyed by app address and version. v1.0.1 order data carries no tokens.
5. Fee base differs by version: v1.0.1 uses 1e9 (u32), HEAD uses 1e7 (u24). A version-blind display shows fees 100x wrong.
6. Salt defeats byte-level dedupe: about 84 percent of mainnet programs end in a Salt instruction, so byte-identical dedupe collapses almost nothing. Rule: the template (opcode sequence, args ignored) is the taxonomy; novelty claims are made at template level.

## The mainnet corpus (early September 2026)

- About 124k ships collapse to about 38 templates. One gated concentrated-AMM template is 84 percent of the corpus. Nobody in the wild uses Dutch auctions, TWAP, oracle programs or jumps. This is the opening beat and the agents' prior.
- Real volume about 326M dollars over 41k strategies with economic fills. The top desk did 5.5M dollars of volume for about 15.6k dollars of edge, about 28 bps. The top five desks by volume all had negative 30-day edge.
- Corpus-wide 1h markout is about minus 4 bps of adverse selection, consistent with corpus edge.
- BSC desks market-make tokenized stocks (TSLAon, SPYon, NVDAon).
- Makers pay no fill gas; takers execute. Only ship and dock transactions cost the maker gas.
- Aqua is the 1INCH venue: pairs with 1INCH on one side are 98.6 percent of priced volume all time and 99.4 percent of the last 30 days (early September 2026). The rest is a few million dollars of Ethereum majors and BSC tokenized stocks.
- The 1INCH tape on Aqua runs about nine fills a minute and twenty times Binance's 1INCH/USDT volume; the Uniswap 1INCH pools are dead. No external source is sharper than the venue itself, which is why the reference price is the tape.
- 94.6 percent of Ethereum volume runs programs with a flat maker fee of 0.10 bps and a 0.025 bps protocol fee (fee base 1e9). At that fee a static curve cannot cover adverse selection; the two to five bps bleed is the cost of near-free liquidity hit by professional takers (one taker took 58 percent of a month's volume, three took 83 percent; none is the public 1inch router).

## P&L rules

- **Only economic fills count.** Roughly a fifth of settlement groups on mainnet are push-only virtual inventory declarations with sentinel amounts (2^53-1 times 1e8 style, or above total supply) and no matching ERC-20 Transfer. They are not trades. A naive rollup ranks them first with 10^21 dollars of volume. Volume, edge, P&L, prices and leaderboards use only groups where value moved both ways in one tx. One-sided groups stay visible as events. The arena scorer applies the same filter.
- Fills are per-tx per-strategy token nets. Protocol-fee pulls net against the incoming token automatically, so implied prices and edge are net of protocol fees by construction; the maker's own flat fee is inside the pushed amount, so it is inside the edge. Both are readable from the program bytes: `FeeFlatIn` args are 4 bytes on a 1e9 base, `AquaProtocolFeeIn` args are 4 bytes of rate plus the 20-byte recipient.
- Numeraire: stable if present (including EUR stables), else the most traded token by settlement legs, tie-break by address. Deterministic.
- Mark: 24h VWAP of the strategy's own two-sided fills per pair, anchored at the pair's last fill. Store and show mark age.
- USD: DefiLlama coins API, per fill hour, batched, own pacer around 12 calls per minute, provenance stored per row (source, actual timestamp, confidence), negative cache for uncovered hours. CoinGecko's free tier cannot cover a corpus this size. Store every address lowercase.
- Markout at a horizon is the fill re-marked at the reference price that much later: signed quantity times (reference later minus fill price), which equals edge plus drift. Drift alone is the adverse-selection component; never present it as the re-marked figure. References come from the venue tape by the minute, so 5-minute markouts exist wherever the pair has other prints; where it does not, the hourly price stands in and the number says so.
- A tape reference needs guards: exact numeric sums (float cumulative sums lose the small windows to cancellation), no dust prints, and a plausibility band around the fill's own price. Without them a single dust print turns a desk's edge into nonsense.
- The fill-time edge flatters and the five-minute markout is the honest edge. Against the tape at fill time, 20 of 202 Ethereum desks over $100K looked profitable; five minutes later, 6, and only 2 at two standard errors. Excluding the maker's own later prints from the later references moved the corpus five-minute number from -3.2 to -3.8 bps: a maker's own stale curve is not a reference.
- Venue and world disagree by about 20 bps per fill (tape versus Binance minute, median, unbiased) and by hundreds on dislocation days. No paid source removes that; averaging over fills does. Show the band, not a claim.
- Same-wallet self-trades are rare; operators split mirrored desks across wallets. Common-funder clustering is the heuristic that catches it. Present wash signals as evidence and lower bounds, never as badges.
- Wallet P&L is deposit-adjusted equity: V(t1) minus V(t0) minus net external flows. Balance anchors via multicall, historical balances derived from transfers, no archive RPC.
- Rebasing tokens break transfer-derived balances. Native ETH is a separate lane.
- The eight metrics professionals look for, in order: markout curve, edge decomposition (spread capture versus inventory), 30d APR with max drawdown and Sharpe on deposit-adjusted daily returns, taker toxicity leaderboard, volume excluding related counterparties, capital velocity and P&L per million of volume, labels, flow imbalance. Crypto annualizes with 365.

## UX rules for the explorer

- Legibility is layering, not simplification. Sentence, then decoded structure, then raw hex, one click apart. No sentence rather than a wrong one.
- Desk is the primary entity. Strategy instances are its children. Ships, docks, pulls, pushes are verb-first sentences in feeds.
- The overview is a pulse, not a wall: one hero claim top-left, at most four other numbers above the fold, flow before stock, a ranked centerpiece (desks, 30d, seven columns max, sparkline per row), every chart gets a sentence or it goes, one provenance line in the footer with freshness.
- Numbers carry context: relative time with absolute on hover, dollar and percent paired, window named inline, benchmark named in the label, tabular numerals, right-aligned.
- Caveats become badges (decoded, partial, live, docked, estimated), not sidebar prose.
- Default windows are recent (24h, 7d, 30d); all-time is a toggle.
- Docked means revoked, not withdrawn: tokens never left the wallet.

## The authoring loop

- Constrain generation to 6 to 8 archetypes with agent-chosen parameters and composition: grid or ladder through concentrated ranges, TWAP exit, Dutch-auction sale, oracle-anchored market making, stable-pair market making with decay, RequireMinRate stop orders, fee-tiered XYC, plus the arena's mandatory RiskCap.
- Validator stages: static grammar (allowed opcodes for the target router, exactly one balance setup, one swap core, invalidator for partial-fill static orders, deadline, fee placement), `quote()` succeeds both directions, CoreInvariants suite, economic smoke test on the fork. Feed custom errors back verbatim.
- Hold-out tape from day one: train on tape A, score on tape B. Cite Allen and Karjalainen 1999 when a judge asks about overfitting.
- Judge questions, answered: "another leaderboard" (name Alpha Arena, Hubble, Recall, Aquapilot, SWARM OS and state the deltas: strategies as venue-executable bytecode, evolution driven by rivals' verifiable fills, reproducible fork arena, hash-attributed P&L); "did AI really write it" (show the generation transcript and the decoded bytecode diff); "makers are not trading" (gladiators are competing market-making desks; the taker engine is the flow).

## The Graph and its neighbours (September 2026)

- Six Aqua subgraphs are published on The Graph Network, one per chain, both registries in each. The gateway served every one of them within two minutes of the publish transaction; a publish costs about a cent on Arbitrum One.
- The network id of a published subgraph appears only in the Studio publish dialog. It can be recovered from the network registry subgraph (`subgraphs(where: {owner})`, take `nftID`, encode base58), which is also how a page could list our deployments without hardcoding.
- graph-cli 0.98 requires an explicit `@entity(immutable: ...)` on every entity, and `graph build --network` rewrites `subgraph.yaml` in place, comments included. Keep the manifest comment free and explain it in the package README.
- On Studio, a deploy re-renders the subgraph page and clears anything typed in the Details form. Deploy first, fill the form after the page shows Deployed.
- A local graph-node loads every head block with all its receipts. Without `eth_getBlockReceipts` it falls back to one request per transaction with a thousand in flight; Base's public endpoint banned the machine after twenty thousand of them in half an hour. Use an endpoint with block receipts and wide historical log ranges (Tenderly's gateway serves both), and set batched, bounded receipt fetching. Steady state following Base's head is about ninety requests a minute; the local node is a bench, stopped when idle.
- Alchemy's free tier caps `eth_getLogs` at a ten-block range, which makes scanning an L2's history impossible there; it is fine for block fetches and the anvil fork.
- The Token API lives at `api.pinax.network` (the older host in some docs resets connections). It wants a bearer JWT issued from the project key; the project key itself is refused. It has no per-token dollar price: prices are per pool, as hourly candles, quoted in the pool's other token. Free plan: 200 requests a minute, ten results a query, hourly candles.
- DefiLlama's batchHistorical answers about a hundred calls a minute with eighty (coin, hour) pairs each and returns symbol and decimals alongside the price. Forty calls priced 3,169 Base token-hours at 0.99 average confidence.
- Aqua's legacy registry was active from November 2025 on Base and Arbitrum and February 2026 on Ethereum; the canonical registry from July 2026. The corpus start is therefore late 2025, not March 2026.
