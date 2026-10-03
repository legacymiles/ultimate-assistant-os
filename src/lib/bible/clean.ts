// ---------------------------------------------------------------------------
// The trust boundary: a model's JSON becomes a Plan here, or becomes null.
//
// Everything that arrives from a generation is a CLAIM. A field can be missing,
// a number can be a sentence, a range can run backwards, an id can be absent or
// duplicated, and the whole body can be truncated mid-array. None of that may
// reach the sheet, because a half-rendered plan is worse than a visible failure:
// the owner would act on it.
//
// Two rules here are policy, not parsing, and they are here rather than in the
// prompt because a prompt is a request and this is a guarantee:
//
//   * `extras` is always emptied. A build plan covers building the thing. The
//     nine business-formation topics exist behind their own buttons and their
//     own route, and a model that volunteers them is overruled.
//   * every cost comes out `estimate`, and a `source` a generation invented is
//     stripped. VERIFIED is a thing the verify pass earns by reading a page.
// ---------------------------------------------------------------------------

import { uid } from "./ids";
import type { Material, Money, Phase, Plan, Step, Supplier } from "./types";
import type { Op } from "./ops";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown, max: number, cap: number): string[] {
  return list(value)
    .map((v) => text(v, max))
    .filter(Boolean)
    .slice(0, cap);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A range, repaired: numbers only, low first, a currency it can be shown in. */
function money(value: unknown, fallbackCurrency: string): Money | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const low = num(raw.low);
  const high = num(raw.high);
  if (low === null || high === null) return undefined;
  if (low < 0 || high < 0) return undefined;
  return {
    low: Math.min(low, high),
    high: Math.max(low, high),
    currency: text(raw.currency, 3).toUpperCase() || fallbackCurrency,
  };
}

function material(value: unknown, currency: string): Material | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name, 120);
  if (!name) return null;
  return {
    id: uid("m"),
    name,
    qty: num(raw.qty) ?? 1,
    unit: text(raw.unit, 16) || "each",
    unitCost: money(raw.unitCost, currency),
    provenance: "estimate",
    supplierIds: [],
  };
}

function supplier(value: unknown, currency: string): Supplier | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name, 120);
  if (!name) return null;
  return {
    id: uid("sup"),
    name,
    what: text(raw.what, 120),
    where: text(raw.where, 200) || undefined,
    phone: text(raw.phone, 40) || undefined,
    url: text(raw.url, 400) || undefined,
    price: money(raw.price, currency),
    // `source` and `foundAt` are deliberately NOT read: only the verify pass
    // may set them, and a generation claiming one would make an estimate look
    // checked.
  };
}

export function cleanStep(value: unknown, currency: string): Step | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = text(raw.title, 140);
  if (!title) return null;

  const legalRaw = (raw.legal ?? null) as Record<string, unknown> | null;
  const question = legalRaw ? text(legalRaw.question, 300) : "";
  const whoToAsk = legalRaw ? text(legalRaw.whoToAsk, 160) : "";

  return {
    id: uid("s"),
    title,
    detail: text(raw.detail, 1200),
    cost: money(raw.cost, currency),
    costNote: text(raw.costNote, 120) || undefined,
    provenance: "estimate",
    hours: num(raw.hours) ?? undefined,
    materials: list(raw.materials)
      .slice(0, 40)
      .map((m) => material(m, currency))
      .filter((m): m is Material => m !== null),
    suppliers: list(raw.suppliers)
      .slice(0, 12)
      .map((s) => supplier(s, currency))
      .filter((s): s is Supplier => s !== null),
    check: text(raw.check, 300) || undefined,
    // Half a flag is no flag: a question nobody can be asked is not actionable,
    // and this app's whole position on legality is "go and ask this person".
    legal: question && whoToAsk ? { question, whoToAsk } : undefined,
    done: false,
    skipped: false,
  };
}

export function cleanPhase(value: unknown, currency: string): Phase | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const steps = list(raw.steps)
    .slice(0, 60)
    .map((s) => cleanStep(s, currency))
    .filter((s): s is Step => s !== null);
  if (!steps.length) return null; // a phase with no steps is a heading
  return {
    id: uid("p"),
    title: text(raw.title, 120) || "Phase",
    goal: text(raw.goal, 300),
    days: num(raw.days) ?? undefined,
    steps,
  };
}

export function cleanPlan(value: unknown, model: string, currency: string): Plan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const phases = list(raw.phases)
    .slice(0, 12)
    .map((p) => cleanPhase(p, currency))
    .filter((p): p is Phase => p !== null);
  if (!phases.length) return null;

  const unitRaw = (raw.unit ?? null) as Record<string, unknown> | null;
  const unitCost = unitRaw ? money(unitRaw.cost, currency) : undefined;

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    model,
    summary: text(raw.summary, 1200),
    assumptions: strings(raw.assumptions, 240, 12),
    openQuestions: strings(raw.openQuestions, 240, 10),
    phases,
    unit: unitCost
      ? {
          cost: unitCost,
          sellsFor: unitRaw ? money(unitRaw.sellsFor, currency) : undefined,
          note: unitRaw ? text(unitRaw.note, 300) || undefined : undefined,
        }
      : undefined,
    // Always empty. See the header.
    extras: [],
  };
}

/** The ops an answer proposed, with everything unrecognised dropped. */
export function cleanOps(value: unknown, currency: string): Op[] {
  const out: Op[] = [];
  for (const entry of list(value).slice(0, 60)) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const kind = text(raw.op, 32);
    const stepId = text(raw.stepId, 64);
    const phaseId = text(raw.phaseId, 64);

    if (kind === "set-summary") {
      const summary = text(raw.summary, 1200);
      if (summary) out.push({ op: "set-summary", summary });
    } else if (kind === "set-assumptions") {
      out.push({ op: "set-assumptions", assumptions: strings(raw.assumptions, 240, 12) });
    } else if (kind === "set-unit") {
      const unitRaw = (raw.unit ?? null) as Record<string, unknown> | null;
      const cost = unitRaw ? money(unitRaw.cost, currency) : undefined;
      if (cost) {
        out.push({
          op: "set-unit",
          unit: {
            cost,
            sellsFor: unitRaw ? money(unitRaw.sellsFor, currency) : undefined,
            note: unitRaw ? text(unitRaw.note, 300) || undefined : undefined,
          },
        });
      }
    } else if (kind === "replace-step") {
      const step = cleanStep(raw.step, currency);
      if (stepId && step) out.push({ op: "replace-step", stepId, step });
    } else if (kind === "add-step") {
      const step = cleanStep(raw.step, currency);
      const after = text(raw.afterStepId, 64);
      if (phaseId && step) {
        out.push({ op: "add-step", phaseId, afterStepId: after || null, step });
      }
    } else if (kind === "remove-step") {
      if (stepId) out.push({ op: "remove-step", stepId });
    } else if (kind === "replace-phase") {
      const phase = cleanPhase(raw.phase, currency);
      if (phaseId && phase) out.push({ op: "replace-phase", phaseId, phase });
    } else if (kind === "add-phase") {
      const phase = cleanPhase(raw.phase, currency);
      const after = text(raw.afterPhaseId, 64);
      if (phase) out.push({ op: "add-phase", afterPhaseId: after || null, phase });
    } else if (kind === "remove-phase") {
      if (phaseId) out.push({ op: "remove-phase", phaseId });
    }
  }
  return out;
}
