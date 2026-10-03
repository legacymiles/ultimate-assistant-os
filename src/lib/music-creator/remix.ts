// ---------------------------------------------------------------------------
// Remix — one record, one sentence, and the next version of it.
//
// "NY drill remix" is a complete brief to a person and almost nothing to a
// generator. This file is the translation: a named style with a real tempo
// range, a real kit and a real set of instruments, so what reaches YuE2 is a
// production and not a genre tag.
//
// ----- what a remix is here, exactly ----------------------------------------
//
// SheetSage2 writes the chosen record's melody down as a score; YuE2 performs
// that score inside the style the prompt asks for. So the TUNE survives and the
// RECORDING does not — no drum hit, no voice, no sample of the original is in
// the output. That is the one sentence the screen has to keep saying, because
// "remix" in a DJ's mouth means the opposite: the original audio, re-edited.
//
// The presets below are knowledge, not decoration. A model asked for "drill"
// with no numbers will cheerfully write 128 BPM over a four-on-the-floor kick,
// which is not drill; handing it 140 and a sliding 808 is the difference
// between the genre and a rumour of it. Each one is a starting point the user
// edits, never a lock.
// ---------------------------------------------------------------------------

import type { SongPick } from "./mashup";

export interface RemixPreset {
  id: string;
  /** What the chip says. */
  label: string;
  /** The words dropped into the prompt box when the chip is tapped. */
  prompt: string;
  /** Prose for the style line: kit, bass, instruments, feel. */
  style: string;
  /** Where this style actually sits, in BPM. */
  bpm: number;
  /** Other spellings people type for the same thing. */
  aliases?: string[];
}

/**
 * The presets, ordered by how often the owner is likely to reach for them
 * rather than alphabetically — the first row of chips is the one that gets
 * pressed.
 */
export const REMIX_PRESETS: RemixPreset[] = [
  {
    id: "ny-drill",
    label: "NY drill",
    prompt: "NY drill remix",
    style:
      "New York drill, sliding 808 bass, skeletal hi-hat rolls and off-grid kicks, dark minor piano or bell loop, " +
      "sparse mix with a lot of space, deadpan half-sung rap delivery",
    bpm: 140,
    aliases: ["drill", "new york drill", "ny drill", "brooklyn drill"],
  },
  {
    id: "uk-drill",
    label: "UK drill",
    prompt: "UK drill remix",
    style:
      "UK drill, triplet sliding 808s, clipped snare and sharp rimshots, cold detuned pad or flute lead, " +
      "wide empty low-mids, clipped London rap delivery",
    bpm: 144,
    aliases: ["uk drill", "london drill"],
  },
  {
    id: "jersey",
    label: "Jersey club",
    prompt: "Jersey club remix",
    style:
      "Jersey club, bed-squeak kick pattern in fives, chopped and stuttered vocal edits, bright simple synth stabs, " +
      "relentless forward energy",
    bpm: 136,
    aliases: ["jersey", "jersey club", "club remix"],
  },
  {
    id: "amapiano",
    label: "Amapiano",
    prompt: "Amapiano remix",
    style:
      "Amapiano, log-drum bassline, airy shakers and loose percussion, soft jazzy piano chords, deep space, " +
      "relaxed conversational vocal",
    bpm: 112,
    aliases: ["amapiano", "log drum", "piano"],
  },
  {
    id: "afrobeats",
    label: "Afrobeats",
    prompt: "Afrobeats remix",
    style:
      "Afrobeats, syncopated kick and shaker groove, warm plucked guitar and marimba figures, melodic sung-rap, " +
      "bright humid production",
    bpm: 104,
    aliases: ["afrobeat", "afrobeats", "afro"],
  },
  {
    id: "slowed",
    label: "Slowed + reverb",
    prompt: "slowed and reverb remix",
    style:
      "slowed and reverbed, heavy plate reverb and long tails, pitched-down vocal, soft saturated drums far back in " +
      "the mix, hazy and nocturnal",
    bpm: 72,
    aliases: ["slowed", "slowed and reverb", "slowed + reverb", "screwed"],
  },
  {
    id: "boom-bap",
    label: "Boom-bap",
    prompt: "boom-bap remix",
    style:
      "90s boom-bap, dusty swung drum break, upright bass, filtered soul sample loop, vinyl noise floor, " +
      "conversational rap delivery",
    bpm: 92,
    aliases: ["boom bap", "boom-bap", "90s hip hop", "lo-fi hip hop", "lofi"],
  },
  {
    id: "dnb",
    label: "Drum & bass",
    prompt: "drum and bass remix",
    style:
      "liquid drum and bass, fast broken amen breaks, deep rolling sub bass, lush wide pads and reese stabs, " +
      "soulful sustained vocal",
    bpm: 174,
    aliases: ["dnb", "drum and bass", "drum & bass", "jungle", "liquid"],
  },
  {
    id: "house",
    label: "House",
    prompt: "house remix",
    style:
      "classic house, four-on-the-floor kick with open hats, warm filtered chord stabs, round analogue bassline, " +
      "soulful diva vocal, long hypnotic build",
    bpm: 124,
    aliases: ["house", "deep house", "dance remix", "club"],
  },
  {
    id: "phonk",
    label: "Phonk",
    prompt: "phonk remix",
    style:
      "phonk, distorted 808 cowbell melody, overdriven Memphis drums, pitched-down vocal chops, tape saturation, " +
      "menacing and compressed",
    bpm: 130,
    aliases: ["phonk", "memphis", "drift phonk"],
  },
  {
    id: "country",
    label: "Country",
    prompt: "country remix",
    style:
      "modern country, acoustic guitar and pedal steel, brushed kit and tambourine, fiddle fills, warm bass, " +
      "plainspoken drawled lead vocal with harmony stacks",
    bpm: 96,
    aliases: ["country", "bluegrass", "nashville"],
  },
  {
    id: "hyperpop",
    label: "Hyperpop",
    prompt: "hyperpop remix",
    style:
      "hyperpop, clipped distorted supersaws, pitched-up processed vocal with heavy autotune, blown-out 808s, " +
      "sudden drops and glitch edits, maximal and bright",
    bpm: 160,
    aliases: ["hyperpop", "glitchcore", "pc music"],
  },
];

