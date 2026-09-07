#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Create the RunPod Serverless endpoint that runs MiniMax H3 for Auteur.
//
//   node runpod/setup.mjs --dry-run     show exactly what would be created
//   node runpod/setup.mjs --yes         actually create it
//   node runpod/setup.mjs --status      health of the endpoint in .env.local
//   node runpod/setup.mjs --teardown    delete the endpoint (volume kept)
//
// The API key is read from .env.local or the environment and is never printed.
// Nothing billable is created without --yes.
//
// The shape this builds, and why:
//
//   Serverless, not a Pod       a Pod bills every second it is running; a
//                               serverless endpoint bills per job
//   workers.min = 0             nothing is running, so nothing is billed,
//                               when you are not rendering
//   idleTimeout = 5s            the worker lingers only briefly after a job;
//                               that lingering IS billed
//   network volume              the ~42 GB of weights are written once and
//                               reused, instead of re-downloaded per cold
//                               start. This is the ONE line item that bills
//                               while you are idle: about $0.07/GB/month.
//   FlashBoot                   snapshots a warm worker so a follow-up render
//                               skips most of the load
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.runpod.io/v2";

const args = new Set(process.argv.slice(2));
const DRY = args.has("--dry-run");
const YES = args.has("--yes");
const STATUS = args.has("--status");
const TEARDOWN = args.has("--teardown");

// ----- env -----------------------------------------------------------------
//
// Settings come from the real environment first, then .env.local, so nothing
// has to be typed on the command line. The API key is only ever read; it is
// never printed, logged or written anywhere.

