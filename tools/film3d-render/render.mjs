#!/usr/bin/env node
// ---------------------------------------------------------------------------
// film3d-render — make the HD MP4 of a 3D Animation Flow film on this PC.
//
// The website's 3D Animation Flow plays and renders films in the browser.
// This renders the SAME film (same engine, same frames) bigger and sharper:
// it bundles src/lib/studio/film3d/capture.ts with esbuild, drives it in a
// headless Chromium, pipes every frame into ffmpeg and muxes the score.
//
//   node render.mjs --brief request.txt --out film.mp4          the In Queue request's text
//   node render.mjs --film film.json    --out film.mp4          a Film3D (or its compact code)
//   options: --size 1080 (short edge) --fps 30 --stills <dir> (one still per beat)
//            --model hero.glb (a rigged GLB, e.g. from Mixamo, used as the hero)
//   node render.mjs --doctor                                    check this PC
//
// Needs: Node 18+, ffmpeg on PATH, Playwright's Chromium (npx playwright
// install chromium) or Google Chrome. CHROMIUM_PATH overrides the browser.
// ---------------------------------------------------------------------------

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const entry = path.join(repo, "src", "lib", "studio", "film3d", "capture.ts");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);
const say = (...a) => console.log(...a);
const fail = (msg) => {
  console.error(`\n✘ ${msg}\n`);
  process.exit(1);
};

function which(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

async function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return (await import(name)).chromium;
    } catch {
      /* next */
    }
  }
  return null;
}

async function launch() {
  const chromium = await loadPlaywright();
  if (!chromium) fail("Playwright isn't installed here. Run: npm install   (in tools/film3d-render)");
  const args = ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=" + (process.env.FILM3D_ANGLE || (process.platform === "linux" ? "swiftshader" : "default")), "--autoplay-policy=no-user-gesture-required"];
  const tries = process.env.CHROMIUM_PATH
    ? [{ executablePath: process.env.CHROMIUM_PATH }]
    : [{}, { channel: "chrome" }, { channel: "msedge" }];
  let last;
  for (const t of tries) {
    try {
      return await chromium.launch({ headless: true, args, ...t });
    } catch (e) {
      last = e;
    }
  }
  fail(`Couldn't start a browser. Run: npx playwright install chromium\n  (${String(last?.message ?? last).split("\n")[0]})`);
}

async function bundle() {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    fail("esbuild isn't installed. Run: npm install   (in tools/film3d-render)");
  }
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    write: false,
    minify: true,
    nodePaths: [path.join(repo, "node_modules"), path.join(here, "node_modules")],
    logLevel: "silent",
  });
  return out.outputFiles[0].text;
}

function readFilmInput() {
  const briefPath = arg("brief");
  const filmPath = arg("film");
  if (!briefPath && !filmPath) fail("Give me the film: --brief <request.txt> or --film <film.json>.");
  const text = readFileSync(briefPath || filmPath, "utf8");
  if (briefPath) {
    const i = text.indexOf('{"v":1');
    if (i < 0) fail("That request has no FILM block. It must come from Jarvis › Studio › 3D Animation Flow.");
    return text.slice(i).split(/\r?\n/)[0].trim();
  }
  return text.trim();
}

async function doctor() {
  const ff = which("ffmpeg");
  const pw = await loadPlaywright();
  say("\n3D Animation Flow — this PC\n");
  say(` ${process.versions.node.split(".")[0] >= 18 ? "✔" : "✘"} Node        ${process.version}`);
  say(` ${ff ? "✔" : "✘"} ffmpeg      ${ff ?? "missing — Windows: winget install --id Gyan.FFmpeg -e"}`);
  say(` ${pw ? "✔" : "✘"} Playwright  ${pw ? "installed" : "missing — npm install (in tools/film3d-render)"}`);
  say(` ${existsSync(entry) ? "✔" : "✘"} Engine      ${entry}`);
  if (pw) {
    const browser = await launch();
    const page = await browser.newPage();
    const gl = await page.evaluate(() => {
      const c = document.createElement("canvas");
      const g = c.getContext("webgl2") || c.getContext("webgl");
      if (!g) return null;
      const ext = g.getExtension("WEBGL_debug_renderer_info");
      return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "webgl ok";
    });
    say(` ${gl ? "✔" : "✘"} WebGL       ${gl ?? "not available in the headless browser"}`);
    await browser.close();
  }
  say("");
}

