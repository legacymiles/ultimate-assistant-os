// ---------------------------------------------------------------------------
// Matching a website's form field to a Life Record field.
//
// This is the whole trick of the extension, and the part that decides whether
// it feels like magic or like a toy. A form input arrives as a bag of weak
// signals — an `autocomplete` token, a `name`, an `id`, the label sitting next
// to it, a placeholder — and one of them has to name a record key.
//
// The ladder below is ordered by how much each signal can be TRUSTED, not by
// how often it appears:
//
//   1. `autocomplete` is a standard with a fixed vocabulary. When a site sets
//      it, it is stating the field's meaning, and it is never a guess.
//   2. `name` / `id` are the developer's own words. Usually honest, sometimes
//      minified into uselessness ("input_14_3" — every Gravity Forms page).
//   3. The visible label is what the HUMAN reads, so it is the most meaningful
//      signal and the least machine-readable. Used last and matched loosely.
//
// Anything this file cannot place is left for the model to map once per domain
// (the extension caches that), because sending every field of every form to an
// AI would be slow, costly and unnecessary — a well-built form is fully solved
// by rule 1 alone.
//
// Shared deliberately between the browser extension and the server: a mapping
// that differs between capture and fill is a mapping that silently corrupts
// the record.
// ---------------------------------------------------------------------------

import { FIELD_BY_KEY, GROUPS } from "./types";

export interface FormField {
  /** The `autocomplete` attribute, if any. */
  autocomplete?: string;
  name?: string;
  id?: string;
  /** The visible label text, however the extension found it. */
  label?: string;
  placeholder?: string;
  /** The input's own type, used to reject impossible matches. */
  type?: string;
}

export interface Match {
  key: string;
  /** Which rung of the ladder decided it. Shown to the owner on capture. */
  by: "autocomplete" | "name" | "label";
  /** 1 = stated by the page, 0.7 = developer's words, 0.5 = read off a label. */
  confidence: number;
}

/**
 * The HTML autocomplete vocabulary, mapped to record keys.
 *
 * Only the tokens that mean exactly one record field are here. `name` (the
 * full name) and `organization` are deliberately absent: a full name is three
 * record fields and splitting it is guesswork best left to the owner.
 */
const AUTOCOMPLETE: Record<string, string> = {
  "given-name": "legal_first",
  "additional-name": "legal_middle",
  "family-name": "legal_last",
  nickname: "preferred_name",
  email: "email",
  tel: "phone_mobile",
  "tel-national": "phone_mobile",
  "street-address": "address_line1",
  "address-line1": "address_line1",
  "address-line2": "address_line2",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "postal_code",
  bday: "dob",
};

/**
 * Patterns over a field's `name`/`id`, most specific first.
 *
 * Order is load-bearing. `/name/` would swallow `first_name`, `last_name` and
 * `username` alike, so every narrow pattern has to be tested before any broad
 * one, and the loop stops at the first hit.
 */
