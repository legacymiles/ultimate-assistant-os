// ---------------------------------------------------------------------------
// Reading a pasted link without yt-dlp.
//
// The paste box shows you what a link IS before anything is fetched, and that
// check is the point of the app — but it normally comes from yt-dlp, which
// does not exist on the deployed site. Waking the PC just to read a title
// would make pasting a link feel slow, and would fail outright while the
// runner is asleep.
//
// So the site asks the video host directly. oEmbed is a keyless endpoint that
// YouTube, Vimeo, TikTok and SoundCloud all publish for exactly this: hand it
// a URL, get back the real title, the real channel and a thumbnail.
//
// What it cannot give is duration or a stated licence. Those come back null
// rather than guessed, and the page says so — a confirmation step that
// invented its facts would be worse than none.
// ---------------------------------------------------------------------------

import type { Licence } from "./types";

export interface OembedProbe {
  id: string;
  title: string;
  creator: string;
  siteLabel: string;
  pageUrl: string;
  durationMs: null;
  thumbnail: string | null;
  uploaded: "";
  licence: Licence;
  isLive: false;
  approxBytes: null;
  /** True: this came from the host's oEmbed, so some fields are unknown. */
  partial: true;
}

interface Endpoint {
  label: string;
  url: (target: string) => string;
}

const ENDPOINTS: { hosts: string[]; endpoint: Endpoint }[] = [
  {
    hosts: ["youtube.com", "youtu.be"],
    endpoint: {
      label: "YouTube",
      url: (t) => "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(t),
    },
  },
  {
    hosts: ["vimeo.com"],
    endpoint: {
      label: "Vimeo",
      url: (t) => "https://vimeo.com/api/oembed.json?url=" + encodeURIComponent(t),
    },
  },
  {
    hosts: ["tiktok.com"],
    endpoint: {
      label: "TikTok",
      url: (t) => "https://www.tiktok.com/oembed?url=" + encodeURIComponent(t),
    },
  },
  {
    hosts: ["soundcloud.com"],
    endpoint: {
      label: "SoundCloud",
      url: (t) => "https://soundcloud.com/oembed?format=json&url=" + encodeURIComponent(t),
    },
  },
];

function endpointFor(raw: string): Endpoint | null {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  } catch {
    return null;
  }
  const hit = ENDPOINTS.find((e) => e.hosts.some((h) => host === h || host.endsWith("." + h)));
  return hit?.endpoint ?? null;
}

interface OembedResponse {
  title?: string;
  author_name?: string;
  thumbnail_url?: string;
  provider_name?: string;
}

/** Read a link through its host's own oEmbed, or null when it will not say. */
export async function probeViaOembed(url: string): Promise<OembedProbe | null> {
  const endpoint = endpointFor(url);
  if (!endpoint) return null;

  let data: OembedResponse;
  try {
    const res = await fetch(endpoint.url(url), {
      headers: { accept: "application/json", "user-agent": "UltimateAssistantOS/1.0" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    // 401/404 here means private, removed, or region-locked — all "cannot say".
    if (!res.ok) return null;
    data = (await res.json()) as OembedResponse;
  } catch {
    return null;
  }

  if (!data.title) return null;

  return {
    id: url,
    title: data.title,
    creator: data.author_name ?? "Unknown",
    siteLabel: data.provider_name ?? endpoint.label,
    pageUrl: url,
    durationMs: null,
    thumbnail: data.thumbnail_url ?? null,
    uploaded: "",
    licence: { kind: "youtube", label: "Rights not verified", url },
    isLive: false,
    approxBytes: null,
    partial: true,
  };
}
