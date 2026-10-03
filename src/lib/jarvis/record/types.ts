// ---------------------------------------------------------------------------
// The Life Record: the structured facts an application actually asks for.
//
// Jarvis already knows the owner's BUILD history in enormous detail — the
// master folder, the skills, every decision logged. He knew nothing about the
// owner: no legal name, no address, no household, no income. So he could
// answer "which app uses OpenRouter?" and could not begin "fill in this
// Medicaid form", because there was nowhere for those facts to live.
//
// This file is that place's shape. Three rules run through it:
//
//   1. TYPED, NOT PROSE. A form needs "employer end date: 2024-03", not a
//      paragraph that mentions a job. Every fact is a field with a key, so it
//      can be dropped into an answer verbatim.
//   2. SENSITIVE VALUES NEVER REACH A MODEL. A field marked `sensitive` is
//      kept out of the prompt entirely. Jarvis is told the value exists and
//      writes `{{ssn}}` where it belongs; the browser substitutes the real
//      value when the owner copies the answer out (see digest.ts).
//   3. EVERY VALUE CARRIES ITS SOURCE. Same doctrine as the rest of Jarvis:
//      a fact read off a pay stub is not the same as a fact the owner typed,
//      and a fact Jarvis inferred is weaker than both.
// ---------------------------------------------------------------------------

/** How the field is entered and rendered. Drives the input, nothing else. */
export type FieldType = "text" | "longtext" | "date" | "money" | "phone" | "email" | "choice";

/**
 * Which kind of application needs this field.
 *
 * It exists so "what's missing?" can be asked per application type rather than
 * as one impossible 90-field wall: a job application does not want the
 * household's monthly income, and Medicaid does not want a reference's phone.
 */
export type Need = "core" | "job" | "benefits" | "optional";

export const NEED_LABEL: Record<Need, string> = {
  core: "Everything asks for it",
  job: "Job applications",
  benefits: "Medicaid / benefits",
  optional: "Only sometimes asked",
};

export interface FieldDef {
  /** Stable key. Also the substitution token: ssn -> {{ssn}}. Never renamed. */
  key: string;
  label: string;
  type: FieldType;
  need: Need;
  /** Choices for type "choice". The owner may still type their own. */
  options?: string[];
  /** Shown under the input: the format a form expects, or where to find it. */
  hint?: string;
  /** Kept out of every prompt. Tokenised instead. */
  sensitive?: boolean;
}

export interface SectionDef {
  id: string;
  label: string;
  /** One line under the heading: what this section is for. */
  blurb: string;
  fields: FieldDef[];
}

/**
 * A repeatable section — jobs, household members, schools.
 *
 * Kept separate from SectionDef rather than folded in with a `repeat` flag,
 * because the two are read differently everywhere downstream: a field has one
 * value, an entry is a row, and a digest that blurs them produces a prompt
 * that says "employer: three".
 */
export interface GroupDef {
  id: string;
  label: string;
  /** What one of them is called, for the add button: "Add a job". */
  singular: string;
  blurb: string;
  need: Need;
  fields: FieldDef[];
  /** The entry's fields, in order, that make its one-line summary. */
  title: string[];
}

