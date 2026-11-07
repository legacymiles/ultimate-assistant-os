// ---------------------------------------------------------------------------
// Projects Timeline › Super Prompt's two "it already exists" modes.
//
//   buildChangePrompt — redesign, remix or add to something that exists, while
//                       keeping every feature it has (the owner's complaint was
//                       an AI tool dropping features already asked for).
//   buildRepoBrief    — an AGENTS.md for any repo (a client site, a project
//                       that lives outside the hub), so any AI tool that opens
//                       that repo gets the whole record first.
//
// Both merge everything the timeline holds: the repo doc's features, look,
// code map and rules (docs/apps/<slug>.md, when the project is a hub app), the
// owner's own features, the edit log, versions and the Knowledge Inbox.
// Pure and instant; no API call.
// ---------------------------------------------------------------------------

import type { AppDoc } from "./appDocs";
import { plain } from "./appDocs";
import { KNOWLEDGE_KIND_LABELS, type Project } from "../types";

export type ChangeKind = "redesign" | "remix" | "add" | "fix";

export const CHANGE_STARTERS: { kind: ChangeKind; label: string; text: string }[] = [
  { kind: "redesign", label: "Redesign the look", text: "Redesign how it looks. Keep every feature and every flow working exactly as it does now." },
  { kind: "remix", label: "Remix into something new", text: "Remix it into a new app that keeps the features below as its starting point, with this twist: " },
  { kind: "add", label: "Add a feature", text: "Add this feature without changing anything that already works: " },
  { kind: "fix", label: "Fix something", text: "Fix this, and change nothing else: " },
];

const EDITS_IN_BRIEF = 15;

function features(project: Project, doc: AppDoc | null, L: string[]) {
  const mine = project.features;
  if (doc?.features.length) {
    L.push(`### In the code today (${doc.features.length}) — from \`docs/apps/${doc.slug}.md\``, "");
    let group = "";
    for (const f of doc.features) {
      if (f.group && f.group !== group) {
        group = f.group;
        L.push(`**${group}**`);
      }
      L.push(`- **${plain(f.title)}**${f.text ? ` — ${plain(f.text)}` : ""}${f.files.length ? ` (${f.files.map((p) => `\`${p}\``).join(", ")})` : ""}`);
    }
    L.push("");
  }
  if (mine.length) {
    L.push(`### Added by the owner in Projects Timeline (${mine.length})`, "");
    for (const f of mine) L.push(`- **${f.title}** (${f.group})${f.description ? ` — ${f.description}` : ""}`);
    L.push("");
  }
  if (!doc?.features.length && !mine.length) {
    L.push("_No features recorded yet. Read the code and list what it does before changing anything._", "");
  }
  if (doc?.missing.length) {
    L.push("### Described before but not found in the code", "", "Ask the owner whether these should exist before building them:", "");
    for (const m of doc.missing) L.push(`- ${plain(m)}`);
    L.push("");
  }
}

function lookAndCode(doc: AppDoc | null, L: string[]) {
  if (!doc) return;
  if (doc.look.length) {
    L.push("## How it looks", "");
    for (const l of doc.look) L.push(`- ${l}`);
    if (doc.screenshot) L.push(`- Screenshot: \`public${doc.screenshot}\``);
    L.push("");
  }
  if (doc.code.length) {
    L.push("## Where the code is", "", "| Part | Path |", "|---|---|");
    for (const c of doc.code) L.push(`| ${c.part} | ${c.path} |`);
    L.push("");
  }
  if (doc.rules.length) {
    L.push("## The owner's rules", "");
    for (const r of doc.rules) L.push(`- ${r}`);
    L.push("");
  }
}

