// A throwaway dev server for verifying changes, isolated from the real one.
//
// Two Next dev servers sharing .next in this folder corrupt it — EINVAL on
// readlink, then blanket 500s on every route — so this one gets its own build
// directory. It also gets its own Recall data directory and no app password,
// so poking at it can never touch the real gate file or the family board.
//
// Local only. Never point this at a directory you care about.
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const port = process.argv[2] ?? "3210";

// --no-parent-watch keeps the server alive after whatever started this script
// exits. Only for a deliberately detached run; see the watchdog at the bottom.
const noParentWatch = process.argv.includes("--no-parent-watch");

// --no-auth blanks the public Supabase keys, which turns the hub's sign-in wall
// off (middleware only gates when Supabase is configured) and drops every app
// onto its signed-out, localStorage-only path. That is the path worth verifying
// anyway, and it means checking a UI never needs a real account's password.
const noAuth = process.argv.includes("--no-auth");

// --no-auth-keep-storage blanks only the anon key: the sign-in wall is still
// off, but the server-side Supabase URL + service-role key keep working, so
// features that need real Storage (Dance Studio hands signed links to a video
// model) can be verified end to end. Writes go to the real project.
const keepStorage = process.argv.includes("--no-auth-keep-storage");

// Plain KEY=value arguments become environment variables for this server only.
// What it is for: checking a screen that behaves differently when a public key
// is configured — the Photos tab and Google Drive, say — without putting that
// key in .env.local, where the real dev server would pick it up too.
const extraEnv = Object.fromEntries(
  process.argv
    .slice(3)
    .filter((a) => /^[A-Z][A-Z0-9_]*=/.test(a))
    .map((a) => [a.slice(0, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]),
);

const child = spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    ...(noAuth
      ? { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }
      : {}),
    ...(keepStorage ? { NEXT_PUBLIC_SUPABASE_ANON_KEY: "" } : {}),
    NEXT_DIST_DIR: `.next-preview-${port}`,
    RECALL_DATA_DIR: resolve(`.preview-data-${port}`),
    // Same reasoning for Dance Vault: a preview run must not write today's
    // pick into the real .dances-daily.json and burn the day's search.
    DANCES_DATA_DIR: resolve(`.preview-data-${port}`),
    // And STD Safe: a preview must never write a test account or a lab report
    // into the real store, which holds actual health records.
    STDSAFE_DATA_DIR: resolve(`.preview-data-${port}`),
    // Empty rather than unset: Next will not overwrite a key that already
    // exists, so this wins over RECALL_PASSWORD in .env.local.
    RECALL_PASSWORD: "",
    ...extraEnv,
  },
});

// Everything below exists so this server dies with the session that asked for
// it. `shell: true` above means the real Next server is a GRANDCHILD:
//
//   this script -> cmd.exe -> npx -> next -> next/dist/server/.../start-server.js
//
// and on Windows a child is NOT killed when its parent dies. Without this, every
// run leaked a multi-GB Next server that outlived its session forever. On
// 2026-11-25 four of them were holding 12 GB of RAM between them.

let shuttingDown = false;

function killTree() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!child.pid) return;
  if (process.platform === "win32") {
    // /T takes the whole descendant tree, which is the point — killing the
    // cmd.exe alone would leave the Next server running.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
}

// Ctrl-C and ordinary termination: tear the tree down, then leave.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    killTree();
    process.exit(0);
  });
}

// Last-resort sweep for any exit path that did not go through a signal.
process.on("exit", killTree);

// If Next falls over on its own, don't linger as an empty parent.
child.on("exit", (code) => {
  shuttingDown = true;
  process.exit(code ?? 0);
});

// The watchdog, and the only part that catches the case that actually leaked:
// when the parent is killed outright (a closed session, taskkill /F) this
// script gets no signal at all, so none of the handlers above ever run. Poll
// for the parent instead and shut down once it is gone.
if (!noParentWatch) {
  const parentPid = process.ppid;
  const watch = setInterval(() => {
    try {
      // Signal 0 tests for existence without touching the process.
      process.kill(parentPid, 0);
    } catch (err) {
      // ESRCH means gone. EPERM means it exists but is not ours to signal —
      // still alive, so keep running.
      if (err.code === "ESRCH") {
        killTree();
        process.exit(0);
      }
    }
  }, 5000);
  // Don't let the timer itself hold the process open.
  watch.unref();
}
