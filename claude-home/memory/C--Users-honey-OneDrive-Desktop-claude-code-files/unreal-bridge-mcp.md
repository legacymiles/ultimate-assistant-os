---
name: unreal-bridge-mcp
description: "The `unreal` MCP server (tools/unreal-bridge) that launches UE 5.8 and proxies Epic's built-in in-editor MCP; hard-won facts about Epic's toolsets, template packs, and content-only packaging on this PC"
metadata: 
  node_type: memory
  type: project
  originSessionId: 12b57f3a-535a-416f-829e-2c051bad14ec
  modified: 2026-09-14T04:35:47.600Z
---

Built 2026-09-14. `tools/unreal-bridge/server.mjs` is registered at **user scope** in Claude Code
(`claude mcp add --scope user unreal ...`), so every session on this PC has `unreal_*` tools plus
Epic's `list_toolsets` / `describe_toolset` / `call_tool` once an editor is open. Skill:
`~/.claude/skills/unreal-game-builder` (backup copy in repo `skills/`). Used by [[game-creator-app]].

**Epic ships the MCP server.** UE 5.8 has `Engine/Plugins/Experimental/ModelContextProtocol`
(streamable HTTP at 127.0.0.1:8000/mcp, flag `-ModelContextProtocolStartServer`) plus
`Experimental/Toolsets/AllToolsets`. No third-party Unreal MCP needed, nothing to compile.
Session id comes back in the `Mcp-Session-Id` RESPONSE header; `tools/call` replies are SSE that
stay open after the result (stop reading once your id arrives).

**Epic tool gotchas (verified):**
- `call_tool` wants the FULL toolset name + SHORT tool name; fully-qualified tool name = "Unknown tool".
- "Optional" args must be sent explicitly (`context_pins: []`, `annotations`, `classFilter: null`)
  or it errors "needs a default value".
- Blueprint DSL node ids cannot be guessed — `find_node_types` first
  (`Utilities|String|ToString(Integer)`, not `Math|Conversions|...`).
- `execute_tool_script` is sandboxed: only json/math/re/time/datetime/copy, no `import unreal`.
- `GetCameraTransform` during PIE still returns the editor camera; player view = `find_actors`
  for a Pawn in the `UEDPIE_` world + `get_actor_transform`.
- `CaptureViewport` returns the PNG base64 inside the JSON text (`returnValue.image.data`);
  zero out annotations for a clean shot.

**Template copies MUST include SharedContentPacks** (TemplateDefs.ini → TemplateResources/<Level>/
<Mount>/Content → /Game/<Mount>). Without them BP_FirstPersonCharacter fails to compile and
`StartPIE` hangs forever on a modal dialog (the whole MCP server stops answering).

**Packaging on this PC is content-only, and that is fragile.** VS Build Tools exist but the .NET
Framework SDK does not, so anything that compiles fails (`RulesError: NetFxSDK`). AutomationTool
treats a Blueprint project as code-based if ANY non-default runtime plugin is enabled — the stock
FirstPerson template's own `GameplayStateTree` triggers it. Fix in `lib/package.mjs`: no `-build`,
and for the duration of BuildCookRun rewrite the .uproject to keep only
`TargetAllowList:["Editor"]` plugins, then restore. Probe packaged in 5.8 min and the exe ran.
Installing the .NET Framework 4.8 Developer Pack would allow runtime plugins / C++ — ask the user first.

**Windows/Git Bash trap:** `node -e '...'` with `C:\\path` inside single quotes gets its
backslashes collapsed by MSYS; use forward slashes + `path.resolve` in inline scripts.

**Privacy trap:** a full-desktop screenshot to look for an editor dialog captured the user's
browser showing saved passwords. Never screenshot the whole desktop; use the editor log instead.
