import { promises as fs } from "node:fs";
import path from "node:path";

// Follow a game's project folder while Claude builds it.
//
// The skill and the bridge write everything the site needs into
// <project>/GameCreator/: status.json at each stage, Design.md, shots/*.png
// (+ shots/captions.json), and game.json at the end. The builder learns which
// folder belongs to the game from the bridge's registry, which gains an entry
// the moment unreal_new_project runs with the game's id.

const STAGE_TO_STATUS = {
  design: "designing",
  designing: "designing",
  project: "building",
  build: "building",
  building: "building",
  test: "testing",
  testing: "testing",
  package: "packaging",
  packaging: "packaging",
  report: "packaging",
  ready: "ready",
  failed: "failed",
};

export function statusForStage(stage) {
  return STAGE_TO_STATUS[String(stage ?? "").toLowerCase()] ?? null;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function projectForGame(projectsRoot, gameId) {
  const registry = await readJson(path.join(projectsRoot, ".game-creator", "registry.json"));
  return registry?.[gameId] ?? null;
}

/**
 * Poll the project folder and call back with only what changed since last time.
 * Returns a stop() function.
 */
export function watchGame({ projectsRoot, gameId, intervalMs = 3000, onChange }) {
  let project = null;
  let lastStatus = "";
  let lastDesign = "";
  let lastManifest = "";
  const seenShots = new Set();
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      if (!project) {
        project = await projectForGame(projectsRoot, gameId);
        if (project) await onChange({ type: "project", project });
      }
      if (!project) return;
      const dir = path.join(project.projectDir, "GameCreator");

      const status = await readJson(path.join(dir, "status.json"));
      const statusKey = JSON.stringify(status);
      if (status && statusKey !== lastStatus) {
        lastStatus = statusKey;
        await onChange({ type: "status", status: statusForStage(status.stage), note: status.note });
      }

      try {
        const design = await fs.readFile(path.join(dir, "Design.md"), "utf8");
        if (design.trim() && design !== lastDesign) {
          lastDesign = design;
          await onChange({ type: "design", design });
        }
      } catch {
        /* not written yet */
      }

      let names = [];
      try {
        names = (await fs.readdir(path.join(dir, "shots"))).filter((n) => /\.(png|jpe?g|webp)$/i.test(n)).sort();
      } catch {
        /* no shots yet */
      }
      const fresh = names.filter((n) => !seenShots.has(n));
      if (fresh.length) {
        const captions = (await readJson(path.join(dir, "shots", "captions.json"))) ?? {};
        for (const name of fresh) {
          const file = path.join(dir, "shots", name);
          // Skip a file still being written: its size must hold still for a tick.
          const a = (await fs.stat(file)).size;
          await new Promise((r) => setTimeout(r, 400));
          const b = (await fs.stat(file)).size;
          if (!a || a !== b) continue;
          seenShots.add(name);
          await onChange({ type: "screenshot", file, caption: captions[name] });
        }
      }

      const manifest = await readJson(path.join(dir, "game.json"));
      const manifestKey = JSON.stringify(manifest);
      if (manifest && manifestKey !== lastManifest) {
        lastManifest = manifestKey;
        await onChange({ type: "manifest", manifest, project });
      }
    } catch (err) {
      await onChange({ type: "error", error: err });
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  void tick();
  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      // One last pass so a game.json written in the final second is not missed.
      stopped = false;
      await tick();
      stopped = true;
    },
    project: () => project,
  };
}
