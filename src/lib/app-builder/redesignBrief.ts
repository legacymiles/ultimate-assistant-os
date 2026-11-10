// ---------------------------------------------------------------------------
// The words a redesign adds to the agent calls and the build brief.
// Its own file so engine.ts can use it without importing redesign.ts
// (which imports engine.ts).
// ---------------------------------------------------------------------------

import type { RedesignSource } from "./types";

/** What the agent is told about the site, in the interview and the feature call. */
export function redesignText(r: RedesignSource): string {
  return [
    `URL: ${r.url}`,
    `Title: ${r.title}`,
    r.summary ? `About: ${r.summary}` : "",
    r.nav.length ? `Navigation: ${r.nav.join(", ")}` : "",
    r.headings.length ? `Headings: ${r.headings.join(" | ")}` : "",
    r.ctas.length ? `Calls to action: ${r.ctas.join(", ")}` : "",
    r.colors.length ? `Current colours (being replaced): ${r.colors.join(", ")}` : "",
    r.functionality.length ? `What it does (must keep):\n${r.functionality.map((f) => `- ${f.label}${f.detail ? `: ${f.detail}` : ""}`).join("\n")}` : "",
    r.ownSite ? `The owner's OWN site${r.sourcePath ? ` — source at ${r.sourcePath}` : ""}: edit that source, keep every handler, route and API call, restyle only.` : "Someone else's site: recreate its front end and behaviours under the new design (its backend can't be copied).",
    r.skills?.length ? `Design skills the owner pinned: ${r.skills.join(", ")} (the first leads)` : "",
    r.note ? `Owner's note: ${r.note}` : "",
    r.confidence === "low" ? "The read was thin (a JavaScript-drawn page): lean on the URL, title and note." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The <redesign> section of the build brief. */
export function redesignBrief(r: RedesignSource): string {
  return [
    "<redesign>",
    `This build is a REDESIGN of the live site ${r.url} (${r.title}). The deal: a completely new, premium look — and every function, page, form, link and piece of content it has today still works the same way. Open the live site first and list everything it does before changing anything; that list is the acceptance test.`,
    r.ownSite
      ? r.sourcePath
        ? `It is the owner's own site and its source is ${r.sourcePath}. Bring that source into this folder (git remote + fetch for a repository, or copy a local folder), restyle it on a branch, keep every handler, route, API call and data flow untouched, and open a pull request against the original repository instead of creating a new one.`
        : "It is the owner's own site but no source was given: recreate it here faithfully, and say in your report that the source would let the redesign land in place."
      : "It is someone else's site: recreate its front end and every behaviour listed under the new design, in original code. Never copy its logo or proprietary assets; its own words and structure are the content.",
    `Real content only — the site's own headings (${r.headings.slice(0, 4).join(" | ") || "read them from the page"}) and calls to action (${r.ctas.slice(0, 4).join(", ") || "read them from the page"}). Never lorem ipsum.`,
    r.colors.length ? `The current colours (${r.colors.slice(0, 6).join(", ")}) are the look being REPLACED; keep only what the brand truly owns.` : "",
    "</redesign>",
  ]
    .filter(Boolean)
    .join("\n");
}
