// Pure helpers over a Profile: creation, connection inference, Four-Cs score.
// No storage and no React here, so it is all unit-testable.

import { DOMAINS } from "./questions";
import type { Connection, DashboardStore, Intake, Profile } from "./types";

export const STORE_KEY = "new-dashboard";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function today(): string {
  // Local calendar date, not UTC — an evening entry must not land on tomorrow.
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function emptyIntake(): Intake {
  return { q1: "", q2: ["", ""], q3: ["", "", ""], q4: "", q5: "", q6: "", q7: "" };
}

export function emptyStore(): DashboardStore {
  return { version: 1, profiles: [], activeId: null };
}

export function newProfile(name: string): Profile {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: name.trim() || "Me",
    createdAt: now,
    updatedAt: now,
    onboarded: false,
    intake: emptyIntake(),
    connections: DOMAINS.map((domain) => ({ domain, tool: "", mechanism: "not-connected", lastChecked: "" })),
    capabilities: [],
    routines: [],
    decisions: [],
    prioritiesDone: [],
  };
}

// --- connection inference ---------------------------------------------------

/** Tool names worth recognising in free-text answers, with a display spelling. */
const KNOWN_TOOLS = [
  "Stripe", "Skool", "GoHighLevel", "QuickBooks", "Xero", "PayPal", "Shopify", "Gumroad", "Google Sheet", "Excel",
  "Gmail", "Outlook", "Slack", "Teams", "Discord", "iMessage", "WhatsApp", "Telegram", "Instagram", "TikTok", "Phone",
  "Google Calendar", "Outlook Calendar",
  "Granola", "Otter", "Fireflies", "Fathom", "Zoom", "Google Meet",
  "Google Drive", "OneDrive", "Dropbox", "Notion", "Obsidian", "Confluence", "Airtable",
  "ClickUp", "Asana", "Linear", "Trello", "Jira", "Monday", "Todoist", "Projects Timeline", "GitHub",
  "Claude Code", "Recall", "Dashboard", "OpenRouter", "Supabase", "Vercel", "RunPod",
];

function toolsIn(text: string): string[] {
  const lower = text.toLowerCase();
  const found = KNOWN_TOOLS.filter((t) => lower.includes(t.toLowerCase()));
  // "Google Calendar" also contains nothing that would double-match, but a bare
  // "Outlook" inside "Outlook Calendar" would — keep the longer name only.
  return found.filter((t) => !found.some((o) => o !== t && o.toLowerCase().includes(t.toLowerCase())));
}

function summarise(text: string): string {
  if (/^\s*(no|none|nothing|n\/a)(\s|$|[.,;—-])/i.test(text)) return "None yet";
  const tools = toolsIn(text);
  if (tools.length) return tools.join(", ");
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 48 ? t.slice(0, 46) + "…" : t;
}

/**
 * Fill each domain's tool from the intake, as the kit's /onboard does:
 * Q4 → Revenue, Q5 → Customers + Communication (+ Calendar inferred from the
 * email provider), Q6 → Meetings + Knowledge, Q7 → Tasks.
 * Only EMPTY tool cells are filled, so a person's own edits are never clobbered.
 */
export function inferConnections(intake: Intake, current: Connection[]): Connection[] {
  const q5 = intake.q5.toLowerCase();
  const calendar = q5.includes("outlook") ? "Outlook Calendar" : q5.includes("gmail") || q5.includes("google") ? "Google Calendar" : "";
  const byDomain: Record<string, string> = {
    [DOMAINS[0]]: intake.q4.trim() ? summarise(intake.q4) : "",
    [DOMAINS[1]]: intake.q5.trim() ? summarise(intake.q5) : "",
    [DOMAINS[2]]: calendar,
    [DOMAINS[3]]: intake.q5.trim() ? summarise(intake.q5) : "",
    [DOMAINS[4]]: intake.q7.trim() ? summarise(intake.q7) : "",
    [DOMAINS[5]]: intake.q6.trim() ? summarise(intake.q6) : "",
    [DOMAINS[6]]: intake.q6.trim() ? summarise(intake.q6) : "",
  };
  return current.map((c) => (c.tool.trim() ? c : { ...c, tool: byDomain[c.domain] ?? "" }));
}

