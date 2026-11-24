// The first line of defence on a public stream: nothing a viewer types is
// spoken aloud until it passes here. Reading abuse out on air is the one
// failure that ends a TikTok account, so this runs before the queue, not after.
//
// The hosted model is the second line (its system prompt forbids repeating
// offensive content). The owner's own word list covers what defaults can't.

export type BlockReason = "blocked-word" | "link" | "spam" | "harassment" | "contact";

export interface ModerationResult {
  ok: boolean;
  reason?: BlockReason;
}

/** Plain-English label for the operator — never a code (R3). */
export const REASON_LABEL: Record<BlockReason, string> = {
  "blocked-word": "Hidden — contains a word you blocked",
  link: "Hidden — links are never read aloud",
  spam: "Hidden — looks like spam",
  harassment: "Hidden — harassment",
  contact: "Hidden — personal contact details",
};

/**
 * Harassment that should never be read on air. Written as patterns, not word
 * lists, so spacing tricks ("k y s") still match.
 */
const HARASSMENT = [
  /\bk\s*y\s*s\b/i,
  /\bkill\s*(?:your|ur|yo)\s*self\b/i,
  /\bgo\s+die\b/i,
  /\bneck\s+(?:your|ur)\s*self\b/i,
  /\bhope\s+(?:you|u)\s+die\b/i,
];

const LINK = /(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|xyz|ly|me|co|app|link|shop)\b/i;
const PHONE = /(?:\+?\d[\s.-]?){9,}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

const LEET: Record<string, string> = { "0": "o", "@": "a", "4": "a", $: "s", "5": "s", "1": "i", "3": "e", "7": "t" };

/**
 * Undo the common character swaps people use to dodge filters.
 *
 * A swap only counts when it touches a letter: "b4dw0rd" is a word in
 * disguise, but "12345" is a number and "world!!" ends in punctuation —
 * mapping those would glue "ii" onto the word and let it slip past a
 * whole-word match.
 */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?<=\p{L})[0@4$5137]|[0@4$5137](?=\p{L})/gu, (c) => LEET[c] ?? c)
    .replace(/(?<=\p{L})[!|](?=\p{L})/gu, "i")
    .replace(/(.)\1{2,}/g, "$1$1")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "b a d w o r d" → "badword". Only runs of ISOLATED single letters are
 * joined. Squashing every space instead would turn "push it" into "pushit"
 * and hide innocent comments that happen to span a bad word.
 */
function joinSpacedLetters(s: string): string {
  return s.replace(/(^|\s)((?:\p{L}\s){2,}\p{L})(?=\s|$)/gu, (_m, lead: string, run: string) => lead + run.replace(/\s/g, ""));
}

function containsBlocked(text: string, blocklist: readonly string[]): boolean {
  const norm = ` ${joinSpacedLetters(normalizeForMatch(text))} `;
  return blocklist.some((raw) => {
    const w = normalizeForMatch(raw);
    return !!w && norm.includes(` ${w} `);
  });
}

function looksLikeSpam(text: string): boolean {
  if (/(.)\1{9,}/.test(text)) return true;
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 16) {
    const upper = letters.replace(/[^\p{Lu}]/gu, "").length;
    if (upper / letters.length > 0.85) return true;
  }
  return false;
}

export function moderate(text: string, blocklist: readonly string[] = []): ModerationResult {
  if (HARASSMENT.some((re) => re.test(text))) return { ok: false, reason: "harassment" };
  if (containsBlocked(text, blocklist)) return { ok: false, reason: "blocked-word" };
  if (EMAIL.test(text) || PHONE.test(text)) return { ok: false, reason: "contact" };
  if (LINK.test(text)) return { ok: false, reason: "link" };
  if (looksLikeSpam(text)) return { ok: false, reason: "spam" };
  return { ok: true };
}

/**
 * The name the character is allowed to say out loud. A username can be the
 * abuse ("@ihate_x"), so it is checked too, and anything unsayable becomes
 * a neutral word rather than being read letter by letter.
 */
export function speakableName(user: string, blocklist: readonly string[] = []): string {
  const clean = user
    .replace(/^@+/, "")
    .replace(/[_.]+/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  if (!clean || !/\p{L}/u.test(clean)) return "friend";
  if (!moderate(clean, blocklist).ok) return "friend";
  return clean;
}
