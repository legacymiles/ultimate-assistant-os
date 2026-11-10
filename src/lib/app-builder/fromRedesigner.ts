"use client";

// ---------------------------------------------------------------------------
// Website Redesigner → App Builder.
//
// The Redesigner reads the live site, then hands it to App Builder as a
// project marked `pending`, exactly the way Jarvis chat hands over an app
// idea (fromChat.ts). App Builder opens it and starts the super agent on its
// own, so the owner lands on Felix's questions about the redesign — and from
// there it is the same road as every build: features, mockups, depth,
// software-factory cards, the coding harness on the PC, Client Review.
// ---------------------------------------------------------------------------

import { normalizeSiteUrl, redesignProject, redesignSource, type RedesignInput, type SiteRead } from "./redesign";
import { readStore, writeStore } from "./useAppBuilder";

export interface RedesignHandOff {
  id: string;
  url: string;
  /** Said to the owner when the page couldn't be read well — the project still starts. */
  warning?: string;
}

/** Read the site, make the project, and say where it opens. */
export async function handRedesignToAppBuilder(input: RedesignInput): Promise<RedesignHandOff> {
  const url = normalizeSiteUrl(input.url);
  if (!url) throw new Error("Paste the site's address, like https://example.com.");

  let read: SiteRead | null = null;
  let warning: string | undefined;
  try {
    const res = await fetch("/api/redesign/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as SiteRead & { error?: string };
    if (res.ok) read = data;
    else warning = `${data.error ?? "That site didn't let us read it."} The redesign starts from the address and your note instead.`;
  } catch {
    warning = "That site took too long to read. The redesign starts from the address and your note instead.";
  }

  const p = redesignProject(redesignSource(read, { ...input, url }));
  const s = readStore();
  writeStore({ projects: [p, ...s.projects], currentId: p.id });
  return {
    id: p.id,
    url: `/apps/app-builder?section=build&p=${encodeURIComponent(p.id)}`,
    ...(warning ? { warning } : {}),
  };
}
