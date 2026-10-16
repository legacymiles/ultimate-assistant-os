// One search box across every kind of thing in the funding knowledge base.

import {
  CHEAT_SHEETS,
  LEFT_OUT,
  LENDERS,
  LESSONS,
  MISTAKES,
  SCRIPTS,
  SEQUENCES,
  TIPS,
} from "@/lib/seed-content/financial-bible";

export type HitKind = "lender" | "cheat" | "tip" | "mistake" | "sequence" | "script" | "lesson" | "left-out";

export interface Hit {
  kind: HitKind;
  id: string;
  title: string;
  /** A short line of context under the title. */
  line: string;
  /** Which tab holds it. */
  tab: FundingTab;
}

export type FundingTab = "qualify" | "lenders" | "cheats" | "plays" | "mistakes" | "scripts" | "lessons";

interface Doc extends Hit {
  text: string;
}

function build(): Doc[] {
  const docs: Doc[] = [];
  for (const l of LENDERS) {
    const products = l.products.map((p) => `${p.side} ${p.kind} ${p.note ?? ""}`).join(" ");
    docs.push({
      kind: "lender",
      id: l.id,
      title: l.name,
      line: l.products.map((p) => `${p.side} ${p.kind}`).join(", "),
      tab: "lenders",
      text: [l.name, l.kind, products, l.bureaus.join(" "), (l.states ?? []).join(" "), ...(l.rules ?? []), ...(l.tips ?? []), l.membership ?? "", l.commission ?? ""].join(" "),
    });
  }
  for (const c of CHEAT_SHEETS)
    docs.push({ kind: "cheat", id: c.id, title: c.title, line: c.use, tab: "cheats", text: [c.title, c.use, ...c.rows.map((r) => `${r.k} ${r.v}`)].join(" ") });
  for (const t of TIPS) docs.push({ kind: "tip", id: t.id, title: t.title, line: t.body, tab: "plays", text: `${t.title} ${t.body} ${t.area}` });
  for (const m of MISTAKES) docs.push({ kind: "mistake", id: m.id, title: m.title, line: m.fix, tab: "mistakes", text: `${m.title} ${m.cost} ${m.fix}` });
  for (const s of SEQUENCES)
    docs.push({ kind: "sequence", id: s.id, title: s.title, line: s.fits, tab: "plays", text: [s.title, s.fits, ...s.steps.map((x) => `${x.title} ${x.detail}`)].join(" ") });
  for (const s of SCRIPTS) docs.push({ kind: "script", id: s.id, title: s.title, line: s.use, tab: "scripts", text: [s.title, s.use, ...s.lines].join(" ") });
  for (const x of LEFT_OUT) docs.push({ kind: "left-out", id: x.id, title: x.what, line: x.why, tab: "mistakes", text: `${x.what} ${x.why}` });
  for (const l of LESSONS)
    docs.push({ kind: "lesson", id: `${l.course}-${l.n}`, title: l.title, line: `${l.module} · lesson ${l.n}`, tab: "lessons", text: `${l.title} ${l.module}` });
  return docs.map((d) => ({ ...d, text: d.text.toLowerCase() }));
}

let INDEX: Doc[] | null = null;

/** Every word must appear; earlier title matches rank first. */
export function search(query: string, limit = 40): Hit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  INDEX ??= build();
  const scored: { d: Doc; s: number }[] = [];
  for (const d of INDEX) {
    if (!words.every((w) => d.text.includes(w))) continue;
    const t = d.title.toLowerCase();
    const s = words.reduce((acc, w) => acc + (t.includes(w) ? 0 : 2), 0) + (d.kind === "lesson" ? 1 : 0);
    scored.push({ d, s });
  }
  return scored
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map(({ d }) => ({ kind: d.kind, id: d.id, title: d.title, line: d.line, tab: d.tab }));
}
