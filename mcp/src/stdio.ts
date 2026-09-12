import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { makeServer } from "./server.js";
// Aquascan over stdio, for Claude Desktop, Claude Code and Cursor: AQUASCAN_API names the API (naumachy.xyz by default).
const server = makeServer(process.env.AQUASCAN_API ?? "https://naumachy.xyz");
await server.connect(new StdioServerTransport());
