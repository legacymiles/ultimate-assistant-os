// ---------------------------------------------------------------------------
// Which coding harness App Builder and Client Review hand a build to.
//
// Both used to name `claude` in the call, which made one laptop's setup a hard
// rule for every deployment: a machine where Claude Code is not signed in but
// DeepSeek Harness is installed could not build anything, and the panel could
// only say the agent "answered without doing anything".
//
// So it is a setting now, defaulting to the old behaviour. `claude` stays the
// default because its Agent SDK path can carry a permission prompt to the page;
// dsh works the same way here (read-only sandbox, every write escalates) and is
// the right choice when that is the harness the owner actually runs.
// ---------------------------------------------------------------------------

import type { HarnessId } from "./types";

/** What a build runs on. Set NEXT_PUBLIC_JARVIS_BUILD_HARNESS=deepseek to switch. */
export function buildHarness(): HarnessId {
  const asked = (process.env.NEXT_PUBLIC_JARVIS_BUILD_HARNESS ?? "").trim().toLowerCase();
  return asked === "deepseek" ? "deepseek" : "claude";
}