const NAME_PATTERNS: [RegExp, string][] = [
  [/(^|[_\-.])(ssn|socialsecurity|social_security|soc_sec)/i, "ssn"],
  [/(first|given|fore)[_\-.]?name|^fname$|^f_name$/i, "legal_first"],
  [/(last|family|sur)[_\-.]?name|^lname$|^l_name$/i, "legal_last"],
  [/(middle|additional)[_\-.]?(name|initial)|^mname$|^mi$/i, "legal_middle"],
  [/maiden|former[_\-.]?name|other[_\-.]?names?|(^|[_\-.\s])aka([_\-.\s]|$)/i, "other_names"],
  [/preferred[_\-.]?name|nickname|goes[_\-.]?by/i, "preferred_name"],
  [/(date[_\-.]?of[_\-.]?birth|^dob$|birth[_\-.]?date|birthdate|bday)/i, "dob"],
  [/(birth[_\-.]?place|place[_\-.]?of[_\-.]?birth)/i, "birthplace"],
  [/(mobile|cell)[_\-.]?(phone|number)?|phone[_\-.]?mobile/i, "phone_mobile"],
  [/(home|alt|alternate|secondary|other)[_\-.]?phone/i, "phone_alt"],
  [/^(phone|telephone|tel|phone_number|primaryphone)$/i, "phone_mobile"],
  [/e[_\-.]?mail/i, "email"],
  [/address[_\-.]?(line)?[_\-.]?2|^addr2$|(^|[_\-.\s])(apt|apartment|unit|suite|ste)([_\-.\s]|$)/i, "address_line2"],
  [/address[_\-.]?(line)?[_\-.]?1|^addr1?$|street|mailing[_\-.]?address/i, "address_line1"],
  [/^(city|town|locality)$|address[_\-.]?city/i, "city"],
  [/^(state|province|region)$|address[_\-.]?state/i, "state"],
  [/(zip|postal)[_\-.]?(code)?/i, "postal_code"],
  [/county|parish/i, "county"],
  [/marital|marriage[_\-.]?status/i, "marital_status"],
  [/citizen|immigration[_\-.]?status/i, "citizenship"],
  [/work[_\-.]?auth|authorized[_\-.]?to[_\-.]?work|legally[_\-.]?authorized/i, "work_authorization"],
  [/sponsorship|require[_\-.]?visa|need[_\-.]?visa/i, "sponsorship_needed"],
  [/household[_\-.]?size|people[_\-.]?in[_\-.]?household|family[_\-.]?size/i, "household_size"],
  [/filing[_\-.]?status|tax[_\-.]?filing/i, "tax_filing"],
  [/employment[_\-.]?status/i, "employment_status"],
  [/household[_\-.]?income/i, "household_monthly_gross"],
  [/(gross|monthly)[_\-.]?(monthly|gross)?[_\-.]?income|income[_\-.]?amount/i, "monthly_gross"],
  [/pay[_\-.]?(frequency|period)|how[_\-.]?often[_\-.]?paid/i, "pay_frequency"],
  [/(^|[_\-.\s])(rent|mortgage)([_\-.\s]|$)|rent[_\-.]?amount|monthly[_\-.]?rent/i, "rent_monthly"],
  [/(current[_\-.]?)?(health[_\-.]?)?(insurance|coverage)/i, "current_insurance"],
  [/medicaid[_\-.]?(id|number)|member[_\-.]?id|recipient[_\-.]?id/i, "medicaid_id"],
  [/pregnan/i, "pregnant"],
  [/disab/i, "disability"],
  [/homeless|stable[_\-.]?housing/i, "homeless"],
  [/desired[_\-.]?(pay|salary)|salary[_\-.]?(expectation|requirement)|expected[_\-.]?pay/i, "desired_pay"],
  [/desired[_\-.]?(title|position|role)|position[_\-.]?applied/i, "desired_title"],
  [/(available|start)[_\-.]?(date|from)|when[_\-.]?can[_\-.]?you[_\-.]?start/i, "available_from"],
  [/(reliable[_\-.]?)?transport/i, "transport"],
  [/licen[sc]e[_\-.]?(number|no)|dl[_\-.]?number/i, "license_number"],
  [/licen[sc]e[_\-.]?state/i, "license_state"],
  [/drivers?[_\-.]?licen[sc]e/i, "drivers_license"],
  [/felony|convict|criminal[_\-.]?(record|history)/i, "felony"],
  [/veteran/i, "veteran"],
  [/summary|about[_\-.]?(me|yourself)|personal[_\-.]?statement|objective/i, "summary"],
  [/schedule|availability|shifts?[_\-.]?available/i, "schedule"],
];

/**
 * Label patterns. Looser than the name patterns and matched against prose, so
 * they are tested only when a field is still unplaced.
 */
