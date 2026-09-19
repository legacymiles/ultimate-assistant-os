#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Create and run the RunPod GPU Pod that renders Music Creator's songs.
//
//   node tools/music-creator/runpod/setup.mjs --dry-run   show what it would create
//   node tools/music-creator/runpod/setup.mjs --yes       create the volume + pod
//   node tools/music-creator/runpod/setup.mjs --deploy    copy the server up and provision it
//   node tools/music-creator/runpod/setup.mjs --status    state, cost, URL, live health
//   node tools/music-creator/runpod/setup.mjs --stop      stop billing for compute
//   node tools/music-creator/runpod/setup.mjs --start     resume the same pod
//   node tools/music-creator/runpod/setup.mjs --teardown  terminate the pod (volume kept)
//
// The API key is read from .env.local or the environment and is never printed.
// Nothing billable is created without --yes.
//
// A POD, NOT A SERVERLESS ENDPOINT — the opposite of runpod/setup.mjs (Auteur),
// and the reason is worth stating because the cost model is worse:
//
//   * This server is stateful. It holds a job queue, the files it produced and
//     the Voice Library's reference clips. A serverless worker is per-request
//     and would lose all three between invocations, so "never process that
//     artist again" would stop being true.
//   * The weights are about 30 GB across five models — YuE2 7.3, its VAE 0.5,
//     AuK 6.8, Qwen2.5-Omni 12, SheetSage2 and MERT 2.7 — on top of three
//     Python environments. A serverless cold start that fetched all that per
//     job would cost far more in GPU-seconds than a Pod you stop when done.
//
// So this bills every second it is RUNNING, and stopping it is your job.
// --stop leaves the volume (and therefore the weights) intact.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL = resolve(HERE, "..");
const ROOT = resolve(TOOL, "..", "..");
const API = "https://api.runpod.io/v2";

/** The port the server listens on, exposed through RunPod's HTTPS proxy. */
const PORT = 8770;

/** Where the network volume is mounted inside the container. */
const MOUNT = "/workspace";

const args = new Set(process.argv.slice(2));
const YES = args.has("--yes");
const STATUS = args.has("--status");
const DEPLOY = args.has("--deploy");
const STOP = args.has("--stop");
const START = args.has("--start");
const TEARDOWN = args.has("--teardown");
// Anything that is not an action is a dry run, including no arguments at all.
const DRY = !YES && !STATUS && !DEPLOY && !STOP && !START && !TEARDOWN;

// ----- env -----------------------------------------------------------------

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

const CONFIG = {
  podName: env("MUSIC_POD_NAME", "music-creator"),
  volumeName: env("MUSIC_VOLUME_NAME", "music-creator-weights"),
  // ~30 GB of weights, ~20 GB of Python environments, plus renders and clips.
  volumeGb: Number(env("MUSIC_VOLUME_GB", "120")),
  // Container disk is ephemeral; it only holds the OS layers and the checkout.
  diskGb: Number(env("MUSIC_DISK_GB", "60")),
  dataCenter: env("RUNPOD_DATACENTER", ""),
  // A CUDA image with a modern toolchain. bootstrap.sh installs the three
  // Pythons the models need on top of it.
  image: env("MUSIC_POD_IMAGE", "runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404"),
  /**
   * 48 GB by default, and this is the single most consequential setting here.
   *
   * YuE2 wants 24 GB and AuK about 25 GB, so on a 24 GB card they cannot both
   * be resident: the server unloads one to load the other, and a session that
   * alternates music and vocals pays that swap every time. Worse, AuK does not
   * fit in 24 GB at all without --cpu-offload, which is slower again. 48 GB
   * holds both at once (--keep-loaded both) for roughly the same money per
   * useful minute.
   */
  minVram: Number(env("MUSIC_MIN_VRAM", "48")),
  gpuId: env("MUSIC_GPU", ""),
  podId: env("MUSIC_POD_ID", ""),
  token: env("MUSIC_TOKEN", ""),
};

// ----- output --------------------------------------------------------------

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const good = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;