function loadEnvFile() {
  const path = resolve(ROOT, ".env.local");
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const fileEnv = loadEnvFile();
const env = (name, fallback = "") => process.env[name] || fileEnv[name] || fallback;

const KEY = env("RUNPOD_API_KEY");
const EXISTING_ENDPOINT = env("RUNPOD_ENDPOINT_ID");

/**
 * Where GitHub Actions publishes this repo's worker image.
 *
 * Read from the git remote rather than hardcoded, so a fork builds and
 * deploys its own copy without editing anything here. Must stay in step with
 * .github/workflows/build-h3-worker.yml.
 */
function defaultImage() {
  try {
    const url = execSync("git remote get-url origin", {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const owner = url.match(/github\.com[:/]([^/]+)\//i)?.[1];
    return owner ? `ghcr.io/${owner.toLowerCase()}/auteur-h3:latest` : "";
  } catch {
    return "";
  }
}

// ----- config --------------------------------------------------------------

const CONFIG = {
  endpointName: env("RUNPOD_ENDPOINT_NAME", "auteur-h3"),
  volumeName: env("RUNPOD_VOLUME_NAME", "auteur-h3-models"),
  // 42 GB of base weights, or ~65 GB if reference-to-video is ever enabled,
  // plus headroom. A volume can be grown later but never shrunk.
  volumeGb: Number(env("RUNPOD_VOLUME_GB", 80)),
  dataCenter: env("RUNPOD_DATACENTER"),
  image: env("RUNPOD_IMAGE") || defaultImage(),
  // 32 GB is the comfortable floor: the quantised model peaks around 27 GB.
  minVramGb: Number(env("RUNPOD_MIN_VRAM_GB", 32)),
  maxWorkers: Number(env("RUNPOD_MAX_WORKERS", 2)),
  idleTimeout: Number(env("RUNPOD_IDLE_TIMEOUT", 5)),
  containerDiskGb: Number(env("RUNPOD_CONTAINER_DISK_GB", 30)),
  // A cold start plus a slow render; the request dies rather than billing
  // forever if something wedges.
  executionTimeoutMs: Number(env("RUNPOD_TIMEOUT_MS", 3_600_000)),
};

// ----- output --------------------------------------------------------------

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const good = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;

function die(msg) {
  console.error(`\n${bad("✗")} ${msg}\n`);
  process.exit(1);
}

// ----- API -----------------------------------------------------------------

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    // RunPod v2 returns RFC 9457 problem documents.
    const detail = data.detail || data.title || data.error || text.slice(0, 400);
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  return data;
}

// ----- steps ---------------------------------------------------------------

// Pool ids are not a documented enum, so the catalog is the source of truth
// and these are only a last resort when it cannot be read.
const FALLBACK_POOLS = ["ADA_32", "ADA_48_PRO", "AMPERE_80", "HOPPER_80"];

async function pickGpuPools() {
  let catalog;
  try {
    catalog = await api("/catalog/gpus");
  } catch (err) {
    // A dry run should still show the payload; a real run should not guess.
    if (!DRY && YES) throw err;
    console.log(warn(`  Could not read the GPU catalog (${err.message.slice(0, 80)}).`));
    return { pools: FALLBACK_POOLS, notes: ["catalog unavailable — showing fallback pools"] };
  }
  const list = Array.isArray(catalog) ? catalog : catalog.gpus || catalog.data || [];
  if (!list.length) {
    console.log(warn("  Could not read the GPU catalog; falling back to a broad pool set."));
    return { pools: FALLBACK_POOLS, notes: ["catalog unavailable"] };
  }

  const usable = list
    .map((g) => ({
      pool: g.pool || g.poolId || g.id,
      name: g.displayName || g.name || g.id,
      vram: Number(g.memoryInGb ?? g.vramInGb ?? g.memory ?? 0),
      price: Number(g?.price?.serverless ?? g?.serverlessPrice ?? 0),
    }))
    .filter((g) => g.pool && g.vram >= CONFIG.minVramGb)
    .sort((a, b) => (a.price || 99) - (b.price || 99));

  if (!usable.length) die(`No GPU pool in the catalog has at least ${CONFIG.minVramGb} GB of VRAM.`);

  // Cheapest first, then a couple of larger fallbacks so a busy pool does not
  // strand the endpoint with nowhere to run.
  const pools = [...new Set(usable.map((g) => g.pool))].slice(0, 4);
  const notes = usable
    .filter((g) => pools.includes(g.pool))
    .slice(0, 6)
    .map((g) => `${g.name} · ${g.vram}GB · $${g.price || "?"}/hr`);
  return { pools, notes };
}

/**
 * A datacenter to put the volume in.
 *
 * This choice is sticky: a network volume lives in exactly one datacenter and
 * pins the endpoint to it, which narrows the GPUs available. So prefer one the
 * catalog says actually has capacity, and only fall back to a guess.
 */
async function pickDataCenter() {
  if (CONFIG.dataCenter) return { id: CONFIG.dataCenter, why: "set in the environment" };

  for (const path of ["/catalog/datacenters", "/datacenters", "/catalog/data-centers"]) {
    try {
      const out = await api(path);
      const list = out.dataCenters || out.datacenters || out.data || (Array.isArray(out) ? out : []);
      const usable = list
        .map((d) => ({
          id: d.id || d.dataCenterId || d.name,
          storage: d.storageSupport ?? d.supportsNetworkVolumes ?? d.networkVolumeSupport ?? true,
          listed: d.listed ?? true,
        }))
        .filter((d) => d.id && d.storage && d.listed);
      if (usable.length) return { id: usable[0].id, why: `from ${path}` };
    } catch {
      // Try the next spelling; this endpoint is not documented in v2 yet.
    }
  }
  return { id: "US-KS-2", why: "fallback default — override with RUNPOD_DATACENTER" };
}

async function findVolume() {
  try {
    const out = await api("/network-volumes");
    const list = out.networkVolumes || out.volumes || out.data || (Array.isArray(out) ? out : []);
    return list.find((v) => v.name === CONFIG.volumeName) || null;
  } catch {
    return null;
  }
}

async function createVolume(dataCenter) {
  return api("/network-volumes", {
    method: "POST",
    body: {
      name: CONFIG.volumeName,
      dataCenter,
      size: CONFIG.volumeGb,
      type: "STANDARD",
    },
  });
}

function endpointBody({ pools, volumeId, image }) {
  return {
    name: CONFIG.endpointName,
    image,
    type: "QUEUE",
    gpu: { pools, count: 1 },
    // The line that makes idle free.
    workers: { min: 0, max: CONFIG.maxWorkers, idleTimeout: CONFIG.idleTimeout },
    scaling: { type: "QUEUE_DELAY", queueDelay: 4 },
    ...(volumeId ? { networkVolumes: [volumeId] } : {}),
    flashboot: "FLASHBOOT",
    disk: CONFIG.containerDiskGb,
    timeout: CONFIG.executionTimeoutMs,
    env: {
      H3_MODELS_DIR: "/runpod-volume/models",
      ...(env("HF_TOKEN") ? { HF_TOKEN: env("HF_TOKEN") } : {}),
    },
  };
}

// ----- modes ---------------------------------------------------------------

async function showStatus() {
  if (!EXISTING_ENDPOINT) die("No RUNPOD_ENDPOINT_ID in .env.local yet.");
  const res = await fetch(`https://api.runpod.ai/v2/${EXISTING_ENDPOINT}/health`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) die(`Health check failed: ${res.status} ${await res.text()}`);
  const h = await res.json();
  console.log(`\n${bold("Endpoint")} ${EXISTING_ENDPOINT}`);
  console.log(`  workers   idle ${h?.workers?.idle ?? "?"} · running ${h?.workers?.running ?? "?"}`);
  console.log(`  jobs      queued ${h?.jobs?.inQueue ?? "?"} · running ${h?.jobs?.inProgress ?? "?"} · done ${h?.jobs?.completed ?? "?"} · failed ${h?.jobs?.failed ?? "?"}`);
  const running = Number(h?.workers?.running || 0);
  console.log(
    running > 0
      ? `\n  ${warn("A worker is running right now, so the meter is on.")}`
      : `\n  ${good("No workers running. You are not being billed for compute.")}`,
  );
  console.log(dim("  The network volume bills continuously regardless.\n"));
}

async function teardown() {
  if (!EXISTING_ENDPOINT) die("No RUNPOD_ENDPOINT_ID in .env.local.");
  if (!YES) die("Add --yes to confirm deleting the endpoint.");
  await api(`/serverless/${EXISTING_ENDPOINT}`, { method: "DELETE" });
  console.log(`\n${good("✓")} Endpoint ${EXISTING_ENDPOINT} deleted.`);
  console.log(dim(`  The network volume "${CONFIG.volumeName}" was kept and still bills.`));
  console.log(dim("  Delete it in the RunPod console if you are done with it.\n"));
}

async function provision() {
  console.log(`\n${bold("Auteur · MiniMax H3 on RunPod Serverless")}\n`);

  console.log(warn("  LICENSE — read before you spend anything"));
  console.log("  The open MiniMax H3 weights ship under the MiniMax H3 Community License,");
  console.log("  whose \"Applicable Territory\" EXCLUDES the United States, the EU, the UK");
  console.log("  and South Korea. Using the weights from an excluded region is a licence");
  console.log("  breach even though the files download freely.");
  console.log(dim("  Apply for authorisation: https://platform.minimax.io/h3-license"));
  console.log(dim("  Or keep using MiniMax's hosted API, which is available worldwide.\n"));

  console.log(warn("  COST — what bills, and when"));
  console.log("  Compute bills only while a job runs, INCLUDING cold start and the idle");
  console.log(`  timeout (${CONFIG.idleTimeout}s). With min workers 0, an untouched endpoint costs nothing.`);
  console.log(`  The ${CONFIG.volumeGb} GB network volume bills about $${(CONFIG.volumeGb * 0.07).toFixed(2)}/month whether you use it or not.`);
  console.log(dim("  That volume is what stops every cold start re-downloading 42 GB.\n"));

  if (!CONFIG.image) {
    die(
      "No container image set.\n\n" +
        "  This worker has to be built and published before an endpoint can run it.\n" +
        "  Two ways, neither needing Docker on this machine:\n\n" +
        `    ${bold("RunPod Hub")}  push runpod/h3-worker to a GitHub repo, cut a release,\n` +
        "                 and submit it at https://console.runpod.io/hub — RunPod builds it.\n" +
        `    ${bold("Docker")}      docker build -t <you>/auteur-h3:1 runpod/h3-worker && docker push ...\n\n` +
        "  Then re-run with RUNPOD_IMAGE=<image> node runpod/setup.mjs --yes",
    );
  }

  const { pools, notes } = await pickGpuPools();
  console.log(`  ${bold("GPU pools")}`);
  for (const n of notes) console.log(`    ${n}`);
  console.log(`    ${dim(`pools: ${pools.join(", ")}`)}\n`);

  let volume = await findVolume();
  let dataCenter = volume?.dataCenter || volume?.dataCenterId || "";
  if (!volume) {
    const picked = await pickDataCenter();
    dataCenter = picked.id;
    console.log(`  ${bold("Datacenter")}  ${dataCenter} ${dim(`(${picked.why})`)}
`);
  }
  if (!volume && !dataCenter) {
    die(
      "Set RUNPOD_DATACENTER (e.g. US-KS-2) so the network volume can be created.\n" +
        "  A volume lives in one datacenter and pins the endpoint to it.",
    );
  }

  const body = endpointBody({ pools, volumeId: volume?.id, image: CONFIG.image });

  if (DRY || !YES) {
    console.log(`  ${bold("Would create")}`);
    if (!volume) {
      console.log(`    network volume  ${CONFIG.volumeName} · ${CONFIG.volumeGb} GB · ${dataCenter}`);
    } else {
      console.log(`    network volume  ${dim(`reusing ${volume.id}`)}`);
    }
    console.log(`    endpoint        ${JSON.stringify(body, null, 2).split("\n").join("\n    ")}`);
    console.log(`\n  ${DRY ? dim("Dry run — nothing created.") : warn("Re-run with --yes to create these.")}\n`);
    return;
  }

  if (!volume) {
    console.log(`  Creating ${CONFIG.volumeGb} GB volume in ${dataCenter}…`);
    volume = await createVolume(dataCenter);
    console.log(`  ${good("✓")} volume ${volume.id}`);
  } else {
    console.log(`  ${good("✓")} reusing volume ${volume.id}`);
  }

  console.log("  Creating endpoint…");
  const endpoint = await api("/serverless", {
    method: "POST",
    body: endpointBody({ pools, volumeId: volume.id, image: CONFIG.image }),
  });

  console.log(`\n${good("✓")} Endpoint created: ${bold(endpoint.id)}\n`);
  console.log("  Add this to .env.local:\n");
  console.log(`    RUNPOD_ENDPOINT_ID=${endpoint.id}\n`);
  console.log(dim("  The first render downloads ~42 GB onto the volume and will take"));
  console.log(dim("  several billed minutes. Every render after that skips it.\n"));
}

// ----- main ----------------------------------------------------------------

if (!KEY) {
  die(
    "No RUNPOD_API_KEY found.\n\n" +
      "  Create one at https://console.runpod.io/user/settings and add it to .env.local:\n\n" +
      "    RUNPOD_API_KEY=rpa_...\n\n" +
      "  Keep it in that file. It is gitignored and nothing prints it.",
  );
}

try {
  if (STATUS) await showStatus();
  else if (TEARDOWN) await teardown();
  else await provision();
} catch (err) {
  die(err.message);
}
