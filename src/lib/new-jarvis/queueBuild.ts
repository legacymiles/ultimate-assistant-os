// ---------------------------------------------------------------------------
// queue_build: a change to an existing app, handed to Claude Code through
// In Queue. Pure, so it is tested; the posting is in NewJarvis.tsx.
// ---------------------------------------------------------------------------

import { INBOX } from "./requests";

export interface AppRef {
  slug: string;
  title: string;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\b(the|my|app|apps|website|site)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Which app the owner means, by slug, title or a clear part of the title. */
export function findApp(said: string, apps: AppRef[]): AppRef | null {
  const raw = said.trim().toLowerCase().replace(/^\/?apps\//, "").replace(/\/.*$/, "");
  const want = norm(said);
  if (!want && !raw) return null;
  const bySlug = apps.find((a) => a.slug === raw || a.slug === want.replace(/ /g, "-"));
  if (bySlug) return bySlug;
  const byTitle = apps.find((a) => norm(a.title) === want);
  if (byTitle) return byTitle;
  if (want.length < 3) return null;
  const partial = apps.filter((a) => norm(a.title).includes(want) || (norm(a.title).length >= 4 && want.includes(norm(a.title))));
  return partial.length === 1 ? partial[0] : null;
}

/** Where it is filed and the text Claude Code reads. */
export function buildRequest(appSaid: string, request: string, apps: AppRef[]): { folder: string; text: string; app: AppRef | null } {
  const app = findApp(appSaid, apps);
  const body = request.replace(/\s+\n/g, "\n").trim();
  const text = app
    ? `${app.title} (/apps/${app.slug}): ${body}`
    : `${appSaid.trim() || "App"}: ${body}`;
  return { folder: app ? `app:${app.slug}` : INBOX, text: text.slice(0, 3_900), app };
}
