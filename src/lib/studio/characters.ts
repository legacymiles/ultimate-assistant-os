// ---------------------------------------------------------------------------
// @-mentioning a person in a Studio prompt.
//
// Studio already had two kinds of @: a workflow ("@kids-story") and an upload
// ("@Subject 2"). Both are things you fetch. A CHARACTER is different — it is
// somebody the library already knows, and the whole point is that mentioning
// them costs nothing: no upload, no file picker, no hunting for a photo of your
// own sister. The Photos tab has her face and, once a sheet has been written,
// her description; "@Brandy" is a pointer at both.
//
// So a character mention does two things when a prompt is rendered:
//   - the model is TOLD who she is, from her character sheet, so a shot can put
//     her somewhere nobody ever photographed her;
//   - her reference faces are ATTACHED as Subjects, so an image or video model
//     that takes references gets the actual face rather than a paraphrase.
//
// This module is pure so the chat route can format the prompt block with it.
// The sheets themselves live in the browser (they are the owner's photos), which
// is why the client sends them rather than the server looking them up.
// ---------------------------------------------------------------------------

export interface CharacterMention {
  /** What goes after @, e.g. "Brandy" or "aunt-mary". Unique, case-insensitive. */
  token: string;
  /** What the owner calls them. */
  name: string;
  /** A person, or the subject of a reference-picture folder. */
  kind: "person" | "album";
  /** "Child", "Friend" — a person's role label; "" for a folder. */
  role: string;
  /** The character sheet's paragraph, when one has been written. */
  appearance?: string;
  /** Features that do not change between photographs. */
  identifiers?: string[];
  wardrobe?: string;
  /** The owner's own note about them. */
  notes?: string;
  /** How many pictures of them the library holds. */
  pictures: number;
  /** A small face crop, for the menu and the chip. Never sent to the model. */
  avatar?: string;
}

/**
 * A name becomes a token: one word, safe in a sentence, still readable.
 *
 * Readability is the requirement, not uniqueness-at-any-cost. The owner types
 * "@Brandy" and the model reads "@Brandy" — a hashed id would work for the code
 * and ruin the prompt, which is a piece of writing a person approves.
 */
export function characterToken(name: string): string {
  const slug = name
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "character";
}

/** Two people called Chris both get a usable token. */
export function uniqueTokens(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = characterToken(n);
    const key = base.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

/** The @token shape, matching the workflow menu's so one caret rule serves both. */
export const CHARACTER_PATTERN = /(^|\s)@([\p{L}\p{N}][\p{L}\p{N}-]*)/gu;

/**
 * The characters a message names, in order, without repeats.
 *
 * Generic over the entry, because the composer's cast carries reference images
 * the model must never be sent and the prompt block has no business knowing
 * about — the same lookup, two different payloads.
 */
export function charactersIn<T extends CharacterMention>(text: string, all: T[]): T[] {
  const byToken = new Map(all.map((c) => [c.token.toLowerCase(), c]));
  const out: T[] = [];
  for (const m of text.matchAll(CHARACTER_PATTERN)) {
    const hit = byToken.get(m[2].toLowerCase());
    if (hit && !out.some((o) => o.token === hit.token)) out.push(hit);
  }
  return out;
}

/** Menu matches for a half-typed "@bra". */
export function searchCharacters<T extends CharacterMention>(query: string, all: T[], limit = 6): T[] {
  const q = query.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (!q) return all.slice(0, limit);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return all
    .map((c) => {
      const n = norm(c.name);
      return { c, score: n.startsWith(q) ? 0 : n.includes(q) ? 1 : norm(c.token).includes(q) ? 2 : 9 };
    })
    .filter((s) => s.score < 9)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.c);
}

/**
 * What Jarvis is told about the characters a message names.
 *
 * Written as an instruction rather than a data dump, because the failure this
 * prevents is a specific one: a model that is handed a description and a name
 * tends to write "@Brandy walks into the room" into the final prompt, and the
 * video model has no idea who that is. The prompt has to carry the DESCRIPTION.
 */
export function characterContext(chars: CharacterMention[]): string {
  if (!chars.length) return "";
  const cards = chars.map((c) => {
    const lines = [
      `### ${c.name}${c.role ? ` (${c.role})` : ""} — written as @${c.token}`,
      c.appearance ? c.appearance : "(No description written yet.)",
      c.identifiers?.length ? `Always true of them: ${c.identifiers.join("; ")}.` : "",
      c.wardrobe ? `Usually dressed: ${c.wardrobe}.` : "",
      c.notes ? `The owner's note: ${c.notes}` : "",
      c.appearance
        ? ""
        : `The library has ${c.pictures} picture${c.pictures === 1 ? "" : "s"} of them but no ` +
          "written description yet. Say so, and ask the owner to press Describe on their card in " +
          "Photos rather than inventing a face for them.",
    ].filter(Boolean);
    return lines.join("\n");
  });
  return [
    "CHARACTERS THE OWNER NAMED. These are real people (or real things) from their own photo",
    "library. The owner wrote @their-name; you have their description here, and their reference",
    "pictures are attached to the render automatically — they do not need to upload anything.",
    "",
    "- In the FINAL PROMPT, write the DESCRIPTION, never the @token and never just the name. A",
    "  video model has never met them: \"@Brandy\" renders a stranger, the paragraph renders her.",
    "- Use the same words for them in every shot of a set, so they stay the same person from clip",
    "  to clip. Change only what the shot changes.",
    "- Their features are fixed. A prompt may put them anywhere, in anything, doing anything the",
    "  owner asks for, but it may not restyle their face, age, build or skin.",
    "- Talk about them by NAME to the owner. They are people, not Subject 3.",
    "",
    ...cards,
  ].join("\n");
}

/** Server-side clamp: the sheets come from the browser, so nothing is trusted raw. */
export function cleanCharacters(v: unknown, limit = 6): CharacterMention[] {
  if (!Array.isArray(v)) return [];
  const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");
  return v
    .slice(0, limit)
    .map((raw): CharacterMention | null => {
      const o = (raw ?? {}) as Record<string, unknown>;
      const name = text(o.name, 60);
      if (!name) return null;
      return {
        token: text(o.token, 60) || characterToken(name),
        name,
        kind: o.kind === "album" ? ("album" as const) : ("person" as const),
        role: text(o.role, 30),
        appearance: text(o.appearance, 1200) || undefined,
        identifiers: (Array.isArray(o.identifiers) ? o.identifiers : [])
          .map((s) => text(s, 120))
          .filter(Boolean)
          .slice(0, 6),
        wardrobe: text(o.wardrobe, 160) || undefined,
        notes: text(o.notes, 300) || undefined,
        pictures: Math.max(0, Math.min(999, Number(o.pictures ?? 0) || 0)),
      };
    })
    .filter((c): c is CharacterMention => Boolean(c));
}
