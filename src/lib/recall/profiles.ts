// ---------------------------------------------------------------------------
// Profiles — blueprints, completeness, the Jarvis draft, and avatar handling.
//
// The model is deliberately boring: a profile is a name, a kind, a list of
// labelled fields and a list of accounts. That is enough to represent a son, a
// business, a domain, a brokerage account or a client, and it means the UI can
// be honest about what is missing instead of pretending a blank is a value.
//
// A profile always owns a folder and a folder-note. The folder is the durable
// record; the profile is the readable card. Everything in this file is pure or
// browser-only so `store.ts` can import it without a cycle.
// ---------------------------------------------------------------------------

import { uid } from "../utils";
import type {
  Profile,
  ProfileAccount,
  ProfileAccountKind,
  ProfileField,
  ProfileFieldType,
  ProfileKind,
  ProfileRole,
} from "./types";

export interface BlueprintField {
  label: string;
  type: ProfileFieldType;
  hint?: string;
  sensitive?: boolean;
}

/**
 * Every profile starts with the fields that matter for its kind — even the
 * ones we do not know yet. An empty SSN or renewal date is a visible to-do, not
 * a missing column, and it is exactly what stops a profile becoming a name
 * with no substance.
 */
export const PROFILE_BLUEPRINTS: Record<ProfileKind, BlueprintField[]> = {
  person: [
    { label: "Full legal name", type: "text", hint: "As it appears on official documents" },
    { label: "Preferred name", type: "text", hint: "What you actually call them" },
    { label: "Birthday", type: "date" },
    { label: "SSN", type: "ssn", sensitive: true, hint: "Hidden by default; never sent to the AI" },
    { label: "Email", type: "email" },
    { label: "Phone", type: "phone" },
    { label: "Home address", type: "text" },
    { label: "Emergency contact", type: "text" },
  ],
  business: [
    { label: "Legal name", type: "text" },
    { label: "EIN", type: "ssn", sensitive: true, hint: "Hidden by default; never sent to the AI" },
    { label: "Website / domain", type: "url" },
    { label: "Registrar", type: "text", hint: "Where the domain is registered, e.g. Cloudflare" },
    { label: "Hosting", type: "text" },
    { label: "Renewal date", type: "date" },
    { label: "Business email", type: "email" },
    { label: "Phone", type: "phone" },
    { label: "Address", type: "text" },
    { label: "Formation date", type: "date" },
  ],
};

export const PROFILE_ROLES: { value: ProfileRole; label: string }[] = [
  { value: "self", label: "Me" },
  { value: "child", label: "Child" },
  { value: "partner", label: "Partner" },
  { value: "relative", label: "Relative" },
  { value: "friend", label: "Friend" },
  { value: "client", label: "Client" },
  { value: "vendor", label: "Vendor" },
  { value: "other", label: "Other" },
];

export const ACCOUNT_KINDS: { value: ProfileAccountKind; label: string }[] = [
  { value: "account", label: "Bank account" },
  { value: "brokerage", label: "Brokerage" },
  { value: "retirement", label: "Retirement" },
  { value: "crypto", label: "Crypto" },
  { value: "domain", label: "Domain" },
  { value: "hosting", label: "Hosting / DNS" },
  { value: "saas", label: "SaaS / tool" },
  { value: "subscription", label: "Subscription" },
  { value: "other", label: "Other" },
];

export function profileKindLabel(kind: ProfileKind): string {
  return kind === "business" ? "Business" : "Person";
}

export function roleLabel(role?: ProfileRole): string {
  return PROFILE_ROLES.find((r) => r.value === role)?.label ?? "";
}

export function accountKindLabel(kind: ProfileAccountKind): string {
  return ACCOUNT_KINDS.find((k) => k.value === kind)?.label ?? "Account";
}

export function accountKindFrom(raw: unknown): ProfileAccountKind {
  const value = String(raw ?? "").toLowerCase();
  return ACCOUNT_KINDS.some((k) => k.value === value)
    ? (value as ProfileAccountKind)
    : "other";
}

/** A field that must never be copied into search text or sent to a model. */
export function isSensitiveField(
  field: Pick<ProfileField, "label" | "type"> & { sensitive?: boolean },
): boolean {
  return (
    Boolean(field.sensitive) ||
    field.type === "ssn" ||
    field.type === "secret" ||
    /\b(ssn|social security|ein|password|passcode|pin|routing|account number)\b/i.test(field.label)
  );
}

