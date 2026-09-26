// ---------------------------------------------------------------------------
// Document intake: a picture of a pay stub becomes proposed record fields.
//
// This is the half of the Life Record that makes it fill up without being
// typed. Photograph a pay stub, an old résumé, a lease, an insurance card, a
// benefits letter — the model reads what is printed and proposes values, the
// owner confirms them one by one, and only then are they saved.
//
// Two rules, both of which exist because the alternative is a record full of
// confident nonsense:
//
//   · READ, DO NOT INFER. A monthly figure is only proposed when the document
//     states a monthly figure. "Biweekly $1,240" does not become "monthly
//     $2,480" here; it becomes a biweekly amount and a pay frequency, and the
//     arithmetic happens where the owner can see it.
//   · NOTHING IS SAVED BY EXTRACTION. Every value comes back as a proposal
//     with the words it was read from, and the owner accepts or rejects it.
// ---------------------------------------------------------------------------

import { GROUPS, SECTIONS, groupById, groupField, FIELD_BY_KEY } from "./types";

export interface FieldProposal {
  kind: "field";
  key: string;
  label: string;
  value: string;
  /** The words on the document this was read from. The owner's check. */
  because: string;
  sensitive: boolean;
}

export interface EntryProposal {
  kind: "entry";
  group: string;
  groupLabel: string;
  label: string;
  values: Record<string, string>;
  because: string;
}

export type Proposal = FieldProposal | EntryProposal;

export interface ExtractResult {
  proposals: Proposal[];
  /** What the model says the document is. Shown above the queue. */
  document: string;
  /** Said out loud when a document was unreadable, rather than returning nothing. */
  note: string;
}

/** The catalog, as the instruction the model is given. Built, never hand-kept. */
export function catalogPrompt(): string {
  const flat = SECTIONS.map((s) => {
    const fields = s.fields
      .map((f) => `  ${f.key} — ${f.label}${f.type === "date" ? " (YYYY-MM-DD)" : f.type === "money" ? " (a number, no currency symbol)" : ""}${f.options ? ` (one of: ${f.options.join(", ")})` : ""}`)
      .join("\n");
    return `${s.label}:\n${fields}`;
  }).join("\n\n");

  const groups = GROUPS.map((g) => {
    const fields = g.fields.map((f) => `  ${f.key} — ${f.label}`).join("\n");
    return `${g.id} (${g.label}, one entry per ${g.singular}):\n${fields}`;
  }).join("\n\n");

  return `SINGLE-VALUE FIELDS\n${flat}\n\nREPEATING GROUPS\n${groups}`;
}

export const EXTRACT_SYSTEM = `You read a document someone has photographed or uploaded and pull out the facts an application form would ask for. You are not filling anything in — you are proposing values a person will confirm.

RULES
- Only propose a value that is actually printed on the document. If a field is not there, leave it out. A short, correct list beats a long, plausible one.
- Never calculate. A biweekly amount is a biweekly amount; do not turn it into a monthly one. Record the amount and the frequency as printed and let the person do the arithmetic where they can see it.
- Copy names, numbers and dates exactly as written, including middle initials and suffixes. Convert dates to YYYY-MM-DD only when the document's own format is unambiguous; otherwise copy it verbatim.
- For every value, quote the words on the document you read it from, in "because". A value with no quotable source is a guess — drop it.
- A work history entry, a household member, a school or an income source goes in the matching group, one entry each.
- If the image is too blurred, cropped or dark to read, say so in "note" and return no proposals rather than guessing.

Answer with JSON only, no prose around it:
{"document":"what this document is, in three or four words","note":"anything the person should know, or empty","fields":[{"key":"legal_last","value":"Okafor","because":"printed as 'OKAFOR, JAMES' at the top"}],"entries":[{"group":"jobs","values":{"employer":"Kroger","title":"Cashier","start":"2023-04-01"},"because":"the employment section lists Kroger, Cashier, 04/2023-present"}]}`;

/** Validate and label whatever the model sent back. Unknown keys are dropped. */
export function cleanProposals(raw: unknown): ExtractResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const proposals: Proposal[] = [];

  const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

  if (Array.isArray(o.fields)) {
    for (const item of o.fields.slice(0, 60)) {
      const f = (item ?? {}) as Record<string, unknown>;
      const key = str(f.key, 60);
      const def = FIELD_BY_KEY.get(key)?.field;
      const value = str(f.value, 300);
      if (!def || !value) continue;
      proposals.push({
        kind: "field",
        key,
        label: def.label,
        value,
        because: str(f.because, 300),
        sensitive: def.sensitive === true,
      });
    }
  }

  if (Array.isArray(o.entries)) {
    for (const item of o.entries.slice(0, 20)) {
      const e = (item ?? {}) as Record<string, unknown>;
      const groupId = str(e.group, 40);
      const group = groupById(groupId);
      if (!group) continue;
      const values: Record<string, string> = {};
      if (e.values && typeof e.values === "object") {
        for (const [k, v] of Object.entries(e.values as Record<string, unknown>)) {
          const val = str(v, 400);
          if (groupField(groupId, k) && val) values[k] = val;
        }
      }
      if (!Object.keys(values).length) continue;
      const title = group.title.map((k) => values[k]).filter(Boolean).join(" — ");
      proposals.push({
        kind: "entry",
        group: groupId,
        groupLabel: group.label,
        label: title || `New ${group.singular}`,
        values,
        because: str(e.because, 300),
      });
    }
  }

  return {
    proposals,
    document: str(o.document, 80),
    note: str(o.note, 300),
  };
}
