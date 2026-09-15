import { promises as fs } from "node:fs";
import path from "node:path";

// Follow a job folder while Claude produces the video. The skill writes
// everything the site needs into <job>/studio/: status.json at each stage,
// stills/*.png (+ stills/captions.json), render/final.mp4, and report.json.

const STAGE_TO_STATUS = {
  prep: "building",
  plan: "building",
  assets: "building",
  characters: "building",
  rig: "building",
  rigging: "building",
  layout: "building",
  build: "building",
  building: "building",
  lookdev: "building",
  animate: "animating",
  animating: "animating",
  mixamo: "animating",
  cascadeur: "animating",
  motion: "animating",
  camera: "animating",
  render: "rendering",
  rendering: "rendering",
  encode: "rendering",
  composite: "rendering",
  report: "rendering",
  ready: "ready",
  failed: "failed",
};

export function statusForStage(stage) {
  return STAGE_TO_STATUS[String(stage ?? "").toLowerCase()] ?? null;
}

/** A file-system-safe folder name for a project: "tiny-robot-city-1a2b3c4d". */
export function jobFolderName(title, id) {
  const slug = String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "video"}-${String(id).replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Poll the job folder and call back with only what changed. Returns { stop }. */
export function watchJob({ jobDir, intervalMs = 3000, onChange }) {
  const dir = path.join(jobDir, "studio");
  let lastStatus = "";
  let lastReport = "";
  const seenStills = new Set();
  let stopped = false;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const status = await readJson(path.join(dir, "status.json"));
      const key = JSON.stringify(status);
      if (status && key !== lastStatus) {
        lastStatus = key;
        await onChange({ type: "status", status: statusForStage(status.stage), note: status.note });
      }

      let names = [];
      try {
        names = (await fs.readdir(path.join(dir, "stills"))).filter((n) => /\.(png|jpe?g|webp)$/i.test(n)).sort();
      } catch {
        /* none yet */
      }
      const fresh = names.filter((n) => !seenStills.has(n));
      if (fresh.length) {
        const captions = (await readJson(path.join(dir, "stills", "captions.json"))) ?? {};
        for (const name of fresh) {
          const file = path.join(dir, "stills", name);
          // Skip a file still being written: its size must hold still.
          const a = (await fs.stat(file)).size;
          await new Promise((r) => setTimeout(r, 400));
          const b = (await fs.stat(file)).size;
          if (!a || a !== b) continue;
          seenStills.add(name);
          const cap = captions[name];
          await onChange({ type: "still", file, caption: typeof cap === "string" ? cap : cap?.caption, sceneId: cap?.sceneId });
        }
      }

      const report = await readJson(path.join(dir, "report.json"));
      const reportKey = JSON.stringify(report);
      if (report && reportKey !== lastReport) {
        lastReport = reportKey;
        await onChange({ type: "report", report });
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
      clearInterval(timer);
      // One last pass so a report written in the final second is not missed.
      await tick();
      stopped = true;
    },
  };
}

/** The rendered video a report points at, resolved and checked. */
export async function resolveVideo(jobDir, report) {
  const candidates = [report?.video, report?.outputPath, "studio/render/final.mp4"]
    .filter((v) => typeof v === "string" && v)
    .map((v) => (path.isAbsolute(v) ? v : path.join(jobDir, v.startsWith("studio") ? v : path.join("studio", v))));
  for (const file of candidates) {
    try {
      const s = await fs.stat(file);
      if (s.isFile() && s.size > 0) return file;
    } catch {
      /* try the next */
    }
  }
  return null;
}
