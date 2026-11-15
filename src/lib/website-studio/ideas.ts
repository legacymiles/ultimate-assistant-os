// ---------------------------------------------------------------------------
// Ideas that go with an edit — App Builder's "here are the features, accept or
// deny each" brought to a website that is already live.
//
// A new website gets the full feature list (Felix, 10-14 features, Features
// tab). An edit is smaller and should stay fast, so it gets a few ideas that
// belong WITH the change the owner just asked for — never a redesign, never a
// gate. The edit is filed and the look pass starts at once; the ideas arrive
// beside it, and an accepted one is folded into the same request's wording
// (the owner's reword, `adminText`), so it is built in the same pass. Nothing
// waits on them and nothing is added unless the owner accepts it.
// ---------------------------------------------------------------------------

export type IdeaStatus = "proposed" | "accepted" | "denied";

export interface EditIdea {
  id: string;
  /** Max ~6 words. */
  title: string;
  /** What it adds, concretely. */
  detail: string;
  /** Why it belongs with this edit. */
  why: string;
  status: IdeaStatus;
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** A model's answer turned into ideas, or nothing. Never more than five. */
export function coerceIdeas(raw: unknown): EditIdea[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: EditIdea[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = clip(o.title, 60);
    const detail = clip(o.detail, 240);
    if (!title || !detail || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    out.push({ id: `i${out.length + 1}`, title, detail, why: clip(o.why, 200), status: "proposed" });
    if (out.length === 5) break;
  }
  return out;
}

interface Rule {
  test: RegExp;
  ideas: Omit<EditIdea, "id" | "status">[];
}

/** With no AI: a few ideas from what kind of change it is. Honest, small, and skippable. */
const RULES: Rule[] = [
  {
    test: /\b(colou?r|blue|red|green|yellow|purple|pink|orange|black|white|dark|light|theme|background)\b/i,
    ideas: [
      { title: "Match buttons and links", detail: "Carry the new colour into buttons, links and focus rings so the page reads as one.", why: "A colour change that stops at the background looks unfinished." },
      { title: "Keep text readable", detail: "Check every text colour against the new background and adjust any that fall below 4.5:1 contrast.", why: "New colours are the usual way contrast quietly breaks." },
      { title: "Dark and light both", detail: "Make the change hold in dark mode and light mode, not just the one on screen.", why: "Visitors on the other mode would otherwise see the old look." },
    ],
  },
  {
    test: /\b(font|text|heading|title|copy|wording|words|bigger|smaller|size)\b/i,
    ideas: [
      { title: "Same change on phones", detail: "Size and wrap the new text for a 390px screen so nothing overflows or truncates.", why: "Text edits are made on a laptop and break on a phone." },
      { title: "Tighten the hierarchy", detail: "Bring the headings and body around the change into one clear scale.", why: "One changed size next to the old ones looks accidental." },
    ],
  },
  {
    test: /\b(button|form|sign ?up|contact|book|checkout|cta|link)\b/i,
    ideas: [
      { title: "Loading and error states", detail: "Show a busy state while it works and a plain-English message when it fails.", why: "A button with no feedback gets pressed twice." },
      { title: "Works with the keyboard", detail: "Make it reachable with Tab and pressable with Enter, with a visible focus ring.", why: "Keyboard users are locked out otherwise." },
    ],
  },
  {
    test: /\b(image|photo|picture|logo|hero|banner|video|icon)\b/i,
    ideas: [
      { title: "Fast-loading images", detail: "Serve the new image sized for the screen, lazy below the fold, with a set width and height.", why: "A new hero image is the most common way a page gets slow." },
      { title: "Describe it for screen readers", detail: "Give the new image alt text that says what it shows.", why: "Without it the change is invisible to some visitors." },
    ],
  },
];

export function offlineIdeas(edit: string): EditIdea[] {
  const picked = RULES.filter((r) => r.test.test(edit)).flatMap((r) => r.ideas);
  return coerceIdeas(picked);
}

/**
 * The request's wording with the accepted ideas folded in — what the build
 * reads. Denied and undecided ideas are never in it.
 */
export function foldIdeas(text: string, ideas: EditIdea[]): string {
  const yes = ideas.filter((i) => i.status === "accepted");
  if (!yes.length) return text.trim();
  return `${text.trim()}\n\nAlso, as part of the same edit:\n${yes.map((i) => `- ${i.title}: ${i.detail}`).join("\n")}`;
}

/** Accept or deny one, leaving the rest alone. Pressing the same choice again sets it back to proposed. */
export function decide(ideas: EditIdea[], id: string, choice: "accepted" | "denied"): EditIdea[] {
  return ideas.map((i) => (i.id !== id ? i : { ...i, status: i.status === choice ? "proposed" : choice }));
}
