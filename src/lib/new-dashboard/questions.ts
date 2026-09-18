// The AIS-OS 7-question intake, adapted for the onboarding wizard.
// Hard cap of 7 is the kit's rule: every question answerable in under a minute.

import type { QuestionId } from "./types";

export interface Question {
  id: QuestionId;
  title: string;
  help: string;
  placeholder: string;
  /** Which Four-Cs layer this answer feeds. */
  feeds: string;
}

export const QUESTIONS: Question[] = [
  {
    id: "q1",
    title: "Who are you, what do you do, and who is it for?",
    help: "Identity, offer, audience. A short paragraph each is plenty.",
    placeholder: "I'm… I build/sell… for…",
    feeds: "Context · about-me + about-business",
  },
  {
    id: "q2",
    title: "Paste 1–2 things you've written recently. Don't edit them.",
    help:
      "An email, a post, a DM — anything that sounds like you when you're not trying. " +
      "Paste it raw from the original. Typed-in-here samples are already shaped by this form.",
    placeholder: "Paste sample here…",
    feeds: "Context · voice",
  },
  {
    id: "q3",
    title: "Your 2–3 biggest priorities for the next 90 days?",
    help: "Name a number, a deadline or a deliverable. \"Grow my business\" doesn't count.",
    placeholder: "e.g. Ship the Music Creator GPU backend by Oct 31",
    feeds: "Context · priorities",
  },
  {
    id: "q4",
    title: "Where does money actually land, and where is it tracked?",
    help: "Stripe? A spreadsheet? Nothing yet? Honest answers only — \"none yet\" is fine.",
    placeholder: "e.g. Stripe → tracked in a Google Sheet",
    feeds: "Connections · Revenue",
  },
  {
    id: "q5",
    title: "Where do you talk to people day to day?",
    help: "Email (Gmail / Outlook), Slack, Discord, iMessage, phone… Calendar is inferred from your email.",
    placeholder: "e.g. Gmail, iMessage, Discord",
    feeds: "Connections · Customers, Communication, Calendar",
  },
  {
    id: "q6",
    title: "Where do meeting notes and important docs live?",
    help: "Google Drive, Notion, OneDrive, a desktop folder you keep meaning to organise…",
    placeholder: "e.g. Google Drive + a OneDrive folder",
    feeds: "Connections · Meetings, Knowledge",
  },
  {
    id: "q7",
    title: "The one task that eats your week — and where you track work?",
    help: "The single biggest time-suck, plus where tasks and projects live.",
    placeholder: "e.g. Re-explaining context to Claude every session; tasks live in…",
    feeds: "Context · top pain + Connections · Tasks",
  },
];

/** The kit's 7 Tier-1 connection domains, in its order. */
export const DOMAINS = [
  "Revenue / Financials",
  "Customer interactions",
  "Calendar",
  "Communication",
  "Project / task tracking",
  "Meeting intelligence",
  "Knowledge / files",
] as const;

export const MECHANISMS: { id: import("./types").Mechanism; label: string }[] = [
  { id: "not-connected", label: "Not yet connected" },
  { id: "mcp", label: "MCP server" },
  { id: "script", label: "Script / API" },
  { id: "export", label: "Export pipeline" },
  { id: "key+ref", label: "Key + API guide" },
];

/**
 * True when a priority names something checkable — a number, a date, a month,
 * or a concrete deliverable verb. The kit pushes back on vague priorities; this
 * is that push-back, done locally so it works with no AI key.
 */
export function isConcretePriority(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true; // empty is "not answered", not "vague"
  if (/\d/.test(t)) return true;
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(t)) return true;
  if (/\b(ship|launch|publish|finish|release|deploy|sign|hire|close|build|complete|deliver)\b/.test(t))
    return true;
  return false;
}

/**
 * Heuristic: did this voice sample arrive by paste, or was it typed into the
 * box? Typing more than a sentence with no paste event trips the kit's one
 * hard rule. Returns the warning to show, or null.
 */
export function voiceWarning(typedChars: number, pasted: boolean): string | null {
  if (pasted || typedChars < 60) return null;
  return "Paste it raw — open your last email or post in another tab and paste the unedited text. Typed samples are already shaped by this form.";
}
