#!/usr/bin/env node
// unreal-bridge: an always-available MCP server for building games in Unreal
// Engine 5.8 from Claude Code.
//
// Epic ships an MCP server inside the editor (the ModelContextProtocol plugin),
// but it only exists while the editor is open, and Claude Code connects to MCP
// servers when a session starts. This bridge is registered with Claude Code
// instead: it always connects, it launches and closes the editor itself, and
// once the editor is up it re-exposes Epic's tools (list_toolsets,
// describe_toolset, call_tool) unchanged.

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { DEFAULT_PORT, engineDir, projectsRoot } from "./lib/paths.mjs";
import { TEMPLATES, TEMPLATE_IDS } from "./lib/templates.mjs";
import { createProject } from "./lib/project.mjs";
import * as registry from "./lib/registry.mjs";
import * as editor from "./lib/editor.mjs";
import { EpicClient, resultText } from "./lib/epic.mjs";
import { packageGame } from "./lib/package.mjs";

const PORT = Number(process.env.UNREAL_MCP_PORT || DEFAULT_PORT);

// ---------------------------------------------------------------------------
// Epic connection
// ---------------------------------------------------------------------------

let epic = null; // EpicClient while the editor's MCP server is reachable
let epicTools = []; // Epic's tool definitions, re-exposed verbatim

async function connectEpic() {
  const client = new EpicClient(editor.mcpUrl(PORT), { clientName: "unreal-bridge" });
  await client.initialize();
  epicTools = await client.listTools();
  epic = client;
  notifyToolsChanged();
  return epicTools;
}

function dropEpic() {
  if (!epic && !epicTools.length) return;
  epic = null;
  epicTools = [];
  notifyToolsChanged();
}

/** Reconnect lazily: the editor may have been opened by hand or restarted. */
async function ensureEpic() {
  if (epic) return epic;
  try {
    await connectEpic();
    return epic;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const text = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const fail = (message) => ({ content: [{ type: "text", text: message }], isError: true });

function epicValue(result) {
  const t = resultText(result);
  if (result?.isError) throw new Error(t);
  try {
    return JSON.parse(t).returnValue;
  } catch {
    return t;
  }
}

async function requireEpic() {
  const client = await ensureEpic();
  if (!client) throw new Error("The Unreal Editor is not running. Call unreal_open_project first.");
  return client;
}

async function currentProject() {
  const s = await editor.status();
  if (!s.uproject) return null;
  return (await registry.findByUproject(s.uproject)) ?? { uproject: s.uproject, projectDir: path.dirname(s.uproject) };
}

const NO_OVERLAY = { gridSpacing: 0, gridExtent: 0, gridHeight: 0, maxLabelDistance: 0, classFilter: null, maxLabels: 0 };

// ---------------------------------------------------------------------------
// Bridge tools
// ---------------------------------------------------------------------------

const BRIDGE_TOOLS = [
  {
    name: "unreal_status",
    description:
      "Show the Unreal setup: engine path, projects folder, whether an editor is running and on which project, and whether Epic's in-editor MCP tools are connected. Call this first in any Unreal task.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "unreal_new_project",
    description:
      "Create a new Blueprint game project from an engine template, with Epic's MCP server and every editor toolset enabled. Does not open it; call unreal_open_project next. Templates: " +
      TEMPLATE_IDS.map((id) => `${id} (${TEMPLATES[id].blurb})`).join("; "),
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Game name; becomes the project folder name (letters and digits only, max 20)." },
        template: { type: "string", enum: TEMPLATE_IDS, default: "FirstPerson" },
        id: { type: "string", description: "Optional game id to register the project under (the Game Creator app passes its own)." },
        description: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "unreal_open_project",
    description:
      "Launch the Unreal Editor on a project with Epic's MCP server on, wait until it is ready, and connect its tools (list_toolsets, describe_toolset, call_tool). The first launch of a new project compiles shaders and can take 5-15 minutes; later launches take about a minute.",
    inputSchema: {
      type: "object",
      properties: {
        uproject: { type: "string", description: "Path to the .uproject. Either this or id." },
        id: { type: "string", description: "Registered game id." },
        timeoutMinutes: { type: "number", default: 20 },
      },
    },
  },
  {
    name: "unreal_close_editor",
    description: "Save every modified asset, then close the Unreal Editor. Required before unreal_package.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "unreal_editor_log",
    description: "Read the end of the running (or last) project's editor log file, optionally filtered by a regular expression.",
    inputSchema: {
      type: "object",
      properties: {
        lines: { type: "number", default: 80 },
        grep: { type: "string", description: "Case-insensitive regex, e.g. 'Error|Warning'." },
        uproject: { type: "string" },
      },
    },
  },
  {
    name: "unreal_screenshot",
    description:
      "Save a clean PNG of the level viewport (no grid or labels) into the project's GameCreator/shots folder. Works in the editor and while Play-In-Editor is running (captures the game view). Optionally move the camera first.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "File name without extension, e.g. '01-gameplay'." },
        caption: { type: "string", description: "Short caption shown under the screenshot in the Game Creator app." },
        camera: {
          type: "object",
          description: "Optional camera pose: {location:{x,y,z}, rotation:{pitch,yaw,roll}} in cm/degrees.",
        },
        showUI: { type: "boolean", default: true, description: "Include on-screen UI (HUD widgets) when capturing during play." },
        view: {
          type: "string",
          enum: ["editor", "player"],
          default: "editor",
          description:
            "'player' (Play-In-Editor must be running) shoots from the player pawn's eye; 'editor' uses the current viewport camera or `camera`.",
        },
        thirdPersonDistance: { type: "number", description: "With view 'player': pull the camera back this many cm behind the pawn (third-person / vehicle shots)." },
        eyeHeight: { type: "number", description: "With view 'player': cm above the pawn origin. Default 60." },
        pawnClass: { type: "string", description: "With view 'player': class path to look for. Default /Script/Engine.Pawn." },
      },
      required: ["name"],
    },
  },
  {
    name: "unreal_package",
    description:
      "Save and close the editor, then package the project as a standalone Windows game into <project>/Packaged. Takes several minutes. Returns the .exe path, or the errors from the build log.",
    inputSchema: { type: "object", properties: { uproject: { type: "string" }, id: { type: "string" } } },
  },
  {
    name: "unreal_play",
    description: "Launch a packaged game (or, if it was never packaged, the project in standalone -game mode) so the user can play it.",
    inputSchema: { type: "object", properties: { id: { type: "string" }, uproject: { type: "string" } } },
  },
  {
    name: "unreal_list_games",
    description: "List every game project the bridge has created, newest first, with paths and packaged exe.",
    inputSchema: { type: "object", properties: {} },
  },
];

