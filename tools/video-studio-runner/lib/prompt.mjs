// The prompt handed to Claude Code for one job.
//
// It is short on purpose: the real knowledge lives in the engine's skill, and
// the job's own instructions block came from that engine's plugin in the hub.
// Repeating it here would let the two drift.

export function buildPrompt(job, workDir) {
  const engines = job.methods.map((m) => `  - ${m.name} → load the \`${m.skill}\` skill`).join("\n");

  const scenes = job.plan.scenes
    .map((scene) => {
      const engine = job.methods.find((m) => m.id === scene.methodId);
      return [
        `### Scene ${scene.index} — ${scene.title}`,
        `Engine: ${engine?.name ?? scene.methodId} (skill: ${engine?.skill ?? scene.methodId})`,
        `Timing: ${scene.startSec}s–${scene.endSec}s (${scene.endSec - scene.startSec}s)`,
        `Output file: out/scene-${scene.index}.mp4`,
        "",
        "Directive:",
        scene.directive || scene.description,
      ].join("\n");
    })
    .join("\n\n");

  const instructions = job.methods
    .map((m) => `## Instructions for ${m.name}\n\n${m.instructions}`)
    .join("\n\n---\n\n");

  return [
    `# Video Studio Arena job — "${job.title}"`,
    "",
    `Working directory: ${workDir}`,
    `Everything you need is also in \`job.json\` in that folder.`,
    "",
    "## What to make",
    "",
    `A ${job.plan.durationSec}-second video at ${job.plan.aspectRatio}, ${job.plan.scenes.length} scene(s).`,
    `Logline: ${job.plan.logline}`,
    "",
    "Engines in this job:",
    engines,
    "",
    "## Rules",
    "",
    "1. Load the engine's skill BEFORE doing anything with that engine. Do not work from memory.",
    "2. Write each scene to `out/scene-<n>.mp4` exactly as named below. The runner watches that",
    "   folder and uploads each file the moment it appears, so the website shows real progress.",
    "3. If you can join them yourself, also write `out/final.mp4`. If you cannot, do not fake it —",
    "   leave it out and the hub joins the scenes.",
    "4. Look at every render before calling it done. Name the specific defect, fix that one thing,",
    "   re-render only the affected scene. Two or three passes is normal.",
    "5. If a dependency is missing — an engine is not installed, an MCP is not connected, a key is",
    "   not set — stop and say exactly which one. Do NOT substitute a different engine, and do NOT",
    "   produce a placeholder and call it the video. A named missing dependency is the correct",
    "   result; a pretend render is not.",
    "6. Say `STATUS: scene <n> <message>` on its own line when you start or finish a scene, so the",
    "   website's status list stays honest.",
    "",
    "## Scenes",
    "",
    scenes,
    "",
    "---",
    "",
    instructions,
  ].join("\n");
}

/** Pull `STATUS: scene 2 rendering` out of Claude's narration. */
export function readStatusLine(line) {
  const match = /STATUS:\s*scene\s*(\d+)\s*(.*)/i.exec(line);
  if (!match) return null;
  return { sceneIndex: Number(match[1]), detail: match[2].trim().slice(0, 200) };
}
