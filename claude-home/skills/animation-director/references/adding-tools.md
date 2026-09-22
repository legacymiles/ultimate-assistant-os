# Adding a tool to the studio

The pipeline is modular: tools are data, not special cases.

1. **Register it** in the hub repo: `src/lib/studio3d/tools/registry.ts` → add an entry to `TOOLS`
   (`id`, `name`, `kind`, `runsOn`, `status`, `role`, `strengths`, `mcp`, `color`) and its id to
   `ToolId`. Add a chip colour in `src/components/studio3d/studio3d.css` (`.s3d-chip--<id>`).
   The tool plan, the "crew" list and the builder's report validation pick it up from there.
2. **Route work to it.** Motion tools: extend `MotionTool` and the rules in
   `src/lib/studio3d/director/motion.ts` (+ tests in `studio3d.test.ts`) and in `routing.md`.
   Non-motion tools (voice, music, concept art, video upscaling): add a field to the plan in
   `types.ts` (e.g. `scene.voiceLines`) and fill it in `director/heuristic.ts` and the AI
   director's schema in `director/llm.ts`.
3. **Teach the skill.** Add `references/<tool>.md` here (what it is for, how Claude reaches it —
   MCP server, CLI or HTTP API, setup commands, limits, fallback) and a stage or sub-step in
   `SKILL.md` / `pipeline.md`. Server-side tools (APIs with keys) can instead run in a hub API
   route and hand the builder a file URL in job.json.
4. **Detect it on the PC** if it is local: `tools/studio3d-builder/lib/detect.mjs` → add to the
   capabilities object and to `StudioCapabilities` in `types.ts`, so the app shows readiness.
5. **Report it**: `report.json.toolsUsed` accepts any registered tool id.

Reserved slots already in the registry (status `planned`): `voice` (narration/dialogue TTS — the
hub's Voice Studio), `music` (score), `concept-art` (image model for look-dev frames).
