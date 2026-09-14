// ---------------------------------------------------------------------------
// What the planning model is told. Pure; the route attaches the uploads as
// vision input in the same order these lines number them.
// ---------------------------------------------------------------------------

import { ROLE_LABEL, lookById, perCutSeconds } from "../constants";
import type { Brief, Upload } from "../types";
import { PLAN_JSON_SHAPE } from "./schema";

export function plannerSystem(): string {
  return [
    "You are a film director, storyboard artist and production designer preparing a SHOT PLAN sheet for a short AI-generated multi-cut film or commercial.",
    "You will be given a brief, the reference images the user uploaded (each with a role and an id), the number of cuts and the total length.",
    "Plan it like a real shoot: a small cast and/or a hero product with continuity-grade descriptions, one or two environments described as a set designer would (with set notes and props), a cut list that tells one clear story across the requested cuts with varied lenses, apertures and camera moves, four lighting reference captions, mood keywords, a one-line style essence and cinematography notes.",
    "Rules:",
    "- Character names are SHORT CAPS LABELS (GIRL, GUY, THE RUNNER). Build a character from a character upload and set its uploadId; describe exactly what the photo shows (age, face, hair, skin, build) so every frame keeps it.",
    "- A product/object upload becomes a product with uploadId set: describe its exact shape, materials, wrapper, colours and markings, and give 3–5 production notes (TEXTURE, FINISH, GLOSS CONTROL, WRAPPED ELEMENT, STYLING…). A commercial brief with no character upload should have a product and NO invented people beyond hands or extras.",
    "- Environments are named in caps with a role suffix (COASTAL ROAD — MAIN LOCATION). Build from environment uploads when given.",
    "- Every cut names its characters and products by those labels and its environment by that name. The cuts are rendered as ONE continuous video, so each cut is one clear beat with one camera move and the cuts flow into each other; durations add up to the total length.",
    "- Write cut descriptions as storyboard captions: what the frame shows, who/what, where, what happens, the light. 25–45 words.",
    "- Vary lensMm across cuts (24–135), aperture (f/1.4–f/5.6), framing, and the move (static, handheld, dolly-in, push-in, pull-out, track, pan, tilt, crane-up, crane-down, arc, orbit, rack-focus, dolly-zoom). A classic ad progression is: wide establishing → macro detail → rack-focus close-up → hero arc.",
    "- Dialogue only if the brief implies speech; write it as \"NAME: line\".",
    "- The palette is 5–6 hex colours that actually appear in the world of the film; lightingNote and lensNote are 2–4 word caps labels for the shared-choices strip.",
    "- Never invent people who aren't in the brief or uploads beyond background extras.",
    "Answer with ONE JSON object exactly in this shape, no prose:",
    PLAN_JSON_SHAPE,
  ].join("\n");
}

export function plannerUser(brief: Brief, uploads: Upload[]): string {
  const look = lookById(brief.look);
  const lines = [
    `Brief: ${brief.prompt.trim()}`,
    `Look: ${look.name} — ${look.style}`,
    `Cuts: ${brief.cutCount}, total length ${brief.totalSec}s (about ${perCutSeconds(brief.totalSec, brief.cutCount)}s each), aspect ${brief.aspectRatio}.`,
  ];
  if (uploads.length) {
    lines.push("Uploads (attached in this order):");
    uploads.forEach((u, i) =>
      lines.push(
        `Image ${i + 1}: id=${u.id} role=${ROLE_LABEL[u.role]}${u.name ? ` name=${u.name}` : ""}${u.description ? ` — ${u.description}` : ""}`,
      ),
    );
  } else {
    lines.push("No uploads: invent the cast, product and set from the brief.");
  }
  return lines.join("\n");
}
