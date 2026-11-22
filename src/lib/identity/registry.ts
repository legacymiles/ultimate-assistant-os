// ---------------------------------------------------------------------------
// Jarvis identity — who each person is, read from Profiles.
//
// Profiles is the one source of truth for people. Every person profile IS an
// identity, and its profile id is the identity id every other store points at:
// the Photos person Camera Autopilot matches (`Person.identityId`), the
// person's Images-library folders and pictures (`Folder.identityId`,
// `Item.identityIds`), and the memory card the harness searches
// (`identity:<id>`). Nothing else gets to mint a person.
//
// This file is pure — no storage, no window — so the same rules run in the
// browser, in a route and in tests.
// ---------------------------------------------------------------------------

import type { Media, ProfileNode, ProfilesData } from "@/lib/profiles/types";
import type { PersonRole } from "@/lib/recall/photos/types";

export const ROOT_ID = "root";

/** What every app may know about a person. Never a secret row, never face data. */
export interface IdentityCard {
  /** The persistent identity id — the person's Profiles id. */
  id: string;
  name: string;
  /** Every other word the owner uses for them, lower case. */
  aliases: string[];
  /** "Person", "You", "Teacher" — the word over the name in Profiles. */
  label: string;
  sub: string;
  /** "MY SON › SCHOOL" style path, for telling two people of the same name apart. */
  path: string;
  role: PersonRole;
  /** Up to a dozen non-private rows ("Birthday: Mar 4"). */
  facts: string[];
  /** Facts Jarvis remembered about them that have no section yet. */
  notes: string[];
  /** Face recognition is permitted for them. */
  consent: boolean;
  /** Authorized reference photos in the profile. */
  refCount: number;
  /** Consent AND at least one reference — Camera Autopilot can recognise them. */
  enrolled: boolean;
  hasPicture: boolean;
}

/** Is this node a real, live person (not an example, not archived or hidden from Jarvis)? */
export function isIdentity(n: ProfileNode | undefined): n is ProfileNode {
  return Boolean(n && n.kind === "person" && n.id !== ROOT_ID && !n.example && !n.archived && !n.hidden);
}

function pathOf(data: ProfilesData, id: string): string {
  const parentOf = new Map<string, string>();
  for (const n of Object.values(data.nodes)) for (const c of n.children) parentOf.set(c, n.id);
  const names: string[] = [];
  let cur: string | undefined = id;
  for (let guard = 0; cur && cur !== ROOT_ID && guard < 16; guard += 1) {
    const node: ProfileNode | undefined = data.nodes[cur];
    if (!node) break;
    names.unshift(node.name.toUpperCase());
    cur = parentOf.get(cur);
  }
  return names.join(" › ");
}

/**
 * A photo in the profile that may be used as a face reference / picture.
 * Library read-backs (`fromRecall`) and videos never qualify.
 */
export function eligibleMedia(m: Media): boolean {
  return m.kind === "photo" && Boolean(m.src) && !m.fromRecall && !m.scene;
}

/** The authorized face references of a person — empty without consent. */
export function enrolledRefs(n: ProfileNode): Media[] {
  if (!n.faceConsent?.granted) return [];
  return n.media.filter((m) => m.ref && eligibleMedia(m));
}

const ROLE_WORDS: [RegExp, PersonRole][] = [
  [/\b(girl ?friend|boy ?friend|wife|husband|partner|fianc[eé]e?|spouse|bae)\b/i, "partner"],
  [/\b(son|daughter|child|kid|baby|stepson|stepdaughter)\b/i, "child"],
  [/\b(mom|mum|mother|dad|father|brother|sister|aunt|uncle|cousin|grand\w*|niece|nephew|relative|in-law)\b/i, "relative"],
  [/\b(friend|bestie|buddy)\b/i, "friend"],
];

/** What the Photos tab should call this person's relationship to the owner. */
export function roleOf(n: ProfileNode): PersonRole {
  if (n.id === "me" || n.label.toLowerCase() === "you") return "self";
  const words = [n.name, n.label, n.sub, ...(n.aliases ?? [])].join(" ");
  for (const [re, role] of ROLE_WORDS) if (re.test(words)) return role;
  return "other";
}

/** "My Son" → "son"; "Brandy Lee" stays. Used for matching, not display. */
function bareName(name: string): string {
  return name.replace(/^(my|our)\s+/i, "").trim().toLowerCase();
}

/** No pixels in a card or a prompt: an embedded data: URL becomes a word. */
function clean(text: string): string {
  return text.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[image]").slice(0, 400);
}

