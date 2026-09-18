// "What should I focus on this week?" — the kit's Day-1 wow prompt, answered
// from the profile only. Shared by the API route (AI) and the client (fallback).

import type { Profile } from "./types";

export interface FocusResult {
  bullets: string[];
  monday: string;
  shift: string;
  ai: boolean;
}

export const FOCUS_SYSTEM =
  "You are someone's personal AI Operating System. Answer ONLY from the context given — never invent facts. " +
  "Reply as JSON: {\"bullets\": [3 short strings, each tied to one stated 90-day priority], " +
  "\"monday\": \"If I had to pick one thing for Monday, it'd be X, because Y.\", " +
  "\"shift\": \"one question asking to what extent AI could be leveraged on that Monday task\"}. " +
  "Match the register of their voice samples if present: short sentences, no em dashes.";

export function focusPrompt(p: Profile): string {
  const i = p.intake;
  const open = i.q3.map((s, n) => ({ s, n })).filter(({ s, n }) => s.trim() && !p.prioritiesDone.includes(n));
  return [
    `Name: ${p.name}`,
    `Who they are: ${i.q1 || "(unknown)"}`,
    `Open 90-day priorities:\n${open.map(({ s }, k) => `${k + 1}. ${s}`).join("\n") || "(none)"}`,
    `What eats their week: ${i.q7 || "(unknown)"}`,
    `Unwired connections: ${p.connections.filter((c) => c.mechanism === "not-connected").map((c) => c.domain).join(", ") || "none"}`,
    `Recent decisions: ${p.decisions.slice(-3).map((d) => d.title).join("; ") || "none"}`,
    i.q2[0] ? `Voice sample:\n${i.q2[0].slice(0, 1200)}` : "",
  ].filter(Boolean).join("\n\n");
}

/** No-AI answer: still specific, because it is built from their own words. */
export function heuristicFocus(p: Profile): FocusResult {
  const open = p.intake.q3.filter((s, n) => s.trim() && !p.prioritiesDone.includes(n));
  const unwired = p.connections.find((c) => c.mechanism === "not-connected");
  const bullets = open.slice(0, 3).map((s) => `Move "${s}" one concrete step forward.`);
  if (bullets.length < 3 && unwired) bullets.push(`Wire ${unwired.domain}${unwired.tool ? ` (${unwired.tool})` : ""} so your AI OS can see it.`);
  if (bullets.length < 3 && p.intake.q7.trim()) bullets.push(`Chip at what eats your week: ${p.intake.q7.trim().slice(0, 90)}`);
  const top = open[0];
  return {
    bullets: bullets.length ? bullets : ["Finish onboarding — set your 90-day priorities first."],
    monday: top ? `If I had to pick one thing for Monday, it'd be "${top}", because it's your first stated priority.` : "Set a priority, then ask again.",
    shift: "To what extent could AI be leveraged on that task?",
    ai: false,
  };
}

export function coerceFocus(raw: unknown): FocusResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const bullets = Array.isArray(r.bullets) ? r.bullets.filter((b): b is string => typeof b === "string").slice(0, 3) : [];
  if (!bullets.length || typeof r.monday !== "string") return null;
  return { bullets, monday: r.monday, shift: typeof r.shift === "string" ? r.shift : "", ai: true };
}
