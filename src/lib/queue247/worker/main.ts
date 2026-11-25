// ---------------------------------------------------------------------------
// Worker entry point. Bundled to tools/queue-worker/dist/worker.mjs by
// tools/queue-worker/build.mjs and run on the VPS under Docker
// (restart: always) — see tools/queue-worker/README.md.
//
//   node dist/worker.mjs            run forever
//   node dist/worker.mjs --doctor   print what this machine can do, then exit
//   node dist/worker.mjs --once     claim and run at most one step, then exit
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { queueDb, queueDbConfigured, NO_DB_MESSAGE } from "../server/db";
import { aiReady } from "../server/ai";
import type { Capability } from "../types";
import { QueueWorker } from "./runtime";

const run = promisify(execFile);
const VERSION = process.env.QUEUE_WORKER_VERSION || "dev";

async function has(bin: string, args: string[]): Promise<boolean> {
  try {
    await run(bin, args, { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<Capability[]> {
  const caps: Capability[] = ["web"];
  if (aiReady()) caps.push("ai");
  if (queueDbConfigured()) caps.push("storage");
  if (await has(process.env.FFMPEG_PATH || "ffmpeg", ["-version"])) caps.push("ffmpeg");
  if (await has(process.env.YTDLP_PATH || "yt-dlp", ["--version"])) caps.push("ytdlp");
  if (process.env.QUEUE_MT4 === "1") caps.push("mt4");
  if (process.env.QUEUE_SHELL === "1") caps.push("shell");
  const only = (process.env.QUEUE_CAPABILITIES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return only.length ? caps.filter((c) => only.includes(c)) : caps;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const caps = await detectCapabilities();
  const id = process.env.QUEUE_WORKER_ID || `${os.hostname()}-${process.pid}`;
  if (args.has("--doctor")) {
    console.log(JSON.stringify({ id, version: VERSION, capabilities: caps, database: queueDbConfigured(), ai: aiReady(), node: process.version }, null, 2));
    return;
  }
  if (!queueDbConfigured()) {
    console.error(NO_DB_MESSAGE);
    process.exit(2);
  }
  const worker = new QueueWorker(queueDb(), {
    id,
    host: process.env.QUEUE_WORKER_HOST || os.hostname(),
    capabilities: caps,
    concurrency: Math.max(1, Math.min(16, Number(process.env.QUEUE_CONCURRENCY) || 3)),
    pollMs: Math.max(1000, Number(process.env.QUEUE_POLL_MS) || 5000),
    version: VERSION,
    maxRssMb: Math.max(256, Number(process.env.QUEUE_MAX_RSS_MB) || 1536),
  });
  const shutdown = () => {
    void worker.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("unhandledRejection", (e) => console.error("unhandled rejection:", e));
  if (args.has("--once")) {
    setTimeout(() => void worker.stop().then(() => process.exit(0)), 5 * 60_000);
  }
  await worker.start();
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
