// Ship the 24/7 Queue worker to the VPS.
//
//   node tools/queue-worker/deploy.mjs            build, copy, (re)start
//   node tools/queue-worker/deploy.mjs --env      also (re)write the VPS .env
//                                                  from the hub's .env.local
//
// The VPS is Windows Server; Docker runs inside WSL2 Ubuntu. Files go to
// C:\queue-worker over scp, then WSL copies them to /opt/queue-worker and runs
// `docker compose up -d --build`. Commands are sent base64-encoded because
// quoting through ssh → cmd → wsl → bash mangles anything interesting
// (~/.claude/aios/connections.md).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const HOST = process.env.QUEUE_VPS_HOST || "Administrator@199.47.240.209";
const KEY = process.env.QUEUE_VPS_KEY || path.join(os.homedir(), ".ssh", "jarvis-vps");
const ssh = (cmd) => execFileSync("ssh", ["-i", KEY, "-o", "BatchMode=yes", HOST, cmd], { stdio: ["ignore", "pipe", "inherit"] }).toString();
const scp = (from, to) => execFileSync("scp", ["-i", KEY, "-o", "BatchMode=yes", "-r", ...from, `${HOST}:${to}`], { stdio: "inherit" });
const wsl = (script) => ssh(`wsl -d Ubuntu -u root -- bash -lc "echo ${Buffer.from(script).toString("base64")} | base64 -d | bash"`);

const WANT = [
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY", "OPENROUTER_SITE_URL", "AI_GATEWAY_API_KEY", "ORCAROUTER_API_KEY", "AI_MODEL",
  "SEARXNG_URL", "SEARXNG_TOKEN", "TAVILY_API_KEY", "JARVIS_GITHUB_TOKEN", "JARVIS_MCP_USER_ID",
];

function envFromHub() {
  const src = readFileSync(path.join(root, ".env.local"), "utf8");
  const vals = {};
  for (const line of src.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && WANT.includes(m[1]) && m[2].trim()) vals[m[1]] = m[2].trim().replace(/^"(.*)"$/, "$1");
  }
  // The owner's account id (for the CLI): from .env.local, or QUEUE_OWNER_ID when deploying.
  if (!vals.JARVIS_MCP_USER_ID && process.env.QUEUE_OWNER_ID) vals.JARVIS_MCP_USER_ID = process.env.QUEUE_OWNER_ID;
  vals.QUEUE_WORKER_ID = "vps-1";
  vals.QUEUE_CONCURRENCY = "3";
  vals.QUEUE_MAX_RSS_MB = "1536";
  return Object.entries(vals).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

console.log("building…");
execFileSync(process.execPath, [path.join(here, "build.mjs")], { stdio: "inherit" });

const stage = mkdtempSync(path.join(os.tmpdir(), "qw-"));
const files = [path.join(here, "dist"), path.join(here, "Dockerfile"), path.join(here, "docker-compose.yml")];
if (process.argv.includes("--env")) {
  const envPath = path.join(stage, ".env");
  writeFileSync(envPath, envFromHub(), { mode: 0o600 });
  files.push(envPath);
}
console.log("copying to the VPS…");
ssh("if not exist C:\\queue-worker mkdir C:\\queue-worker");
scp(files, "C:/queue-worker/");

console.log("starting the container…");
const out = wsl(`
set -e
mkdir -p /opt/queue-worker
cp -r /mnt/c/queue-worker/dist /mnt/c/queue-worker/Dockerfile /mnt/c/queue-worker/docker-compose.yml /opt/queue-worker/
if [ -f /mnt/c/queue-worker/.env ]; then cp /mnt/c/queue-worker/.env /opt/queue-worker/.env && chmod 600 /opt/queue-worker/.env && rm -f /mnt/c/queue-worker/.env; fi
# SearXNG runs on this same VPS: its token never leaves the machine.
if ! grep -q '^SEARXNG_URL=' /opt/queue-worker/.env && [ -f /opt/searxng/.jarvis-token ]; then
  printf 'SEARXNG_URL=https://search.bighomieai.com
SEARXNG_TOKEN=%s
' "$(cat /opt/searxng/.jarvis-token)" >> /opt/queue-worker/.env
fi
cd /opt/queue-worker
docker compose up -d --build 2>&1 | tail -5
sleep 6
docker compose ps
docker compose logs --tail 15
`);
console.log(out);