export const SECTIONS: SectionDef[] = [
  {
    id: "identity",
    label: "Identity",
    blurb: "Exactly as it reads on your legal documents, not as you'd introduce yourself.",
    fields: [
      { key: "legal_first", label: "Legal first name", type: "text", need: "core" },
      { key: "legal_middle", label: "Middle name", type: "text", need: "core", hint: "Leave empty if you have none — that is an answer too." },
      { key: "legal_last", label: "Legal last name", type: "text", need: "core" },
      { key: "preferred_name", label: "Goes by", type: "text", need: "optional" },
      { key: "other_names", label: "Other names used", type: "text", need: "optional", hint: "Maiden name, former name — benefits forms ask." },
      { key: "dob", label: "Date of birth", type: "date", need: "core" },
      { key: "birthplace", label: "Place of birth", type: "text", need: "benefits", hint: "City and state or country." },
      { key: "ssn", label: "Social Security number", type: "text", need: "core", sensitive: true, hint: "Never sent to the AI. Jarvis writes {{ssn}} and this device fills it in." },
      { key: "marital_status", label: "Marital status", type: "choice", need: "core", options: ["Single", "Married", "Separated", "Divorced", "Widowed"] },
      { key: "citizenship", label: "Citizenship / status", type: "choice", need: "benefits", options: ["U.S. citizen", "Permanent resident", "Other lawful status", "Prefer not to record"] },
      { key: "work_authorization", label: "Authorised to work in the U.S.", type: "choice", need: "job", options: ["Yes", "No"] },
      { key: "sponsorship_needed", label: "Needs sponsorship", type: "choice", need: "job", options: ["No", "Yes"] },
    ],
  },
  {
    id: "contact",
    label: "Contact",
    blurb: "The number and address a caseworker or recruiter will actually use.",
    fields: [
      { key: "phone_mobile", label: "Mobile phone", type: "phone", need: "core" },
      { key: "phone_alt", label: "Other phone", type: "phone", need: "optional" },
      { key: "email", label: "Email", type: "email", need: "core" },
      { key: "address_line1", label: "Street address", type: "text", need: "core" },
      { key: "address_line2", label: "Apt / unit", type: "text", need: "optional" },
      { key: "city", label: "City", type: "text", need: "core" },
      { key: "state", label: "State", type: "text", need: "core" },
      { key: "postal_code", label: "ZIP", type: "text", need: "core" },
      { key: "county", label: "County", type: "text", need: "benefits", hint: "Medicaid is administered county by county — forms always ask." },
      { key: "address_since", label: "Living there since", type: "date", need: "benefits" },
      { key: "mailing_address", label: "Mailing address, if different", type: "longtext", need: "optional" },
      { key: "homeless", label: "Currently without stable housing", type: "choice", need: "benefits", options: ["No", "Yes"], hint: "Changes which Medicaid questions apply." },
    ],
  },
  {
    id: "household",
    label: "Household & money",
    blurb: "Benefits are decided on household size against household income. Both have to be exact.",
    fields: [
      { key: "household_size", label: "People in the household", type: "text", need: "benefits", hint: "Everyone you file taxes with, including yourself." },
      { key: "tax_filing", label: "Tax filing status", type: "choice", need: "benefits", options: ["Single", "Head of household", "Married filing jointly", "Married filing separately", "Do not file"] },
      { key: "employment_status", label: "Employment status", type: "choice", need: "core", options: ["Employed full time", "Employed part time", "Self-employed", "Unemployed", "Unable to work", "Student", "Retired"] },
      { key: "monthly_gross", label: "Your gross monthly income", type: "money", need: "benefits", hint: "Before deductions. Pay stub, not bank deposit." },
      { key: "pay_frequency", label: "Paid", type: "choice", need: "benefits", options: ["Weekly", "Every two weeks", "Twice a month", "Monthly", "Irregular"] },
      { key: "household_monthly_gross", label: "Whole household's gross monthly", type: "money", need: "benefits" },
      { key: "rent_monthly", label: "Rent or mortgage a month", type: "money", need: "benefits" },
      { key: "current_insurance", label: "Health coverage right now", type: "choice", need: "benefits", options: ["None", "Medicaid", "Medicare", "Employer plan", "Marketplace plan", "Other"] },
      { key: "medicaid_id", label: "Medicaid / member ID", type: "text", need: "benefits", sensitive: true },
      { key: "disability", label: "Disability affecting work", type: "choice", need: "benefits", options: ["No", "Yes", "Prefer not to record"] },
      { key: "pregnant", label: "Pregnant", type: "choice", need: "benefits", options: ["No", "Yes"], hint: "Opens a separate Medicaid category with a much higher income limit." },
    ],
  },
  {
    id: "work",
    label: "Work preferences",
    blurb: "The answers every job application asks and you retype every time.",
    fields: [
      { key: "desired_title", label: "Roles you're applying for", type: "text", need: "job" },
      { key: "desired_pay", label: "Pay expectation", type: "text", need: "job", hint: "A range is a fine answer: '$22–26/hr'." },
      { key: "available_from", label: "Available to start", type: "date", need: "job" },
      { key: "schedule", label: "Schedule you can work", type: "text", need: "job", hint: "Shifts, weekends, overnights." },
      { key: "transport", label: "Reliable transport", type: "choice", need: "job", options: ["Yes", "No"] },
      { key: "drivers_license", label: "Driver's licence", type: "choice", need: "job", options: ["Yes — valid", "No", "Expired"] },
      { key: "license_number", label: "Licence number", type: "text", need: "optional", sensitive: true },
      { key: "license_state", label: "Licence state", type: "text", need: "optional" },
      { key: "felony", label: "Convictions to disclose", type: "choice", need: "job", options: ["None", "Yes — see note"] },
      { key: "felony_note", label: "How you describe it", type: "longtext", need: "optional", hint: "Written once, calmly, so you never have to improvise it in a form." },
      { key: "veteran", label: "Veteran status", type: "choice", need: "optional", options: ["Not a veteran", "Veteran", "Prefer not to say"] },
      { key: "summary", label: "Your short 'about me'", type: "longtext", need: "job", hint: "Three or four sentences. Jarvis reuses it in cover letters." },
    ],
  },
  {
    id: "health",
    label: "Health & insurance",
    blurb: "What a clinic, a pharmacy or an A&E form asks, and nobody can recite under pressure.",
    fields: [
      { key: "blood_type", label: "Blood type", type: "choice", need: "core", options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
      { key: "insurance_carrier", label: "Insurance carrier", type: "text", need: "benefits", hint: "The company on the card, e.g. Pinnacle Health." },
      { key: "insurance_member_id", label: "Member ID", type: "text", need: "benefits", sensitive: true },
      { key: "insurance_group", label: "Group number", type: "text", need: "benefits" },
      { key: "insurance_plan", label: "Plan name", type: "text", need: "optional" },
      { key: "allergies", label: "Allergies", type: "longtext", need: "core", hint: "Including the reaction, because every form asks." },
      { key: "medications", label: "Regular medication", type: "longtext", need: "optional", hint: "Name and dose." },
      { key: "conditions", label: "Ongoing conditions", type: "longtext", need: "optional" },
      { key: "gp_name", label: "Doctor or practice", type: "text", need: "optional" },
      { key: "gp_phone", label: "Doctor's phone", type: "phone", need: "optional" },
      { key: "emergency_name", label: "Emergency contact", type: "text", need: "core" },
      { key: "emergency_relation", label: "Their relationship to you", type: "text", need: "optional" },
      { key: "emergency_phone", label: "Emergency contact phone", type: "phone", need: "core" },
    ],
  },
];

export const GROUPS: GroupDef[] = [
  {
    id: "jobs",
    label: "Work history",
    singular: "job",
    blurb: "Exact dates are the part that stalls an application. Record them once.",
    need: "job",
    title: ["title", "employer"],
    fields: [
      { key: "employer", label: "Employer", type: "text", need: "job" },
      { key: "title", label: "Job title", type: "text", need: "job" },
      { key: "start", label: "Started", type: "date", need: "job" },
      { key: "end", label: "Ended", type: "date", need: "job", hint: "Leave empty if this is current." },
      { key: "pay", label: "Pay", type: "text", need: "optional" },
      { key: "city", label: "City", type: "text", need: "job" },
      { key: "supervisor", label: "Supervisor", type: "text", need: "job" },
      { key: "supervisor_phone", label: "Supervisor's phone", type: "phone", need: "job" },
      { key: "reason_left", label: "Reason for leaving", type: "text", need: "job" },
      { key: "duties", label: "What you did", type: "longtext", need: "job" },
    ],
  },
  {
    id: "household_members",
    label: "Household members",
    singular: "person",
    blurb: "Everyone counted in the household. Medicaid asks for each one by name and date of birth.",
    need: "benefits",
    title: ["name", "relation"],
    fields: [
      { key: "name", label: "Full legal name", type: "text", need: "benefits" },
      { key: "relation", label: "Relation to you", type: "text", need: "benefits" },
      { key: "dob", label: "Date of birth", type: "date", need: "benefits" },
      { key: "ssn", label: "Social Security number", type: "text", need: "benefits", sensitive: true },
      { key: "income", label: "Their monthly income", type: "money", need: "benefits" },
      { key: "coverage", label: "Their coverage now", type: "text", need: "benefits" },
      { key: "applying", label: "Applying for coverage too", type: "choice", need: "benefits", options: ["Yes", "No"] },
    ],
  },
  {
    id: "education",
    label: "Education",
    singular: "school",
    blurb: "School names and years, spelled the way the diploma spells them.",
    need: "job",
    title: ["level", "school"],
    fields: [
      { key: "school", label: "School", type: "text", need: "job" },
      { key: "level", label: "Level", type: "choice", need: "job", options: ["High school", "GED", "Trade / certificate", "Associate", "Bachelor's", "Master's", "Doctorate"] },
      { key: "field", label: "Field of study", type: "text", need: "optional" },
      { key: "city", label: "City", type: "text", need: "optional" },
      { key: "completed", label: "Completed", type: "choice", need: "job", options: ["Yes", "No — still attending", "No — did not finish"] },
      { key: "year", label: "Year", type: "text", need: "job" },
    ],
  },
  {
    id: "references",
    label: "References",
    singular: "reference",
    blurb: "Three people, already asked, with numbers that still work.",
    need: "job",
    title: ["name", "relation"],
    fields: [
      { key: "name", label: "Name", type: "text", need: "job" },
      { key: "relation", label: "How they know you", type: "text", need: "job" },
      { key: "phone", label: "Phone", type: "phone", need: "job" },
      { key: "email", label: "Email", type: "email", need: "optional" },
      { key: "asked", label: "Has agreed to be a reference", type: "choice", need: "job", options: ["Yes", "Not yet"] },
    ],
  },
  {
    id: "income_other",
    label: "Other income",
    singular: "income source",
    blurb: "Anything that is money coming in and is not your main paycheque.",
    need: "benefits",
    title: ["kind", "amount"],
    fields: [
      { key: "kind", label: "What it is", type: "text", need: "benefits", hint: "SSI, SSDI, child support, unemployment, side work, help from family." },
      { key: "amount", label: "Amount", type: "money", need: "benefits" },
      { key: "frequency", label: "How often", type: "choice", need: "benefits", options: ["Weekly", "Every two weeks", "Monthly", "Irregular", "One-off"] },
      { key: "whose", label: "Whose income", type: "text", need: "benefits" },
    ],
  },
  {
    id: "documents",
    label: "Documents",
    singular: "document",
    blurb: "What you can lay hands on, and where it is. Half of an application is proving what you said.",
    need: "core",
    title: ["kind", "where"],
    fields: [
      { key: "kind", label: "Document", type: "text", need: "core", hint: "Birth certificate, Social Security card, pay stub, lease, photo ID, résumé." },
      { key: "where", label: "Where it is", type: "text", need: "core", hint: "'Blue folder, top drawer' is a better answer than 'home'." },
      { key: "expires", label: "Expires", type: "date", need: "optional" },
      { key: "covers", label: "What it proves", type: "text", need: "optional", hint: "Identity, income, address, citizenship." },
    ],
  },
];

/** Where a value came from. Shown in the UI, never guessed. */
export type ValueSource = "you" | "document" | "jarvis";

export const SOURCE_LABEL: Record<ValueSource, string> = {
  you: "You typed it",
  document: "Read off a document",
  jarvis: "Jarvis put it here",
};

export interface FieldValue {
  value: string;
  updatedAt: string;
  source: ValueSource;
  /** For a document-read value: which document, so it can be checked. */
  origin?: string;
}

export interface GroupEntry {
  id: string;
  values: Record<string, string>;
  updatedAt: string;
  source: ValueSource;
  origin?: string;
}

export interface LifeRecord {
  version: 1;
  fields: Record<string, FieldValue>;
  groups: Record<string, GroupEntry[]>;
  /**
   * Pictures of the documents the values were read off — metadata only. The
   * shape and the rules live in files.ts; the bytes live outside this blob,
   * because this one syncs whole on every save. Optional on purpose: every
   * record written before this existed is still a valid record.
   */
  files?: import("./files").RecordFile[];
  updatedAt: string;
}

export function emptyRecord(): LifeRecord {
  return { version: 1, fields: {}, groups: {}, files: [], updatedAt: "" };
}

/** Every field in the catalog, flat, for lookups by key. */
export const FIELD_BY_KEY: Map<string, { field: FieldDef; section: SectionDef }> = new Map(
  SECTIONS.flatMap((section) => section.fields.map((field) => [field.key, { field, section }] as const)),
);

export function groupById(id: string): GroupDef | undefined {
  return GROUPS.find((g) => g.id === id);
}

/** A group's field, for validating what the model or a document proposes. */
export function groupField(groupId: string, key: string): FieldDef | undefined {
  return groupById(groupId)?.fields.find((f) => f.key === key);
}

/** True when this key must never be put in a prompt. Unknown keys: yes. */
export function isSensitive(key: string, groupId?: string): boolean {
  const def = groupId ? groupField(groupId, key) : FIELD_BY_KEY.get(key)?.field;
  return def ? def.sensitive === true : true;
}

/**
 * Read a record key, in either of the two shapes it legitimately takes.
 *
 *   legal_last          a single field
 *   jobs.employer       a group's field, no particular entry — what a form
 *                       MEANS when it asks "most recent employer", and what
 *                       the matcher produces
 *   jobs.2.employer     one specific entry's field — what a fill snapshot
 *                       holds, and what a {{token}} refers to
 *
 * Both shapes exist for good reasons and both were in use before this
 * function: capture spoke the second, filling spoke the first, and the two
 * never met, so a work-history field silently never auto-filled. One parser
 * now, used by every side.
 */
export interface ParsedKey {
  groupId?: string;
  field: string;
  /** 1-based. Absent means "no particular entry" — callers pick, usually 1. */
  index?: number;
}

export function parseKey(key: string): ParsedKey | null {
  const parts = key.split(".");
  if (parts.length === 1) return FIELD_BY_KEY.has(key) ? { field: key } : null;

  const [groupId, ...rest] = parts;
  if (!groupById(groupId)) return null;

  if (rest.length === 1) {
    return groupField(groupId, rest[0]) ? { groupId, field: rest[0] } : null;
  }
  if (rest.length === 2) {
    const index = Number(rest[0]);
    if (!Number.isInteger(index) || index < 1) return null;
    return groupField(groupId, rest[1]) ? { groupId, field: rest[1], index } : null;
  }
  return null;
}

/** What to call a key on screen: "Legal last name", "Work history: Employer". */
export function labelForKey(key: string): string | null {
  const parsed = parseKey(key);
  if (!parsed) return null;
  if (!parsed.groupId) return FIELD_BY_KEY.get(parsed.field)?.field.label ?? null;
  const group = groupById(parsed.groupId);
  const def = groupField(parsed.groupId, parsed.field);
  if (!group || !def) return null;
  const which = parsed.index ? ` ${parsed.index}` : "";
  return `${group.label}${which}: ${def.label}`;
}

/** The one-line label for an entry, e.g. "Cashier — Kroger". */
export function entryTitle(group: GroupDef, entry: GroupEntry): string {
  const parts = group.title.map((k) => entry.values[k]?.trim()).filter(Boolean);
  return parts.length ? parts.join(" — ") : `Untitled ${group.singular}`;
}
