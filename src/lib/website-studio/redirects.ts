// ---------------------------------------------------------------------------
// Where an old App Builder / Website Redesigner address goes now.
//
// Step 6 of the Website Studio migration (docs/superpowers/specs/
// website-studio.md): the places the owner NAVIGATES to land in the Studio.
// What does not move, on purpose:
//
//   - App Builder framed inside Jarvis. The chat's `app_builder` tool pulls it
//     up in a sheet, and a redirect inside that frame would swap the sheet's
//     contents for a whole second app. The page reads `Sec-Fetch-Dest: iframe`
//     and passes `framed`.
//   - The boards the Studio does not host: the Flux edit-mockup board
//     (`v=edit`, which the website-edit-mockups skill links to), the bake-off
//     (`v=2`) and the Showcase (`v=showcase`).
//
// Pure: params in, an address or null out.
// ---------------------------------------------------------------------------

export const STUDIO = "/apps/website-studio";

/** The boards that still live on App Builder's redesign section. */
const STAYS = new Set(["edit", "2", "showcase"]);

type Params = Record<string, string | string[] | undefined>;

const first = (p: Params, k: string) => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || "";
};

/**
 * The Studio address for an App Builder URL, or null to stay put.
 *
 * `?p=<id>` opens that draft in the Studio (it reads the same project store);
 * `?section=redesign` opens the Studio's start on "Redesign a website", with
 * the address carried; an idea from the Showcase becomes the start's prompt.
 */
export function studioRedirectFor(params: Params, framed: boolean): string | null {
  if (framed) return null;
  // The Studio's own "Open in App Builder" press: the classic screen, on purpose.
  if (first(params, "classic") === "1") return null;
  const section = first(params, "section");
  const v = first(params, "v");
  if (section === "redesign" && STAYS.has(v)) return null;
  // A `v=edit` link that lost its section still means the edit board.
  if (STAYS.has(v) || first(params, "edit")) return null;

  const q = new URLSearchParams();
  const p = first(params, "p");
  if (p) {
    q.set("p", p);
    return `${STUDIO}?${q}`;
  }
  if (section === "redesign") {
    q.set("start", "redesign");
    const url = first(params, "url");
    if (url) q.set("url", url);
    return `${STUDIO}?${q}`;
  }
  const idea = first(params, "idea");
  if (idea) q.set("idea", idea);
  const s = q.toString();
  return s ? `${STUDIO}?${s}` : STUDIO;
}

/** What the Studio's start reads back out of its own address. */
export function readStart(search: string): { mode: "prompt" | "redesign"; idea: string; url: string } {
  const q = new URLSearchParams(search);
  return {
    mode: q.get("start") === "redesign" ? "redesign" : "prompt",
    idea: q.get("idea")?.trim() ?? "",
    url: q.get("url")?.trim() ?? "",
  };
}
