// End-to-end probe of the realism pipeline through the bridge over stdio:
// ArenaShooter variant project -> Poly Haven import -> open -> PIE ->
// real game screenshot -> package -> packaged screenshot.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "shooter-probe", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, "..", "server.mjs")] }));
const call = async (name, args = {}) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 40 * 60_000 });
  const t = (r.content ?? []).map((c) => c.text ?? "").join("\n");
  console.log(`[${name}${args.tool_name ? ":" + args.tool_name : ""}] ${Math.round((Date.now() - t0) / 1000)}s ${r.isError ? "ERROR " : ""}${t.slice(0, 1500)}`);
  return { r, t };
};
const APP = "EditorToolset.EditorAppToolset";
const { t } = await call("unreal_new_project", { name: "ShooterProbe", template: "FirstPerson", variant: "ArenaShooter" });
const id = JSON.parse(t).id;
await call("unreal_add_assets", { id, models: ["concrete_road_barrier"], surfaces: ["road_damaged"] });
await call("unreal_open_project", { id, timeoutMinutes: 40 });
await call("call_tool", { toolset_name: APP, tool_name: "StartPIE", arguments: { options: { bSimulate: false, playMode: "PlayMode_InViewPort", warmupSeconds: 5 } } });
await call("unreal_editor_log", { grep: "LogBlueprint: Error|LoadErrors", lines: 20 });
await call("call_tool", { toolset_name: APP, tool_name: "StopPIE", arguments: {} });
await call("unreal_game_shot", { id, name: "probe-game", caption: "Arena Shooter variant, -game", seconds: 8 });
await call("unreal_package", { id });
await call("unreal_game_shot", { id, name: "probe-packaged", caption: "Arena Shooter variant, packaged", seconds: 8, packaged: true });
await client.close();
