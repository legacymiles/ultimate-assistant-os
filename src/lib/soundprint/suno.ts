// ---------------------------------------------------------------------------
// Soundprint — playing the real Suno track.
//
// Suno has no public generation API (partner-only beta as of mid-2026), and it
// sets `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'none'` on every
// page — so its visual player CANNOT be embedded in an iframe here. The browser
// refuses to render it.
//
// But the finished audio is public: once a song exists, its mp3 lives at
// `https://cdn1.suno.ai/<song-id>.mp3` and plays in a plain <audio> element
// cross-origin (verified). So the flow is: you create the song on Suno with the
// two prompts, paste the share link back, and the app plays the actual track.
// ---------------------------------------------------------------------------

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Short share links: suno.com/s/<code> — must be resolved server-side. */
const SHORT = /suno\.com\/s\/([A-Za-z0-9]+)/i;

export interface SunoRef {
  kind: "id" | "short";
  value: string;
}

/**
 * Pull a usable reference out of whatever the user pasted:
 *   https://suno.com/song/<uuid>?sh=...   → the uuid (kind: "id")
 *   https://suno.com/s/<code>             → the code (kind: "short", needs resolving)
 *   a bare <uuid>                         → the uuid
 */
export function parseSunoRef(input: string): SunoRef | null {
  const text = input.trim();
  if (!text) return null;

  const uuid = text.match(UUID);
  if (uuid) return { kind: "id", value: uuid[0].toLowerCase() };

  const short = text.match(SHORT);
  if (short) return { kind: "short", value: short[1] };

  return null;
}

/**
 * Suno spreads audio across several CDN shards (cdn1, cdn2, …). The share URL
 * doesn't tell you which one a given song is on, so we probe all of them and
 * use whichever actually serves the file. Hardcoding cdn1 was silently failing
 * for every song that happens to live on another shard.
 */
export const CDN_HOSTS = ["cdn1.suno.ai", "cdn2.suno.ai", "cdn3.suno.ai", "cdn4.suno.ai"];

export function cdnCandidates(songId: string): string[] {
  return CDN_HOSTS.map((h) => `https://${h}/${songId}.mp3`);
}

/** First-guess URL, kept for callers that only need one (the probe refines it). */
export function cdnUrl(songId: string): string {
  return `https://${CDN_HOSTS[0]}/${songId}.mp3`;
}

export function songPageUrl(songId: string): string {
  return `https://suno.com/song/${songId}`;
}

/** Where the user goes to make the song. */
export const SUNO_CREATE_URL = "https://suno.com/create";
