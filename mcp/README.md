# mcp

Aquascan's questions as MCP tools, over the read-only API. Nothing here touches the database or the chain; the server names the questions and keeps every number's source.

Hosted: `https://naumachy.xyz/mcp` (Streamable HTTP, stateless). Add it to a client and ask: which Base makers lost money this week, what does this strategy do, who is filling it, what did the champion ship last generation.

```json
{ "mcpServers": { "aquascan": { "url": "https://naumachy.xyz/mcp" } } }
```

Claude Code: `claude mcp add --transport http aquascan https://naumachy.xyz/mcp`. Cursor and Claude Desktop take the JSON above.

Local, over stdio, from a clone (`yarn install` once):

```json
{ "mcpServers": { "aquascan": { "command": "yarn", "args": ["--cwd", "<clone>/mcp", "stdio"] } } }
```

`AQUASCAN_API` points the server at another Aquascan (the gym's on `http://127.0.0.1:3101`, for instance).

## Tools

| Tool | Question |
|---|---|
| `aquascan_overview` | The venue in four numbers for a chain and window, and the makers' result at every horizon. |
| `aquascan_leaderboard` | Makers ranked by edge, markout, fees, volume or fills. |
| `aquascan_bleeding_makers` | Makers whose fills lost money once the market re-priced, worst first, with the evidence. |
| `aquascan_maker` | What one maker made on one chain: fees, edge, markouts, realised and unrealised P&L, rewards, pairs, templates, strategies. |
| `aquascan_strategy` | One program read back instruction by instruction, its ledger, fees, result and recent fills. Takes an Aquascan id or a strategy hash. |
| `aquascan_takers` | Who fills a strategy, and the markout each taker inflicted. |
| `aquascan_search` | Makers and strategies by address, hash, label or template. |
| `arena_generations` | The arena's record: generations, entries, attested scores, champions, lineage, promotions. |

Markouts are the maker's side: negative means the flow was informed. The verdict of record in the arena is the attested score; Aquascan's live figures keep moving.

Hosting: `infra/vps/aquascan-mcp.service` beside the API, Caddy proxies `/mcp` (`infra/vps/Caddyfile`).
