// ---------------------------------------------------------------------------
// rclone on this PC, read-only, for the Backups dashboard.
//
// rclone (github.com/rclone/rclone) talks to 70+ storage providers — more
// Google Drives, OneDrive, Dropbox, S3, B2, Nextcloud/WebDAV, Immich-adjacent
// NAS shares. The owner configures remotes with `rclone config` themselves;
// this module only LISTS them and asks each for its real storage numbers
// (`rclone about <remote>: --json`). It never copies, syncs or deletes.
//
// Remote names are validated before they reach the command line, and rclone
// is run with execFile (no shell), so a name can never become a command.
// ---------------------------------------------------------------------------

import { execFile } from "node:child_process";

const BIN = process.env.RCLONE_PATH || "rclone";
const NAME = /^[\w.\- ]{1,64}$/;

function run(args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    execFile(BIN, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === "ENOENT") return reject(Object.assign(new Error("rclone is not installed on this PC."), { missing: true }));
        return reject(new Error(String(stderr || err.message).trim().split("\n").pop()?.slice(0, 300) || "rclone failed"));
      }
      resolve(String(stdout));
    });
  });
}

/** The remotes, with their type and real storage where the provider reports it. */
export async function remotes() {
  let version = "";
  try {
    version = (await run(["version"], 10_000)).split("\n")[0].trim();
  } catch (e) {
    if (e.missing) return { installed: false, remotes: [] };
    throw e;
  }
  const dump = JSON.parse((await run(["config", "dump"], 15_000)) || "{}");
  const names = Object.keys(dump).filter((n) => NAME.test(n));
  const out = await Promise.all(
    names.map(async (name) => {
      const type = String(dump[name]?.type ?? "");
      try {
        const about = JSON.parse(await run(["about", `${name}:`, "--json"]));
        return { name, type, total: about.total ?? null, used: about.used ?? null, free: about.free ?? null, trashed: about.trashed ?? null };
      } catch (e) {
        return { name, type, error: String(e.message ?? e) };
      }
    }),
  );
  return { installed: true, version, remotes: out };
}