const LABEL_PATTERNS: [RegExp, string][] = [
  [/social security|ssn/i, "ssn"],
  [/first name|given name/i, "legal_first"],
  [/last name|family name|surname/i, "legal_last"],
  [/middle (name|initial)/i, "legal_middle"],
  [/date of birth|birth ?date/i, "dob"],
  [/place of birth/i, "birthplace"],
  [/maiden|other names?|previously known/i, "other_names"],
  [/e-?mail/i, "email"],
  [/(mobile|cell) (phone|number)/i, "phone_mobile"],
  [/phone/i, "phone_mobile"],
  [/(apartment|apt|unit|suite)/i, "address_line2"],
  [/(street|mailing) address|address line 1|^address$/i, "address_line1"],
  [/^city$|city or town/i, "city"],
  [/^state$/i, "state"],
  [/zip|postal code/i, "postal_code"],
  [/county|parish/i, "county"],
  [/marital status/i, "marital_status"],
  [/citizenship|immigration status/i, "citizenship"],
  [/authorized to work|work authorization/i, "work_authorization"],
  [/sponsorship|visa/i, "sponsorship_needed"],
  [/people (in|liv(e|ing) in) (your|the) (home|household)|household size|how many people/i, "household_size"],
  [/filing status/i, "tax_filing"],
  [/employment status|are you (currently )?employed/i, "employment_status"],
  [/household.*income/i, "household_monthly_gross"],
  [/(gross|monthly).*income|income before/i, "monthly_gross"],
  [/how often.*paid|pay (frequency|period)/i, "pay_frequency"],
  [/rent|mortgage/i, "rent_monthly"],
  [/health (insurance|coverage)|currently.*(insured|covered)/i, "current_insurance"],
  [/medicaid.*(id|number)|member (id|number)/i, "medicaid_id"],
  [/pregnan/i, "pregnant"],
  [/disab/i, "disability"],
  [/(salary|pay).*(expect|requirement|desired)|desired (pay|salary)/i, "desired_pay"],
  [/position.*(applying|applied)|desired position/i, "desired_title"],
  [/when can you start|available to start|start date/i, "available_from"],
  [/reliable transport/i, "transport"],
  [/driver'?s licen[sc]e/i, "drivers_license"],
  [/felony|convicted|criminal (record|history)/i, "felony"],
  [/veteran/i, "veteran"],
  [/tell us about (yourself|you)|summary|objective/i, "summary"],
  [/availability|what shifts/i, "schedule"],
];

/** Inputs that hold no recordable value, whatever they are called. */
const NEVER = /^(password|hidden|submit|button|image|file|search|reset)$/i;

/** A password field named "ssn" is still a password. Type beats every word. */
function impossible(field: FormField, key: string): boolean {
  const type = (field.type ?? "").toLowerCase();
  if (NEVER.test(type)) return true;
  const def = FIELD_BY_KEY.get(key)?.field;
  if (!def) return true;
  // An email input cannot be a date of birth, whatever its name suggests.
  if (type === "email" && def.type !== "email") return true;
  if (def.type === "email" && type && !["email", "text"].includes(type)) return true;
  return false;
}

function firstMatch(text: string, patterns: [RegExp, string][]): string | null {
  if (!text.trim()) return null;
  for (const [re, key] of patterns) if (re.test(text)) return key;
  return null;
}

/**
 * Which record field this form input is, or null when it cannot be told.
 *
 * Null is a real answer and is returned often. The alternative — a low-grade
 * guess — writes a phone number into a licence number, and a record the owner
 * cannot trust is worse than one with holes in it.
 */
export function matchField(field: FormField): Match | null {
  const auto = (field.autocomplete ?? "").toLowerCase().trim();
  if (auto) {
    // Sites write "shipping given-name" and "section-x billing email".
    for (const token of auto.split(/\s+/)) {
      const key = AUTOCOMPLETE[token];
      if (key && !impossible(field, key)) return { key, by: "autocomplete", confidence: 1 };
    }
  }

  // Tested separately, never joined. Joining them put a space on the end of
  // `name`, and every anchored pattern here — ^fname$, ^phone$, ^city$ — then
  // matched nothing at all, silently, for every form on the web.
  for (const text of [field.name ?? "", field.id ?? ""]) {
    const byName = firstMatch(text, NAME_PATTERNS);
    if (byName && !impossible(field, byName)) return { key: byName, by: "name", confidence: 0.7 };
  }

  for (const text of [field.label ?? "", field.placeholder ?? ""]) {
    const byLabel = firstMatch(text, LABEL_PATTERNS);
    if (byLabel && !impossible(field, byLabel)) return { key: byLabel, by: "label", confidence: 0.5 };
  }

  return null;
}

export interface MatchedField extends FormField {
  value: string;
  match: Match | null;
}

/**
 * Match a whole form at once, dropping empties and duplicates.
 *
 * Last value wins on a duplicate key, because a form that asks twice (a
 * confirm-your-email pair, a shipping block repeated below a billing one)
 * almost always has the user's final answer lower down the page.
 */
export function matchForm(fields: (FormField & { value: string })[]): MatchedField[] {
  const out = new Map<string, MatchedField>();
  const unplaced: MatchedField[] = [];

  for (const f of fields) {
    const value = (f.value ?? "").trim();
    if (!value) continue;
    const match = matchField(f);
    if (!match) {
      unplaced.push({ ...f, value, match: null });
      continue;
    }
    const existing = out.get(match.key);
    // A stronger signal never loses to a later, weaker one.
    if (existing?.match && existing.match.confidence > match.confidence) continue;
    out.set(match.key, { ...f, value, match });
  }

  return [...out.values(), ...unplaced];
}

/** Every key the model may map an unknown field onto, as one prompt line. */
export function mappableKeys(): string {
  const flat = [...FIELD_BY_KEY.entries()].map(([key, { field }]) => `${key} (${field.label})`);
  const grouped = GROUPS.flatMap((g) =>
    g.fields.map((f) => `${g.id}.${f.key} (${g.label}: ${f.label})`),
  );
  return [...flat, ...grouped].join(", ");
}
