#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Send one real render to the endpoint and report what happened.
//
// This is the test that no amount of local checking can replace: whether the
// graph the worker assembles is actually accepted by a live ComfyUI holding
// real H3 weights. Everything up to this point is inference from docs.
//
//   node runpod/smoke-test.mjs            5s draft clip, cheapest useful test
//   node runpod/smoke-test.mjs --full     full 768p canvas
//
// It prints the progress notes the worker emits, so a long cold start reads
// as "fetching weights" rather than silence, and writes any returned clip to
// runpod/smoke-test-output.mp4.
// ---------------------------------------------------------------------------

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FULL = process.argv.includes("--full");
// --ref <file> renders in reference mode, which is what Auteur uses to keep a
// character or a look consistent across shots. It needs a second transformer,
// so the first reference render downloads about 23 GB more.
const REF = (() => {
  const i = process.argv.indexOf("--ref");
  return i >= 0 ? process.argv[i + 1] : null;
})();

const fileEnv = (() => {
  const p = resolve(ROOT, ".env.local");
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
})();

const KEY = process.env.RUNPOD_API_KEY || fileEnv.RUNPOD_API_KEY;
const ID = process.env.RUNPOD_ENDPOINT_ID || fileEnv.RUNPOD_ENDPOINT_ID;
if (!KEY || !ID) {
  console.error("Need RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in .env.local");
  process.exit(1);
}

const BASE = `https://api.runpod.ai/v2/${ID}`;
const headers = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "User-Agent": "auteur-smoke/1.0",
};

// A brief in H3's own shape: it wants a production brief, not a caption.
const PROMPT = [
  "integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium",
  "close-up frames an elderly fisherman in a yellow oilskin coat at the stern of",
  "a small boat, grey morning sea behind him. The camera pushes in with small",
  "amplitude at slow speed toward his face. He looks out at the water, then",
  "almost smiles. Lighting: flat overcast daylight, soft and cold. No subtitles,",
  "no on-screen text, no logos, no extra people.",
  "overall_soundscape: waves slapping the hull, wind across the microphone, a",
  "distant gull, rope creaking. No dialogue, no music in the ambience.",
  "non_diegetic_music: a single sustained cello note, very slow, soft dynamics.",
].join(" ");

// H3's reference form is six labelled sections, and the reference is named
// <Subject 1> so the model knows which parts to hold on to.
const REF_PROMPT = [
  "subject_definitions:",
  "<Subject 1> is a floating arena: a dark teal circular platform rimmed with",
  "glowing cyan light, surrounded by drifting capsule-shaped objects in hot pink,",
  "cyan and orange, against a deep magenta-to-pink gradient background.",
  "Retention: fully_preserved.",
  "summary: [reference generation] A slow orbit around the floating arena while",
  "the objects drift and turn.",
  "retention_analysis:",
  "<Subject 1> (appears in [Shot 1]): fully_preserved - the magenta-and-cyan",
  "palette, the glowing rim of the platform and the floating capsule objects are",
  "retained.",
  "detailed_description: [Shot 1] Stylised 3D rendered look, a wide shot frames",
  "the floating arena of <Subject 1> suspended in empty space. The camera orbits",
  "slowly around it with medium amplitude at slow speed as the capsule objects",
  "drift and tumble around the platform. Lighting: the cyan rim glows against the",
  "magenta background, soft bloom. No subtitles, no on-screen text, no logos.",
  "overall_soundscape: a low airy hum, soft chimes as objects drift past, distant",
  "resonant tones. No dialogue.",
  "non_diegetic_music: a slow synth pad with a gentle arpeggio, soft dynamics.",
].join(" ");

function referencePayload() {
  if (!REF) return null;
  if (!existsSync(REF)) {
    console.error(`Reference image not found: ${REF}`);
    process.exit(1);
  }
  const mime =
    { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[
      extname(REF).toLowerCase()
    ] || "image/png";
  const b64 = readFileSync(REF).toString("base64");
  return [{ label: "Subject 1", kind: "image", data_url: `data:${mime};base64,${b64}` }];
}

const started = Date.now();
const mins = () => ((Date.now() - started) / 60000).toFixed(1);

async function main() {
  const references = referencePayload();
  console.log(
    `Submitting a ${FULL ? "full 768p" : "draft"} 5s ${references ? "REFERENCE" : "text"} render to ${ID}…`,
  );
  if (references) {
    const mb = (references[0].data_url.length / 1.37 / 1e6).toFixed(1);
    console.log(`  reference: ${REF} (${mb} MB)`);
    console.log("  a first reference render also fetches ~23 GB for the reference model\n");
  } else {
    console.log("");
  }

  const res = await fetch(`${BASE}/run`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      input: {
        prompt: references ? REF_PROMPT : PROMPT,
        ...(references ? { references } : {}),
        duration: 5,
        aspect_ratio: "16:9",
        resolution: FULL ? "768P" : "draft",
        turbo: true,
        seed: 1101,
      },
    }),
  });
  const started_job = await res.json();
  if (!res.ok || !started_job.id) {
    console.error("Submit failed:", res.status, JSON.stringify(started_job).slice(0, 600));
    process.exit(1);
  }
  const jobId = started_job.id;
  console.log(`job ${jobId} — ${started_job.status}\n`);

  let lastNote = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 10_000));
    const s = await fetch(`${BASE}/status/${jobId}`, { headers });
    const d = await s.json().catch(() => ({}));
    const status = d.status || "?";

    // Progress notes arrive on the stream; show only changes.
    const stream = Array.isArray(d.stream) ? d.stream : [];
    const note =
      (stream.length && (stream[stream.length - 1]?.output?.note || stream[stream.length - 1]?.output)) ||
      d.output?.note ||
      "";
    const text = typeof note === "string" ? note : JSON.stringify(note);
    if (text && text !== lastNote) {
      lastNote = text;
      console.log(`  [${mins()}m] ${text}`);
    }

    if (status === "COMPLETED") {
      const out = d.output || {};
      if (out.error) {
        console.error(`\nFAILED after ${mins()}m — the worker reported:\n\n${out.error}\n`);
        process.exit(2);
      }
      console.log(`\nCOMPLETED in ${mins()}m`);
      console.log("  delayTime", d.delayTime, "ms | executionTime", d.executionTime, "ms");
      for (const k of ["width", "height", "frames", "seconds", "steps", "mode", "bytes", "boot"]) {
        if (out[k] !== undefined) console.log(`  ${k}:`, out[k]);
      }
      if (out.video_base64) {
        const path = resolve(ROOT, `runpod/smoke-test-output${REF ? "-ref" : ""}.mp4`);
        writeFileSync(path, Buffer.from(out.video_base64, "base64"));
        console.log(`\n  wrote ${path}`);
      } else if (out.video_url) {
        console.log("\n  video_url:", out.video_url);
      }
      const billedS = (Number(d.delayTime || 0) + Number(d.executionTime || 0)) / 1000;
      console.log(`\n  billed worker time ~${billedS.toFixed(0)}s ≈ $${(billedS * (1.58 / 3600)).toFixed(3)} on a 5090`);
      return;
    }
    if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(status)) {
      console.error(`\n${status} after ${mins()}m`);
      console.error(JSON.stringify(d).slice(0, 1500));
      process.exit(2);
    }
    if (Date.now() - started > 45 * 60_000) {
      console.error(`\nGiving up after ${mins()}m. Job ${jobId} may still be running.`);
      process.exit(3);
    }
  }
}

main().catch((e) => {
  console.error("smoke test error:", e.message);
  process.exit(1);
});
