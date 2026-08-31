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

spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NEXT_DIST_DIR: `.next-preview-${port}`,
    RECALL_DATA_DIR: resolve(`.preview-data-${port}`),
    // Same reasoning for Dance Vault: a preview run must not write today's
    // pick into the real .dances-daily.json and burn the day's search.
    DANCES_DATA_DIR: resolve(`.preview-data-${port}`),
    // Empty rather than unset: Next will not overwrite a key that already
    // exists, so this wins over RECALL_PASSWORD in .env.local.
    RECALL_PASSWORD: "",
  },
});
