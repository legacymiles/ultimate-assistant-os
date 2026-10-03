// ---------------------------------------------------------------------------
// Folding real suppliers into a plan.
//
// The verify pass reads the web for what the materials actually cost and who
// actually sells them nearby. Merging that in is where an app of this kind
// usually destroys something: it overwrites the price the owner negotiated, or
// drops the supplier he already has a relationship with, and he stops trusting
// the sheet.
//
// So the rules are narrow. A finding may FILL something empty and may replace
// an ESTIMATE. It may never touch a `user` value and may never remove a
// supplier. What was not found stays an estimate and keeps saying so, because
// the honest outcome of a search is often "I could not price this".
// ---------------------------------------------------------------------------

import type { Plan, Supplier } from "./types";

export interface Finding {
  /** The step this is about. A finding for an unknown step is ignored. */
  stepId: string;
  /** Set when the price is for ONE material rather than the whole step. */
  materialId?: string;
  supplier: Supplier;
}

/** Two suppliers are the same when they are the same shop for the same thing. */
function same(a: Supplier, b: Supplier): boolean {
  return (
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase()
    && a.what.trim().toLowerCase() === b.what.trim().toLowerCase()
  );
}

export function mergeVerified(plan: Plan, findings: Finding[], now = new Date().toISOString()): Plan {
  const next: Plan = structuredClone(plan);

  for (const finding of findings) {
    const step = next.phases.flatMap((p) => p.steps).find((s) => s.id === finding.stepId);
    if (!step) continue;

    const supplier: Supplier = { ...finding.supplier, foundAt: now };
    const existing = step.suppliers.find((s) => same(s, supplier));
    if (existing) {
      // A re-scan refreshes a price it already knows about rather than
      // appending a duplicate — but a supplier the owner typed in has no
      // `source`, and leaving that alone is the whole point.
      if (existing.source) {
        existing.price = supplier.price ?? existing.price;
        existing.where = supplier.where ?? existing.where;
        existing.url = supplier.url ?? existing.url;
        existing.phone = supplier.phone ?? existing.phone;
        existing.source = supplier.source ?? existing.source;
        existing.foundAt = now;
      }
    } else {
      step.suppliers.push(supplier);
    }

    const price = supplier.price;
    if (!price) continue;

    if (finding.materialId) {
      const material = step.materials.find((m) => m.id === finding.materialId);
      if (!material || material.provenance === "user") continue;
      material.unitCost = price;
      material.provenance = "verified";
      if (!material.supplierIds.includes(supplier.id)) material.supplierIds.push(supplier.id);
      continue;
    }

    if (step.provenance === "user") continue;
    step.cost = price;
    step.provenance = "verified";
  }

  return next;
}