export function profileInitials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** The folder path a new profile owns. Kind is part of the path so people and
 *  businesses never collapse into one flat list. */
export function profileFolderPath(kind: ProfileKind, displayName: string): string[] {
  return ["Profiles", kind === "business" ? "Businesses" : "People", displayName.trim()];
}

// ----- fields --------------------------------------------------------------

const TYPE_BY_LABEL: Record<string, ProfileFieldType> = {
  email: "email",
  "business email": "email",
  phone: "phone",
  birthday: "date",
  "renewal date": "date",
  "formation date": "date",
  ssn: "ssn",
  ein: "ssn",
  "website / domain": "url",
  domain: "url",
  "website": "url",
  login: "login",
  password: "secret",
};

function fieldType(label: string, fallback: ProfileFieldType = "text"): ProfileFieldType {
  return TYPE_BY_LABEL[label.trim().toLowerCase()] ?? fallback;
}

/** Fill every known blueprint slot, then append anything extra the caller had. */
export function buildProfileFields(
  kind: ProfileKind,
  incoming: { label?: unknown; value?: unknown; type?: unknown }[] = [],
  displayName?: string,
): ProfileField[] {
  const blueprint = PROFILE_BLUEPRINTS[kind];
  const byLabel = new Map<string, { value: string; type?: ProfileFieldType }>();
  for (const raw of incoming) {
    const label = String(raw?.label ?? "").trim();
    if (!label) continue;
    const type = String(raw?.type ?? "");
    byLabel.set(label.toLowerCase(), {
      value: String(raw?.value ?? "").trim(),
      type: (["text", "email", "phone", "date", "ssn", "number", "money", "url", "login", "secret", "note"] as ProfileFieldType[]).includes(
        type as ProfileFieldType,
      )
        ? (type as ProfileFieldType)
        : undefined,
    });
  }

  const fields: ProfileField[] = blueprint.map((b) => {
    const hit = byLabel.get(b.label.toLowerCase());
    if (hit) byLabel.delete(b.label.toLowerCase());
    return {
      id: uid("pf"),
      label: b.label,
      value: hit?.value ?? "",
      type: hit?.type ?? b.type,
      sensitive: b.sensitive || isSensitiveField({ label: b.label, type: b.type }),
      hint: b.hint,
    };
  });

  for (const [label, hit] of byLabel) {
    const type = hit.type ?? fieldType(label);
    fields.push({
      id: uid("pf"),
      label: label.replace(/\b\w/g, (c) => c.toUpperCase()),
      value: hit.value,
      type,
      sensitive: isSensitiveField({ label, type }) || undefined,
    });
  }

  // A profile knows its own name even when the draft forgot the field.
  if (displayName?.trim()) {
    const legal = fields.find((f) => /full legal name|legal name/i.test(f.label));
    if (legal && !legal.value) legal.value = displayName.trim();
  }
  return fields;
}

export interface Completeness {
  known: number;
  total: number;
  pct: number;
  missing: ProfileField[];
}

export function profileCompleteness(profile: Pick<Profile, "fields">): Completeness {
  const total = profile.fields.length;
  const missing = profile.fields.filter((f) => !f.value.trim());
  const known = total - missing.length;
  return { known, total, pct: total === 0 ? 0 : Math.round((known / total) * 100), missing };
}

