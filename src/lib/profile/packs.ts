// ---------------------------------------------------------------------------
// Schema packs — the mechanic that turns a stated fact into a shaped folder.
//
// The source video's advice is "don't pre-build the tree, let the agent spin up
// folders as jobs arrive". A pack is that, made typed: saying "I just got a DTF
// printer" fires `equipment`, which knows a piece of equipment has a serial, a
// warranty and a consumables list — so the owner answers fields instead of
// designing a folder structure.
//
// `cues` do double duty: they seed the extractor's prompt AND rank the manual
// add menu, which keeps the AI path and the human path speaking one vocabulary.
// ---------------------------------------------------------------------------

import type { Pack } from "./types";

export const PACKS: Pack[] = [
  {
    id: "person",
    label: "Person",
    icon: "Users",
    cues: ["friend", "family", "my mum", "my brother", "my wife", "birthday is", "met at"],
    fields: [
      { label: "Relationship", kind: "text" },
      { label: "Birthday", kind: "date" },
      { label: "Phone", kind: "phone" },
      { label: "Email", kind: "email" },
      { label: "Address", kind: "address" },
      { label: "How we met", kind: "multiline" },
      { label: "Gift ideas", kind: "multiline" },
    ],
  },
  {
    id: "job",
    label: "Job",
    icon: "Target",
    cues: ["i work at", "i started at", "my job", "employer", "my shift", "my manager"],
    fields: [
      { label: "Employer", kind: "text" },
      { label: "Title", kind: "text" },
      { label: "Started", kind: "date" },
      { label: "Ended", kind: "date" },
      { label: "Work address", kind: "address" },
      { label: "Schedule", kind: "text" },
      { label: "Manager", kind: "text" },
      { label: "Pay", kind: "money" },
      { label: "Payroll login", kind: "secret" },
      { label: "Door code", kind: "secret" },
      { label: "Badge / card number", kind: "secret" },
    ],
    children: [
      { name: "Pay stubs" },
      { name: "Reviews" },
    ],
  },
  {
    id: "job-application",
    label: "Application",
    icon: "Flag",
    cues: ["applied to", "application", "interview with"],
    fields: [
      { label: "Company", kind: "text" },
      { label: "Role", kind: "text" },
      { label: "Applied", kind: "date" },
      { label: "Status", kind: "text" },
      { label: "Contact", kind: "text" },
      { label: "Posting", kind: "url" },
      { label: "Next step", kind: "multiline" },
    ],
  },
  {
    id: "job-offer",
    label: "Offer",
    icon: "Star",
    cues: ["offer from", "they offered me", "offer letter"],
    fields: [
      { label: "Company", kind: "text" },
      { label: "Role", kind: "text" },
      { label: "Base", kind: "money" },
      { label: "Bonus / equity", kind: "text" },
      { label: "Start date", kind: "date" },
      { label: "Respond by", kind: "date" },
      { label: "Recruiter", kind: "text" },
      { label: "Status", kind: "text" },
    ],
  },
  {
    id: "resume",
    label: "Resume",
    icon: "File",
    cues: ["resume", "cv", "my experience"],
    fields: [
      { label: "Headline", kind: "text" },
      { label: "Summary", kind: "multiline" },
      { label: "Years experience", kind: "text" },
    ],
    children: [
      { name: "Experience" },
      { name: "Education" },
      { name: "Skills" },
      { name: "Certifications" },
    ],
  },
  {
    id: "business",
    label: "Business",
    icon: "Layers",
    cues: ["my business", "my company", "i run", "we sell", "llc", "sole trader"],
    fields: [
      { label: "Legal name", kind: "text" },
      { label: "Trading name", kind: "text" },
      { label: "Structure", kind: "text" },
      { label: "Tax number", kind: "secret" },
      { label: "Formed", kind: "date" },
      { label: "Bank", kind: "text" },
      { label: "Accountant", kind: "text" },
      { label: "What we sell", kind: "multiline" },
    ],
    children: [
      { name: "Website & Domains", icon: "Globe" },
      { name: "Email & Logins", icon: "Key" },
      { name: "Equipment", icon: "Server" },
      { name: "Vendors", icon: "Tag" },
      { name: "Clients", icon: "Users" },
      { name: "Taxes", icon: "Cash" },
      { name: "Pricing", icon: "Cash" },
      { name: "Brand & Voice", pack: "voice", icon: "Bulb" },
    ],
  },
  {
    id: "website",
    label: "Website",
    icon: "Globe",
    cues: ["my website", "domain", "registrar", "my site"],
    fields: [
      { label: "URL", kind: "url" },
      { label: "What it is", kind: "text" },
      { label: "Platform", kind: "text" },
      { label: "Registrar", kind: "text" },
      { label: "Renews", kind: "date" },
      { label: "Host", kind: "text" },
      { label: "Admin login", kind: "secret" },
      { label: "Analytics", kind: "url" },
    ],
  },
  {
    id: "equipment",
    label: "Equipment",
    icon: "Server",
    cues: ["i just got a", "i bought a", "printer", "machine", "my gear", "my rig"],
    fields: [
      { label: "Make & model", kind: "text" },
      { label: "Serial number", kind: "text" },
      { label: "Purchased", kind: "date" },
      { label: "Price", kind: "money" },
      { label: "Supplier", kind: "text" },
      { label: "Warranty until", kind: "date" },
      { label: "Consumables", kind: "multiline" },
      { label: "Maintenance log", kind: "multiline" },
    ],
  },
  {
    id: "vendor",
    label: "Vendor",
    icon: "Tag",
    cues: ["supplier", "vendor", "i buy from", "wholesale"],
    fields: [
      { label: "What they supply", kind: "text" },
      { label: "Account number", kind: "text" },
      { label: "Rep", kind: "text" },
      { label: "Terms", kind: "text" },
      { label: "Portal", kind: "url" },
      { label: "Portal login", kind: "secret" },
    ],
  },
  {
    id: "client",
    label: "Client",
    icon: "Users",
    cues: ["my client", "customer", "i do work for"],
    fields: [
      { label: "Contact", kind: "text" },
      { label: "Email", kind: "email" },
      { label: "Phone", kind: "phone" },
      { label: "What we do for them", kind: "multiline" },
      { label: "Rate", kind: "money" },
      { label: "Client since", kind: "date" },
      { label: "How they pay", kind: "text" },
    ],
  },
  {
    id: "bill",
    label: "Bill",
    icon: "Cash",
    cues: ["bill", "i pay", "monthly", "due on the", "utility", "rent is"],
    fields: [
      { label: "Provider", kind: "text" },
      { label: "Amount", kind: "money" },
      { label: "How often", kind: "text" },
      { label: "Due day", kind: "text" },
      { label: "Autopay", kind: "text" },
      { label: "Paid with", kind: "text" },
      { label: "Account number", kind: "text" },
      { label: "Login", kind: "secret" },
    ],
  },
  {
    id: "card",
    label: "Card",
    icon: "Cash",
    cues: ["credit card", "debit card", "my visa", "my amex"],
    fields: [
      { label: "Issuer", kind: "text" },
      { label: "Last four", kind: "text" },
      { label: "Expires", kind: "date" },
      { label: "Limit", kind: "money" },
      { label: "Statement day", kind: "text" },
      { label: "Full number", kind: "secret" },
      { label: "CVV", kind: "secret" },
    ],
  },
  {
    id: "account",
    label: "Account",
    icon: "Database",
    cues: ["bank account", "savings", "checking", "my bank"],
    fields: [
      { label: "Institution", kind: "text" },
      { label: "Type", kind: "text" },
      { label: "Last four", kind: "text" },
      { label: "Routing / BSB", kind: "secret" },
      { label: "Login", kind: "secret" },
    ],
  },
  {
    id: "tax-year",
    label: "Tax year",
    icon: "Cash",
    cues: ["taxes", "tax return", "filed", "refund"],
    fields: [
      { label: "Year", kind: "text" },
      { label: "Filed", kind: "date" },
      { label: "Prepared by", kind: "text" },
      { label: "Refund / owed", kind: "money" },
      { label: "Where the documents are", kind: "multiline" },
    ],
  },
  {
    id: "property",
    label: "Property",
    icon: "Home",
    cues: ["i live at", "my house", "my apartment", "landlord", "mortgage", "lease"],
    fields: [
      { label: "Address", kind: "address" },
      { label: "Own or rent", kind: "text" },
      { label: "Payment", kind: "money" },
      { label: "Landlord / lender", kind: "text" },
      { label: "Lease from", kind: "date" },
      { label: "Lease until", kind: "date" },
      { label: "Door / alarm code", kind: "secret" },
    ],
  },
  {
    id: "vehicle",
    label: "Vehicle",
    icon: "Flag",
    cues: ["my car", "my truck", "my van", "plate", "vin"],
    fields: [
      { label: "Make, model, year", kind: "text" },
      { label: "Plate", kind: "text" },
      { label: "VIN", kind: "text" },
      { label: "Insurer", kind: "text" },
      { label: "Registration due", kind: "date" },
      { label: "Last service", kind: "date" },
    ],
  },
  {
    id: "insurance",
    label: "Insurance",
    icon: "Shield",
    cues: ["insurance", "policy", "covered by"],
    fields: [
      { label: "Provider", kind: "text" },
      { label: "What it covers", kind: "text" },
      { label: "Policy number", kind: "secret" },
      { label: "Premium", kind: "money" },
      { label: "Renews", kind: "date" },
    ],
  },
  {
    id: "health",
    label: "Health",
    icon: "Shield",
    cues: ["allergic", "allergy", "medication", "blood type", "my doctor", "diagnosed"],
    fields: [
      { label: "Allergies", kind: "multiline" },
      { label: "Conditions", kind: "multiline" },
      { label: "Medications", kind: "multiline" },
      { label: "Blood type", kind: "text" },
      { label: "Doctor", kind: "text" },
      { label: "Emergency contact", kind: "text" },
    ],
  },
  {
    id: "id-document",
    label: "ID document",
    icon: "Lock",
    cues: ["passport", "licence", "license", "social security", "birth certificate"],
    fields: [
      { label: "Type", kind: "text" },
      { label: "Country / state", kind: "text" },
      { label: "Number", kind: "secret" },
      { label: "Issued", kind: "date" },
      { label: "Expires", kind: "date" },
    ],
  },
  {
    id: "subscription",
    label: "Subscription",
    icon: "Clock",
    cues: ["subscription", "i subscribe", "per month for"],
    fields: [
      { label: "Service", kind: "text" },
      { label: "Cost", kind: "money" },
      { label: "How often", kind: "text" },
      { label: "Renews", kind: "date" },
      { label: "Paid with", kind: "text" },
    ],
  },
  {
    id: "login",
    label: "Login",
    icon: "Key",
    cues: ["my login", "password for", "account on", "2fa"],
    fields: [
      { label: "Service", kind: "text" },
      { label: "URL", kind: "url" },
      { label: "Username", kind: "text" },
      { label: "Password", kind: "secret" },
      { label: "2FA", kind: "secret" },
      { label: "Recovery", kind: "secret" },
    ],
  },
  {
    id: "voice",
    label: "Voice & tone",
    icon: "Bulb",
    cues: ["never say", "don't say", "i write like", "my tone", "sounds like me"],
    fields: [
      { label: "Core instruction", kind: "multiline" },
      { label: "Never say", kind: "multiline" },
      { label: "Something I actually wrote", kind: "multiline" },
      { label: "Tone patterns", kind: "multiline" },
    ],
  },
];

