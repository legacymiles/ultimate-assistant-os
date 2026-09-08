// ---------------------------------------------------------------------------
// Recall — structured record schemas.
// Websites and logins get the SAME fields every time, so a folder of them reads
// as a table instead of a pile of differently-shaped notes. Every value here is
// plaintext and searchable; a credential's password lives in `item.password`,
// never in fields, and is never indexed by search.
// ---------------------------------------------------------------------------

import type { ItemKind } from "./types";

export interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  /** Render in JetBrains Mono — URLs, hosts, commands, keys. */
  mono?: boolean;
  /** Render as a clickable link. */
  link?: boolean;
  /** Show on the collapsed row, not just the expanded record. */
  primary?: boolean;
  type?: "text" | "date";
}

/**
 * A website is deliberately general — a site you own, a service you use, a
 * dashboard you keep losing. It can live in any folder, next to the notes and
 * logins that go with it.
 */
export const WEBSITE_FIELDS: FieldDef[] = [
  { key: "url", label: "URL", placeholder: "example.com", mono: true, link: true, primary: true },
  { key: "purpose", label: "What it's for", placeholder: "prop firm dashboard, my portfolio…", primary: true },
  { key: "account", label: "Account", placeholder: "which login — see Logins & Passwords" },
  { key: "hosting", label: "Hosted on", placeholder: "Vercel, Hostinger, my VPS…" },
  { key: "host", label: "Host / IP", placeholder: "188.34.0.0", mono: true },
  { key: "registrar", label: "Registrar", placeholder: "Namecheap, Cloudflare…" },
  { key: "renews", label: "Renews", placeholder: "2027-03-11", type: "date" },
  { key: "deploy", label: "Deploy", placeholder: "git push origin main", mono: true },
];

export const CREDENTIAL_FIELDS: FieldDef[] = [
  { key: "username", label: "Username", placeholder: "legacymiles", mono: true, primary: true },
  { key: "email", label: "Email", placeholder: "you@example.com", mono: true },
  { key: "url", label: "URL", placeholder: "https://trading.aquafunded.com", link: true, primary: true },
  { key: "twofa", label: "2FA", placeholder: "Authenticator app / SMS / none" },
  { key: "notes", label: "Notes", placeholder: "recovery email, account number…" },
];

export function fieldsFor(kind: ItemKind): FieldDef[] {
  switch (kind) {
    case "website":
      return WEBSITE_FIELDS;
    case "credential":
      return CREDENTIAL_FIELDS;
    default:
      return [];
  }
}

/** The one or two values worth showing on a collapsed row. */
export function primaryFields(kind: ItemKind): FieldDef[] {
  return fieldsFor(kind).filter((f) => f.primary);
}

const DATE_KEYS = new Set(["renews"]);

/**
 * Days until the soonest renewal on a record, or null when none is set.
 * Drives the amber "expiring" / red "expired" dot on a website row.
 */
export function daysUntilExpiry(fields: Record<string, string> | undefined): number | null {
  if (!fields) return null;
  let soonest: number | null = null;
  for (const [k, v] of Object.entries(fields)) {
    if (!DATE_KEYS.has(k) || !v) continue;
    const t = new Date(v).getTime();
    if (Number.isNaN(t)) continue;
    const days = Math.ceil((t - Date.now()) / 86_400_000);
    if (soonest === null || days < soonest) soonest = days;
  }
  return soonest;
}
