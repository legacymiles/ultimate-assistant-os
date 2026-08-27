// ---------------------------------------------------------------------------
// Soundprint — the offline engine.
//
// Runs when there's no AI_GATEWAY_API_KEY, or when the model call fails. It is
// not a toy: the tempo, key, brightness, dynamics and percussion numbers are
// real measurements from the browser, so an offline breakdown is grounded in
// the actual audio. What it can't do is musical interpretation — naming the
// exact subgenre, or writing lyrics. That's the model's half.
// ---------------------------------------------------------------------------

import { scaffoldSwap, detectPerformanceRequest } from "./performers";
import { matchVocabulary } from "./vocabulary";
import {
  SECTION_LABELS,
  emptyBreakdown,
  type Measured,
  type PerformerSwap,
  type SongBrief,
  type StyleBreakdown,
} from "./types";

/** Phrases that mean "keep the arrangement out of it". */
const KEEP_OUT: { test: RegExp; avoid: string[] }[] = [
  { test: /\b(no|without|before|until)\b[^.]{0,24}\b(beat|drums?|percussion)\b/i, avoid: ["drums", "percussion", "full band"] },
  { test: /\bbefore\b[^.]{0,24}\b(beat|drums?|band)\b[^.]{0,16}\b(come|comes|drop|drops|kick)/i, avoid: ["drums", "full band"] },
  { test: /\b(keep|leave|take|cut)\b[^.]{0,24}\b(beat|drums?|percussion|band)\b[^.]{0,24}\b(out|off|away)\b/i, avoid: ["drums", "percussion", "full band"] },
  // "once the beat came in it wasn't good" — the complaint IS the exclusion.
  { test: /\b(beat|drums?|band)\b[^.]{0,60}\b(ruin\w*|wasn'?t good|isn'?t good|not good|got bad|worse)\b/i, avoid: ["drums", "percussion"] },
  { test: /\b(no|without)\b[^.]{0,20}\bvocals?\b/i, avoid: ["vocals"] },
  { test: /\b(no|without)\b[^.]{0,20}\b(distortion|distorted)\b/i, avoid: ["distorted guitar", "heavy distortion"] },
  { test: /\b(no|without)\b[^.]{0,20}\bsynths?\b/i, avoid: ["synths"] },
  { test: /\b(no|without)\b[^.]{0,20}\b(electronic|edm)\b/i, avoid: ["electronic production"] },
  { test: /\bkeep it (quiet|soft|sparse|minimal|calm)\b/i, avoid: ["big build", "full band"] },
  { test: /\b(never|don'?t)\b[^.]{0,24}\b(build|drop|explode|kick in)\b/i, avoid: ["big build", "climactic drop"] },
];

function deriveAvoid(brief: SongBrief, measured: Measured | null): string[] {
  const text = `${brief.request} ${brief.reference}`;
  const avoid = new Set<string>();

  for (const rule of KEEP_OUT) {
    if (rule.test.test(text)) rule.avoid.forEach((a) => avoid.add(a));
  }

  // "Stay in this texture" is a promise we have to actively defend.
  if (brief.scope === "hold") {
    avoid.add("full band");
    avoid.add("big build");
  }
  if (brief.vocals === "instrumental") avoid.add("vocals");

  // The measurement gets the final say: if there genuinely is no kit in the
  // selected range, keep it that way.
  if (measured && measured.percussion < 0.2 && brief.scope === "hold") {
    avoid.add("drums");
    avoid.add("percussion");
  }

  return [...avoid];
}

function tempoPhrase(measured: Measured | null): string {
  if (!measured?.bpm) return "";
  const bpm = measured.bpm;
  const feel =
    bpm < 75 ? "slow, unhurried" : bpm < 100 ? "mid-tempo" : bpm < 130 ? "steady, driving" : "up-tempo";
  return `${bpm} BPM, ${feel}`;
}

/**
 * Last-resort genre inference. If nobody named a genre and nothing matched,
 * we still have instruments, mood and real measurements to reason from — an
 * empty style prompt is worse than a reasonable guess the user can correct.
 */
function inferGenres(
  instruments: string[],
  moods: string[],
  measured: Measured | null,
): string[] {
  const inst = instruments.join(" ").toLowerCase();
  const mood = moods.join(" ").toLowerCase();

  if (/808|trap/.test(inst)) return ["trap"];
  if (/acoustic|fingerpicked|banjo|mandolin/.test(inst)) {
    return ["acoustic ballad", "singer-songwriter"];
  }
  if (/distorted|palm-muted/.test(inst)) return ["alternative rock"];
  if (/string section|orchestral|timpani|choir/.test(inst)) return ["neoclassical", "orchestral score"];
  if (/synth|808 drum|arpeggiated synth/.test(inst)) return ["synth-pop"];
  if (/rhodes|wurlitzer|hammond/.test(inst)) return ["neo-soul"];
  if (/piano/.test(inst)) return ["minimal piano", "neoclassical"];
  if (/clean electric guitar|arpeggiated electric/.test(inst)) {
    return /brooding|melanchol|yearn|bittersweet/.test(mood)
      ? ["alternative rock", "post-grunge"]
      : ["indie rock"];
  }

  // Nothing but measurements to go on.
  if (measured) {
    if (measured.percussion < 0.2) return ["ambient", "neoclassical"];
    if (measured.bpm && measured.bpm >= 120) return ["indie pop"];
    return ["indie rock"];
  }
  return [];
}

/** Mood of last resort, read straight off the measurements. */
function inferMoods(measured: Measured | null): string[] {
  if (!measured) return [];
  const out: string[] = [];
  if (/dark and warm|warm midrange/.test(measured.brightness)) out.push("brooding");
  if (/very bright|bright and present/.test(measured.brightness)) out.push("hopeful");
  if (measured.percussion < 0.2) out.push("intimate", "spacious");
  if (measured.bpm && measured.bpm < 80) out.push("reflective");
  return out.slice(0, 3);
}

export function heuristicBreakdown(brief: SongBrief, measured: Measured | null): StyleBreakdown {
  const text = `${brief.request}\n${brief.reference}`;
  const matched = matchVocabulary(text);
  const m = brief.manual;
  const section = SECTION_LABELS[brief.section].toLowerCase();

  const instrumentation = unique([...m.instruments, ...matched.instruments]);
  let moods = unique([...m.moods, ...matched.moods]);
  if (!moods.length) moods = inferMoods(measured);

  let genres = unique([...m.genres, ...matched.genres]);
  if (!genres.length) genres = inferGenres(instrumentation, moods, measured);

  const production = unique([
    ...m.production,
    ...matched.production,
    measured?.dynamics ?? "",
    measured?.density ?? "",
    measured?.stereo ?? "",
  ]);

  const understood = buildUnderstood(brief, measured, section);

  const vocalTraits = unique([...m.vocalTraits, ...matched.vocalTraits]);
  const vocal =
    brief.vocals === "instrumental" || !vocalTraits.length
      ? null
      : {
          range: vocalTraits.find((t) => /tenor|baritone|bass|alto|soprano|mezzo/.test(t)) ?? "",
          texture: vocalTraits.filter((t) => /rasp|breath|smok|nasal|airy|warm|thin|gravel/.test(t)),
          delivery: vocalTraits.filter((t) =>
            /belt|strain|restrain|conversation|behind|ahead|whisper|spoken|melisma|cracked/.test(t),
          ),
          effects: vocalTraits.filter((t) => /double|harmon|reverb|dry|auto|vocod|filter|gang/.test(t)),
        };

  return {
    ...emptyBreakdown(),
    understood,
    genres,
    moods,
    tempo: tempoPhrase(measured),
    key: measured?.key ? `${measured.key} tonality` : "",
    instrumentation,
    production: production.filter(Boolean),
    structure: measured
      ? `Based on the ${section} you selected — ${measured.percussionLabel}.`
      : `Focused on the ${section}.`,
    era: "",
    vocal,
    adjacent: [],
    avoid: deriveAvoid(brief, measured),
  };
}

function buildUnderstood(brief: SongBrief, measured: Measured | null, section: string): string {
  const bits: string[] = [];
  const ref = brief.reference.trim();

  const article = /^[aeiou]/i.test(section) ? "an" : "a";
  bits.push(ref ? `Chasing the ${section} of ${ref}` : `Chasing ${article} ${section} feel`);

  if (measured) {
    const range = `${fmtSec(measured.startSec)}–${fmtSec(measured.endSec)}`;
    bits.push(`measured from your audio across ${range}`);
    if (measured.bpm) bits.push(`~${measured.bpm} BPM`);
    if (measured.key) bits.push(measured.key);
  }

  bits.push(
    brief.scope === "hold"
      ? "holding that texture for the whole track"
      : "using it as the opening and letting the song grow",
  );

  if (brief.vocals === "instrumental") bits.push("instrumental");

  return `${bits.join(" · ")}.`;
}

function fmtSec(sec: number): string {
  const mm = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

export function heuristicPerformers(brief: SongBrief): PerformerSwap[] {
  return detectPerformanceRequest(brief.request).map(scaffoldSwap);
}

function unique(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}