export function profileSearchText(profile: Profile): string {
  const fieldText = profile.fields
    .filter((f) => !isSensitiveField(f))
    .map((f) => `${f.label} ${f.value}`)
    .join(" ");
  const accountText = profile.accounts
    .map((a) =>
      [a.label, a.provider, a.kind, a.login, a.renewalDate, a.openedDate, a.value, a.notes]
        .filter(Boolean)
        .join(" "),
    )
    .join(" ");
  return [
    profile.displayName,
    profile.legalName,
    profile.headline,
    profile.notes,
    profile.tags.join(" "),
    fieldText,
    accountText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** The searchable note that mirrors a profile into its folder. */
export function buildProfileNoteBody(profile: Profile): string {
  const lines: string[] = [];
  lines.push(profile.displayName);
  lines.push(
    `${profileKindLabel(profile.kind)}${profile.role ? ` · ${roleLabel(profile.role)}` : ""}`,
  );
  if (profile.headline) lines.push(profile.headline);
  if (profile.notes?.trim()) {
    lines.push("");
    lines.push(profile.notes.trim());
  }

  lines.push("");
  lines.push("## Details");
  for (const field of profile.fields) {
    lines.push(
      `- ${field.label}: ${
        field.value.trim()
          ? isSensitiveField(field)
            ? "(stored privately on the profile)"
            : field.value.trim()
          : "— not added yet"
      }`,
    );
  }

  if (profile.accounts.length) {
    lines.push("");
    lines.push("## Accounts");
    for (const account of profile.accounts) {
      lines.push(`### ${account.label}`);
      if (account.provider) lines.push(`- Provider: ${account.provider}`);
      if (account.kind) lines.push(`- Type: ${accountKindLabel(account.kind)}`);
      if (account.openedDate) lines.push(`- Opened: ${account.openedDate}`);
      if (account.renewalDate) lines.push(`- Renewal: ${account.renewalDate}`);
      if (account.login) lines.push(`- Login: ${account.login}`);
      if (account.value) lines.push(`- Value: ${account.currency ?? "USD"} ${account.value}`);
      if (account.url) lines.push(`- URL: ${account.url}`);
      if (account.notes) lines.push(`- Notes: ${account.notes}`);
      // Passwords are deliberately never copied into the searchable note.
    }
  }
  return lines.join("\n");
}

// ----- avatar --------------------------------------------------------------

const AVATAR_MAX = 384;

/**
 * Square-crop, downscale and JPEG-encode an avatar. A phone photo is several
 * megabytes; localStorage holds about five. The result is normally 20–60 KB.
 */
export async function avatarToDataUrl(file: File): Promise<string> {
  // iPhone photos are routinely HEIC, which most desktop browsers cannot
  // decode. Convert first; heic2any is a dynamic import so the ~2.7 MB reader
  // only loads when a HEIC is actually chosen.
  const heic = /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (heic) {
    const { default: heic2any } = await import("heic2any");
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    const blob = Array.isArray(out) ? out[0] : out;
    return avatarToDataUrl(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
  }

  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose an image file."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error("Could not decode that image."));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const size = Math.min(AVATAR_MAX, side);
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(String(reader.result ?? ""));
          return;
        }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(reader.result ?? "");
    };
    reader.readAsDataURL(file);
  });
}

// ----- Jarvis draft --------------------------------------------------------

export interface ProfileDraftField {
  label: string;
  value: string;
  type: ProfileFieldType;
  sensitive?: boolean;
  hint?: string;
}

export interface ProfileDraftAccount {
  label: string;
  provider?: string;
  kind: ProfileAccountKind;
  openedDate?: string;
  renewalDate?: string;
  login?: string;
  value?: string;
  currency?: string;
  url?: string;
}

export interface ProfileDraft {
  kind: ProfileKind;
  displayName: string;
  role?: ProfileRole;
  headline?: string;
  summary: string;
  fields: ProfileDraftField[];
  accounts: ProfileDraftAccount[];
  questions: string[];
  sources: { id: string; title: string }[];
  confidence: "high" | "medium" | "low";
  engine: "ai" | "heuristic";
}

export interface DraftInput {
  description: string;
  kind?: ProfileKind;
  name?: string;
  candidates?: { id: string; title: string; summary?: string; extract?: string }[];
  folderPaths?: string[];
  existingTags?: string[];
  existingProfiles?: { displayName: string; kind: ProfileKind; role?: string }[];
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|ai|co|app|dev|store|shop|us)\b/i;
const DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/;

function detectKind(text: string, explicit?: ProfileKind): ProfileKind {
  if (explicit) return explicit;
  return /\b(llc|inc|corp|company|business|brand|agency|store|shop|domain|website|hosting|cloudflare|registrar|renewal|saas|startup|bighomieai|jackstaxx)\b/i.test(
    text,
  )
    ? "business"
    : "person";
}