export function buildIdentities(data: ProfilesData): IdentityCard[] {
  const out: IdentityCard[] = [];
  for (const n of Object.values(data.nodes)) {
    if (!isIdentity(n)) continue;
    const facts: string[] = [];
    for (const s of n.sections)
      for (const i of s.items) {
        if (i.secret || i.noAi) continue;
        if (facts.length < 12) facts.push(clean(`${i.k}: ${i.v}${i.meta ? ` (${i.meta})` : ""}`));
      }
    const notes = data.memory.filter((m) => m.about === n.id).map((m) => clean(`${m.k}: ${m.v}`)).slice(0, 8);
    const refs = enrolledRefs(n);
    const consent = Boolean(n.faceConsent?.granted);
    out.push({
      id: n.id,
      name: n.name,
      aliases: [...new Set((n.aliases ?? []).map((a) => a.toLowerCase().trim()).filter(Boolean))],
      label: n.label,
      sub: n.sub,
      path: pathOf(data, n.id),
      role: roleOf(n),
      facts,
      notes,
      consent,
      refCount: n.media.filter((m) => m.ref && eligibleMedia(m)).length,
      enrolled: consent && refs.length > 0,
      hasPicture: Boolean(n.avatar),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// --- who is the owner talking about? -----------------------------------------

export interface Mention {
  id: string;
  name: string;
  /** The words in the text that pointed at them. */
  via: string;
  /** 1 = full name, 0.9 = alias, 0.75 = first name, 0.6 = relationship word. */
  score: number;
}

export interface Resolution {
  mentions: Mention[];
  /** Words that point at more than one person ("Chris" with two Chrises). */
  ambiguous: { via: string; ids: string[] }[];
}

const STOP = new Set(["me", "my", "i", "you", "the", "a", "an", "and", "or", "to", "of", "in", "on", "at", "for", "is", "it", "he", "she", "they", "them", "her", "him", "his", "who", "what", "when", "where"]);

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function has(text: string, phrase: string): boolean {
  if (!phrase || phrase.length < 2) return false;
  return new RegExp(`(^|[^a-z0-9])${esc(phrase)}('s|s)?([^a-z0-9]|$)`, "i").test(text);
}

/**
 * Map the people a sentence names to identities. A phrase that fits several
 * people is reported as ambiguous instead of being given to whichever came
 * first — guessing wrong about WHO is the mistake this system exists to stop.
 */
export function resolveMentions(text: string, cards: IdentityCard[]): Resolution {
  const t = ` ${text.toLowerCase()} `;
  const byPhrase = new Map<string, { score: number; ids: Set<string> }>();
  const note = (phrase: string, id: string, score: number) => {
    const p = phrase.toLowerCase().trim();
    if (!p || STOP.has(p) || !has(t, p)) return;
    const cur = byPhrase.get(p) ?? { score, ids: new Set<string>() };
    cur.score = Math.max(cur.score, score);
    cur.ids.add(id);
    byPhrase.set(p, cur);
  };
  for (const c of cards) {
    note(c.name, c.id, 1);
    const bare = bareName(c.name);
    if (bare !== c.name.toLowerCase()) note(`my ${bare}`, c.id, 0.95);
    for (const a of c.aliases) note(a, c.id, a.includes(" ") ? 0.95 : 0.9);
    const first = bare.split(/\s+/)[0];
    if (first && first !== bare && first.length > 2) note(first, c.id, 0.75);
    if (c.role === "self") continue;
    if (bare.split(/\s+/).length === 1 && bare.length > 2) note(bare, c.id, 0.6);
  }

  // A longer phrase that matched swallows the shorter ones inside it
  // ("brandy lee" beats "brandy"), so "Brandy Lee" is not also ambiguous.
  const phrases = [...byPhrase.keys()].sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const p of phrases) if (!kept.some((k) => k.includes(p) && byPhrase.get(k)!.ids.size === 1)) kept.push(p);

  const best = new Map<string, Mention>();
  const ambiguous: Resolution["ambiguous"] = [];
  for (const p of kept) {
    const hit = byPhrase.get(p)!;
    if (hit.ids.size > 1) {
      ambiguous.push({ via: p, ids: [...hit.ids] });
      continue;
    }
    const id = [...hit.ids][0];
    const card = cards.find((c) => c.id === id)!;
    const prev = best.get(id);
    if (!prev || prev.score < hit.score) best.set(id, { id, name: card.name, via: p, score: hit.score });
  }
  return { mentions: [...best.values()].sort((a, b) => b.score - a.score), ambiguous };
}

// --- duplicates ----------------------------------------------------------------

/** Person profiles that share a name or an alias — likely one person twice. */
export function findDuplicates(cards: IdentityCard[]): { key: string; ids: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const c of cards) {
    for (const k of new Set([bareName(c.name), ...c.aliases.filter((a) => a.length > 2 && !STOP.has(a) && !/^(son|daughter|kid|boy|girl|baby|friend|teacher|me|myself)$/.test(a))])) {
      if (!k) continue;
      const s = by.get(k) ?? new Set<string>();
      s.add(c.id);
      by.set(k, s);
    }
  }
  return [...by.entries()].filter(([, ids]) => ids.size > 1).map(([key, ids]) => ({ key, ids: [...ids] }));
}

/**
 * Who a name means, telling "nobody" apart from "more than one". `loose`
 * also accepts a unique first name — fine for reading a sentence, never for
 * moving someone's face from one place to another.
 */
export function matchName(name: string, cards: IdentityCard[], loose = false): { card: IdentityCard | null; ambiguous: boolean } {
  const want = name.toLowerCase().trim();
  if (!want) return { card: null, ambiguous: false };
  const exact = cards.filter((c) => c.name.toLowerCase() === want || bareName(c.name) === want || c.aliases.includes(want));
  if (exact.length === 1) return { card: exact[0], ambiguous: false };
  if (exact.length > 1) return { card: null, ambiguous: true };
  if (!loose) return { card: null, ambiguous: false };
  const first = cards.filter((c) => bareName(c.name).split(/\s+/)[0] === want);
  return first.length === 1 ? { card: first[0], ambiguous: false } : { card: null, ambiguous: first.length > 1 };
}

/** Find the identity a free-text name means, or null (none, or more than one). */
export function identityByName(name: string, cards: IdentityCard[]): IdentityCard | null {
  return matchName(name, cards, true).card;
}

// --- the block every prompt gets ------------------------------------------------

function line(c: IdentityCard, full: boolean): string {
  const bits = [`- ${c.name} [identity ${c.id}] — ${c.label.toLowerCase()}${c.sub ? `, ${c.sub}` : ""}`];
  if (c.aliases.length) bits.push(`    also called: ${c.aliases.slice(0, 8).join(", ")}`);
  if (c.path && c.path.includes("›")) bits.push(`    filed at: ${c.path}`);
  if (full) {
    if (c.facts.length) bits.push(`    ${c.facts.join(" · ")}`);
    if (c.notes.length) bits.push(`    remembered: ${c.notes.join(" · ")}`);
  }
  bits.push(`    face recognition: ${c.enrolled ? `enrolled (${c.refCount} reference photo${c.refCount === 1 ? "" : "s"})` : c.consent ? "allowed, no reference photo yet" : "off"}`);
  return bits.join("\n");
}

/**
 * The PEOPLE block for any LLM prompt. People the text mentions come first with
 * their facts; everyone else is one short line so a name the owner uses is
 * always recognised. Ambiguous words are called out so the model asks.
 */
export function identityDigest(cards: IdentityCard[], text = "", maxChars = 5000): string {
  if (!cards.length) return "";
  const r = text ? resolveMentions(text, cards) : { mentions: [], ambiguous: [] };
  const named = new Set(r.mentions.map((m) => m.id));
  const parts: string[] = [
    "PEOPLE (Jarvis identities from Profiles — the one record of who each person is; the same id is used by Camera Autopilot, the Images library and memory). " +
      "When the owner names someone, they mean the matching identity below. Refer to people by name, never invent facts about them.",
  ];
  if (r.mentions.length) parts.push(`Mentioned in this message:\n${r.mentions.map((m) => line(cards.find((c) => c.id === m.id)!, true)).join("\n")}`);
  if (r.ambiguous.length)
    parts.push(
      `Ambiguous — ask which one before acting:\n${r.ambiguous
        .map((a) => `- "${a.via}" could be ${a.ids.map((id) => cards.find((c) => c.id === id)?.name ?? id).join(" or ")}`)
        .join("\n")}`,
    );
  const rest = cards.filter((c) => !named.has(c.id));
  if (rest.length) parts.push(`Everyone else:\n${rest.map((c) => line(c, !text)).join("\n")}`);
  return parts.join("\n\n").slice(0, maxChars);
}

/** The memory row for one identity — what search_memory and the harness find. */
export function identityMemory(c: IdentityCard): { externalId: string; title: string; content: string; tags: string[] } {
  const content = [
    `${c.name} is a person in the owner's life (${c.label.toLowerCase()}${c.sub ? `: ${c.sub}` : ""}).`,
    c.aliases.length ? `Also called: ${c.aliases.join(", ")}.` : "",
    c.path ? `Profile: ${c.path}.` : "",
    `Jarvis identity id: ${c.id} — the same person in Profiles, Camera Autopilot, the Images library and Jarvis.`,
    c.facts.length ? `Details:\n${c.facts.map((f) => `- ${f}`).join("\n")}` : "",
    c.notes.length ? `Remembered:\n${c.notes.map((f) => `- ${f}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { externalId: `identity:${c.id}`, title: `Who is ${c.name}`, content, tags: ["identity", "person", c.role] };
}
