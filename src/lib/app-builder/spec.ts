// ---------------------------------------------------------------------------
// App Builder — the app's spec, and edits as deltas against it.
//
// A website gets edited for years. Every edit after the first was being
// written against the ORIGINAL plan, because that is all the project held —
// so the brief for "move the contact form up" never said what else the site
// does, and nothing told the builder which of it must still work afterwards.
//
// This is OpenSpec's idea, which is the right one: keep ONE spec of what the
// thing does now, write each change as what it ADDS, MODIFIES or REMOVES, and
// fold the change into the spec when it ships. A removal states a reason, so a
// feature can never quietly disappear between versions.
//
// Pure: no fetch, no storage, no model.
// ---------------------------------------------------------------------------

import type { AppSpec, BuilderProject, Feature, Scenario, SpecDelta } from "./types";

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Freeze what shipped: the accepted features and their scenarios.
 *
 * Called when a build reports done. Proposed features are ideas and denied
 * ones were turned down, so neither is part of what the app DOES.
 */
export function specFrom(p: BuilderProject, at = new Date().toISOString()): AppSpec {
  return {
    at,
    ...(p.edit?.version ? { version: p.edit.version } : {}),
    features: p.features
      .filter((f) => f.status === "accepted")
      .map((f) => ({ ...f, scenarios: f.scenarios ? f.scenarios.map((s) => ({ ...s })) : undefined })),
  };
}

/**
 * The spec after this build — OpenSpec's "archive" step.
 *
 * An edit MERGES into what was already there: the features it did not touch
 * stay, the ones it changed are replaced, and the ones it removed go. A new
 * app has nothing to merge into, so its spec is simply what it shipped.
 */
export function foldSpec(p: BuilderProject, at = new Date().toISOString()): AppSpec {
  const shipped = specFrom(p, at);
  const had = p.spec;
  if (!had || !p.edit) return shipped;

  // Matched by title throughout, because a client edit's features are the
  // owner's wording of a request and carry no id from the old spec.
  const removed = new Set(p.features.filter((f) => f.status === "denied").map((f) => f.title.toLowerCase()));
  const byTitle = new Map(shipped.features.map((f) => [f.title.toLowerCase(), f] as const));
  const kept = had.features.filter((f) => !removed.has(f.title.toLowerCase()) && !byTitle.has(f.title.toLowerCase()));
  const features = [...kept, ...shipped.features].map((f, i) => {
    const id = `f${i + 1}`;
    return { ...f, id, scenarios: f.scenarios?.map((s, j) => ({ ...s, id: `${id}.s${j + 1}` })) };
  });
  return { ...shipped, features };
}

/**
 * This edit, written against the spec: what it adds, changes and removes.
 *
 * Matched by title, because a client edit's features are the owner's wording
 * of a request and carry no id from the old spec. A title that was already in
 * the spec is a MODIFIED; a new one is ADDED; a spec feature the owner denied
 * on this list is REMOVED.
 */
export function deltasFor(p: BuilderProject): SpecDelta[] {
  const spec = p.spec;
  if (!spec) return [];
  const inSpec = new Map(spec.features.map((f) => [f.title.toLowerCase(), f] as const));
  const out: SpecDelta[] = [];

  for (const f of p.features) {
    const was = inSpec.get(f.title.toLowerCase());
    if (f.status === "denied") {
      if (was) {
        out.push({
          kind: "removed",
          featureId: was.id,
          title: was.title,
          // The owner denying a shipped feature IS the reason; the brief asks
          // for it in words, and `checkDeltas` blocks a removal without one.
          reason: f.why ? oneLine(f.why) : "",
          scenarios: (was.scenarios ?? []).map((s) => s.id),
        });
      }
      continue;
    }
    if (f.status !== "accepted") continue;
    if (!was) {
      out.push({
        kind: "added",
        featureId: f.id,
        title: f.title,
        detail: oneLine(f.detail),
        scenarios: (f.scenarios ?? []).map((s) => s.id),
      });
      continue;
    }
    const changedScenarios = (f.scenarios ?? []).filter((s) => {
      const had = (was.scenarios ?? []).find((x) => x.when.toLowerCase() === s.when.toLowerCase());
      return !had || had.then.toLowerCase() !== s.then.toLowerCase();
    });
    if (oneLine(f.detail) !== oneLine(was.detail) || changedScenarios.length) {
      out.push({
        kind: "modified",
        featureId: was.id,
        title: f.title,
        detail: oneLine(f.detail),
        scenarios: changedScenarios.map((s) => s.id),
      });
    }
  }
  return out;
}