export function presetById(id: string): RemixPreset | undefined {
  return REMIX_PRESETS.find((p) => p.id === id);
}

/**
 * The preset a typed prompt is asking for, if any.
 *
 * Longest alias first, so "uk drill" is not swallowed by "drill" — the two are
 * different tempos and different kits, and the one the user typed is the one
 * they meant.
 */
export function matchPreset(prompt: string): RemixPreset | undefined {
  const text = ` ${prompt.toLowerCase().replace(/[^a-z0-9&+ ]/g, " ").replace(/\s+/g, " ")} `;
  const candidates: { preset: RemixPreset; alias: string }[] = [];
  for (const preset of REMIX_PRESETS) {
    for (const alias of [preset.label.toLowerCase(), ...(preset.aliases ?? [])]) {
      if (text.includes(` ${alias} `)) candidates.push({ preset, alias });
    }
  }
  candidates.sort((x, y) => y.alias.length - x.alias.length);
  return candidates[0]?.preset;
}

/** A BPM written in the prompt, when there is one. Beats a preset's default. */
export function bpmFrom(prompt: string): number | undefined {
  const match = prompt.match(/(\d{2,3})\s*bpm/i);
  if (!match) return undefined;
  const bpm = Number(match[1]);
  return bpm >= 40 && bpm <= 220 ? bpm : undefined;
}

// ----- what the writer is told -----------------------------------------------

/** How to refer to the record being remixed. */
export function remixSongName(pick: SongPick | undefined): string {
  if (!pick) return "the original";
  if (pick.track) return `${pick.track.title} — ${pick.track.artist}`;
  return pick.fileName || pick.query || "the original";
}

/**
 * The plan, as lines a person can check and a model can read.
 *
 * Shown on the screen and sent to the writer verbatim, for the same reason the
 * mashup does it: one string means the user cannot be shown one thing and the
 * model told another.
 */
export function describeRemix(input: {
  pick: SongPick | undefined;
  prompt: string;
  keepLyrics: boolean;
  hasScore: boolean;
  bpm?: number;
}): string[] {
  const preset = matchPreset(input.prompt);
  const bpm = input.bpm ?? bpmFrom(input.prompt) ?? preset?.bpm;
  const lines = [
    input.hasScore
      ? `Melody transcribed from ${remixSongName(input.pick)} — the tune is what survives the remix.`
      : `Melody from ${remixSongName(input.pick)}, once it has been transcribed. Until then YuE2 writes its own tune.`,
    preset
      ? `Rebuilt as ${preset.label}: ${preset.style}.`
      : input.prompt.trim()
        ? `Rebuilt as asked: ${input.prompt.trim()}.`
        : "No direction given yet — say what to turn it into.",
    input.keepLyrics
      ? "Words kept in the manner of the original, re-written to fit the new groove."
      : "New words written for this version.",
  ];
  if (bpm) lines.push(`Tempo ${bpm} BPM.`);
  lines.push("Nothing of the original recording is in the output: this is a new performance of its melody.");
  return lines;
}

/**
 * A style line assembled from the prompt alone, for when no AI key is set.
 *
 * Every clause is either the user's own words or a preset they can see on the
 * screen, so this is a scaffold rather than a pretend producer — and the UI
 * labels it as one.
 */
export function offlineRemixStyle(prompt: string, bpm?: number): string {
  const preset = matchPreset(prompt);
  const tempo = bpm ?? bpmFrom(prompt) ?? preset?.bpm;
  const parts = [preset ? preset.style : prompt.replace(/\s+/g, " ").trim()];
  if (tempo) parts.push(`${tempo} BPM`);
  return parts.filter(Boolean).join(", ").slice(0, 600);
}