/**
 * Stop with a message, never a stack trace.
 *
 * It throws rather than calling process.exit: on Windows, exiting while fetch
 * still holds a keep-alive socket trips a libuv assertion that prints after the
 * message and reads like a crash in this script. main()'s catch prints it and
 * sets the exit code instead, and Node leaves once the socket is released.
 */
class Stop extends Error {}

function die(msg) {
  throw new Stop(msg);
}

// ----- API -----------------------------------------------------------------

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      // Their edge rejects the default client UA with a Cloudflare 1010.
      "User-Agent": "music-creator-setup/1.0 (+https://github.com/legacymiles/ultimate-assistant-os)",
      Accept: "application/json",
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
    throw new Error(`${method} ${path} -> ${res.status}: ${detail}`);
  }
  return data;
}

function list(out, ...keys) {
  if (Array.isArray(out)) return out;
  for (const key of keys) if (Array.isArray(out?.[key])) return out[key];
  return [];
}

// ----- choosing hardware ---------------------------------------------------

/**
 * The cheapest card in the catalog with enough memory.
 *
 * Price is read from the catalog rather than hardcoded, because RunPod's rates
 * move and a stale number in a script is worse than no number: it becomes the
 * one the user plans around.
 */
async function pickGpu() {
  const catalog = await api("/catalog/gpus").catch(() => null);
  const gpus = list(catalog, "gpus", "gpuTypes", "data");
  if (!gpus.length) {
    if (CONFIG.gpuId) return { id: CONFIG.gpuId, why: "set in the environment; catalog unreadable" };
    die("Could not read the GPU catalog, and MUSIC_GPU is not set. Set MUSIC_GPU to a card id such as 'NVIDIA RTX A6000'.");
  }

  // The catalog's shape, confirmed against the live endpoint: `memory` is GB
  // as a number, and `price` is per-tier — {secure, community, serverless} —
  // not a scalar. `maxCount` says how many of that card each tier can give you,
  // and a card with none available on the tier we ask for is not a candidate at
  // all, however cheap it looks.
  const vram = (g) => g.memory ?? 0;
  const price = (g) => g.price?.secure ?? Infinity;
  const available = (g) => (g.maxCount?.secure ?? 0) > 0;

  /**
   * Is `--keep-loaded both` safe on this card?
   *
   * Only on 80 GB and up, and the reason is a detail of how the server runs.
   * YuE2 lives in the server's own process, AuK runs as a subprocess in its own
   * interpreter, and `both` makes free_gpu() a no-op — so a resident YuE2
   * (~24 GB) is still on the card while AuK loads ~24.8 GiB beside it, needing
   * a shade under 49 GiB. An "48 GB" card does not have that: an A40 reports
   * 46068 MiB and even an A6000 only 49140 MiB.
   *
   * `one` is not a compromise here. It keeps YuE2 resident between song jobs
   * exactly the same way, and frees it before a speech job, so the peak is one
   * model rather than two — which is why 48 GB is ample and 24 GB is not (AuK
   * alone peaks above it).
   */
  const bothResident = (g) => vram(g) >= 64;

  if (CONFIG.gpuId) {
    const exact = gpus.find((g) => g.id === CONFIG.gpuId || g.name === CONFIG.gpuId);
    if (!exact) die(`MUSIC_GPU="${CONFIG.gpuId}" is not in the catalog. Run with --dry-run to see the candidates.`);
    return { id: exact.id, vram: vram(exact), price: price(exact), why: "set in the environment" };
  }

  const usable = gpus
    // NVIDIA only: both model stacks are CUDA. An MI300X has 192 GB and would
    // sort straight to the top on memory while running neither model.
    .filter((g) => g.manufacturer === "NVIDIA" && vram(g) >= CONFIG.minVram && available(g) && Number.isFinite(price(g)))
    // Simply the cheapest that clears the bar. Since the two models never sit
    // on the card together, a more expensive 48 GB card buys nothing here —
    // and 48 GB is where the cheap cards are anyway: every 32 GB card in the
    // catalog costs more per hour than the 48 GB A40.
    .sort((a, b) => price(a) - price(b));

  if (!usable.length) {
    die(
      `No GPU in the catalog has ${CONFIG.minVram} GB. Lower it with MUSIC_MIN_VRAM=24 ` +
        "(YuE2 fits; AuK then needs --cpu-offload and the two models swap in and out).",
    );
  }
  const chosen = usable[0];
  return {
    id: chosen.id,
    vram: vram(chosen),
    price: price(chosen),
    bothResident: bothResident(chosen),
    why: `cheapest card with at least ${CONFIG.minVram} GB`,
    alternatives: usable.slice(1, 4).map((g) => `${g.name ?? g.id} (${vram(g)} GB, $${price(g)}/hr)`),
  };
}

