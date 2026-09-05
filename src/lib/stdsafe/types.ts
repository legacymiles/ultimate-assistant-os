// ---------------------------------------------------------------------------
// STD Safe — domain types.
//
// Client-safe: no node: imports. The components read INFECTIONS, the label maps
// and the tier thresholds straight from here, and the server derives status from
// the same module, so a shared view and the owner's own view cannot disagree.
//
// The vocabulary matters as much as the shapes. There is no "clean" anywhere in
// this file, and there is no boolean for it either — the moment the model can
// hold `clean: true` some component will render it, and that is a promise the
// data cannot keep. What the model holds is: what was tested, what it said, when
// the sample was taken, and how well that is backed up.
// ---------------------------------------------------------------------------

export type InfectionId =
  | "hiv"
  | "syphilis"
  | "chlamydia"
  | "gonorrhea"
  | "hepb"
  | "hepc"
  | "hsv1"
  | "hsv2"
  | "trich"
  | "mgen";

export interface Infection {
  id: InfectionId;
  label: string;
  /** Column-width name for the dense status table. */
  short: string;
  /**
   * Every spelling a lab might print. Used by the parser, so this list is the
   * difference between reading a Quest report and failing to.
   */
  aka: string[];
}

/**
 * The ten-infection panel. Ordered roughly by how consequential a positive is,
 * because this order is the order the status table renders in.
 */
export const INFECTIONS: Infection[] = [
  { id: "hiv", label: "HIV (1 & 2)", short: "HIV", aka: ["hiv", "hiv-1", "hiv 1", "hiv-2", "hiv 2", "hiv ag/ab", "hiv antibody", "human immunodeficiency"] },
  { id: "syphilis", label: "Syphilis", short: "Syphilis", aka: ["syphilis", "rpr", "treponema", "vdrl", "tp-pa"] },
  { id: "chlamydia", label: "Chlamydia", short: "Chlamydia", aka: ["chlamydia", "c. trachomatis", "ct/ng", "trachomatis"] },
  { id: "gonorrhea", label: "Gonorrhea", short: "Gonorrhea", aka: ["gonorrhea", "gonorrhoea", "n. gonorrhoeae", "neisseria", "gc"] },
  { id: "hepb", label: "Hepatitis B", short: "Hep B", aka: ["hepatitis b", "hep b", "hbsag", "hbv"] },
  { id: "hepc", label: "Hepatitis C", short: "Hep C", aka: ["hepatitis c", "hep c", "hcv"] },
  { id: "hsv1", label: "Herpes (HSV-1)", short: "HSV-1", aka: ["hsv-1", "hsv 1", "herpes simplex 1", "herpes simplex virus 1", "hsv1 igg"] },
  { id: "hsv2", label: "Herpes (HSV-2)", short: "HSV-2", aka: ["hsv-2", "hsv 2", "herpes simplex 2", "herpes simplex virus 2", "hsv2 igg"] },
  { id: "trich", label: "Trichomoniasis", short: "Trich", aka: ["trichomonas", "trichomoniasis", "t. vaginalis"] },
  { id: "mgen", label: "Mycoplasma genitalium", short: "M. gen", aka: ["mycoplasma", "m. genitalium", "mgen", "mycoplasma genitalium"] },
];

export const INFECTION_IDS: InfectionId[] = INFECTIONS.map((i) => i.id);

export function infectionById(id: InfectionId): Infection {
  return INFECTIONS.find((i) => i.id === id) ?? INFECTIONS[0];
}

export type Outcome = "negative" | "positive" | "indeterminate";

/**
 * Why a positive is not the end of the sentence.
 *
 * An undetectable HIV viral load is not transmissible, and a chlamydia treated
 * six months ago is not a current infection. Without this field the app would
 * flatten both into the same red dot, which is both wrong and cruel.
 */
export type TreatmentContext =
  | "treated-cleared"
  | "in-treatment"
  | "managed-undetectable"
  | "suppressive-therapy"
  | "untreated";

export const CONTEXT_LABELS: Record<TreatmentContext, string> = {
  "treated-cleared": "Treated & cleared",
  "in-treatment": "In treatment",
  "managed-undetectable": "Managed — undetectable",
  "suppressive-therapy": "On suppressive therapy",
  untreated: "Not yet treated",
};

export const CONTEXT_NOTES: Record<TreatmentContext, string> = {
  "treated-cleared": "Treated, with a follow-up test confirming it cleared.",
  "in-treatment": "Currently being treated; not yet re-tested.",
  "managed-undetectable": "Under treatment with an undetectable viral load.",
  "suppressive-therapy": "Managed with ongoing suppressive medication.",
  untreated: "Positive and not currently being treated.",
};

/** How well a record is backed up. Exactly two tiers — see the spec. */
export type Verification = "document" | "self";

export interface Result {
  infection: InfectionId;
  outcome: Outcome;
  /** Only meaningful on a positive. */
  context?: TreatmentContext;
  /** The raw string the lab printed, kept so the owner can sanity-check a parse. */
  value?: string;
}

export interface TestRecord {
  id: string;
  userId: string;
  /** ISO date (YYYY-MM-DD) the sample was taken. The date that actually matters. */
  collectedAt: string;
  /** When the lab released it. Shown, but never used for freshness. */
  reportedAt?: string;
  lab: string;
  panelName: string;
  verification: Verification;
  /** Points at the stored report file. Owner-only, never shared. */
  fileId?: string;
  fileName?: string;
  results: Result[];
  note?: string;
  createdAt: string;
}

export type RequestStatus = "pending" | "approved" | "denied" | "expired";

export interface ShareRequest {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: RequestStatus;
  createdAt: string;
  respondedAt?: string;
  /** Set on approval. 24h later the view is dead. */
  grantExpiresAt?: string;
}

/** A user as it is safe to send to the browser — never password material. */
export interface PublicUser {
  id: string;
  handle: string;
  displayName?: string;
}

export const GRANT_TTL_MS = 24 * 60 * 60 * 1000;

/** Freshness thresholds, in days from the collection date. */
export const FRESH_DAYS = 30;
export const AGING_DAYS = 90;
