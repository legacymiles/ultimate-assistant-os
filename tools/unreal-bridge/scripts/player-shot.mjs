// Through the bridge over stdio, exactly as Claude Code calls it:
// start Play-In-Editor, take a player-view screenshot, stop.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "player-shot", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, "..", "server.mjs")] }));
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 300000 });
  const t = (r.content ?? []).map((c) => c.text ?? "").join("\n");
  console.log(`[${name}${args.tool_name ? ":" + args.tool_name : ""}] ${r.isError ? "ERROR " : ""}${t.slice(0, 300).replace(/\n/g, " ")}`);
  return r;
};
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("tools:", tools.join(", "));
await call("unreal_status");
const APP = "EditorToolset.EditorAppToolset";
await call("call_tool", { toolset_name: APP, tool_name: "StartPIE", arguments: { options: { bSimulate: false, playMode: "PlayMode_InViewPort", warmupSeconds: 2 } } });
await call("unreal_screenshot", { name: "bridge-player-view", caption: "Player view via bridge", view: "player" });
await call("call_tool", { toolset_name: APP, tool_name: "StopPIE", arguments: {} });
await call("unreal_screenshot", { name: "bridge-editor-view", view: "editor" });
await client.close();
