// A throwaway dev server for verifying changes, isolated from the real one.
//
// Two Next dev servers sharing .next in this folder corrupt it — EINVAL on
// readlink, then blanket 500s on every route — so this one gets its own build
// directory. It also gets its own Recall data directory and no app password,
// so poking at it can never touch the real gate file or the family board.
//
// Local only. Never point this at a directory you care about.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const port = process.argv[2] ?? "3210";

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

spawn("npx", ["next", "dev", "-p", port], {
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
