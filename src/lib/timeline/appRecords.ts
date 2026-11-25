// ---------------------------------------------------------------------------
// Projects Timeline › App records — the per-app truth file, in the browser.
//
// app-records.json is written by `npm run apps:records` from docs/apps/<slug>.md
// (the hand-written half) plus a scan of the app's code (the "From the code"
// half). `npm run check:records` keeps the two from drifting. Read-only here.
// ---------------------------------------------------------------------------

import RECORDS from "./app-records.json";
import type { Project } from "../types";
import type { AppRecord } from "./records";

export const APP_RECORDS = RECORDS as unknown as AppRecord[];

const bySlug = new Map(APP_RECORDS.map((r) => [r.slug, r]));

export function recordFor(project: Pick<Project, "catalog_slug"> | null | undefined): AppRecord | null {
  return project?.catalog_slug ? (bySlug.get(project.catalog_slug) ?? null) : null;
}

/** The counts a record's code half boils down to, for one summary line. */
export function codeSummary(r: AppRecord): string {
  const c = r.code;
  const policies = c.tables.reduce((n, t) => n + t.policies.length, 0);
  const bits = [
    [c.api.length, "route"],
    [c.signIn.length, "sign-in check"],
    [c.tables.length, "table"],
    [policies, "policy", "policies"],
    [c.env.length, "key"],
    [c.tests.length, "test"],
  ] as const;
  return bits
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : (many ?? `${one}s`)}`)
    .join(" · ");
}
