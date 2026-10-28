// The text a studio_queue job is filed with: what the PC agent reads first.
// Pure, so it can be tested without a browser.

/** Workflows that render in code on the PC, and the skill that renders each. */
export const PC_SKILLS: Record<string, string> = {
  "flow:animate-my-character": "animate-character-story",
  "flow:film-3d": "threejs-film-story",
  "flow:custom-video-swap": "custom-video-swap",
  "flow:workflow-maker": "rea-to-workflow",
};

/** What the pictures on a request ARE, per workflow — the agent reads this before opening them. */
const PICTURES: Record<string, string> = {
  "flow:animate-my-character": "The pictures on this request are the character.",
  "flow:film-3d": "The pictures on this request are the character.",
  "flow:custom-video-swap":
    "The pictures are the new characters (left to right) and then the background, as the brief maps them; the driving clip is the link on this request.",
  "flow:workflow-maker": "The pictures are key frames from the video or images the owner wants turned into a workflow.",
};

export function queueRequestText(args: Record<string, unknown>): string {
  const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : "Studio job";
  const brief = typeof args.brief === "string" ? args.brief.trim() : "";
  const folder = typeof args.folder === "string" ? args.folder : "";
  const skill = PC_SKILLS[folder];
  const verb = folder === "flow:workflow-maker" ? "Build it" : "Render";
  const head = skill ? `${title}\n${verb} with the ${skill} skill on this PC. ${PICTURES[folder] ?? ""}`.trim() : title;
  return (brief ? `${head}\n\n${brief}` : head).slice(0, 3900);
}
