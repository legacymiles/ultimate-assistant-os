// The text a studio_queue job is filed with: what the PC agent reads first.
// Pure, so it can be tested without a browser.

/** Workflows that render in code on the PC, and the skill that renders each. */
export const PC_SKILLS: Record<string, string> = {
  "flow:animate-my-character": "animate-character-story",
  "flow:film-3d": "threejs-film-story",
};

export function queueRequestText(args: Record<string, unknown>): string {
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Studio job";
  const brief = typeof args.brief === "string" ? args.brief.trim() : "";
  const skill = PC_SKILLS[typeof args.folder === "string" ? args.folder : ""];
  const head = skill
    ? `${title}\nRender with the ${skill} skill on this PC. The pictures on this request are the character.`
    : title;
  return (brief ? `${head}\n\n${brief}` : head).slice(0, 3900);
}
