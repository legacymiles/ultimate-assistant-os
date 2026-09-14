// Smoke test: start the bridge over stdio the way Claude Code does, list its
// tools, and call unreal_status.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(here, "..", "server.mjs")] });
const client = new Client({ name: "smoke", version: "0" });
await client.connect(transport);
const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));
const status = await client.callTool({ name: "unreal_status", arguments: {} });
console.log(status.content[0].text.slice(0, 1500));
await client.close();