const BRIDGE_NAMES = new Set(BRIDGE_TOOLS.map((t) => t.name));

async function resolveProject({ id, uproject }) {
  if (id) {
    const hit = await registry.get(id);
    if (!hit) throw new Error(`No game registered with id "${id}".`);
    return hit;
  }
  if (uproject) return (await registry.findByUproject(uproject)) ?? { uproject: path.resolve(uproject), projectDir: path.dirname(path.resolve(uproject)) };
  const running = await currentProject();
  if (running) return running;
  throw new Error("Say which project: pass id or uproject.");
}

const handlers = {
  async unreal_status() {
    const s = await editor.status();
    if (s.mcpReady) await ensureEpic();
    else dropEpic();
    return text({
      engineDir: engineDir(),
      projectsRoot: projectsRoot(),
      editor: s,
      epicToolsConnected: Boolean(epic),
      epicTools: epicTools.map((t) => t.name),
      next: !s.running
        ? "No editor running. Create a project with unreal_new_project, then unreal_open_project."
        : !s.mcpReady
          ? "Editor is starting (or was opened without the MCP server). Call unreal_open_project to wait for it."
          : "Ready. Use list_toolsets / describe_toolset / call_tool.",
    });
  },

  async unreal_new_project(args) {
    const entry = await createProject({
      name: args.name,
      template: args.template ?? "FirstPerson",
      id: args.id,
      description: args.description ?? "",
    });
    return text({ ...entry, next: `Call unreal_open_project with id "${entry.id}".` });
  },

  async unreal_open_project(args) {
    const project = await resolveProject(args);
    const launched = await editor.launch(project.uproject, { port: PORT });
    const waited = await editor.waitReady({
      port: PORT,
      pid: launched.pid,
      uproject: project.uproject,
      timeoutMs: (args.timeoutMinutes ?? 20) * 60_000,
    });
    const tools = await connectEpic();
    return text({
      opened: project.uproject,
      id: project.id,
      pid: launched.pid,
      alreadyRunning: Boolean(launched.alreadyRunning),
      readyAfterSeconds: Math.round(waited.readyAfterMs / 1000),
      epicTools: tools.map((t) => t.name),
      startingLevel: project.map,
      next: "Call list_toolsets, then describe_toolset for the toolsets you need.",
    });
  },

  async unreal_close_editor() {
    const result = await editor.close();
    dropEpic();
    return text(result);
  },

  async unreal_editor_log(args) {
    const project = args.uproject ? { uproject: args.uproject } : await currentProject() ?? (await registry.list())[0];
    if (!project) return fail("No project to read a log for.");
    return text(await editor.logTail(project.uproject, { lines: args.lines ?? 80, grep: args.grep }));
  },

  async unreal_screenshot(args) {
    const client = await requireEpic();
    const project = await currentProject();
    if (!project) return fail("Could not tell which project the running editor has open.");
    const APP = "EditorToolset.EditorAppToolset";
    let camera = args.camera;
    if (!camera && args.view === "player") {
      // During Play-In-Editor the viewport camera tool still reports the
      // editor's pose, so find the spawned player character (it lives in the
      // UEDPIE_ world) and shoot from its eye height and facing.
      if (!epicValue(await client.callToolset(APP, "IsPIERunning", {}))) {
        return fail('view "player" needs Play-In-Editor running. Start it with call_tool EditorAppToolset.StartPIE first.');
      }
      const pawns = epicValue(
        await client.callToolset("editor_toolset.toolsets.scene.SceneTools", "find_actors", {
          root: null,
          name: "",
          actor_type: { refPath: args.pawnClass ?? "/Script/Engine.Pawn" },
          tag: "",
          bounds: null,
          collision_channels: [],
        }),
      );
      const pawn = (pawns ?? []).find((p) => /UEDPIE_/.test(p.refPath)) ?? (pawns ?? [])[0];
      if (!pawn) return fail("No player pawn found in the play session.");
      const xf = epicValue(
        await client.callToolset("editor_toolset.toolsets.actor.ActorTools", "get_actor_transform", { actor: pawn, worldspace: true }),
      );
      const back = args.thirdPersonDistance ?? 0;
      const yaw = ((xf.rotation?.yaw ?? 0) * Math.PI) / 180;
      camera = {
        location: {
          x: xf.location.x - Math.cos(yaw) * back,
          y: xf.location.y - Math.sin(yaw) * back,
          z: xf.location.z + (args.eyeHeight ?? 60) + (back ? back * 0.35 : 0),
        },
        rotation: { pitch: back ? -12 : (xf.rotation?.pitch ?? 0), yaw: xf.rotation?.yaw ?? 0, roll: 0 },
      };
    }
    camera = camera ?? epicValue(await client.callToolset(APP, "GetCameraTransform", {}));
    if (!camera.scale) camera.scale = { x: 1, y: 1, z: 1 };
    const shot = epicValue(
      await client.callToolset(
        APP,
        "CaptureViewport",
        { captureTransform: camera, annotations: NO_OVERLAY, bShowUI: args.showUI ?? true },
        { timeoutMs: 120_000 },
      ),
    );
    if (!shot?.image?.data) return fail("The editor returned no image.");
    const safe = String(args.name).replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "shot";
    const dir = path.join(project.projectDir, "GameCreator", "shots");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safe}.png`);
    await fs.writeFile(file, Buffer.from(shot.image.data, "base64"));
    if (args.caption) {
      const capFile = path.join(dir, "captions.json");
      let caps = {};
      try {
        caps = JSON.parse(await fs.readFile(capFile, "utf8"));
      } catch {
        /* first caption */
      }
      caps[`${safe}.png`] = args.caption;
      await fs.writeFile(capFile, JSON.stringify(caps, null, 2), "utf8");
    }
    return text({ saved: file, caption: args.caption ?? null });
  },

  async unreal_package(args) {
    const project = await resolveProject(args);
    const s = await editor.status();
    if (s.running) {
      await editor.close();
      dropEpic();
    }
    const result = await packageGame(project.uproject, {});
    if (result.ok && project.id) await registry.upsert({ id: project.id, packagedExe: result.exe, packagedAt: new Date().toISOString() });
    if (!result.ok) return { ...text({ ...result, hint: "Read the errors, fix them in the editor (unreal_open_project), then package again." }), isError: true };
    return text(result);
  },

  async unreal_play(args) {
    const project = await resolveProject(args);
    const exe = project.packagedExe;
    if (exe) {
      spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
      return text({ launched: exe });
    }
    const { editorExe } = await import("./lib/paths.mjs");
    spawn(editorExe(), [project.uproject, "-game", "-windowed", "-ResX=1600", "-ResY=900"], { detached: true, stdio: "ignore" }).unref();
    return text({ launched: `${project.uproject} (standalone -game; not packaged yet)` });
  },

  async unreal_list_games() {
    return text(await registry.list());
  },
};

// ---------------------------------------------------------------------------
// MCP wiring
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "unreal", version: "1.0.0" },
  {
    capabilities: { tools: { listChanged: true } },
    instructions:
      "Build Unreal Engine 5.8 games. Start with unreal_status. New game: unreal_new_project -> unreal_open_project -> Epic's tools via list_toolsets/describe_toolset/call_tool -> unreal_screenshot -> unreal_package. For the full pipeline use the unreal-game-builder skill.",
  },
);

function notifyToolsChanged() {
  server.sendToolListChanged?.().catch?.(() => {});
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!epic) await ensureEpic();
  return { tools: [...BRIDGE_TOOLS, ...epicTools.filter((t) => !BRIDGE_NAMES.has(t.name))] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  try {
    if (BRIDGE_NAMES.has(name)) return await handlers[name](args);

    const client = await ensureEpic();
    if (!client) {
      return fail(`"${name}" is an Unreal Editor tool, and the editor is not running. Call unreal_open_project first.`);
    }
    try {
      return await client.callTool(name, args, { timeoutMs: 15 * 60_000 });
    } catch (err) {
      // The editor may have closed or crashed underneath us.
      if (!(await editor.status()).mcpReady) {
        dropEpic();
        return fail(`The Unreal Editor stopped responding (${err.message}). Check unreal_editor_log, then unreal_open_project.`);
      }
      throw err;
    }
  } catch (err) {
    return fail(err?.message ?? String(err));
  }
});

await server.connect(new StdioServerTransport());
// Attach to an editor that is already up (e.g. this is a new Claude session).
ensureEpic().catch(() => {});
