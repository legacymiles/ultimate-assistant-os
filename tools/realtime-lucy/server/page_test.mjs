// Drive the real /apps/realtime-lucy page in Chromium with a fake camera
// (Chromium's --use-fake-device-for-media-stream test pattern, or a Y4M/MJPEG
// file via FAKE_VIDEO=path) against a running Lucy server, click "Go live",
// and report the live numbers the page shows.
//
//   node tools/realtime-lucy/server/page_test.mjs http://localhost:3233/apps/realtime-lucy
//
// Uses whatever `playwright` is resolvable from PLAYWRIGHT_DIR (default
// ~/node_modules) so the hub itself does not need Playwright installed.

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url = process.argv[2] ?? "http://localhost:3233/apps/realtime-lucy";
const seconds = Number(process.argv[3] ?? 40);
const pwDir = process.env.PLAYWRIGHT_DIR ?? path.join(os.homedir(), "node_modules");
const require = createRequire(path.join(pwDir, "package.json"));
const { chromium } = require("playwright");

const args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
if (process.env.FAKE_VIDEO) args.push(`--use-file-for-fake-video-capture=${process.env.FAKE_VIDEO}`);

const browser = await chromium.launch({ headless: true, args });
const ctx = await browser.newContext({ permissions: ["camera"], viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(url, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Go live" }).waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Go live" }).click();
console.log("clicked Go live; waiting", seconds, "s");
await page.waitForTimeout(seconds * 1000);

const numbers = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll("dl dt").forEach((dt) => {
    out[dt.textContent.trim()] = dt.nextElementSibling?.textContent.trim();
  });
  const vids = [...document.querySelectorAll("video")].map((v) => ({
    w: v.videoWidth, h: v.videoHeight, playing: !v.paused && v.readyState >= 2, t: v.currentTime,
  }));
  const caption = document.querySelector("figure:nth-of-type(2) figcaption")?.textContent.trim();
  return { numbers: out, videos: vids, caption, error: document.querySelector("p.text-red-400")?.textContent };
});
console.log(JSON.stringify(numbers, null, 1));
await page.screenshot({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bench", "page-test.png") });
if (consoleErrors.length) console.log("console errors:", consoleErrors.slice(0, 5));
await browser.close();

const gen = numbers.videos[1];
const ok = gen && gen.w > 0 && gen.t > 1 && /\d/.test(numbers.numbers["Generated fps"] ?? "");
console.log("RESULT:", ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
