// ---------------------------------------------------------------------------
// Music Creator — the writing layer's prompts and its offline fallback.
//
// Server-side only (it holds the system prompts). Everything here produces TEXT
// for YuE2 to sing: a style line, a lyric sheet, hook candidates, a mashup plan.
// None of it touches the GPU, which is why the studio is worth opening on a
// laptop with no server configured.
//
// The rules encoded in the prompts come from YuE2's own generation guide, and
// they matter more than tone: `style` carries genre, instruments, vocal
// character, language and tempo as prose; `lyrics` carries section tags and the
// words actually sung and nothing else. A production note that leaks into the
// lyrics gets sung, so the system prompt says so in as many words.
// ---------------------------------------------------------------------------

export type WriteTask = "lyrics" | "style" | "hooks" | "mashup" | "rewrite" | "vocal-direction";

const YUE_RULES = `
YuE2 takes two fields and sings the second one literally.

style: one line of prose. Language, genre, sub-genre, instrumentation, vocal character
(e.g. "warm female alto, breathy"), production feel, and a tempo in BPM. No section tags,
no lyrics, no sentences addressed to the model.

lyrics: section tags in square brackets on their own line — [Intro] [Verse] [Pre-Chorus]
[Chorus] [Bridge] [Outro] — with the words underneath. ONLY words that should be sung.
Never put stage directions, instrument notes, production notes, timings or commentary in
the lyrics: every character of it is performed. Blank line between sections.
Keep lines singable: 4-9 syllables is a comfortable pop line, and a chorus repeats.`;

const SYSTEM: Record<WriteTask, string> = {
  lyrics: `You are a songwriter working inside a music production studio. You write lyrics that a
model will actually sing.${YUE_RULES}

Answer as JSON: {"title": string, "lyrics": string, "notes": string}
"notes" is one short line for the human about the form you chose. Never put it in the lyrics.`,

  style: `You are a record producer writing the style line for a song generator.${YUE_RULES}

Answer as JSON: {"style": string, "alternatives": [string, string]}
"style" is your best single line. "alternatives" are two genuinely different readings of the
same brief — not rewordings. Each alternative is a complete style line on its own.`,

  hooks: `You are a topline writer chasing hooks. A hook is short: 2-6 lines, one idea, one
image, repeatable, and it lands the title. You write several DIFFERENT hooks, not variations
of one — different angles, different rhythms, different ways into the idea.${YUE_RULES}

Answer as JSON: {"hooks": [{"label": string, "lyrics": string, "style": string, "why": string}]}
"label" is 2-4 words naming the angle. "lyrics" uses a [Chorus] or [Hook] tag. "style" is a
style line suited to that particular hook. "why" is one line on what makes it stick.`,

  mashup: `You are planning a mashup. The melody of one recording will be transcribed to a score
and performed in the style of another — so your job is the TARGET style line and the lyrics
that will ride that melody.${YUE_RULES}

The melody is fixed by the source, so lyrics must fit its phrasing: match the syllable count
and stress of the original lines as closely as the brief allows.

Answer as JSON: {"style": string, "lyrics": string, "notes": string}
"notes" says in one or two lines what you kept from each side.`,

  rewrite: `You are revising lyrics inside a production studio. Apply the requested change and
change nothing else. Keep section tags, section order, and — unless asked otherwise — the
syllable count and stress pattern of each line, because a melody may already be written to
it.${YUE_RULES}

Answer as JSON: {"lyrics": string, "changed": string}
"changed" is one line naming what you actually altered.`,

  "vocal-direction": `You are directing a speech model (AuK) that performs written words in a
cloned voice. It SPEAKS — it cannot sing, and it cannot make music.

Write two things: the exact text to perform, and a one-sentence instruction describing the
delivery (pace, energy, emotion, accent, spacing). The text must be the words only.
For a performance over a beat, favour rhythmic, front-loaded phrasing and short lines.

Answer as JSON: {"text": string, "instruction": string}`,
};

export function systemFor(task: WriteTask): string {
  return SYSTEM[task];
}

/** Build the user turn from whatever the tool collected. */
export function userFor(task: WriteTask, input: Record<string, unknown>): string {
  const lines: string[] = [];
  const add = (label: string, value: unknown) => {
    const text = typeof value === "string" ? value.trim() : value == null ? "" : String(value);
    if (text) lines.push(`${label}: ${text}`);
  };

  add("Brief", input.brief);
  add("Genre or sound", input.genre);
  add("Mood", input.mood);
  add("Tempo", input.tempo);
  add("Energy", input.energy);
  add("Instrumentation", input.instrumentation);
  add("Vocal delivery", input.vocal);
  add("Language", input.language);
  add("Song structure", input.structure);
  add("Existing style line", input.style);
  add("Existing lyrics", input.lyrics);
  add("Requested change", input.change);
  add("Melody source", input.sourceA);
  add("Style source", input.sourceB);
  add("Title idea", input.title);
  add("How many", input.count);

  if (!lines.length) lines.push("Brief: surprise me — make something worth finishing.");
  return lines.join("\n");
}

// ----- the offline fallback ------------------------------------------------
//
// Not a pretend songwriter. It arranges what the user already typed into the
// exact shape YuE2 needs, so the render path is usable with no AI key — and the
// UI labels it as a local draft so nobody mistakes it for a written song.

const SECTIONS = ["[Verse]", "[Chorus]", "[Verse]", "[Chorus]", "[Bridge]", "[Chorus]"];

export function offlineDraft(task: WriteTask, input: Record<string, unknown>): Record<string, unknown> {
  const brief = String(input.brief ?? "").trim();
  const genre = String(input.genre ?? "").trim();
  const mood = String(input.mood ?? "").trim();
  const tempo = String(input.tempo ?? "").trim();
  const vocal = String(input.vocal ?? "").trim();
  const instrumentation = String(input.instrumentation ?? "").trim();
  const language = String(input.language ?? "English").trim();

  const style = [language, genre || "pop", mood, instrumentation, vocal, tempo]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");

  if (task === "style") return { style, alternatives: [] };

  if (task === "vocal-direction") {
    return { text: String(input.lyrics ?? brief).trim(), instruction: [mood, vocal].filter(Boolean).join(", ") };
  }

  // A scaffold built from the brief's own words: section tags, and the brief on
  // the first line so there is something real to edit rather than invented filler.
  const seed = brief || "write the first line here";
  const body = SECTIONS.map((tag, i) => `${tag}\n${i === 0 ? seed : "…"}`).join("\n\n");

  if (task === "hooks") {
    return {
      hooks: [{ label: "Local draft", lyrics: `[Chorus]\n${seed}`, style, why: "Written from your brief without an AI key." }],
    };
  }
  if (task === "rewrite") return { lyrics: String(input.lyrics ?? ""), changed: "Nothing — no AI key is configured." };
  return { title: brief.slice(0, 60) || "Untitled", lyrics: body, style, notes: "Local draft: section tags only." };
}
