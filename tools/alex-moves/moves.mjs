// Alex's moves — the clips that make the real face look alive.
//
// LiveTalking (C:\dev\livetalking, wav2lip) only redraws the MOUTH. Everything
// else Alex does — blinking, glancing at chat, sipping coffee, laughing — has
// to be in the video it plays. This renders those videos free on the owner's
// GPU with WanGP (Flux 2 Klein for the base picture, MiniMax H3 FL2VA for the
// motion) and installs them into LiveTalking:
//
//   node tools/alex-moves/moves.mjs base             wider chest-up picture of Alex at a desk
//   node tools/alex-moves/moves.mjs render [ids…]    one H3 clip per move (skips ones already made)
//   node tools/alex-moves/moves.mjs install          talk → avatar `alex_live`; idle + actions → action clips
//
// Every clip starts AND ends on the base picture (FL2VA start = end), so any
// clip can follow any other without a jump. WanGP's MCP server must be up on
// :42004 (see tools/h3-render/README.md), and LiveTalking must be stopped while
// rendering — both don't fit in 6 GB.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import http from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const OUT = resolve(HERE, "out");
const LT = process.env.LIVETALKING_DIR || "C:/dev/livetalking";
const SPEC = JSON.parse(readFileSync(join(HERE, "clips.json"), "utf8"));
const BASE = join(OUT, "base.png");

const TURBO_FL2VA =
  "https://huggingface.co/DeepBeepMeep/MiniMax-H3/resolve/main/loras/minimax_h3_lightx2v_fl2v_turbo_4step_alpha16_v0.1.safetensors";

/** Action clips get LiveTalking audiotypes 2, 3, … in clips.json order; the quiet loop is 1. */
export function audiotypes(clips) {
  const map = {};
  let next = 2;
  for (const c of clips) {
    if (c.use === "quiet") map[c.id] = 1;
    else if (c.use === "action") map[c.id] = next++;
  }
  return map;
}

// ----- WanGP over MCP (raw http: a render holds the request open for minutes) --
let sessionId = null;
let rpcId = 0;
function rpc(method, params, notify = false) {
  const body = JSON.stringify(notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params });
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "Content-Length": Buffer.byteLength(body) };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return new Promise((ok, fail) => {
    const req = http.request({ host: "127.0.0.1", port: 42004, path: "/mcp", method: "POST", headers }, (res) => {
      if (res.headers["mcp-session-id"]) sessionId = res.headers["mcp-session-id"];
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (notify) return ok(null);
        const line = data.split("\n").filter((l) => l.startsWith("data:")).pop();
        try { ok(JSON.parse(line ? line.slice(5) : data)); } catch { ok({ raw: data.slice(0, 800) }); }
      });
    });
    req.setTimeout(0);
    req.on("error", fail);
    req.end(body);
  });
}

async function wangp(source) {
  if (!sessionId) {
    try {
      await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "alex-moves", version: "1" } });
    } catch {
      throw new Error("WanGP isn't running on :42004 — start it (tools/h3-render/README.md).");
    }
    await rpc("notifications/initialized", {}, true);
  }
  const r = await rpc("tools/call", { name: "wangp_generate", arguments: { action: "generate", arguments: { source } } });
  const text = (r?.result?.content ?? []).map((c) => c.text).join("\n");
  let result;
  try { result = JSON.parse(text).result; } catch { throw new Error(`WanGP: ${text.slice(0, 600)}`); }
  if (!result?.success) throw new Error(`WanGP failed: ${JSON.stringify(result?.errors ?? text).slice(0, 600)}`);
  return result.generated_files[0];
}

const secs = (t) => ((Date.now() - t) / 1000).toFixed(0);

async function base() {
  const t = Date.now();
  const file = await wangp({
    model_type: "flux2_klein_4b",
    prompt: SPEC.base.prompt,
    resolution: SPEC.base.size,
    num_inference_steps: 4,
    multi_prompts_gen_type: "FG",
    image_refs: [resolve(ROOT, SPEC.base.ref)],
    video_prompt_type: "KI",
    seed: Number(process.env.SEED ?? 20261125),
  });
  copyFileSync(file, BASE);
  console.log(`base picture → ${BASE} (${secs(t)} s)`);
}

