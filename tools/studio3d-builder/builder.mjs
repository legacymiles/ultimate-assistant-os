#!/usr/bin/env node
// 3D Studio builder — runs on the PC that has Blender (and optionally Cascadeur
// and a Mixamo clip library).
//
//   npm run builder          keep checking the hub for queued videos and produce them
//   npm run builder:once     produce at most one video, then exit
//   npm run doctor           show what this PC has for the studio, then exit
//
// For each video: claim it, write job.json into a job folder, run Claude Code
// headless with the animation-director skill, stream Claude's progress and the
// job folder's files (stills, report) back to the hub, upload the final render,
// and mark the video ready or failed. One at a time — renders use the whole GPU.

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "./lib/env.mjs";
import { detectCapabilities } from "./lib/detect.mjs";
import { HubClient } from "./lib/hub.mjs";
import { buildPrompt, runClaude } from "./lib/claude.mjs";
import { jobFolderName, resolveVideo, watchJob } from "./lib/watch.mjs";

const cfg = config();
const once = process.argv.includes("--once");
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

async function doctor() {
  const caps = await detectCapabilities(cfg, { fresh: true });
  const tick = (ok) => (ok ? "✔" : "✘");
  console.log("\n3D Studio — this PC\n");
  console.log(` ${tick(caps.blender.found)} Blender        ${caps.blender.found ? `${caps.blender.version ?? "?"}  ${caps.paths.blender}` : "not found (install from blender.org or set BLENDER_PATH)"}`);
  console.log(` ${tick(caps.blenderMcp)} Blender MCP    ${caps.blenderMcp ? "registered" : "not registered (optional): claude mcp add blender -s user -- uvx blender-mcp"}`);
  console.log(` ${tick(caps.mixamo.clips.length > 0)} Mixamo clips   ${caps.mixamo.clips.length} in ${caps.paths.mixamoLibrary}`);
  console.log(` ${tick(caps.cascadeur.found)} Cascadeur      ${caps.cascadeur.found ? caps.paths.cascadeur : "not installed (optional — Blender fallback)"}`);
  console.log(` ${tick(caps.cascadeurMcp)} Cascadeur MCP  ${caps.cascadeurMcp ? "registered" : "not registered (optional)"}`);
  console.log(` ${tick(existsSync(path.join(cfg.skillDir, "SKILL.md")))} Skill          ${cfg.skillDir}`);
  console.log(` ${tick(Boolean(cfg.hubUrl && cfg.token))} Hub            ${cfg.hubUrl || "HUB_URL not set"}${cfg.token ? "" : " (BUILDER_TOKEN not set)"}\n`);
}

