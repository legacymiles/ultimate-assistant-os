// ---------------------------------------------------------------------------
// Camera Autopilot — how the photo pipeline learns the owner.
//
// Two kinds of memory, both fed into every vision call through
// `standingGuidance()` so the model's FIRST guess improves rather than the
// owner having to correct the same thing forever:
//
//   rules     plain sentences the owner told Jarvis ("song images go to my
//             Classifier"), or that Jarvis learned and the owner can see and
//             switch off. Each one is visible on the Deck — a rule the owner
//             cannot see is a rule they cannot fix.
//
//   examples  the last few photos actually filed, with where they went and
//             whether the owner corrected the proposal. Few-shot by example is
//             what makes "photos like this one" work without anyone writing a
//             rule at all.
//
// Learning never FILES anything. It only changes the proposal; the review
// queue's "nothing is filed without a yes" rule is untouched.
//
// Synced, because habits belong to the person, not to the browser.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { destinationById } from "@/lib/dashboard/destinations/registry";
import type { PendingPhoto } from "./types";

export const AUTOPILOT_KEY = "photo-autopilot:v1";
/** Announced on every write so the Deck and the Photos tab stay in step. */
export const AUTOPILOT_CHANGED = "photo-autopilot-changed";

export type RuleSource = "told" | "learned" | "preset";

export interface AutopilotRule {
  id: string;
  text: string;
  source: RuleSource;
  on: boolean;
  createdAt: string;
}

export interface AutopilotExample {
  /** What the photo was: its title and a few tags. */
  what: string;
  /** Where it was filed, as the owner would say it. */
  where: string;
  /** The owner changed the proposal before approving. */
  corrected: boolean;
  at: string;
}

export interface AutopilotData {
  rules: AutopilotRule[];
  examples: AutopilotExample[];
}

const MAX_RULES = 40;
const MAX_EXAMPLES = 40;
/** Examples sent to the model. Recent ones only — habits drift. */
const PROMPT_EXAMPLES = 14;
/** Filings of the same tag to the same place before it becomes a rule. */
const LEARN_AFTER = 3;

const EMPTY: AutopilotData = { rules: [], examples: [] };