function history(project: Project, L: string[]) {
  const edits = project.edits ?? [];
  if (edits.length) {
    L.push(`## Recent changes (newest first, ${Math.min(edits.length, EDITS_IN_BRIEF)} of ${edits.length})`, "");
    for (const e of edits.slice(0, EDITS_IN_BRIEF)) L.push(`- ${e.date} — ${e.title}`);
    L.push("");
  }
  const versions = [...project.versions].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
  if (versions.length) {
    L.push("## Versions", "");
    for (const v of versions) L.push(`- v${v.number} — ${v.summary || "no summary"}`);
    L.push("");
  }
  if (project.knowledge.length) {
    L.push("## The owner's notes (Knowledge Inbox)", "", "These are real requirements and decisions. Honour them.", "");
    for (const k of [...project.knowledge].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))) {
      L.push(`- **${k.title || KNOWLEDGE_KIND_LABELS[k.kind]}** (${KNOWLEDGE_KIND_LABELS[k.kind]}, ${k.created_at.slice(0, 10)})`);
      for (const line of k.content.split(/\n+/).map((x) => x.trim()).filter(Boolean)) L.push(`  - ${line}`);
    }
    L.push("");
  }
}

function about(project: Project, doc: AppDoc | null, L: string[]) {
  if (project.one_liner || doc?.tag) L.push(`> ${project.one_liner || doc?.tag}`, "");
  const overview = project.overview || doc?.overview;
  if (overview) L.push(overview, "");
  if (project.detailed) L.push("### In detail", "", project.detailed, "");
}

/** A prompt to change something that already exists without losing anything it has. */
export function buildChangePrompt(project: Project, doc: AppDoc | null, change: string): string {
  const L: string[] = [];
  const what = change.trim();
  L.push(`# Change "${project.name}" — keep everything it already does`, "");
  L.push(
    "This already exists and works. Your job is the change below and nothing else. Every feature listed " +
      "under **Features** must still work when you are done: dropping, hiding or \"simplifying away\" one is a " +
      "failure, even if its code looks unused. If the change truly needs one gone, stop and ask.",
    "",
  );
  L.push("## The change", "", what || "_Not written yet — ask the owner what should change before you start._", "");
  L.push("## What it is", "");
  about(project, doc, L);
  L.push("## Features — all of these must still work", "");
  features(project, doc, L);
  lookAndCode(doc, L);
  history(project, L);
  L.push("## How to do it", "");
  if (doc) {
    L.push(
      "1. You are in the `legacymiles/ultimate-assistant-os` repo. Read `AGENTS.md`, then `docs/apps/" + doc.slug + ".md`, then `DESIGN.md`.",
      "2. Run `git fetch origin && git status -sb`. If this checkout is behind `origin/main`, stop and say so.",
    );
  } else {
    L.push("1. Read the repo's `AGENTS.md` or `README.md` first, and find where each feature above lives before editing.", "2. Make sure you are on the newest code (`git pull`) before you start.");
  }
  L.push(
    "3. Work on a new branch. Make the change.",
    "4. Go down the Features list one by one and check each still works — open it, at laptop and phone width. Don't assume.",
    "5. Update the app's doc (features, how it looks) in the same commit, if either changed.",
    "6. Open a pull request. Never push to main; the owner merges.",
    "",
    "---",
    `_From Projects Timeline's record of "${project.name}"${doc ? ` and docs/apps/${doc.slug}.md` : ""}._`,
  );
  return L.join("\n");
}

/** An AGENTS.md for any repo: the full record, written as standing instructions. */
export function buildRepoBrief(project: Project, doc: AppDoc | null): string {
  const L: string[] = [];
  L.push(`# ${project.name} — read this first`, "");
  L.push(
    "For every AI coding tool that opens this repo (Claude Code, Codex, Cursor, Gemini, Copilot…). It is the owner's " +
      "record of this project, exported from Projects Timeline. Read all of it before you change anything.",
    "",
  );
  L.push("## What it is", "");
  about(project, doc, L);
  L.push("## Features — every one must keep working", "");
  L.push("The owner asked for each of these. A change that drops one is a regression. If a change needs one gone, ask first.", "");
  features(project, doc, L);
  lookAndCode(doc, L);
  history(project, L);
  L.push(
    "## Working here",
    "",
    "- Get the newest code first (`git pull`). If your copy is behind, say so before building.",
    "- Keep the look described above unless the owner asks to change it.",
    "- Check every feature above still works before you call a change done, on a laptop and a phone.",
    "- When you add a feature or change the look, add it to this file in the same commit.",
    "- Work on a branch and open a pull request. The owner merges.",
    "",
    "---",
    `_Exported from Projects Timeline on ${new Date().toISOString().slice(0, 10)}. Re-export after big changes so this stays current._`,
  );
  return L.join("\n");
}
