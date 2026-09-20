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

import { parseSongPair } from "./mashup";

export type WriteTask =
  | "lyrics"
  | "style"
  | "hooks"
  | "mashup"
  | "rewrite"
  | "vocal-direction"
  | "mashup-find"
  | "mashup-blend"
  | "mashup-revise";

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

  // ----- the mashup tool's three steps ------------------------------------
  //
  // Split across three tasks rather than one, because they fail differently.
  // Reading two song titles out of a sentence is cheap and near-certain;
  // designing a blend is the expensive judgement call; revising a finished take
  // must change one thing and leave everything else alone. One combined prompt
  // would make the cheap step as slow as the expensive one and let a revision
  // quietly redesign the record.

  "mashup-find": `You identify the two songs somebody wants mashed up.

Read their sentence and pull out the two recordings. Return a SEARCH QUERY for each — the
form you would type into a music catalogue, so "title artist" when you recognise the song,
otherwise their words unchanged. Never invent a song they did not name. If they only named
one, leave songB empty rather than choosing a partner for them.

Anything that is direction rather than a title ("make it slower", "keep the rap") belongs in
"brief", not in a query.

Answer as JSON: {"songA": string, "songB": string, "title": string, "brief": string}
"title" is a short name for the mashup itself — 1-4 words, no quotes, no "feat.", no slash
between the two song names unless that genuinely reads well.`,

  "mashup-blend": `You are producing a mashup of two existing records, for a model (YuE2) that
will perform it from scratch. Nothing of either original recording reaches the listener: you
are writing the instructions for a NEW performance that combines what the two records are
made of.${YUE_RULES}

You are given a blend plan naming which record each element comes from. Follow it exactly —
it is the user's decision, not a suggestion. Your job is to turn it into one style line that
a generator can act on: name real instruments, a real groove, a real vocal character and a
real BPM, drawn from the records named. Use what you know about those records; when you do
not know one, say nothing about it rather than inventing a fact.

Lyrics: the melody is fixed by a transcribed score, so write lines that fit its phrasing.
Never reproduce the lyrics of a real song — write NEW words in the manner the plan asks for.

Answer as JSON: {"title": string, "style": string, "lyrics": string, "notes": string}
"title" is a short name for the mashup. "notes" is two or three lines for the human saying
what you took from each record and what you had to decide for yourself.`,

  "mashup-revise": `You are revising a mashup that has already been rendered once. The user
heard it and asked for one change.

Apply that change and change nothing else. Everything they did not mention — the genre, the
instruments they liked, the section order, the syllable count of every line they did not
complain about — stays exactly as it is. A revision that quietly redesigns the record is the
failure mode here.${YUE_RULES}

If the change is purely about sound (tempo, instruments, mix, energy), edit the style line
and return the lyrics unchanged. If it is purely about words, edit the lyrics and return the
style line unchanged. Only touch both when the change genuinely needs both.

Answer as JSON: {"style": string, "lyrics": string, "changed": string}
"changed" is one line naming what you actually altered, so the version list is readable.`,
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
  add("What they asked for", input.prompt);
  add("Song A", input.trackA);
  add("Song B", input.trackB);
  add("Blend plan", input.blend);
  add("Chord progression available", input.progression);

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

  // ----- the mashup tasks, with no model -----------------------------------
  //
  // Each does the part that is genuinely mechanical and refuses the part that
  // is not. Splitting "X and Y" is string work and is done properly; designing
  // a blend is judgement, so the offline answer is the user's own plan read
  // back as a style line rather than an invented production.

  if (task === "mashup-find") {
    const pair = parseSongPair(String(input.prompt ?? brief));
    return {
      songA: pair.songA,
      songB: pair.songB,
      // Not a written title — the two names joined, which is at least true.
      title: [pair.songA, pair.songB].filter(Boolean).join(" × ").slice(0, 60),
      brief: pair.rest,
    };
  }

  if (task === "mashup-blend") {
    // `blend` is the plan the tool already assembled from the user's own
    // choices; it is the one honest thing to hand back as a style line.
    const plan = String(input.blend ?? "").trim();
    const line = String(input.style ?? "").trim() || plan.split("\n").join("; ");
    const seed = brief || "write the first line here";
    return {
      title: String(input.title ?? "").trim() || "Untitled mashup",
      style: line.slice(0, 600),
      lyrics: SECTIONS.map((tag, i) => `${tag}\n${i === 0 ? seed : "…"}`).join("\n\n"),
      notes: "Local draft: your own blend choices read back as a style line, with a blank lyric sheet to fill in.",
    };
  }

  if (task === "mashup-revise") {
    // The one safe revision with no model is no revision. Saying so beats
    // returning something subtly different that nobody asked for.
    return {
      style: String(input.style ?? ""),
      lyrics: String(input.lyrics ?? ""),
      changed: "Nothing — no AI key is configured, so edit the style line or lyrics yourself and render again.",
    };
  }

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
