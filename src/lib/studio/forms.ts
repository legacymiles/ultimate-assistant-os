// ---------------------------------------------------------------------------
// Studio forms — what a skill asks the owner, rendered in the chat.
//
// The model calls `studio_form` with a loose JSON shape; `cleanForm` turns it
// into something the UI can trust (known field types, options present where
// they are needed, bounded sizes). The owner's answers go back to the model as
// one plain-text message — `answerText` — beginning "[Form: <title>]", which is
// how the skill knows a round is complete.
// ---------------------------------------------------------------------------

export type FieldType = "text" | "textarea" | "choice" | "multi" | "image";

export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
  default?: string;
}

export interface StudioForm {
  title: string;
  intro?: string;
  fields: FormField[];
  submitLabel?: string;
}

const TYPES: FieldType[] = ["text", "textarea", "choice", "multi", "image"];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function cleanForm(raw: unknown): StudioForm | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const fields: FormField[] = [];
  const seen = new Set<string>();
  for (const f of Array.isArray(o.fields) ? o.fields.slice(0, 16) : []) {
    const r = (f ?? {}) as Record<string, unknown>;
    const label = str(r.label, 200);
    let id = str(r.id, 40).replace(/[^a-zA-Z0-9_-]/g, "_") || `field_${fields.length + 1}`;
    if (seen.has(id)) id = `${id}_${fields.length + 1}`;
    let type = (TYPES.includes(r.type as FieldType) ? r.type : "text") as FieldType;
    const options = Array.isArray(r.options)
      ? r.options.map((x) => str(x, 400)).filter(Boolean).slice(0, 12)
      : [];
    // A choice with nothing to choose is a text box.
    if ((type === "choice" || type === "multi") && !options.length) type = "text";
    if (!label) continue;
    seen.add(id);
    fields.push({
      id,
      label,
      type,
      ...(options.length && (type === "choice" || type === "multi") ? { options } : {}),
      ...(r.required === true ? { required: true } : {}),
      ...(str(r.placeholder, 200) ? { placeholder: str(r.placeholder, 200) } : {}),
      ...(str(r.default, 2000) ? { default: str(r.default, 2000) } : {}),
    });
  }
  if (!fields.length) return null;
  return {
    title: str(o.title, 120) || "A few details",
    ...(str(o.intro, 600) ? { intro: str(o.intro, 600) } : {}),
    fields,
    ...(str(o.submit_label ?? o.submitLabel, 40) ? { submitLabel: str(o.submit_label ?? o.submitLabel, 40) } : {}),
  };
}

/** One value per field: text, the chosen option, several options, or an image count. */
export type FormValues = Record<string, string | string[]>;

/** What was left empty that must not be. */
export function missing(form: StudioForm, values: FormValues, imageCounts: Record<string, number>): string[] {
  return form.fields
    .filter((f) => f.required)
    .filter((f) => {
      if (f.type === "image") return !(imageCounts[f.id] > 0);
      const v = values[f.id];
      return Array.isArray(v) ? v.length === 0 : !String(v ?? "").trim();
    })
    .map((f) => f.label);
}

/** The owner's answers, as the message the skill reads next. */
export function answerText(form: StudioForm, values: FormValues, imageCounts: Record<string, number>): string {
  const lines = [`[Form: ${form.title}]`];
  for (const f of form.fields) {
    if (f.type === "image") {
      const n = imageCounts[f.id] ?? 0;
      lines.push(`${f.label}: ${n ? `${n} image${n === 1 ? "" : "s"} attached` : "none uploaded"}`);
      continue;
    }
    const v = values[f.id];
    const text = Array.isArray(v) ? v.join(" | ") : String(v ?? "").trim();
    lines.push(`${f.label}: ${text || "(left blank)"}`);
  }
  return lines.join("\n");
}