/** Spec features this edit does not touch — the regression list. */
export function untouched(p: BuilderProject): Feature[] {
  const spec = p.spec;
  if (!spec) return [];
  // Only MODIFIED and REMOVED name a spec feature. An ADDED carries the NEW
  // feature's own id, which can easily be "f1" and collide with a spec id —
  // and a collision here would quietly drop a live feature from the list of
  // things that must still pass, which is the one list that must be complete.
  const touched = new Set(deltasFor(p).filter((d) => d.kind !== "added").map((d) => d.featureId));
  return spec.features.filter((f) => !touched.has(f.id));
}

/** Every scenario that must still pass after this edit. */
export function mustStillPass(p: BuilderProject): Scenario[] {
  return untouched(p).flatMap((f) => f.scenarios ?? []);
}

/**
 * What is wrong with this set of deltas, in the owner's words.
 *
 * One rule, and it is OpenSpec's: a REMOVED needs a reason. A feature that
 * shipped and then vanished with no reason recorded is the thing nobody can
 * explain six months later.
 */
export function checkDeltas(p: BuilderProject): string[] {
  return deltasFor(p)
    .filter((d) => d.kind === "removed" && !d.reason)
    .map((d) => `“${d.title}” is being removed from the site, but no reason is recorded. Say why in its Why field.`);
}

/**
 * The delta as a block of the build brief.
 *
 * Both halves matter: what to change, and what must still work afterwards.
 * The second half is the one that was always missing — it is why an edit could
 * break a form two pages away and the report would still read green.
 */
export function deltaBlock(p: BuilderProject, max = 2_400): string {
  const deltas = deltasFor(p);
  if (!deltas.length && !p.spec) return "";
  const keep = mustStillPass(p);
  const word = { added: "ADDED", modified: "MODIFIED", removed: "REMOVED" } as const;
  const lines = [
    "<change_against_spec>",
    `The site already has a spec — what it does as of ${p.spec?.version ? `${p.spec.version}, ` : ""}its last shipped build. This change is a delta against it, not a fresh plan.`,
    ...deltas.map((d) =>
      [
        `${word[d.kind]} ${d.featureId} ${d.title}`,
        d.detail ? `: ${d.detail}` : "",
        d.reason ? ` (reason: ${d.reason})` : "",
        d.scenarios?.length ? ` [checks: ${d.scenarios.join(" ")}]` : "",
      ].join(""),
    ),
    ...(keep.length
      ? [
          "",
          `UNCHANGED — these ${keep.length} checks already pass on the live site and must STILL pass when you are done. Run them before you post the preview; if one breaks, that is a regression, not a side effect:`,
          ...keep.map((s) => `- ${s.id} WHEN ${s.when} THEN ${s.then}`),
        ]
      : []),
    "</change_against_spec>",
  ].join("\n");
  return lines.length > max ? `${lines.slice(0, max - 1)}…` : lines;
}

/** The same thing in one line, for the In Queue brief's tight budget. */
export function deltaLine(p: BuilderProject): string {
  const deltas = deltasFor(p);
  if (!deltas.length) return "";
  const n = { added: 0, modified: 0, removed: 0 };
  for (const d of deltas) n[d.kind]++;
  const keep = mustStillPass(p).length;
  const parts = [
    n.added ? `${n.added} added` : "",
    n.modified ? `${n.modified} changed` : "",
    n.removed ? `${n.removed} removed` : "",
  ].filter(Boolean);
  return `Against the site's spec: ${parts.join(", ")}.${keep ? ` ${keep} existing checks must still pass — run them before posting the preview.` : ""}`;
}

/**
 * The spec as the markdown that goes in `docs/apps/<slug>.md`.
 *
 * A spec that lives only in a synced blob is one the next tool cannot read.
 * In the repo it is what Projects Timeline, a harness and the next session all
 * see without being told it exists.
 */
export function specMarkdown(spec: AppSpec, name: string): string {
  return [
    `## Scenarios`,
    "",
    `_What ${name} does, as of ${spec.at.slice(0, 10)}${spec.version ? ` (${spec.version})` : ""}. Generated by App Builder — each line is checked by a test named with its id._`,
    "",
    ...spec.features.flatMap((f) => [
      `### ${f.id} ${f.title}`,
      "",
      f.detail,
      "",
      ...(f.scenarios ?? []).map((s) => `- **${s.id}** ${s.given ? `GIVEN ${s.given}, ` : ""}WHEN ${s.when} THEN ${s.then} _(${s.proof})_`),
      "",
    ]),
  ].join("\n");
}
