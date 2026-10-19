// ---------------------------------------------------------------------------
// Felix — the end goal first, then the bar.
//
// Pure logic behind Jarvis's Goal check panel and the Enhance button:
//
//   topicOf(text)        is this prompt about building / fixing something?
//   QUESTIONS[topic]     the intake: end goal first, then who, success, features…
//   checklistFor(...)    which rules of the one build checklist apply
//   draftBrief(...)      a structured prompt built from the answers, with no AI —
//                        the offline fallback, and the draft the AI enhances
//   ticketFrom(...)      the same brief as a super-board card (Felix format)
//
// The skill text lives in skills/felix (and in Jarvis's skill store). The
// checklist is the ONE build checklist kept in Profile › Backend checklist
// (src/lib/jarvis-profile/checklist.ts); this file only picks which of its
// coded lines a brief should cite.
// ---------------------------------------------------------------------------

import { STARTER_LINES, type RuleLevel } from "../jarvis-profile/checklist";

export type FelixTopic = "app" | "website" | "plugin" | "fix" | "content";

export const TOPIC_LABEL: Record<FelixTopic, string> = {
  app: "New app or feature",
  website: "Website",
  plugin: "Jarvis plugin",
  fix: "Fix",
  content: "Writing",
};

export interface FelixQuestion {
  id: string;
  label: string;
  /** Shown under the label: why the question is asked. */
  hint?: string;
  /** Chips. The first is the recommended one where it applies. */
  options?: string[];
  multi?: boolean;
  /** A free-text box, with or without chips. */
  free?: boolean;
  placeholder?: string;
}

const LOOK = ["Match Jarvis (minimal, futuristic)", "Clean & professional", "Bold & playful", "I have a reference"];
const TOUCHES = ["Accounts / sign-in", "Payments", "Personal data", "Other apps", "AI", "Works offline"];

export const QUESTIONS: Record<FelixTopic, FelixQuestion[]> = {
  app: [
    { id: "goal", label: "End goal", hint: "What should be true for people once this exists?", free: true, placeholder: "e.g. my clients book without calling me" },
    { id: "audience", label: "Who it's for", options: ["Just me", "My clients", "Jarvis users", "The public"] },
    {
      id: "success",
      label: "How we'll know it worked",
      options: ["People finish the main task without help", "Saves me time every week", "Makes money", "Never crashes, fast on phones"],
      multi: true,
      free: true,
      placeholder: "or say it your way",
    },
    { id: "features", label: "Must-have features, your way", hint: "Kept exactly as you describe them.", free: true },
    { id: "look", label: "Look & feel", options: LOOK },
    { id: "touches", label: "What it touches", options: TOUCHES, multi: true },
  ],
  website: [
    { id: "goal", label: "The one thing a visitor should do", options: ["Call", "Book", "Buy", "Fill in a form"], free: true, placeholder: "or something else" },
    { id: "audience", label: "The business and who visits", free: true, placeholder: "e.g. a barber in Columbus; locals on their phones" },
    {
      id: "success",
      label: "How we'll know it worked",
      options: ["More calls / bookings", "Loads in under a second on phones", "Ranks for local searches", "The client can edit it themselves"],
      multi: true,
    },
    { id: "features", label: "Pages and features, your way", free: true },
    { id: "look", label: "Look & feel", options: LOOK },
    { id: "handoff", label: "Handoff", options: ["Domain & email", "Analytics", "Contact form", "Client Review link", "Jarvis error script"], multi: true },
  ],
  plugin: [
    { id: "goal", label: "End goal", hint: "What does it make easier, and for whom?", free: true },
    { id: "where", label: "Where it lives", options: ["Dashboard widget", "Toolbox tab", "App plugins card", "A chat tool"] },
    { id: "success", label: "How we'll know it worked", options: ["I use it every day", "It replaces a manual chore", "Other users set it up without help"], multi: true },
    { id: "features", label: "Must-have features, your way", free: true },
    { id: "touches", label: "What it touches", options: TOUCHES, multi: true },
  ],
  fix: [
    { id: "goal", label: "What's wrong, and where", free: true, placeholder: "e.g. photos upload twice from the iPhone shortcut" },
    { id: "often", label: "How often", options: ["Every time", "Sometimes", "Happened once"] },
    { id: "rung", label: "How far to go", options: ["Fix it and stop it happening again", "Fix every case like it", "Fix this one"] },
    { id: "success", label: "How we'll know it's fixed", options: ["A test that failed now passes", "No new logged errors for a week", "I can do the thing again"], multi: true },
  ],
  content: [
    { id: "goal", label: "What should the reader do or feel after?", free: true },
    { id: "audience", label: "Who reads it", free: true },
    { id: "where", label: "Where it goes", options: ["Website", "Social post", "Email", "Video script", "Ad"] },
  ],
};

