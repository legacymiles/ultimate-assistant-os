// ---------------------------------------------------------------------------
// Referring to an upload from inside the prompt.
//
// The render pipeline has always numbered uploads — Subject 1 is the first
// picture attached in the conversation, and src/lib/studio/render.ts hands a
// job exactly the Subjects its prompt names. That numbering was invisible: the
// owner had to remember which photo was which and type "Subject 3" from memory.
//
// So the same @ menu that offers workflows now offers the uploads themselves,
// as "@Subject 2". The token is plain enough that the model reads it as prose
// and `pick()` still matches it, which is why it is a readable phrase rather
// than an opaque id.
// ---------------------------------------------------------------------------

export interface ReferenceMention {
  /** 1-based, and stable for the whole conversation. */
  n: number;
  /** What goes after @, with no space so one word is one token. */
  token: string;
  /** "Subject 2" — what the model reads. */
  label: string;
  kind: "image" | "video";
  thumb: string;
  name: string;
}

/** Matches "@Subject2", "@subject 2" and the bare "Subject 2" the skills write. */
export const REFERENCE_PATTERN = /@?\bSubject[\s-]*(\d+)\b/gi;

export function referenceToken(n: number): string {
  return `Subject${n}`;
}

/** The reference numbers a piece of text names, in order, without repeats. */
export function referencesIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(REFERENCE_PATTERN)) {
    const n = Number(m[1]);
    if (n >= 1 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Menu matches for a half-typed "@sub", "@2" or "@subject 3". */
export function searchReferences(query: string, all: ReferenceMention[]): ReferenceMention[] {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!q) return all;
  // A number means the number. Falling through to the file name would make
  // "@2" offer photo-12.jpg, which is never what typing a subject number means.
  if (/^\d+$/.test(q)) return all.filter((r) => String(r.n).startsWith(q));
  return all.filter(
    (r) => `subject${r.n}`.startsWith(q) || r.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q),
  );
}
