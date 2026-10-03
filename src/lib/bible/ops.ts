// ---------------------------------------------------------------------------
// Applying the agent's edit to a plan.
//
// The chat does not rewrite the plan; it PROPOSES operations against step and
// phase ids, and this module is the only thing allowed to change a plan. That
// is what makes "make it cheaper" arrive as a diff with a lower total instead
// of a new wall of text, and what makes v1 still readable after v2 exists.
//
// Three rules the engine enforces rather than trusting the model with:
//
//   1. An op naming an unknown id is DROPPED and reported. Guessing which step
//      was meant is how an agent silently deletes the wrong work.
//   2. `done`, `skipped` and `note` are the owner's. A replace carries them
//      over, so being asked for a cheaper material never un-ticks what he has
//      already built or erases the note saying why.
//   3. Anything with `user` provenance survives, and so does every supplier.
//
// Nothing here mutates its input: the caller keeps the old version in
// `idea.plans[]`, and a reducer that edited in place would corrupt the history
// it is supposed to preserve.
// ---------------------------------------------------------------------------

import type { Material, Phase, Plan, Step, Supplier } from "./types";

export type Op =
  | { op: "set-summary"; summary: string }
  | { op: "set-assumptions"; assumptions: string[] }
  | { op: "set-unit"; unit: Plan["unit"] }
  | { op: "replace-step"; stepId: string; step: Step }
  | { op: "add-step"; phaseId: string; afterStepId: string | null; step: Step }
  | { op: "remove-step"; stepId: string }
  | { op: "replace-phase"; phaseId: string; phase: Phase }
  | { op: "add-phase"; afterPhaseId: string | null; phase: Phase }
  | { op: "remove-phase"; phaseId: string };

export interface Dropped {
  op: Op;
  why: string;
}

export interface ApplyResult {
  plan: Plan;
  applied: number;
  dropped: Dropped[];
}

/** Materials: the agent's list, with anything the owner priced put back. */
function keepOwnMaterials(old: Material[], next: Material[]): Material[] {
  const byId = new Map(next.map((m) => [m.id, m]));
  for (const mine of old) {
    if (mine.provenance === "user") byId.set(mine.id, mine); // his copy wins outright
  }
  return [...byId.values()];
}

/**
 * Suppliers are ADDITIVE and nothing is ever dropped here.
 *
 * Both kinds of existing supplier are hard-won: one the owner typed in is a shop
 * he knows, and one the verify pass found carries the `source` that is the only
 * evidence behind a VERIFIED price. An agent rewriting a step's wording has no
 * business removing either, so the old list is kept whole and genuinely new
 * suppliers are appended. A step that accumulates a few too many shops is a
 * cosmetic problem; losing the lumber yard, or losing the source and leaving the
 * price looking checked, is a correctness one.
 */
function keepSuppliers(old: Supplier[], next: Supplier[]): Supplier[] {
  const key = (s: Supplier) => `${s.name.trim().toLowerCase()}|${s.what.trim().toLowerCase()}`;
  const seen = new Set(old.map(key));
  return [...old, ...next.filter((s) => !seen.has(key(s)))];
}

/**
 * The incoming step, with the parts of the old one that were never the agent's
 * to change.
 */
function preserveOwn(old: Step, incoming: Step): Step {
  // A price the owner typed outranks the agent's; so does the provenance that
  // says so. Without this line, asking for a cheaper plan silently relabels his
  // own number as an estimate and the verify pass is then free to overwrite it.
  const ownPrice = old.provenance === "user";
  return {
    ...incoming,
    id: old.id,
    done: old.done,
    skipped: old.skipped,
    note: old.note,
    cost: ownPrice ? old.cost : incoming.cost,
    provenance: ownPrice ? "user" : incoming.provenance,
    materials: keepOwnMaterials(old.materials, incoming.materials),
    suppliers: keepSuppliers(old.suppliers, incoming.suppliers),
  };
}

function findStep(plan: Plan, stepId: string): { phase: Phase; index: number } | null {
  for (const phase of plan.phases) {
    const index = phase.steps.findIndex((s) => s.id === stepId);
    if (index !== -1) return { phase, index };
  }
  return null;
}