/**
 * Where to put the volume — and therefore the pod.
 *
 * A network volume exists in exactly one data center and a pod can only mount
 * one that is local to it, so this decision pins both. It is made once, at
 * volume creation, and everything afterwards follows it.
 */
async function pickDataCenter() {
  if (CONFIG.dataCenter) return { id: CONFIG.dataCenter, why: "set in the environment" };
  const out = await api("/catalog/datacenters").catch(() => null);
  const dcs = list(out, "dataCenters", "datacenters", "data");

  // Only some sites offer network volumes at all, and one that does not would
  // fail at volume creation rather than pod creation — a confusing place to
  // find out.
  const withVolumes = dcs.filter((d) => (d.networkVolumeTypes || d.storageTypes || []).length > 0);
  const pool = withVolumes.length ? withVolumes : dcs;
  if (!pool.length) return { id: "US-KS-2", why: "catalog unreadable - falling back" };

  // The catalog says which sites take volumes but NOT which GPUs each one has,
  // so a site can accept the volume and then have no A40 to put beside it.
  // These are the large, well-stocked North American sites; preferring them is
  // the only hedge available short of trying and failing.
  for (const want of ["US-KS-2", "US-TX-3", "US-IL-1", "US-NC-1", "US-GA-2", "US-CA-2"]) {
    if (pool.some((d) => d.id === want)) return { id: want, why: "takes volumes, large North American site" };
  }
  const na = pool.find((d) => d.region === "NORTH_AMERICA") || pool[0];
  return { id: na.id, why: "offers network volumes" };
}

/**
 * GPU and site chosen TOGETHER, from live stock.
 *
 * Learned the hard way (2026-09-18): picking the site first put the volume in
 * US-TX-3, which had no 48 GB card at all, and the two sites that did have
 * A40s take no network volumes. The catalog's AVAILABILITY view says which
 * site has which card in stock, so: every NVIDIA card with enough memory, at
 * every volume-capable site where it is in stock, ranked by stock level first
 * (a stopped pod can only restart if its host still has the card free, so
 * "HIGH" is what makes waking it from the website reliable), then price.
 * With a volume already made, only its site is considered.
 */
async function pickPlacement(volumeDc) {
  if (CONFIG.gpuId || (CONFIG.dataCenter && !volumeDc)) return null; // explicit settings win
  const [gpuOut, dcOut] = await Promise.all([
    api("/catalog/gpus?include=AVAILABILITY&product=POD").catch(() => null),
    api("/catalog/datacenters").catch(() => null),
  ]);
  const gpus = list(gpuOut, "gpus", "data");
  const volumeSites = new Set(
    list(dcOut, "dataCenters", "datacenters", "data")
      .filter((d) => (d.networkVolumeTypes || []).length)
      .map((d) => d.id),
  );
  if (!gpus.length || !volumeSites.size) return null;
  const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  const options = [];
  for (const g of gpus) {
    if (g.manufacturer !== "NVIDIA" || (g.memory ?? 0) < CONFIG.minVram || !g.secure || !g.price?.secure) continue;
    for (const d of g.dataCenters || []) {
      if (!rank[d.availability] || !volumeSites.has(d.id) || (volumeDc && d.id !== volumeDc)) continue;
      options.push({ g, dc: d.id, stock: d.availability, price: g.price.secure });
    }
  }
  if (!options.length) return null;
  options.sort((a, b) => rank[b.stock] - rank[a.stock] || a.price - b.price);
  const best = options[0];
  return {
    dc: { id: best.dc, why: `${best.stock} stock of ${best.g.name ?? best.g.id} there, and it takes volumes` },
    gpu: {
      id: best.g.id,
      vram: best.g.memory,
      price: best.price,
      bothResident: best.g.memory >= 64,
      why: `best-stocked card with at least ${CONFIG.minVram} GB at a volume site`,
      alternatives: options.slice(1, 4).map((o) => `${o.g.name ?? o.g.id} @ ${o.dc} (${o.stock}, $${o.price}/hr)`),
    },
  };
}