// --- Four Cs ----------------------------------------------------------------

export interface LayerScore {
  key: "context" | "connections" | "capabilities" | "cadence";
  label: string;
  score: number; // 0-25
  test: string; // the kit's "this layer is in place" test
  next: string; // the single most useful next step
}

const DAY = 86_400_000;

/**
 * Setup coverage per layer, out of 25 each. This is NOT the kit's /audit
 * score — that one only credits verified, working evidence. Here a named tool
 * earns a little and a wired, recently-checked one earns the rest, so the
 * number moves as the person does real setup, and the UI labels it honestly.
 */
export function fourCs(p: Profile, now = Date.now()): LayerScore[] {
  const i = p.intake;
  const voice = i.q2.filter((s) => s.trim().length > 40).length;
  const priorities = i.q3.filter((s) => s.trim()).length;
  const context =
    (i.q1.trim().length > 40 ? 8 : i.q1.trim() ? 4 : 0) +
    (voice === 2 ? 7 : voice === 1 ? 4 : 0) +
    (priorities >= 2 ? 5 : priorities * 2) +
    (i.q7.trim() ? 5 : 0);

  const perDomain = 25 / p.connections.length;
  const connections = p.connections.reduce((sum, c) => {
    const named = c.tool.trim() ? 0.25 : 0;
    const wired = c.mechanism !== "not-connected" ? 0.5 : 0;
    const fresh = c.lastChecked && now - Date.parse(c.lastChecked) < 30 * DAY ? 0.25 : 0;
    return sum + perDomain * (named + wired + fresh);
  }, 0);

  const capabilities = Math.min(25, p.capabilities.length * 5);

  const cadence = Math.min(
    25,
    p.routines.reduce((sum, r) => {
      const proven = r.lastRun && now - Date.parse(r.lastRun) < 14 * DAY;
      return sum + (proven ? 10 : 4);
    }, 0),
  );

  const firstUnwired = p.connections.find((c) => c.mechanism === "not-connected");
  return [
    {
      key: "context",
      label: "Context",
      score: Math.round(context),
      test: "A fresh session can answer \"what do you do and what matters this quarter?\" without browsing.",
      next: voice < 2 ? "Paste two real voice samples." : !i.q1.trim() ? "Answer Q1 — who you are and who it's for." : "Export the files into your Claude Code folder.",
    },
    {
      key: "connections",
      label: "Connections",
      score: Math.round(connections),
      test: "\"What's on my calendar tomorrow and what's due?\" returns live data, no pasting.",
      next: firstUnwired ? `Wire up ${firstUnwired.domain}${firstUnwired.tool ? ` (${firstUnwired.tool})` : ""}.` : "Re-check every connection this month.",
    },
    {
      key: "capabilities",
      label: "Capabilities",
      score: capabilities,
      test: "A short phrase triggers a multi-step workflow that produces a real artifact.",
      next: p.capabilities.length ? "Add the next workflow you repeat 3+ times a week." : "Add your first skill or workflow.",
    },
    {
      key: "cadence",
      label: "Cadence",
      score: cadence,
      test: "Laptop closed, and a brief still lands in your inbox.",
      next: p.routines.some((r) => r.lastRun) ? "Log each routine's last real run." : "Schedule one routine and log its first run.",
    },
  ];
}

/** The kit's Day-1 → Day-14 plan, keyed off when the profile was created. */
export function dayPlan(p: Profile, now = Date.now()) {
  const day = Math.floor((now - Date.parse(p.createdAt)) / DAY) + 1;
  const wired = p.connections.some((c) => c.mechanism !== "not-connected");
  return {
    day,
    steps: [
      { day: 1, label: "Onboard — answer the 7 questions", done: p.onboarded },
      { day: 2, label: "Wire one connection", done: wired },
      // Audit and level-up happen in Claude Code, so the evidence here is the
      // decision the person logs afterwards (the kit logs both the same way).
      { day: 7, label: "Run /audit in Claude Code", done: p.decisions.some((d) => /audit/i.test(d.title)) },
      { day: 14, label: "Run /level-up — ship one automation", done: p.decisions.some((d) => /level.?up/i.test(d.title)) },
    ],
  };
}