async function produce(hub, project) {
  log(`Producing "${project.plan?.title ?? project.prompt.slice(0, 60)}" (${project.id})`);
  const capabilities = await detectCapabilities(cfg);
  const jobDir = path.join(cfg.studioRoot, jobFolderName(project.plan?.title, project.id));
  await mkdir(path.join(jobDir, "studio", "stills"), { recursive: true });
  await mkdir(path.join(jobDir, "studio", "render"), { recursive: true });
  await writeFile(
    path.join(jobDir, "job.json"),
    JSON.stringify(
      {
        id: project.id,
        prompt: project.prompt,
        brief: project.brief,
        plan: project.plan,
        paths: {
          jobDir,
          blender: capabilities.paths.blender,
          cascadeur: capabilities.paths.cascadeur,
          mixamoLibrary: capabilities.paths.mixamoLibrary,
          skillScripts: path.join(cfg.skillDir, "scripts"),
        },
        capabilities: { ...capabilities, paths: undefined },
      },
      null,
      2,
    ),
  );

  if (!capabilities.blender.found) {
    await hub.fail(project.id, "Blender is not installed on the studio PC (or BLENDER_PATH is wrong). Install Blender from blender.org, then press Try again.");
    log("Failed: Blender not found");
    return;
  }

  await hub.progress(project.id, { status: "building", note: "Setting up the job", lines: [`Job folder: ${jobDir}`] });

  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const lines = pending.splice(0, 200);
    try {
      await hub.progress(project.id, { lines });
    } catch (err) {
      log("progress post failed:", err.message);
      pending.unshift(...lines.slice(-50));
    }
  };
  const flushTimer = setInterval(flush, 2000);

  let finalReport = null;
  const watcher = watchJob({
    jobDir,
    onChange: async (change) => {
      try {
        if (change.type === "status" && change.status) {
          const terminal = change.status === "ready" || change.status === "failed";
          await hub.progress(project.id, { status: terminal ? undefined : change.status, note: change.note });
        } else if (change.type === "still") {
          await hub.uploadMedia(project.id, "still", change.file, { caption: change.caption, sceneId: change.sceneId });
          log("uploaded", path.basename(change.file));
        } else if (change.type === "report") {
          finalReport = change.report;
        } else if (change.type === "error") {
          log("watch error:", change.error?.message ?? change.error);
        }
      } catch (err) {
        log(`sync ${change.type} failed:`, err.message);
      }
    },
  });

  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), cfg.maxMinutes * 60_000);
  const started = Date.now();
  const run = await runClaude({
    prompt: buildPrompt({ project, jobDir, capabilities }),
    cwd: jobDir,
    model: cfg.model,
    signal: limit.signal,
    onLine: (line) => {
      pending.push(line);
      if (process.stdout.isTTY) console.log("  ", line.slice(0, 160));
    },
  });
  clearTimeout(timer);
  await watcher.stop();
  clearInterval(flushTimer);
  await flush();

  const stage = String(finalReport?.stage ?? "").toLowerCase();
  if (stage === "ready") {
    const video = await resolveVideo(jobDir, finalReport);
    if (video) {
      await hub.progress(project.id, { status: "rendering", note: "Uploading the video", lines: [`Uploading ${video}`] });
      try {
        await hub.uploadMedia(project.id, "video", video);
        const report = { ...finalReport, outputPath: video, renderMinutes: finalReport.renderMinutes ?? (Date.now() - started) / 60_000 };
        await hub.progress(project.id, { status: "ready", note: "Video ready", report });
        log("Ready:", video);
        return;
      } catch (err) {
        await hub.fail(project.id, `The video rendered but could not be uploaded: ${err.message}\n\nIt is on the studio PC at ${video}`);
        log("Upload failed:", err.message);
        return;
      }
    }
    finalReport = { ...finalReport, stage: "failed", error: "report.json says ready, but no rendered video was found at studio/render/final.mp4." };
  }

  if (finalReport) await hub.progress(project.id, { report: finalReport }).catch(() => {});
  const reason = run.aborted
    ? `The render ran past the ${cfg.maxMinutes}-minute limit and was stopped.`
    : String(finalReport?.stage).toLowerCase() === "failed"
      ? finalReport.error ?? "The skill reported that production failed."
      : run.code !== 0
        ? `Claude Code exited with code ${run.code}.`
        : "Claude finished without writing a ready report.json.";
  await hub.fail(project.id, `${reason}\n\nLast output:\n${run.lastLines.slice(-20).join("\n")}`);
  log("Failed:", reason);
}

async function main() {
  if (process.argv.includes("--doctor")) return doctor();
  const hub = new HubClient(cfg);
  log(`Studio builder started. Hub: ${cfg.hubUrl}. Jobs: ${cfg.studioRoot}`);
  for (;;) {
    let project = null;
    try {
      project = await hub.claim(await detectCapabilities(cfg));
    } catch (err) {
      log("claim failed:", err.message);
    }
    if (project) {
      try {
        await produce(hub, project);
      } catch (err) {
        log("production crashed:", err);
        await hub.fail(project.id, `The studio builder crashed: ${err.message}`).catch(() => {});
      }
      if (once) return;
      continue;
    }
    if (once) {
      log("Nothing queued.");
      return;
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