// ----- volume and pod ------------------------------------------------------

async function findVolume() {
  const out = await api("/network-volumes").catch(() => null);
  return list(out, "networkVolumes", "volumes", "data").find((v) => v.name === CONFIG.volumeName) || null;
}

async function findPod() {
  if (CONFIG.podId) return api(`/pods/${CONFIG.podId}`).catch(() => null);
  const out = await api("/pods").catch(() => null);
  return list(out, "pods", "data").find((p) => p.name === CONFIG.podName && p.status !== "TERMINATED") || null;
}

/**
 * The address the website talks to.
 *
 * RunPod fronts an exposed HTTP port at `https://<pod id>-<port>.proxy.runpod.net`,
 * where the id carries no `pod_` prefix. The prefix is stripped here because
 * the v2 API returns ids in the prefixed form. --status probes this URL rather
 * than trusting it, so a change in their scheme shows up as a failed probe
 * instead of a setting that looks right and never connects; the Connect button
 * in the RunPod console is the authority if they ever disagree.
 */
function proxyUrl(pod) {
  return `https://${String(pod.id).replace(/^pod_/, "")}-${PORT}.proxy.runpod.net`;
}

// ----- deploying the server ------------------------------------------------

/**
 * The pod's DIRECT ssh endpoint — the only one usable here.
 *
 * RunPod offers two. The proxy (ssh.runpod.io) needs no exposed port, but it
 * carries an interactive shell only: scp, sftp, rsync and port forwarding do
 * not work over it. Since this deploy is a file copy, the direct endpoint is
 * not a preference but a requirement, and falling back to the proxy would fail
 * halfway through with an error about the subsystem rather than about this.
 *
 * `direct` is null until the pod has a machine assignment, and absent entirely
 * on a pod created without startSsh.
 */
function sshTarget(pod) {
  const direct = pod.ssh?.direct;
  if (!direct?.host || !direct?.port) return null;
  return { host: direct.host, port: direct.port, user: direct.username || "root" };
}

function run(cmd, argv) {
  console.log(dim(`  $ ${cmd} ${argv.join(" ")}`));
  execFileSync(cmd, argv, { stdio: "inherit" });
}

/**
 * Put the server on the pod and provision it.
 *
 * scp of the source tree rather than a git clone: this repo is private and
 * local, the server is a few hundred kilobytes, and a clone would need a
 * deploy key on a machine rented by the hour. `data/` is excluded — it is the
 * pod's own output directory and lives on the volume.
 */
/**
 * Refuse to start a copy that cannot authenticate.
 *
 * A pod accepts the public keys registered on the RunPod ACCOUNT at the moment
 * it was created, not a password. Without a key the scp below fails several
 * steps in with ssh's own "Permission denied (publickey)", which says nothing
 * about where the key was supposed to be registered — so check first and say it.
 */
function requireSshKey() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const names = ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"];
  if (names.some((n) => existsSync(resolve(home, ".ssh", n)))) return;
  die(
    [
      "No SSH public key found in ~/.ssh, so the pod cannot authenticate you.",
      "",
      "  1. ssh-keygen -t ed25519            (press enter at every prompt)",
      "  2. copy the contents of ~/.ssh/id_ed25519.pub",
      "  3. paste it into https://console.runpod.io/user/settings under SSH Public Keys",
      "",
      "  A pod only picks up the keys registered BEFORE it was created, so if the pod",
      "  already exists, terminate it and re-run --yes after adding the key.",
    ].join("\n"),
  );
}

