// ---------------------------------------------------------------------------
// The motion-transfer brief for MiniMax H3.
//
// H3 reference generation separates roles by label, in attach order: the
// dance clip is "Video 1", the character's pictures are "Image 1…N". The
// rule that makes it work (MiniMax's street-dance recipe): image = identity,
// video = performance, prompt = constraints. When a prompt lets every
// reference speak to every attribute, the original dancer's face and clothes
// leak into the result — so the brief says, explicitly, what NOT to take from
// the video.
//
// Pure, so it is unit-tested and the exact text is stored on each generation.
// ---------------------------------------------------------------------------

export interface MotionPromptInput {
  characterName: string;
  description?: string;
  imageCount: number;
  userPrompt?: string;
}

export function composeMotionPrompt({ characterName, description, imageCount, userPrompt }: MotionPromptInput): string {
  const name = characterName.trim() || "the character";
  const count = Math.max(1, imageCount);
  const images = count === 1 ? "Image 1" : `Images 1 to ${count}`;
  const extra = userPrompt?.trim();

  return [
    `Video 1 is the motion reference. ${images} ${count === 1 ? "is" : "are"} the character reference for ${name}.`,
    "Use Video 1 strictly for the dance: every movement of the choreography, its timing and rhythm, body positions, camera framing, camera movement and overall composition. Do not take the dancer's face, hair, skin, body shape or clothing from Video 1.",
    `Use ${images} for ${name}'s identity, face, hairstyle, body proportions, outfit and colours${description?.trim() ? ` (${description.trim()})` : ""}. Keep ${name} identical for the whole clip.`,
    `Recreate the complete dance from Video 1 beat for beat with ${name} as the only dancer, preserving body rhythm, timing and camera framing.`,
    extra ? `Additional direction: ${extra}` : "Keep the setting, lighting and background of Video 1.",
  ].join("\n");
}
