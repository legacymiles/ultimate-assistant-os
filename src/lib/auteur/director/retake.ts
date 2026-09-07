// ---------------------------------------------------------------------------
// Retakes without a model.
//
// "Make the camera closer." "Darker." "Change her outfit to a green dress."
// "Make him look angry. Keep everything else the same."
//
// A retake is a PATCH on the structured shot, never a rewrite of the prompt
// text, so the rest of the project stays exactly as it was. This module maps
// the common instructions to fields. The LLM path in the route does the same
// job with more nuance and returns the same ShotPatch shape.
// ---------------------------------------------------------------------------

import type { Camera, CameraMovement, Character, Framing, Shot, ShotPatch } from "../types";

const CLOSER: Framing[] = ["extreme wide", "wide", "medium wide", "medium", "medium close-up", "close-up", "extreme close-up"];

function stepFraming(current: Framing, dir: 1 | -1): Framing {
  const i = CLOSER.indexOf(current === "insert" ? "extreme close-up" : current);
  const next = Math.max(0, Math.min(CLOSER.length - 1, (i < 0 ? 3 : i) + dir));
  return CLOSER[next];
}

const MOVEMENT_WORDS: [RegExp, CameraMovement][] = [
  [/\b(push|dolly) ?in\b|\bmove (the )?camera (in|closer)\b/i, "push in"],
  [/\b(pull|dolly) ?(out|back)\b|\bpull away\b/i, "pull out"],
  [/\bpan(ning)? left\b/i, "pan left"],
  [/\bpan(ning)? right\b/i, "pan right"],
  [/\btilt(ing)? up\b/i, "tilt up"],
  [/\btilt(ing)? down\b/i, "tilt down"],
  [/\btrack(ing)?\b|\bfollow (him|her|them|the)\b/i, "tracking"],
  [/\bhand ?held\b|\bshaky\b/i, "handheld"],
  [/\bcrane (up|rise)\b|\brise up\b|\bdrone up\b/i, "crane up"],
  [/\bcrane down\b|\bdescend\b/i, "crane down"],
  [/\borbit\b|\bcircle around\b|\baround (him|her|them|it)\b/i, "orbit"],
  [/\bzoom in\b/i, "zoom in"],
  [/\bzoom out\b/i, "zoom out"],
  [/\b(static|still|locked[- ]off|no (camera )?movement|don'?t move the camera)\b/i, "static"],
];

const ANGLE_WORDS: [RegExp, Camera["angle"]][] = [
  [/\blow angle\b|\bfrom below\b/i, "low angle"],
  [/\bhigh angle\b|\bfrom above\b|\blooking down\b/i, "high angle"],
  [/\boverhead\b|\btop[- ]down\b|\bbird'?s[- ]eye\b/i, "overhead"],
  [/\bdutch\b|\btilted frame\b|\bcanted\b/i, "dutch angle"],
  [/\bover[- ]the[- ]shoulder\b|\bOTS\b/, "over the shoulder"],
  [/\b(pov|point of view|first[- ]person)\b/i, "POV"],
  [/\beye[- ]level\b/i, "eye level"],
];

const FRAMING_WORDS: [RegExp, Framing][] = [
  [/\bextreme close[- ]?up\b|\bECU\b/, "extreme close-up"],
  [/\bclose[- ]?up\b|\bCU\b/, "close-up"],
  [/\bmedium close\b|\bMCU\b/, "medium close-up"],
  [/\bmedium wide\b|\bcowboy\b/i, "medium wide"],
  [/\bmedium( shot)?\b/i, "medium"],
  [/\bextreme wide\b|\bEWS\b/, "extreme wide"],
  [/\bwide( shot)?\b|\bestablishing\b/i, "wide"],
  [/\binsert\b|\bdetail shot\b/i, "insert"],
];

const EXPRESSIONS: [RegExp, string][] = [
  [/\bangr(y|ier)\b|\bfurious\b|\bmad\b/i, "angry, jaw set, eyes hard"],
  [/\bsad(der)?\b|\bcry(ing)?\b|\btearful\b/i, "sad, eyes glassy, on the edge of tears"],
  [/\bhapp(y|ier)\b|\bsmil(e|ing)\b|\bjoy\b/i, "happy, a real smile reaching the eyes"],
  [/\bscared\b|\bafraid\b|\bterrified\b|\bfrightened\b/i, "terrified, wide-eyed, breath held"],
  [/\bsurprised?\b|\bshocked\b/i, "surprised, mouth slightly open"],
  [/\bcalm(er)?\b|\bserene\b|\bpeaceful\b/i, "calm, unguarded, breathing slowly"],
  [/\bconfident\b|\bcocky\b/i, "confident, chin up, slight smirk"],
  [/\bnervous\b|\banxious\b/i, "nervous, eyes darting, fidgeting"],
  [/\bin love\b|\blonging\b|\btender\b/i, "tender, soft-eyed, a held breath"],
  [/\bserious\b|\bstern\b|\bintense\b/i, "intense, unblinking"],
  [/\blaugh(ing)?\b/i, "laughing, head tipped back"],
  [/\bdisgust(ed)?\b/i, "disgusted, lip curled"],
  [/\bbored\b|\btired\b|\bexhausted\b/i, "exhausted, heavy-lidded"],
];

const LIGHTING: [RegExp, string][] = [
  [/\bdarker\b|\bmore shadow\b|\bmoodier\b|\blow[- ]key\b/i, "darker, low-key, deep shadows with one motivated source"],
  [/\bbrighter\b|\bmore light\b|\bhigh[- ]key\b|\blighter\b/i, "brighter, high-key, soft even light"],
  [/\bgolden hour\b|\bsunset\b/i, "golden hour, warm low sun, long shadows"],
  [/\bneon\b/i, "neon practicals in magenta and cyan, wet reflections"],
  [/\bcandle/i, "candlelight, warm flicker, soft falloff"],
  [/\bmoonlight\b|\bmoonlit\b/i, "cold moonlight, blue shadows"],
  [/\bbacklit\b|\bbacklight\b|\brim light\b/i, "strong backlight, rim-lit silhouette edges"],
  [/\bwarm(er)?\b/i, "warmer light, amber tones"],
  [/\bcold(er)?\b|\bcooler\b/i, "cooler light, blue-steel tones"],
  [/\bsilhouette\b/i, "pure silhouette against a bright background"],
  [/\bharsh\b|\bhard light\b/i, "hard directional light, crisp shadows"],
  [/\bsoft(er)? light\b|\bdiffused?\b/i, "soft diffused light, gentle wrap"],
  [/\bfog(gy)?\b|\bhaze\b|\bmist\b/i, "atmospheric haze, volumetric light"],
  [/\brain(y|ing)?\b/i, "rain, wet surfaces catching the light"],
  [/\bnight\b/i, "night, practical lights and deep blacks"],
  [/\bday(time)?\b|\bmorning\b/i, "daylight, natural and clean"],
];

/** Which character the instruction points at: a name, or a pronoun by role. */
function targetCharacter(instruction: string, shot: Shot, cast: Character[]): Character | undefined {
  const inShot = shot.characterIds.map((id) => cast.find((c) => c.id === id)).filter((c): c is Character => Boolean(c));
  for (const c of inShot) {
    if (new RegExp(`\\b${escapeRe(c.name)}\\b`, "i").test(instruction)) return c;
  }
  if (/\b(her|she|hers|woman|girl)\b/i.test(instruction)) {
    return inShot.find((c) => /\b(she|her|woman|girl|female)\b/i.test(c.description + " " + c.manner)) ?? inShot[0];
  }
  if (/\b(him|he|his|man|guy)\b/i.test(instruction)) {
    return inShot.find((c) => /\b(he|him|man|guy|male)\b/i.test(c.description + " " + c.manner)) ?? inShot[inShot.length - 1];
  }
  return inShot[0];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const GARMENT =
  /\b(coat|sweater|jumper|jacket|dress|gown|shirt|blouse|tee|t-shirt|top|jeans|trousers|pants|shorts|skirt|suit|hoodie|scarf|boots|sneakers|shoes|heels|hat|cap|uniform|kit|robe|cardigan|vest|tie|belt|gloves|wearing|outfit|clothes)\b/i;

/**
 * Drop the clothing segments of a continuity sheet so a wardrobe change does
 * not describe two outfits at once. Segments are the comma-separated parts;
 * age, hair and props survive.
 */
export function stripGarments(description: string): string {
  return description
    .split(/,\s*/)
    .filter((seg) => seg.trim() && !GARMENT.test(seg))
    .join(", ");
}

/** Extract "to a green dress" / "into a leather jacket" / "wearing X". */
function outfitFrom(instruction: string): string | null {
  const m =
    instruction.match(/\b(?:outfit|clothes|clothing|dress|wardrobe|costume)\b[^.]*?\b(?:to|into)\s+(.+?)(?:[.,;]|$)/i) ??
    instruction.match(/\bwear(?:ing|s)?\s+(.+?)(?:[.,;]|$)/i) ??
    instruction.match(/\b(?:put|dress)\s+(?:him|her|them|\w+)\s+in\s+(.+?)(?:[.,;]|$)/i);
  return m ? m[1].trim() : null;
}

export function heuristicRetake(instruction: string, shot: Shot, cast: Character[]): ShotPatch {
  const text = instruction.trim();
  const patch: ShotPatch = { summary: "" };
  const changes: string[] = [];
  const camera: Partial<Camera> = {};

  // --- camera distance
  if (/\bcloser\b|\btighter\b|\bcloser (to|on)\b|\bmore intimate\b/i.test(text) && !/\bnot? closer\b/i.test(text)) {
    camera.framing = stepFraming(shot.camera.framing, 1);
    changes.push(`framing → ${camera.framing}`);
  } else if (/\bwider\b|\bfurther (away|back)\b|\bmore (room|space)\b|\bpull back\b/i.test(text)) {
    camera.framing = stepFraming(shot.camera.framing, -1);
    changes.push(`framing → ${camera.framing}`);
  }
  for (const [re, f] of FRAMING_WORDS) {
    if (re.test(text)) {
      camera.framing = f;
      changes.push(`framing → ${f}`);
      break;
    }
  }
  for (const [re, m] of MOVEMENT_WORDS) {
    if (re.test(text)) {
      camera.movement = m;
      changes.push(`movement → ${m}`);
      break;
    }
  }
  for (const [re, a] of ANGLE_WORDS) {
    if (re.test(text)) {
      camera.angle = a;
      changes.push(`angle → ${a}`);
      break;
    }
  }
  if (/\bslower\b|\bslow (it )?down\b/i.test(text)) {
    patch.action = `${shot.action.replace(/\.$/, "")}, in slow, deliberate motion`;
    changes.push("slower motion");
  } else if (/\bfaster\b|\bquicker\b|\bmore energy\b/i.test(text)) {
    patch.action = `${shot.action.replace(/\.$/, "")}, fast and energetic`;
    changes.push("faster motion");
  }
  if (Object.keys(camera).length) patch.camera = camera;

  // --- lighting
  for (const [re, l] of LIGHTING) {
    if (re.test(text)) {
      patch.lighting = l;
      changes.push(`lighting → ${l.split(",")[0]}`);
      break;
    }
  }

  // --- expression
  for (const [re, e] of EXPRESSIONS) {
    if (re.test(text)) {
      patch.expression = e;
      changes.push(`expression → ${e.split(",")[0]}`);
      break;
    }
  }

  // --- wardrobe
  const outfit = outfitFrom(text);
  const outfitRequested = outfit || /\b(outfit|clothes|clothing|wardrobe|costume)\b/i.test(text);
  if (outfitRequested) {
    const who = targetCharacter(text, shot, cast);
    if (who) {
      const base = stripGarments(who.description);
      const newOutfit = outfit ?? "a different outfit, in the same style and era";
      patch.characterOverrides = { [who.id]: `${base}${base ? ", " : ""}wearing ${newOutfit}` };
      changes.push(`${who.name}'s wardrobe → ${newOutfit}`);
    }
  }

  // --- duration
  const dur = text.match(/\b(\d{1,2})\s*(s|sec|seconds?)\b/i);
  if (dur) {
    patch.durationSec = Math.max(4, Math.min(15, Number(dur[1])));
    changes.push(`duration → ${patch.durationSec}s`);
  } else if (/\blonger\b/i.test(text)) {
    patch.durationSec = Math.min(15, shot.durationSec + 2);
    changes.push(`duration → ${patch.durationSec}s`);
  } else if (/\bshorter\b/i.test(text)) {
    patch.durationSec = Math.max(4, shot.durationSec - 2);
    changes.push(`duration → ${patch.durationSec}s`);
  }

  // --- nothing matched: treat it as an action note rather than doing nothing
  if (!changes.length) {
    patch.action = `${shot.action.replace(/\.$/, "")}. ${text.replace(/\bkeep everything else( the same)?\.?/i, "").trim()}`.trim();
    changes.push("action note added");
  }

  patch.summary = changes.join(", ");
  return patch;
}

/** Apply a patch to a shot, producing the new shot (the old one is untouched). */
export function applyPatch(shot: Shot, patch: ShotPatch): Shot {
  return {
    ...shot,
    description: patch.description ?? shot.description,
    action: patch.action ?? shot.action,
    camera: { ...shot.camera, ...(patch.camera ?? {}) },
    lighting: patch.lighting ?? shot.lighting,
    expression: patch.expression ?? shot.expression,
    dialogue: patch.dialogue ?? shot.dialogue,
    durationSec: patch.durationSec ?? shot.durationSec,
  };
}