/**
 * Is this prompt about building or fixing something?
 *
 * Cheap and conservative: a false negative only means the panel stays a chip
 * the owner can still tap; a false positive interrupts a casual message, which
 * is worse. So very short text and plain questions never match.
 */
export function topicOf(text: string): FelixTopic | null {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ").trim()} `;
  if (t.trim().split(" ").length < 4) return null;
  const make = /\b(build|make|create|design|code|develop|add|set up|setup|launch|redo|redesign|improve|upgrade)\b/;
  if (/\b(fix|broken|bug|crash(es|ing)?|error|doesn'?t work|not working|keeps failing|stuck|slow)\b/.test(t) && !/\b(build|create) (a|an|me)\b/.test(t)) return "fix";
  if (make.test(t) && /\b(plugin|widget|jarvis tab|toolbox|chat tool)\b/.test(t)) return "plugin";
  if (make.test(t) && /\b(website|web site|site|landing page|homepage|portfolio|web page)\b/.test(t)) return "website";
  if (make.test(t) && /\b(app|application|tool|dashboard|game|feature|bot|extension|tracker|calculator|platform|saas)\b/.test(t)) return "app";
  if (/\b(write|draft)\b/.test(t) && /\b(post|email|caption|script|copy|ad|bio|article|blog)\b/.test(t)) return "content";
  return null;
}

export type FelixAnswers = Record<string, string | string[]>;

const asList = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : []).map((s) => s.trim()).filter(Boolean);
const asText = (v: string | string[] | undefined): string => asList(v).join("; ");

// ----- the build checklist (one list, owned by the backend checklist in Profile) ----------------

export interface CheckLine {
  id: string;
  level: RuleLevel;
  text: string;
}

/** The starter lines of the one checklist, as Felix cites them (id = code). */
export const CHECKLIST: CheckLine[] = STARTER_LINES.map((l) => ({
  id: l.code,
  level: l.level,
  text: l.when === "Always" ? l.then : `${l.when.charAt(0).toLowerCase()}${l.when.slice(1)}: ${l.then}`,
}));

const BY_ID = new Map(CHECKLIST.map((c) => [c.id, c]));

/** The checklist lines a brief should hold itself to, in checklist order. */
export function checklistFor(topic: FelixTopic, answers: FelixAnswers): CheckLine[] {
  if (topic === "content") return [];
  const ids = new Set(["R1", "R2", "R3", "R4", "R6", "D5", "U1", "U2", "U8", "S1", "O1", "O6"]);
  const add = (...codes: string[]) => codes.forEach((c) => ids.add(c));
  if (topic === "fix") add("O5", "O7");
  if (topic === "website") add("P1", "P2", "P3", "U3", "U4", "S6", "C1", "C2", "C3", "C4", "C5", "C6");
  if (topic === "app" || topic === "plugin") add("S4", "U4", "U6", "A1", "D3", "R5");
  const touches = asList(answers.touches).join(" ").toLowerCase();
  if (touches.includes("account")) add("L1", "S3", "S4", "D4");
  if (touches.includes("payment")) add("S5", "S3", "S7");
  if (touches.includes("personal")) add("S2", "D2", "D4");
  if (touches.includes("other apps")) add("R5");
  if (touches.includes("ai")) add("S5", "R4", "R5");
  if (touches.includes("offline")) add("D3");
  const audience = asText(answers.audience).toLowerCase();
  if (/public|clients|users/.test(audience)) add("P1", "U3", "O3", "L1");
  return CHECKLIST.filter((c) => ids.has(c.id) && BY_ID.has(c.id));
}

// ----- the brief ---------------------------------------------------------------

export interface FelixBrief {
  topic: FelixTopic;
  /** One line. */
  goal: string;
  /** The goal beyond the goal (Altitude rung 3). */
  beyond: string;
  assumptions: string[];
  /** 2–5 checkable outcomes: the outside judge. */
  acceptance: string[];
  checklist: CheckLine[];
  /** The enhanced prompt, ready to send. */
  prompt: string;
  /** Short card title for the board. */
  title: string;
}

const BEYOND: Record<FelixTopic, string> = {
  app: "it keeps itself right: crashes are logged and fixed before anyone reports them, and it gets better from how people use it",
  website: "it keeps bringing in business on its own: fast, trusted, found in search, and the client can update it without calling you",
  plugin: "it takes a chore off your plate for good, and other Jarvis users can set it up without help",
  fix: "this kind of problem stops happening: it is logged, caught by a test, and can't quietly come back",
  content: "the reader does the thing, and it can be reused",
};

const JUDGE: Record<string, string> = {
  "People finish the main task without help": "three people who have never seen it finish the main task on a phone without help",
  "Saves me time every week": "the time it takes today is measured before and after, and it drops",
  "Makes money": "a real payment or booking goes through end to end",
  "Never crashes, fast on phones": "zero logged crashes in the first week, and Lighthouse mobile LCP under 1 s (median of 3)",
  "More calls / bookings": "calls and bookings are counted for two weeks before and after launch",
  "Loads in under a second on phones": "Lighthouse mobile LCP under 1 s, median of three runs",
  "Ranks for local searches": "the business shows on the first page for its main local search within 60 days",
  "The client can edit it themselves": "the client changes a price or photo without help in a test",
  "I use it every day": "it is opened on at least five days of the first week",
  "It replaces a manual chore": "the manual chore is not done by hand once in the first week",
  "Other users set it up without help": "a new user sets it up from onboarding alone",
  "A test that failed now passes": "a test written first fails for the reported reason, then passes after the fix",
  "No new logged errors for a week": "Site errors shows no new occurrence of this error for seven days",
  "I can do the thing again": "the exact steps that broke now work, on the device that broke",
};

function titleOf(topic: FelixTopic, raw: string, goal: string): string {
  const emoji = { app: "✨", website: "🌐", plugin: "🧩", fix: "🐛", content: "✍️" }[topic];
  const kind = { app: "feature", website: "feature", plugin: "feature", fix: "bug", content: "docs" }[topic];
  const what = (goal || raw).replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const head = `${emoji} [${kind}] `;
  const room = 70 - head.length;
  return head + (what.length > room ? `${what.slice(0, room - 1).trimEnd()}…` : what);
}

/**
 * The enhanced prompt, built from the answers with no model.
 *
 * Follows Anthropic's practice: goal and the why first, context, the user's
 * own requirements kept as written, an explicit bar, then the outside judge —
 * each part in its own XML tag. This is the offline result, and the draft the
 * AI pass improves.
 */
export function draftBrief(raw: string, topic: FelixTopic, answers: FelixAnswers): FelixBrief {
  const assumptions: string[] = [];
  const goalAnswer = asText(answers.goal);
  const goal =
    goalAnswer ||
    (topic === "fix" ? `fix: ${raw.trim()}` : raw.trim());
  if (!goalAnswer) assumptions.push("The end goal is what you typed; say more in Goal check to sharpen it.");

  const audience = asText(answers.audience) || (topic === "plugin" ? "Jarvis users" : "");
  if (!audience && topic !== "fix") assumptions.push("Most people will use it on a phone.");

  const success = asList(answers.success);
  const acceptance = success.map((s) => JUDGE[s] ?? s);
  if (topic === "fix") acceptance.unshift("the bug is reproduced first, from the raw logs or steps, before anything is changed");
  if (acceptance.length < 2) acceptance.push("zero logged crashes on the changed screens, checked in Site errors after a full click-through");
  if (acceptance.length < 3 && topic !== "content") acceptance.push("typecheck and tests pass, with new tests covering the new behaviour");

  const checklist = checklistFor(topic, answers);
  const features = asText(answers.features);
  const extra: string[] = [];
  for (const key of ["look", "where", "often", "rung", "handoff", "touches"] as const) {
    const v = asText(answers[key]);
    if (v) extra.push(`${key === "rung" ? "How far to go" : key[0].toUpperCase() + key.slice(1)}: ${v}`);
  }

  const bar =
    topic === "content"
      ? "Make it specific, in the reader's language, with one clear call to action."
      : "Go beyond the basics: make it a fully featured, production-quality result with a distinctive, polished design, " +
        "purposeful motion and interactivity — the standard a top commercial product team would ship. Keep what I asked for, " +
        "the way I asked for it, and raise the quality around it rather than adding unrelated features.";

  const parts = [
    `<goal>\n${goal}${audience ? `\nFor: ${audience}.` : ""}\nThe goal beyond the goal: ${BEYOND[topic]}.\n</goal>`,
    `<request>\n${raw.trim()}\n</request>`,
    features || extra.length ? `<requirements>\n${[features && `Must-haves, as I described them: ${features}`, ...extra].filter(Boolean).map((l) => `- ${l}`).join("\n")}\n</requirements>` : "",
    `<standard>\n${bar}${checklist.length ? `\nHold it to these checklist lines:\n${checklist.map((c) => `- ${c.id} (${c.level}): ${c.text}`).join("\n")}` : ""}\n</standard>`,
    `<success_criteria>\n${acceptance.map((a) => `- ${a}`).join("\n")}\nReport honestly against these with real numbers, including anything that missed.\n</success_criteria>`,
    topic === "content"
      ? ""
      : `<constraints>\nAct freely on local, reversible steps. Ask before anything that spends money, deletes data, or can't be undone. If something needed is missing (a key, access, data), say exactly what and what it would unlock — never fake it.\n</constraints>`,
  ].filter(Boolean);

  return {
    topic,
    goal,
    beyond: BEYOND[topic],
    assumptions,
    acceptance: acceptance.slice(0, 5),
    checklist,
    prompt: parts.join("\n\n"),
    title: titleOf(topic, raw, goalAnswer),
  };
}

// ----- the board card ------------------------------------------------------------

export interface BoardTicket {
  title: string;
  body: string;
  labels: string[];
}

/** The brief as a super-board card, in its ticket format (see skills/software-factory). */
export function ticketFrom(brief: FelixBrief, raw: string, where?: string): BoardTicket {
  const kind = brief.topic === "fix" ? "bug" : brief.topic === "content" ? "docs" : "feature";
  const touches = brief.prompt.toLowerCase();
  const labels = [kind, "felix"];
  if (touches.includes("payments")) labels.push("money");
  if (touches.includes("accounts / sign-in")) labels.push("auth");
  const body = [
    `## Problem\n${brief.goal}\n\nGoal beyond the goal: ${brief.beyond}.`,
    `## Context\n- **Where:** ${where || "to be found from the request"}\n- **Who:** ${brief.topic === "plugin" ? "Jarvis users" : "the owner and the people it's for"}\n- **Checklist:** ${brief.checklist.map((c) => c.id).join(", ") || "n/a"}\n- **Asked as:** ${raw.trim().slice(0, 400)}`,
    `## Fix\nBuild what the brief below asks for, the way it asks for it.\n\n<details><summary>Felix brief</summary>\n\n\`\`\`text\n${brief.prompt}\n\`\`\`\n</details>`,
    `## Acceptance Criteria\n${brief.acceptance.map((a) => `- [ ] ${a}`).join("\n")}`,
    `## Risk\n${labels.includes("money") || labels.includes("auth") ? "🟡 **Medium** · touches payments or sign-in — the merge goes to the owner" : "🟢 **Low** · new or contained change"}`,
    `## Blocked by\n- None.`,
  ];
  return { title: brief.title, body: body.join("\n\n"), labels };
}