async function render(ids) {
  if (!existsSync(BASE)) throw new Error("No base picture yet — run `moves.mjs base` first.");
  const todo = SPEC.clips.filter((c) => (ids.length ? ids.includes(c.id) : !existsSync(join(OUT, `${c.id}.mp4`))));
  for (const c of todo) {
    const t = Date.now();
    console.log(`rendering ${c.id}…`);
    const file = await wangp({
      model_type: "minimax_h3_fl2va_pruned",
      prompt: c.prompt,
      resolution: "480x832",
      video_length: 124, // ~5.2 s at 24 fps; H3 wants 107 + 17k frames
      seed: Number(c.seed ?? 4242),
      num_inference_steps: 4,
      guidance_scale: 1,
      flow_shift: 12,
      loras_multipliers: "1.0",
      activated_loras: [TURBO_FL2VA],
      config: "gguf_q2_k,int8_convrot,lower_ram",
      // Start AND end on the same picture: every clip returns to the pose the
      // next one starts from, so the cuts between them don't jump.
      image_start: [BASE],
      image_end: [BASE],
      image_prompt_type: "SE",
    });
    copyFileSync(file, join(OUT, `${c.id}.mp4`));
    console.log(`  ${c.id} done in ${secs(t)} s`);
  }
}

/** 540x960 at 25 fps — LiveTalking's frame size and clock. */
const FIT = "fps=25,scale=540:960:force_original_aspect_ratio=increase,crop=540:960";

function install() {
  const types = audiotypes(SPEC.clips);
  const talk = SPEC.clips.find((c) => c.use === "talking");
  if (!existsSync(join(OUT, `${talk.id}.mp4`))) throw new Error("The talking clip isn't rendered yet.");

  // Talking base: rebuilt as LiveTalking avatar `alex_live` (a face box per frame).
  const src = join(LT, "data", "source", "alex_live.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(OUT, `${talk.id}.mp4`), "-vf", FIT, "-an", src]);
  rmSync(join(LT, "data", "avatars", "alex_live"), { recursive: true, force: true });
  execFileSync(join(LT, ".venv", "Scripts", "python.exe"),
    ["avatars/wav2lip/genavatar.py", "--video_path", "data/source/alex_live.mp4", "--img_size", "256", "--avatar_id", "alex_live"],
    { cwd: LT, env: { ...process.env, PYTHONPATH: ".", PYTHONIOENCODING: "utf-8" }, stdio: "inherit" });

  // Quiet loop + actions: frames named 0.jpg, 1.jpg … (LiveTalking sorts them
  // as numbers), and for actions a 16 kHz wav whose length decides how long
  // the action plays — H3's own sound (the sip, the laugh) rides along.
  const config = [];
  for (const c of SPEC.clips) {
    const type = types[c.id];
    if (!type) continue;
    const mp4 = join(OUT, `${c.id}.mp4`);
    if (!existsSync(mp4)) { console.log(`  skip ${c.id} (not rendered)`); continue; }
    const dir = join(LT, "data", "customvideo", "alex", c.id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-vf", FIT, "-q:v", "2", "-start_number", "0", join(dir, "%d.jpg")]);
    const entry = { audiotype: type, imgpath: `data/customvideo/alex/${c.id}` };
    if (type > 1) {
      const frames = readdirSync(dir).length;
      const wav = join(LT, "data", "customvideo", "alex", `${c.id}.wav`);
      // Exactly as long as the frames (40 ms each), so the action plays once.
      // H3 invents a soundtrack: a sip or a laugh is worth keeping (softer than
      // his voice); for a wave it can be a made-up mumble, so `"sound": false`
      // makes that clip silent.
      const length = (frames / 25).toFixed(2);
      execFileSync("ffmpeg", c.sound === false
        ? ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", length, wav]
        : ["-v", "error", "-y", "-i", mp4, "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
          "-filter_complex", "[0:a]volume=0.4[s];[s][1:a]amix=inputs=2:duration=longest:normalize=0[a]", "-map", "[a]",
          "-ar", "16000", "-ac", "1", "-t", length, wav]);
      entry.audiopath = `data/customvideo/alex/${c.id}.wav`;
    }
    config.push(entry);
    console.log(`  ${c.id} → audiotype ${type}`);
  }
  writeFileSync(join(LT, "data", "alex_moves.json"), JSON.stringify(config, null, 2));
  console.log("\nStart LiveTalking with:\n  .venv/Scripts/python.exe app.py --transport webrtc --model wav2lip --avatar_id alex_live --modelres 256 --customvideo_config data/alex_moves.json --REF_FILE en-US-AndrewNeural --listenport 8010");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  mkdirSync(OUT, { recursive: true });
  const [cmd, ...rest] = process.argv.slice(2);
  const run = { base, render: () => render(rest), install: async () => install() }[cmd];
  if (!run) {
    console.error("usage: moves.mjs base | render [ids…] | install");
    process.exit(2);
  }
  run().catch((e) => { console.error(e.message); process.exit(1); });
}