function guessName(text: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const cleaned = text.replace(/\s+/g, " ").trim();
  const forMatch = cleaned.match(
    /\b(?:for|about|on)\s+(?:my\s+)?(son|daughter|wife|husband|partner|mom|mother|dad|father|friend|client)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2})/,
  );
  if (forMatch) return forMatch[2].trim();
  const myMatch = cleaned.match(
    /\b[Mm]y\s+(?:son|daughter|wife|husband|partner|mom|mother|dad|father|friend|client)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2})/,
  );
  if (myMatch) return myMatch[1].trim();
  const relMatch = cleaned.match(
    /\b(?:my\s+)(son|daughter|wife|husband|partner|mom|mother|dad|father)\b/i,
  );
  if (relMatch) return `My ${relMatch[1].toLowerCase()}`;
  const named = cleaned.match(/\b(?:named|called)\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,2})/);
  if (named) return named[1].trim();
  // "Bighomie AI — domain …" is a common way to dictate a business record.
  const heading = cleaned.match(/^([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+[—–-]\s+/);
  if (heading) return heading[1].trim();
  return "New profile";
}

function roleFromText(text: string): ProfileRole | undefined {
  if (/\bmy\s+son\b/i.test(text)) return "child";
  if (/\bmy\s+daughter\b/i.test(text)) return "child";
  if (/\bmy\s+(wife|husband|partner)\b/i.test(text)) return "partner";
  if (/\bmy\s+(mom|mother|dad|father|brother|sister|aunt|uncle)\b/i.test(text)) return "relative";
  if (/\bmy\s+friend\b/i.test(text)) return "friend";
  if (/\bclient\b/i.test(text)) return "client";
  return undefined;
}

/**
 * Offline draft. It cannot reason, but it can still give the person a complete
 * skeleton, pull out the obvious email/phone/date/domain, and ask exactly the
 * questions the missing fields imply. The AI path replaces this when a key is
 * configured; this is the floor, not a fake.
 */
export function heuristicProfileDraft(input: DraftInput): ProfileDraft {
  const text = `${input.description} ${input.name ?? ""}`.trim();
  const kind = detectKind(text, input.kind);
  const displayName = guessName(text, input.name);
  const role = kind === "person" ? roleFromText(text) : undefined;
  const blueprint = PROFILE_BLUEPRINTS[kind];

  const email = text.match(EMAIL_RE)?.[0];
  const phone = text.match(PHONE_RE)?.[0];
  const ssn = text.match(SSN_RE)?.[0];
  const domain = text.match(DOMAIN_RE)?.[0];
  const date = text.match(DATE_RE)?.[0];

  const incoming = blueprint.map((b) => {
    let value = "";
    const lower = b.label.toLowerCase();
    if (lower === "email" || lower === "business email") value = email ?? "";
    else if (lower === "phone") value = phone ?? "";
    else if (lower === "ssn" || lower === "ein") value = ssn ?? "";
    else if (lower === "website / domain" || lower === "domain") value = domain ?? "";
    else if (lower === "birthday" || lower === "renewal date" || lower === "formation date")
      value = date ?? "";
    else if (lower === "registrar" && /cloudflare/i.test(text)) value = "Cloudflare";
    else if (lower === "full legal name" || lower === "legal name") value = displayName;
    return { label: b.label, value, type: b.type };
  });

  const accounts: ProfileDraftAccount[] = [];
  const lower = text.toLowerCase();
  if (/\btrump\b/.test(lower)) {
    accounts.push({
      label: "Trump account",
      provider: "Trump Media & Technology Group",
      kind: "brokerage",
      openedDate: date ?? "",
      value: "",
      currency: "USD",
    });
  }
  if (/\bcloudflare\b/.test(lower) || /\bdomain\b/.test(lower) || domain) {
    accounts.push({
      label: domain ? `Domain — ${domain}` : "Domain",
      provider: /cloudflare/i.test(text) ? "Cloudflare" : "",
      kind: "domain",
      renewalDate: date ?? "",
      url: domain ? `https://${domain}` : "",
      currency: "USD",
    });
  }
  if (/\bbank\b/.test(lower)) {
    accounts.push({ label: "Bank account", kind: "account", currency: "USD" });
  }

  const fields = buildProfileFields(kind, incoming, displayName);
  const missing = fields.filter((f) => !f.value.trim());
  const questions = missing.slice(0, 5).map((f) => `What is the ${f.label.toLowerCase()}?${f.hint ? ` (${f.hint})` : ""}`);

  return {
    kind,
    displayName,
    role,
    headline: kind === "business" ? "Business profile" : roleLabel(role) ? `${roleLabel(role)} profile` : "Personal profile",
    summary:
      kind === "business"
        ? "A business record with its domains, accounts and renewal dates in one place."
        : "A person profile with the identity and account details you will need later.",
    fields,
    accounts,
    questions,
    sources: (input.candidates ?? []).slice(0, 4).map((c) => ({ id: c.id, title: c.title })),
    confidence: "low",
    engine: "heuristic",
  };
}

function normaliseDraft(raw: Partial<ProfileDraft>, fallback: ProfileDraft, input: DraftInput): ProfileDraft {
  const kind: ProfileKind = raw.kind === "business" || raw.kind === "person" ? raw.kind : fallback.kind;
  const displayName = String(raw.displayName ?? "").trim() || fallback.displayName;
  const incoming = Array.isArray(raw.fields) ? raw.fields : fallback.fields;
  const fields = buildProfileFields(kind, incoming, displayName).map((f) => ({
    label: f.label,
    value: f.value,
    type: f.type,
    sensitive: f.sensitive,
    hint: f.hint,
  }));
  const accounts = (Array.isArray(raw.accounts) ? raw.accounts : fallback.accounts)
    .slice(0, 8)
    .map((a) => ({
      label: String(a.label ?? "").trim() || "Account",
      provider: String(a.provider ?? "").trim() || undefined,
      kind: accountKindFrom(a.kind),
      openedDate: String(a.openedDate ?? "").trim() || undefined,
      renewalDate: String(a.renewalDate ?? "").trim() || undefined,
      login: String(a.login ?? "").trim() || undefined,
      value: String(a.value ?? "").trim() || undefined,
      currency: String(a.currency ?? "").trim() || "USD",
      url: String(a.url ?? "").trim() || undefined,
    }));
  const missing = fields.filter((f) => !f.value.trim());
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map(String).filter(Boolean).slice(0, 6)
    : missing.slice(0, 5).map((f) => `What is the ${f.label.toLowerCase()}?`);
  return {
    kind,
    displayName,
    role: (raw.role as ProfileRole | undefined) ?? roleFromText(input.description) ?? fallback.role,
    headline: String(raw.headline ?? "").trim() || fallback.headline,
    summary: String(raw.summary ?? "").trim() || fallback.summary,
    fields,
    accounts,
    questions,
    sources: Array.isArray(raw.sources)
      ? raw.sources
          .map((s) => ({ id: String(s.id ?? ""), title: String(s.title ?? "") }))
          .filter((s) => s.id && s.title)
          .slice(0, 6)
      : fallback.sources,
    confidence: raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low",
    engine: "ai",
  };
}

/**
 * Ask Jarvis for a profile draft. Never throws: a missing key, a dead gateway
 * or malformed JSON all fall back to the heuristic so the Add Profile flow
 * always produces something the user can edit.
 */
export async function draftProfileFromJarvis(input: DraftInput): Promise<ProfileDraft> {
  const fallback = heuristicProfileDraft(input);
  try {
    const res = await fetch("/api/recall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "profile",
        description: input.description,
        kind: input.kind ?? null,
        name: input.name ?? null,
        candidates: (input.candidates ?? []).slice(0, 6),
        folderPaths: input.folderPaths ?? [],
        existingTags: input.existingTags ?? [],
        existingProfiles: input.existingProfiles ?? [],
      }),
    });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { draft?: Partial<ProfileDraft> | null };
    if (!data.draft) return fallback;
    return normaliseDraft(data.draft, fallback, input);
  } catch {
    return fallback;
  }
}

/** Convert a draft into the input shape store.createProfile expects. */
export function draftToCreateInput(draft: ProfileDraft) {
  return {
    kind: draft.kind,
    displayName: draft.displayName,
    role: draft.role,
    headline: draft.headline,
    fields: draft.fields.map((f) => ({ label: f.label, value: f.value, type: f.type })),
    accounts: draft.accounts.map((a) => ({
      label: a.label,
      provider: a.provider,
      kind: a.kind,
      openedDate: a.openedDate,
      renewalDate: a.renewalDate,
      login: a.login,
      value: a.value,
      currency: a.currency,
      url: a.url,
    })),
  };
}

/** A title for an account card without repeating the provider twice. */
export function accountSubtitle(account: ProfileAccount): string {
  return [account.provider, accountKindLabel(account.kind)].filter(Boolean).join(" · ");
}