export const PACK_BY_ID: Record<string, Pack> = Object.fromEntries(PACKS.map((p) => [p.id, p]));

export function packOf(id: string): Pack | null {
  return PACK_BY_ID[id] ?? null;
}

/**
 * Rank packs against a phrase, best first. Used by the add menu's search box
 * and as the tie-breaker when the extractor names a pack that does not exist.
 */
export function suggestPacks(phrase: string, limit = 6): Pack[] {
  const q = phrase.trim().toLowerCase();
  if (!q) return PACKS.slice(0, limit);
  const scored = PACKS.map((p) => {
    let score = 0;
    if (p.label.toLowerCase().includes(q)) score += 6;
    if (p.id.includes(q)) score += 4;
    for (const cue of p.cues) {
      if (q.includes(cue)) score += 5;
      else if (cue.includes(q)) score += 2;
    }
    return { p, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.p);
}

/** The seeded root. Seven tiles; Business starts empty and fills when one exists. */
export const ROOT_TREE: { name: string; icon: Pack["icon"]; children: { name: string; pack?: string; icon?: Pack["icon"] }[] }[] = [
  {
    name: "Me",
    icon: "Users",
    children: [
      { name: "Identity & Documents", icon: "Lock" },
      { name: "Health", pack: "health", icon: "Shield" },
      { name: "Voice & Tone", pack: "voice", icon: "Bulb" },
      { name: "Preferences & Routines", icon: "Clock" },
    ],
  },
  {
    name: "People",
    icon: "Users",
    children: [
      { name: "Friends & Family", icon: "Users" },
      { name: "Work & Professional", icon: "Target" },
    ],
  },
  {
    name: "Money",
    icon: "Cash",
    children: [
      { name: "Bills", icon: "Cash" },
      { name: "Cards", icon: "Cash" },
      { name: "Accounts", icon: "Database" },
      { name: "Subscriptions", icon: "Clock" },
      { name: "Taxes", icon: "Cash" },
    ],
  },
  {
    name: "Work",
    icon: "Target",
    children: [
      { name: "Current Job", pack: "job", icon: "Target" },
      { name: "Resume", pack: "resume", icon: "File" },
      { name: "Old Jobs", icon: "Clock" },
      { name: "Applications", icon: "Flag" },
      { name: "Offers", icon: "Star" },
    ],
  },
  { name: "Business", icon: "Layers", children: [] },
  {
    name: "Home",
    icon: "Home",
    children: [
      { name: "Property", pack: "property", icon: "Home" },
      { name: "Vehicles", icon: "Flag" },
      { name: "Utilities", icon: "Cash" },
      { name: "Insurance", icon: "Shield" },
    ],
  },
  { name: "Legal & Docs", icon: "File", children: [] },
];