async function main() {
  if (has("doctor")) return doctor();
  const out = path.resolve(arg("out", "film.mp4"));
  const short = Number(arg("size", "1080"));
  const fps = Number(arg("fps", "30"));
  const stills = arg("stills");
  const model = arg("model");
  if (!which("ffmpeg")) fail("ffmpeg isn't on PATH. Windows: winget install --id Gyan.FFmpeg -e  (then open a new terminal).");

  let film = readFilmInput();
  if (model) {
    if (!existsSync(model)) fail(`No model at ${model}.`);
    const parsed = JSON.parse(film);
    parsed.hero = { ...(parsed.hero ?? {}), model: "https://film3d.local/hero.glb" };
    film = JSON.stringify(parsed);
  }

  say("• Bundling the film engine…");
  const code = await bundle();
  say("• Starting the browser…");
  const browser = await launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("  page error:", e.message));
  if (model) {
    await page.route("https://film3d.local/hero.glb", (route) => route.fulfill({ status: 200, contentType: "model/gltf-binary", body: readFileSync(model), headers: { "Access-Control-Allow-Origin": "*" } }));
  }
  await page.setContent("<!doctype html><html><body style='margin:0;background:#000'></body></html>");
  await page.addScriptTag({ content: code });
  const info = await page.evaluate(([f, s]) => globalThis.film3d.load(f, s), [film, short]);
  const frames = Math.round(info.seconds * fps);
  say(`• "${info.title}" — ${info.width}×${info.height}, ${info.seconds.toFixed(1)} s, ${info.beats} beats, ${frames} frames`);

  const work = mkdtempSync(path.join(tmpdir(), "film3d-"));
  const wav = path.join(work, "score.wav");
  say("• Composing the score…");
  writeFileSync(wav, Buffer.from(await page.evaluate(() => globalThis.film3d.score()), "base64"));

  if (stills) {
    mkdirSync(stills, { recursive: true });
    const moments = await page.evaluate(() => globalThis.film3d.moments());
    for (let i = 0; i < moments.length; i++) {
      const b64 = await page.evaluate((t) => globalThis.film3d.frame(t, 0.9), moments[i]);
      writeFileSync(path.join(stills, `beat-${String(i + 1).padStart(2, "0")}-${moments[i].toFixed(1)}s.jpg`), Buffer.from(b64, "base64"));
    }
    say(`• ${moments.length} stills → ${stills}`);
  }

  mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-",
    "-i", wav,
    "-c:v", "libx264", "-preset", process.env.FILM3D_PRESET || "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
    out,
  ], { stdio: ["pipe", "inherit", "inherit"] });
  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${c}`))));
  });

  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    const b64 = await page.evaluate((t) => globalThis.film3d.frame(t, 0.93), i / fps);
    if (!ff.stdin.write(Buffer.from(b64, "base64"))) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % fps === 0) process.stdout.write(`\r• Frames ${i}/${frames}  (${((Date.now() - t0) / 1000).toFixed(0)} s)   `);
  }
  ff.stdin.end();
  await done;
  await browser.close();
  process.stdout.write("\n");
  const mb = (statSync(out).size / 1e6).toFixed(1);
  say(`✔ ${out}  (${mb} MB, ${info.width}×${info.height}, ${info.seconds.toFixed(1)} s)`);
  console.log(JSON.stringify({ ok: true, out, width: info.width, height: info.height, seconds: info.seconds, frames, mb: Number(mb) }));
}

main().catch((e) => fail(e?.message ?? String(e)));