function rid(): string {
  return `apr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function getAutopilot(): AutopilotData {
  const d = loadLocal<AutopilotData>(AUTOPILOT_KEY, EMPTY);
  // Fresh arrays every time: the writers below mutate what this returns, and
  // on a new account that would otherwise be the shared EMPTY default.
  return {
    rules: Array.isArray(d?.rules) ? d.rules.map((r) => ({ ...r })) : [],
    examples: Array.isArray(d?.examples) ? [...d.examples] : [],
  };
}

function save(d: AutopilotData): AutopilotData {
  const next = { rules: d.rules.slice(-MAX_RULES), examples: d.examples.slice(-MAX_EXAMPLES) };
  saveSynced(AUTOPILOT_KEY, next);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTOPILOT_CHANGED));
  return next;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Add a rule unless an equivalent one exists; an existing one is switched back on. */
export function addRule(text: string, source: RuleSource = "told"): AutopilotData {
  const clean = text.trim().slice(0, 240);
  if (!clean) return getAutopilot();
  const d = getAutopilot();
  const same = d.rules.find((r) => norm(r.text) === norm(clean));
  if (same) {
    same.on = true;
    // A rule the owner states outranks one Jarvis inferred.
    if (source === "told") same.source = "told";
    return save(d);
  }
  d.rules.push({ id: rid(), text: clean, source, on: true, createdAt: new Date().toISOString() });
  return save(d);
}

export function toggleRule(id: string): AutopilotData {
  const d = getAutopilot();
  const r = d.rules.find((x) => x.id === id);
  if (r) r.on = !r.on;
  return save(d);
}

export function removeRule(id: string): AutopilotData {
  const d = getAutopilot();
  d.rules = d.rules.filter((r) => r.id !== id);
  return save(d);
}

/** Where a pending photo is going, in the owner's words rather than a path array. */
export function destinationLabel(p: PendingPhoto): string {
  const a = p.analysis;
  if (a?.destination) {
    const dest = destinationById(a.destination.id);
    if (dest) {
      const fields = dest.parse(a.destination.fields);
      if (fields) return dest.preview(fields).where;
      return dest.label;
    }
  }
  if (a?.route === "event") return "Calendar";
  return (p.destPath ?? ["Inbox"]).join(" › ");
}

/**
 * Remember what was just filed. Called by approvePhotos with the photos that
 * actually made it, so a failed filing never teaches anything.
 *
 * A tag that keeps landing in the same place becomes a learned rule — shown on
 * the Deck, switchable off — which is the "it gets better on its own" part.
 */
export function learnFromApprovals(photos: PendingPhoto[]): void {
  if (!photos.length) return;
  const d = getAutopilot();
  const at = new Date().toISOString();

  for (const p of photos) {
    const tags = (p.analysis?.tags ?? []).slice(0, 4);
    const title = p.analysis?.title || p.name;
    d.examples.push({
      what: tags.length ? `${title} [${tags.join(", ")}]` : title,
      where: destinationLabel(p),
      corrected: Boolean(p.overridden),
      at,
    });
  }

  // Tag → place counts across the remembered window.
  const counts = new Map<string, number>();
  for (const ex of d.examples) {
    const tags = ex.what.match(/\[(.*)\]$/)?.[1]?.split(", ") ?? [];
    for (const t of tags) {
      const k = `${t}\u0000${ex.where}`;
      counts.set(k, (counts.get(k) ?? 0) + (ex.corrected ? 2 : 1));
    }
  }
  for (const [k, n] of counts) {
    if (n < LEARN_AFTER) continue;
    const [tag, where] = k.split("\u0000");
    // People photos are never auto-ruled: a wrong family folder is the one
    // mistake this pipeline is built to avoid.
    if (where.startsWith("Photos")) continue;
    const text = `Images tagged "${tag}" go to ${where}`;
    if (!d.rules.some((r) => norm(r.text) === norm(text))) {
      d.rules.push({ id: rid(), text, source: "learned", on: true, createdAt: at });
    }
  }

  save(d);
}

/**
 * The block sent with every vision call. Empty when there is nothing learned,
 * so a fresh account's prompt is byte-identical to before.
 */
export function standingGuidance(data: AutopilotData = getAutopilot()): string {
  const rules = data.rules.filter((r) => r.on).slice(-24);
  const examples = data.examples.slice(-PROMPT_EXAMPLES);
  const parts: string[] = [];
  if (rules.length) {
    parts.push("Rules the user has set or confirmed:\n" + rules.map((r) => `- ${r.text}`).join("\n"));
  }
  if (examples.length) {
    parts.push(
      "How the user filed recent photos (match these habits for similar photos):\n" +
        examples
          .map((e) => `- ${e.what} → ${e.where}${e.corrected ? " (the user corrected the guess to this)" : ""}`)
          .join("\n"),
    );
  }
  return parts.join("\n\n").slice(0, 3000);
}

/** Starter rules offered in onboarding — chosen there, never applied silently. */
export const PRESET_RULES: { id: string; text: string; label: string }[] = [
  { id: "songs", label: "Song screenshots → Audio Studio Classifier", text: "Screenshots or photos of a song (now-playing screens, playlists, track names) go to the Music Classifier in Jarvis Audio Studio" },
  { id: "repos", label: "Code repo screenshots → Folders › Repos", text: "Screenshots of a GitHub or code repository go to Folders › Repos so the repo can be found and saved" },
  { id: "receipts", label: "Receipts → Folders › Receipts", text: "Receipts and invoices go to Folders › Receipts" },
  { id: "prompts", label: "Prompt screenshots → Skills Library", text: "Screenshots of a prompt or AI instructions go to the Skills Library" },
  { id: "recipes", label: "Recipes → Cookbook", text: "Photos of recipes go to my cookbook" },
];