async function deploy(pod) {
  requireSshKey();
  const target = sshTarget(pod);
  if (!target) {
    die(
      [
        "The pod has no direct SSH endpoint, which is the one a file copy needs.",
        "",
        "  * Still PROVISIONING or STARTING? It appears once the pod has a machine. Check --status and retry.",
        "  * Created without SSH? A pod only has SSH if it was created with startSsh, which --yes sets.",
        "    A pod made by hand in the console may not have it, and it cannot be added afterwards.",
        "  * RunPod's other endpoint (ssh.runpod.io) is an interactive shell only - scp cannot use it.",
      ].join("\n"),
    );
  }
  const dest = `${target.user}@${target.host}`;
  const ssh = ["-p", String(target.port), "-o", "StrictHostKeyChecking=accept-new"];

  // Upload to a staging directory, NOT to the install directory.
  //
  // bootstrap.sh works out the checkout from its own location (it lives in
  // runpod/, so its parent is the tool) and copies that into
  // `$VOLUME/music-creator`. Uploading straight there would make the source and
  // the destination the same directory. The staging copy is wiped first so a
  // redeploy cannot leave a stale file behind, and `data/` is never sent — that
  // is the pod's own output, already on the volume.
  const staging = `${MOUNT}/music-creator-src`;
  console.log(bold(`\nCopying the server to ${dest}:${staging}`));

  run("ssh", [...ssh, dest, `rm -rf ${staging} && mkdir -p ${staging}`]);
  run("scp", [
    "-P",
    String(target.port),
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-r",
    resolve(TOOL, "server"),
    resolve(TOOL, "runpod"),
    resolve(TOOL, "requirements.txt"),
    resolve(TOOL, "README.md"),
    `${dest}:${staging}/`,
  ]);

  if (!CONFIG.token) die("MUSIC_TOKEN is not set. Run --yes first, or copy the token it printed into .env.local.");
  console.log(bold("\nProvisioning (about 30 GB of weights and three Python environments; allow an hour the first time)"));
  run("ssh", [
    ...ssh,
    dest,
    `MUSIC_TOKEN='${CONFIG.token}' VOLUME='${MOUNT}' MUSIC_PORT='${PORT}' bash ${staging}/runpod/bootstrap.sh`,
  ]);

  console.log(good("\nProvisioned. Start the server with:"));
  console.log(`  ssh -p ${target.port} ${dest} 'bash ${MOUNT}/start-music-server.sh'`);
  console.log(dim("\nThen check it from here: node tools/music-creator/runpod/setup.mjs --status"));
}

/**
 * Create the pod, and translate the one failure that is actually common.
 *
 * The volume pins the data centre, and the catalog cannot say which GPUs that
 * data centre has — so "no capacity" here means the pair is wrong, not that
 * RunPod is full. The volume is already created and paid for at this point, so
 * the useful advice is to change the card rather than start over.
 */
async function createPod(body) {
  try {
    return await api("/pods", { method: "POST", body });
  } catch (err) {
    if (!/capacity|unavailable|no instances|not available/i.test(err.message)) throw err;
    die(
      [
        err.message,
        "",
        `  ${body.gpu.id} is not available in ${body.dataCenterIds[0]}, where the volume lives.`,
        `  Pick another card with MUSIC_GPU='NVIDIA RTX A6000' (--dry-run lists the alternatives),`,
        "  or delete the volume in the console and re-run with RUNPOD_DATACENTER set to a different site.",
      ].join("\n"),
    );
  }
}

// ----- the live check ------------------------------------------------------