export function applyOps(plan: Plan, ops: Op[]): ApplyResult {
  const next: Plan = structuredClone(plan);
  const dropped: Dropped[] = [];
  let applied = 0;

  for (const op of ops) {
    switch (op.op) {
      case "set-summary":
        next.summary = op.summary;
        applied += 1;
        break;

      case "set-assumptions":
        next.assumptions = op.assumptions;
        applied += 1;
        break;

      case "set-unit":
        next.unit = op.unit;
        applied += 1;
        break;

      case "replace-step": {
        const at = findStep(next, op.stepId);
        if (!at) {
          dropped.push({ op, why: `no step "${op.stepId}" in this plan` });
          break;
        }
        at.phase.steps[at.index] = preserveOwn(at.phase.steps[at.index], op.step);
        applied += 1;
        break;
      }

      case "add-step": {
        const phase = next.phases.find((p) => p.id === op.phaseId);
        if (!phase) {
          dropped.push({ op, why: `no phase "${op.phaseId}" in this plan` });
          break;
        }
        if (op.afterStepId === null) phase.steps.unshift(op.step);
        else {
          const index = phase.steps.findIndex((s) => s.id === op.afterStepId);
          if (index === -1) {
            dropped.push({ op, why: `no step "${op.afterStepId}" to add after` });
            break;
          }
          phase.steps.splice(index + 1, 0, op.step);
        }
        applied += 1;
        break;
      }

      case "remove-step": {
        const at = findStep(next, op.stepId);
        if (!at) {
          dropped.push({ op, why: `no step "${op.stepId}" to remove` });
          break;
        }
        at.phase.steps.splice(at.index, 1);
        applied += 1;
        break;
      }

      case "replace-phase": {
        const index = next.phases.findIndex((p) => p.id === op.phaseId);
        if (index === -1) {
          dropped.push({ op, why: `no phase "${op.phaseId}" in this plan` });
          break;
        }
        // Steps the owner has already ticked off keep their state, matched by
        // id, even when the whole phase around them is rewritten.
        const old = next.phases[index];
        next.phases[index] = {
          ...op.phase,
          id: old.id,
          steps: op.phase.steps.map((incoming) => {
            const previous = old.steps.find((s) => s.id === incoming.id);
            return previous ? preserveOwn(previous, incoming) : incoming;
          }),
        };
        applied += 1;
        break;
      }

      case "add-phase": {
        if (op.afterPhaseId === null) next.phases.unshift(op.phase);
        else {
          const index = next.phases.findIndex((p) => p.id === op.afterPhaseId);
          if (index === -1) {
            dropped.push({ op, why: `no phase "${op.afterPhaseId}" to add after` });
            break;
          }
          next.phases.splice(index + 1, 0, op.phase);
        }
        applied += 1;
        break;
      }

      case "remove-phase": {
        const index = next.phases.findIndex((p) => p.id === op.phaseId);
        if (index === -1) {
          dropped.push({ op, why: `no phase "${op.phaseId}" to remove` });
          break;
        }
        next.phases.splice(index, 1);
        applied += 1;
        break;
      }
    }
  }

  // Nothing landed means nothing changed: the answer was an answer, and a
  // version number that moves without the plan moving is a lie.
  if (applied > 0) {
    next.version = plan.version + 1;
    next.createdAt = new Date().toISOString();
  }

  return { plan: next, applied, dropped };
}

/** One line for the diff gate's header. */
export function opSummary(ops: Op[]): string {
  if (!ops.length) return "no changes";
  const changed = ops.filter((o) => o.op === "replace-step" || o.op === "replace-phase").length;
  const added = ops.filter((o) => o.op === "add-step" || o.op === "add-phase").length;
  const removed = ops.filter((o) => o.op === "remove-step" || o.op === "remove-phase").length;
  const other = ops.length - changed - added - removed;

  const parts: string[] = [];
  if (changed) parts.push(`${changed} step${changed === 1 ? "" : "s"} changed`);
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (other) parts.push(`${other} other edit${other === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
