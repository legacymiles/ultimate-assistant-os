#!/usr/bin/env node
// CLI wrapper for the unreal-bridge library functions.
// Usage: node cli.mjs <command> [args-as-json]

import path from "node:path";
import { promises as fs } from "node:fs";
import { createProject } from "./lib/project.mjs";
import * as editor from "./lib/editor.mjs";
import * as registry from "./lib/registry.mjs";
import { EpicClient, resultText } from "./lib/epic.mjs";
import { packageGame } from "./lib/package.mjs";
import { DEFAULT_PORT } from "./lib/paths.mjs";

const PORT = Number(process.env.UNREAL_MCP_PORT || DEFAULT_PORT);

function die(msg) { console.error(JSON.stringify({ error: msg })); process.exit(1); }
function out(obj) { console.log(JSON.stringify(obj, null, 2)); }

const [,, cmd, ...rest] = process.argv;
const arg = rest.length ? JSON.parse(rest.join(" ")) : {};

async function getEpic() {
  const c = new EpicClient(editor.mcpUrl(PORT), { clientName: "cli" });
  await c.initialize();
  return c;
}

function epicValue(result) {
  const t = resultText(result);
  try { return JSON.parse(t).returnValue; } catch { return t; }
}

try {
  switch (cmd) {
    case "status": {
      const s = await editor.status();
      out(s);
      break;
    }
    case "new_project": {
      // arg: {name, template, id, description}
      const entry = await createProject(arg);
      out(entry);
      break;
    }
    case "open_project": {
      // arg: {id} or {uproject}
      let project;
      if (arg.id) project = await registry.get(arg.id);
      else if (arg.uproject) project = { uproject: arg.uproject, projectDir: path.dirname(arg.uproject) };
      if (!project) die("Project not found");
      const launched = await editor.launch(project.uproject, { port: PORT });
      console.error("Waiting for editor MCP server...");
      const waited = await editor.waitReady({
        port: PORT,
        pid: launched.pid,
        uproject: project.uproject,
        timeoutMs: (arg.timeoutMinutes ?? 20) * 60_000,
        onTick: (ms) => { if (ms % 30000 < 5000) console.error(`  ...${Math.round(ms/1000)}s`); },
      });
      out({ opened: project.uproject, id: project.id, pid: launched.pid, readyAfterSeconds: Math.round(waited.readyAfterMs / 1000) });
      break;
    }
    case "close_editor": {
      const result = await editor.close();
      out(result);
      break;
    }
    case "editor_log": {
      // arg: {uproject, lines, grep}
      let project;
      if (arg.id) project = await registry.get(arg.id);
      else if (arg.uproject) project = { uproject: arg.uproject };
      else { const list = await registry.list(); project = list[0]; }
      if (!project) die("No project");
      const log = await editor.logTail(project.uproject, { lines: arg.lines ?? 80, grep: arg.grep });
      out({ log });
      break;
    }
    case "list_toolsets": {
      const epic = await getEpic();
      const result = await epic.callTool("list_toolsets", {});
      out(resultText(result));
      await epic.close();
      break;
    }
    case "describe_toolset": {
      // arg: {toolset_name}
      const epic = await getEpic();
      const result = await epic.callTool("describe_toolset", { toolset_name: arg.toolset_name });
      out(resultText(result));
      await epic.close();
      break;
    }
    case "call_tool": {
      // arg: {toolset_name, tool_name, arguments}
      const epic = await getEpic();
      const result = await epic.callToolset(arg.toolset_name, arg.tool_name, arg.arguments || {}, { timeoutMs: (arg.timeoutMinutes || 15) * 60_000 });
      const txt = resultText(result);
      try { out(JSON.parse(txt)); } catch { out({ text: txt, isError: result?.isError }); }
      await epic.close();
      break;
    }
    case "screenshot": {
      // arg: {name, caption, view, camera, showUI}
      const epic = await getEpic();
      const APP = "EditorToolset.EditorAppToolset";
      const SCENE = "editor_toolset.toolsets.scene.SceneTools";
      const ACTOR = "editor_toolset.toolsets.actor.ActorTools";
      const NO_OVERLAY = { gridSpacing: 0, gridExtent: 0, gridHeight: 0, maxLabelDistance: 0, classFilter: null, maxLabels: 0 };

      let camera = arg.camera;
      if (!camera && arg.view === "player") {
        const pawns = epicValue(await epic.callToolset(SCENE, "find_actors", {
          root: null, name: "", actor_type: { refPath: "/Script/Engine.Pawn" }, tag: "", bounds: null, collision_channels: [],
        }));
        const pawn = (pawns ?? []).find(p => /UEDPIE_/.test(p.refPath)) ?? (pawns ?? [])[0];
        if (!pawn) die("No player pawn found");
        const xf = epicValue(await epic.callToolset(ACTOR, "get_actor_transform", { actor: pawn, worldspace: true }));
        camera = {
          location: { x: xf.location.x, y: xf.location.y, z: xf.location.z + (arg.eyeHeight ?? 60) },
          rotation: { pitch: xf.rotation?.pitch ?? 0, yaw: xf.rotation?.yaw ?? 0, roll: 0 },
        };
      }
      if (!camera) camera = epicValue(await epic.callToolset(APP, "GetCameraTransform", {}));
      if (!camera.scale) camera.scale = { x: 1, y: 1, z: 1 };

      const shot = epicValue(await epic.callToolset(APP, "CaptureViewport", {
        captureTransform: camera, annotations: NO_OVERLAY, bShowUI: arg.showUI ?? true,
      }, { timeoutMs: 120_000 }));

      if (!shot?.image?.data) die("No image returned");

      // Find project dir from registry
      const s = await editor.status();
      let projectDir;
      if (s.uproject) projectDir = path.dirname(s.uproject);
      else { const list = await registry.list(); if (list[0]) projectDir = list[0].projectDir; }
      if (!projectDir) die("Cannot determine project dir");

      const safe = String(arg.name).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "shot";
      const dir = path.join(projectDir, "GameCreator", "shots");
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${safe}.png`);
      await fs.writeFile(file, Buffer.from(shot.image.data, "base64"));

      if (arg.caption) {
        const capFile = path.join(dir, "captions.json");
        let caps = {};
        try { caps = JSON.parse(await fs.readFile(capFile, "utf8")); } catch {}
        caps[`${safe}.png`] = arg.caption;
        await fs.writeFile(capFile, JSON.stringify(caps, null, 2), "utf8");
      }
      out({ saved: file, caption: arg.caption ?? null });
      await epic.close();
      break;
    }
    case "package": {
      // arg: {id} or {uproject}
      let project;
      if (arg.id) project = await registry.get(arg.id);
      else if (arg.uproject) project = { uproject: arg.uproject, projectDir: path.dirname(arg.uproject) };
      if (!project) die("Project not found");
      const s = await editor.status();
      if (s.running) { await editor.close(); }
      const result = await packageGame(project.uproject, {});
      if (result.ok && project.id) await registry.upsert({ id: project.id, packagedExe: result.exe, packagedAt: new Date().toISOString() });
      out(result);
      break;
    }
    case "play": {
      let project;
      if (arg.id) project = await registry.get(arg.id);
      if (!project) die("Project not found");
      const { spawn } = await import("node:child_process");
      if (project.packagedExe) {
        spawn(project.packagedExe, [], { detached: true, stdio: "ignore" }).unref();
        out({ launched: project.packagedExe });
      } else {
        const { editorExe } = await import("./lib/paths.mjs");
        spawn(editorExe(), [project.uproject, "-game", "-windowed", "-ResX=1600", "-ResY=900"], { detached: true, stdio: "ignore" }).unref();
        out({ launched: project.uproject });
      }
      break;
    }
    default:
      die(`Unknown command: ${cmd}. Use: status, new_project, open_project, close_editor, editor_log, list_toolsets, describe_toolset, call_tool, screenshot, package, play`);
  }
} catch (err) {
  die(err.message ?? String(err));
}