async function probe(url, token) {
  try {
    const res = await fetch(`${url}/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, why: `the server answered ${res.status}` };
    const body = await res.json();
    const engines = Object.entries(body.engines || {}).map(
      ([name, e]) => `${e.available ? good("ok  ") : warn("NO  ")}${name}${e.available ? (e.loaded ? " (loaded)" : "") : ` - ${e.reason ?? ""}`}`,
    );
    return { ok: true, body, engines };
  } catch (err) {
    return { ok: false, why: err.name === "TimeoutError" ? "no answer in 20s" : err.message };
  }
}

// ----- main ----------------------------------------------------------------

async function main() {
  if (!KEY) {
    die("RUNPOD_API_KEY is not set. Create one at https://console.runpod.io/user/settings and put it in .env.local.");
  }

  const existing = await findPod();

  if (STATUS) {
    if (!existing) die(`No pod named "${CONFIG.podName}". Create one with --yes.`);
    const url = proxyUrl(existing);
    console.log(bold(`\n${existing.name}  ${existing.id}`));
    console.log(`  status      ${existing.status === "RUNNING" ? good(existing.status) : warn(existing.status)}`);
    console.log(`  gpu         ${existing.gpu?.id ?? "?"} x${existing.gpu?.count ?? 1}`);
    console.log(`  cost        $${existing.cost ?? 0}/hr ${existing.status === "RUNNING" ? warn("(billing now)") : dim("(not billing compute)")}`);
    console.log(`  data centre ${existing.dataCenterId ?? "?"}`);
    console.log(`  url         ${url}`);
    if (existing.status === "RUNNING") {
      const health = await probe(url, CONFIG.token);
      if (!health.ok) {
        console.log(`  health      ${warn(health.why)}`);
        console.log(dim("              The pod is up but the server is not answering. Start it with start-music-server.sh, or run --deploy."));
      } else {
        console.log(`  health      ${good("answering")}`);
        for (const line of health.engines) console.log(`              ${line}`);
      }
    }
    console.log();
    return;
  }

  if (STOP || START || TEARDOWN) {
    if (!existing) die(`No pod named "${CONFIG.podName}".`);
    const action = TEARDOWN ? "terminate" : STOP ? "stop" : "start";
    if (TEARDOWN && !YES) {
      console.log(warn(`\nThis terminates ${existing.id} permanently. The volume (and the weights on it) is kept.`));
      console.log("Re-run with --teardown --yes to confirm.\n");
      return;
    }
    await api(`/pods/${existing.id}/action`, { method: "POST", body: { action } });
    console.log(good(`\n${action} sent to ${existing.id}.`));
    if (STOP) console.log(dim("Compute stops billing. The volume keeps billing (~$0.07/GB/month) and keeps the weights.\n"));
    if (TEARDOWN) console.log(dim("Terminated. --yes on a later run creates a fresh pod against the same volume.\n"));
    return;
  }

  if (DEPLOY) {
    if (!existing) die(`No pod named "${CONFIG.podName}". Create one with --yes first.`);
    if (existing.status !== "RUNNING") die(`The pod is ${existing.status}. Start it with --start and wait for RUNNING.`);
    await deploy(existing);
    return;
  }

  // ----- plan, then maybe create -----
  if (existing) {
    console.log(warn(`\nA pod named "${CONFIG.podName}" already exists (${existing.id}, ${existing.status}).`));
    console.log("Use --status, --deploy, --start, --stop or --teardown.\n");
    return;
  }

  const volume = await findVolume();
  const placed = await pickPlacement(volume ? volume.dataCenter ?? volume.dataCenterId : "");
  const dc = volume
    ? { id: volume.dataCenter ?? volume.dataCenterId, why: "the volume already lives there" }
    : placed?.dc ?? (await pickDataCenter());
  const gpu = placed?.gpu ?? (await pickGpu());
  const token = CONFIG.token || randomBytes(24).toString("base64url");

  console.log(bold("\nThe plan"));
  console.log(`  pod            ${CONFIG.podName}`);
  console.log(`  gpu            ${gpu.id}${gpu.vram ? `  ${gpu.vram} GB` : ""}${Number.isFinite(gpu.price) ? `  ~$${gpu.price}/hr` : ""}   ${dim(gpu.why)}`);
  if (gpu.alternatives?.length) console.log(`  alternatives   ${dim(gpu.alternatives.join(" | "))}`);
  console.log(`  keep-loaded    ${gpu.bothResident ? "both - 80 GB is enough for a resident YuE2 and an AuK subprocess side by side" : "one"}`);
  if (!gpu.bothResident) {
    console.log(dim("                 YuE2 stays loaded between songs and is freed before a speech job, so only one"));
    console.log(dim("                 model is ever on the card. bootstrap.sh confirms this against the real card."));
  }
  console.log(`  image          ${CONFIG.image}`);
  console.log(`  container disk ${CONFIG.diskGb} GB ${dim("(ephemeral)")}`);
  console.log(`  volume         ${volume ? `${CONFIG.volumeName} (exists, ${volume.size ?? "?"} GB)` : `${CONFIG.volumeName} (new, ${CONFIG.volumeGb} GB)`} at ${MOUNT}`);
  console.log(`  data centre    ${dc.id}   ${dim(dc.why)}`);
  console.log(`  ports          ${PORT}/http, 22/tcp`);
  {
    // Said here rather than at --deploy, because a pod only accepts the keys
    // that were on the account when it was created: finding out afterwards
    // means terminating a pod that has already started billing.
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const hasKey = ["id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub"].some((n) => existsSync(resolve(home, ".ssh", n)));
    console.log(
      `  ssh key        ${hasKey ? good("found in ~/.ssh") : bad("none in ~/.ssh - add one BEFORE creating the pod")}`,
    );
    if (!hasKey) {
      console.log(dim("                 ssh-keygen -t ed25519, then paste ~/.ssh/id_ed25519.pub into"));
      console.log(dim("                 https://console.runpod.io/user/settings under SSH Public Keys"));
    }
  }
  console.log(bold("\nWhat this costs"));
  console.log(`  Compute bills every second the pod is RUNNING${Number.isFinite(gpu.price) ? ` (about $${gpu.price}/hr)` : ""}, whether or not it is rendering.`);
  console.log(`  The volume bills continuously, about $${((volume?.size ?? CONFIG.volumeGb) * 0.07).toFixed(2)}/month, even while the pod is stopped.`);
  console.log(`  ${bold("Stop the pod when you finish a session:")} node tools/music-creator/runpod/setup.mjs --stop`);

  if (DRY) {
    console.log(bold("\nThis was a dry run. Nothing was created."));
    console.log("Run with --yes to create it.\n");
    return;
  }

  let volumeId = volume?.id;
  if (!volumeId) {
    console.log(bold("\nCreating the volume"));
    const created = await api("/network-volumes", {
      method: "POST",
      body: { name: CONFIG.volumeName, size: CONFIG.volumeGb, dataCenter: dc.id },
    });
    volumeId = created.id || created.networkVolumeId;
    console.log(good(`  ${volumeId}  ${CONFIG.volumeGb} GB in ${dc.id}`));
  }

  console.log(bold("\nCreating the pod"));
  const pod = await createPod({
    name: CONFIG.podName,
    image: CONFIG.image,
    gpu: { id: gpu.id, count: 1 },
    cloud: "SECURE",
    disk: CONFIG.diskGb,
    ports: [`${PORT}/http`, "22/tcp"],
    dataCenterIds: [dc.id],
    mounts: { network: [{ volumeId, path: MOUNT }] },
    env: {
      MUSIC_TOKEN: token,
      VOLUME: MOUNT,
      MUSIC_PORT: String(PORT),
      MUSIC_IDLE_STOP_MINUTES: env("MUSIC_IDLE_STOP_MINUTES", "20"),
    },
    // Boot = start the music server too, so the website can wake a stopped pod
    // with one API call. autostart.sh is written by bootstrap.sh on the first
    // --deploy; until then it does not exist and this is just the image's own
    // /start.sh (sshd), which must keep running in the foreground.
    cmd: [
      "bash",
      "-c",
      `[ -f ${MOUNT}/autostart.sh ] && (bash ${MOUNT}/autostart.sh &); exec /start.sh`,
    ],
    startSsh: true,
  });
  console.log(good(`  ${pod.id}  ${pod.status}`));

  const url = proxyUrl(pod);
  console.log(bold("\nPut these in .env.local"));
  console.log(`  MUSIC_SERVER_URL=${url}`);
  console.log(`  MUSIC_TOKEN=${token}`);
  console.log(`  MUSIC_POD_ID=${pod.id}`);
  console.log(bold("\nThen"));
  console.log("  node tools/music-creator/runpod/setup.mjs --status    wait for RUNNING");
  console.log("  node tools/music-creator/runpod/setup.mjs --deploy    copy the server up and download the weights");
  console.log(dim("\nThe weights land on the volume, so this is a one-time hour. Later sessions are --start, then start-music-server.sh.\n"));
}

main().catch((err) => {
  console.error(`\n${bad("x")} ${err.message}\n`);
  process.exitCode = 1;
});
