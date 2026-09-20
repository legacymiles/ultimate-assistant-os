#!/usr/bin/env node
// Video Studio Arena runner — runs on the PC that has the engines.
//
//   npm run runner        keep asking the hub for jobs and render them
//   npm run runner:once   render at most one job, then exit
//
// Four of the five engines (Remotion, HyperFrames, Unreal, Blender) need a
// real local install, so the website cannot render them itself. It queues the
// job; this program claims it, runs Claude Code with that engine's skill in a
// per-project folder, uploads each scene as it lands, and reports the real
// status — including the real error when something fails.

import { promises as fs } from "node:fs";
import path from "node:path";

import { config, configProblem } from "./lib/env.mjs";
import { Hub } from "./lib/hub.mjs";
import { runClaude } from "./lib/claude.mjs";
import { buildPrompt, readStatusLine } from "./lib/prompt.mjs";
import { watchOutput } from "./lib/watch.mjs";

const cfg = config();
const once = process.argv.includes("--once");
const hub = new Hub(cfg);

const log = (...args) => console.log(new Date().toLocaleTimeString(), ...args);

async function renderJob(job) {
  const dir = path.join(cfg.workDir, job.projectId);
  const out = path.join(dir, "out");
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(dir, "job.json"), JSON.stringify(job, null, 2));

  const engines = job.methods.map((m) => m.name).join(", ");
  log(`Rendering "${job.title}" (${job.sceneIndexes.length} scene(s), ${engines}) in ${dir}`);

  await hub.progress(job.projectId, {
    step: { id: "claim", state: "done", label: "Runner picked up the job", detail: engines },
    log: `Runner started in ${dir}`,
  });

  const watcher = watchOutput(out, async (which, file) => {
    log(`Uploading ${which === "final" ? "the final video" : `scene ${which}`}…`);
    await hub.uploadClip(job.projectId, which, file, { jobId: job.jobId, renderedBy: engines });
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.jobTimeoutMinutes * 60_000);

  let result;
  try {
    result = await runClaude({
      prompt: buildPrompt(job, dir),
      cwd: dir,
      model: cfg.model,
      openrouterKey: cfg.openrouterKey,
      signal: controller.signal,
      onLine: (line) => {
        log("  ", line);
        const status = readStatusLine(line);
        if (status) {
          void hub.progress(job.projectId, {
            step: { id: `scene-${status.sceneIndex}`, state: "running", detail: status.detail },
          });
        }
      },
    });
  } finally {
    clearTimeout(timer);
    watcher.stop();
  }

  // A clip written in the last seconds of the run still counts.
  await watcher.flush().catch((err) => log("upload failed:", err.message));

  if (!result.ok) {
    log("Failed:", result.error);
    await hub.fail(job.projectId, result.error, { jobId: job.jobId });
    return;
  }

  if (watcher.uploaded.size === 0) {
    const error =
      "The session finished without writing any video to out/. " +
      (result.summary || "Check the runner log for what it reported.");
    log("Failed:", error);
    await hub.fail(job.projectId, error, { jobId: job.jobId });
    return;
  }

  log(`Done — uploaded ${watcher.uploaded.size} file(s).`);
  await hub.progress(job.projectId, { log: result.summary || "Render finished." });
}

async function loop() {
  const problem = configProblem(cfg);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  log(`Runner up. Hub ${cfg.hubUrl}, work dir ${cfg.workDir}.`);
  for (;;) {
    let job = null;
    try {
      job = await hub.claim();
    } catch (err) {
      log("claim failed:", err.message);
    }

    if (job) {
      try {
        await renderJob(job);
      } catch (err) {
        log("job crashed:", err.message);
        await hub.fail(job.projectId, `The runner crashed: ${err.message}`, { jobId: job.jobId });
      }
      if (once) return;
    } else if (once) {
      log("Nothing queued.");
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, cfg.pollSeconds * 1000));
  }
}

loop().catch((err) => {
  console.error(err);
  process.exit(1);
});
