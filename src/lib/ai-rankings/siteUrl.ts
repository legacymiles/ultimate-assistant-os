// ---------------------------------------------------------------------------
// A name → the site it belongs to, so every entry in the AI Rankings folder is
// a link you can click.
//
// The owner types a name ("Krea", "comfyanonymous/ComfyUI") and usually stops
// there; the URL field then stays empty and the row is a dead end — nothing to
// open, and nothing for the ranking board's classifier to read. So when the URL
// is left blank it gets filled in.
//
// Three ways, in order of how much they can be trusted:
//   typed  — the name IS a domain or an owner/repo, so no guessing happens.
//   ai     — the model names the official site. Taken at its word: the tools
//            this folder collects often refuse a datacentre request, so
//            "can the server fetch it" is not evidence either way.
//   probe  — no key, or a name the model did not recognise: the server tries
//            <slug>.com / .ai / .io / .app / .dev and keeps the first that
//            responds.
//   guess  — nothing answered (offline, every probe dead): the .com form,
//            returned anyway so the field is never empty, and flagged.
//
// Everything here is a suggestion written into an editable field, never a
// silent fact — the form says where the URL came from and the owner can
// overwrite it. That is why a wrong guess is cheap and an empty field is not.
// ---------------------------------------------------------------------------

/** The source of a resolved URL, weakest last. */
export type UrlSource = "typed" | "ai" | "probe" | "guess";

export interface ResolvedUrl {
  url: string;
  source: UrlSource;
}

/** A hostname-ish string: no spaces, at least one dot, an alphabetic last label. */
export function looksLikeDomain(raw: string): boolean {
  const s = raw.trim().replace(/^https?:\/\//i, "");
  if (!s || /\s/.test(s)) return false;
  const host = s.split(/[/?#]/)[0];
  const labels = host.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => /^[a-z0-9-]+$/i.test(l) && l.length > 0)) return false;
  return /^[a-z]{2,24}$/i.test(labels[labels.length - 1]);
}

/** "comfyanonymous/ComfyUI" — a GitHub repo written the way the board keys it. */
export function looksLikeRepo(raw: string): boolean {
  const s = raw.trim();
  return /^[\w.-]+\/[\w.-]+$/.test(s) && !looksLikeDomain(s);
}

/** The name reduced to one domain label: "Stable Diffusion" → "stablediffusion". */
export function nameSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    // A parenthetical or a trailing qualifier is not part of the brand.
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "");
}

/** Suffixes tried, most likely first. AI tools live on .ai as often as .com. */
export const TLDS = ["com", "ai", "io", "app", "dev"] as const;

/**
 * The URLs worth trying for a name, best first. Empty when the name has no
 * usable letters at all (a number, an emoji), because a link to nothing is
 * worse than an empty field.
 */
export function guessCandidates(name: string): string[] {
  const raw = name.trim();
  if (!raw) return [];
  if (looksLikeDomain(raw)) return [normalize(raw)];
  if (looksLikeRepo(raw)) return [`https://github.com/${raw}`];
  const slug = nameSlug(raw);
  if (!slug) return [];
  return TLDS.map((tld) => `https://${slug}.${tld}`);
}

/** The single best offline guess for a name, or "" when there is none. */
export function guessSiteUrl(name: string): string {
  return guessCandidates(name)[0] ?? "";
}

/** How much a name tells us on its own, before anything is asked or probed. */
export function guessSource(name: string): UrlSource {
  const raw = name.trim();
  return looksLikeDomain(raw) || looksLikeRepo(raw) ? "typed" : "guess";
}

function normalize(raw: string): string {
  const s = raw.trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/**
 * The URL for a name, as good as this browser can get it: the server route
 * when it answers, else the offline guess. Never throws and never returns an
 * empty result for a name with letters in it — the caller writes it straight
 * into an editable field.
 */
export async function resolveSiteUrl(name: string, signal?: AbortSignal): Promise<ResolvedUrl> {
  const offline: ResolvedUrl = { url: guessSiteUrl(name), source: guessSource(name) };
  if (!offline.url || offline.source === "typed") return offline;

  try {
    const res = await fetch("/api/ai-rankings/site-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
      signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as Partial<ResolvedUrl>;
    if (typeof json.url === "string" && json.url) {
      return { url: json.url, source: (json.source as UrlSource) ?? "guess" };
    }
  } catch {
    // Offline, or the route is unreachable — the guess still makes the row
    // clickable and the form still says it is a guess.
  }
  return offline;
}

/** The one-line note the form shows under an auto-filled URL. */
export function urlNote(source: UrlSource): string {
  switch (source) {
    case "typed":
      return "Read straight off the name.";
    case "ai":
      return "Found from the name — edit it if it is the wrong site.";
    case "probe":
      return "This domain answered — edit it if it is the wrong site.";
    default:
      return "A guess from the name — worth checking before you rely on it.";
  }
}
