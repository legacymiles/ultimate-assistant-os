// ---------------------------------------------------------------------------
// Where the two halves of this app get their facts. Server-only.
//
// IDENTIFY  — Apple's iTunes Search API. Keyless, complete, and the same
//             catalogue every music app on earth agrees with, which is exactly
//             what "confirm the song" needs. It licenses nothing.
//
// DOWNLOAD  — the Internet Archive and Openverse. Between them they index the
//             public-domain and Creative Commons audio on the open web
//             (Archive's own collections and the Live Music Archive; Jamendo,
//             Freesound, ccMixter and Wikimedia through Openverse). Both are
//             keyless. Neither carries commercial releases, and that is the
//             point: a row exists here only if somebody published the file for
//             download, and the licence travels with it to the UI.
//
//             Plus YouTube, through yt-dlp on the owner's own machine. That
//             source states no licence, so its rows say so rather than
//             pretending otherwise. See ytdlp.ts.
//
// Everything degrades to an empty list rather than an error. One source being
// slow or down must never take the page with it.
// ---------------------------------------------------------------------------

import { cleanFileTitle, rank, scoreCandidate } from "./match";
import type { Candidate, Licence, Track } from "./types";
import { searchYouTube, ytdlpStatus } from "./ytdlp";

const UA = "UltimateAssistantOS/1.0 (hub mp3-download)";
const TIMEOUT = 12_000;

async function getJson<T>(url: string, ms = TIMEOUT): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(ms),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    // Timeout, DNS, malformed JSON — all the same answer here: no rows.
    return null;
  }
}

// --- stage 1: identify -----------------------------------------------------

interface ItunesSong {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  primaryGenreName?: string;
  trackExplicitness?: string;
  trackNumber?: number;
  trackCount?: number;
  discNumber?: number;
  trackViewUrl?: string;
}

export async function searchTracks(query: string, limit = 18): Promise<Track[]> {
  const q = query.trim();
  if (!q) return [];
  const url =
    "https://itunes.apple.com/search?" +
    new URLSearchParams({ term: q, entity: "song", media: "music", limit: String(limit) });

  const data = await getJson<{ results?: ItunesSong[] }>(url);
  const rows = data?.results ?? [];

  return rows
    .filter((r) => r.trackId && r.trackName)
    .map((r) => ({
      id: String(r.trackId),
      title: r.trackName ?? "",
      artist: r.artistName ?? "Unknown artist",
      album: r.collectionName ?? "",
      // Apple's artwork URL is a template: the trailing size is swappable.
      artworkUrl: (r.artworkUrl100 ?? "").replace(/\/\d+x\d+bb\.jpg$/, "/300x300bb.jpg"),
      previewUrl: r.previewUrl ?? null,
      durationMs: r.trackTimeMillis ?? 0,
      releaseDate: r.releaseDate ?? "",
      genre: r.primaryGenreName ?? "",
      explicit: r.trackExplicitness === "explicit",
      trackNumber: r.trackNumber ?? 0,
      trackCount: r.trackCount ?? 0,
      discNumber: r.discNumber ?? 0,
      storeUrl: r.trackViewUrl ?? "",
    }));
}

// --- licences --------------------------------------------------------------

/** Read a licence out of a creativecommons.org URL. */
export function licenceFromUrl(url: string | undefined): Licence | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes("publicdomain/zero")) {
    return { kind: "public-domain", label: "CC0 · public domain", url };
  }
  if (u.includes("publicdomain")) return { kind: "public-domain", label: "Public domain", url };
  const m = u.match(/licenses\/([a-z-]+)\/([\d.]+)/);
  if (m) return { kind: "cc", label: "CC " + m[1].toUpperCase() + " " + m[2], url };
  return null;
}

/** Openverse reports the licence as a slug plus a version. */
function licenceFromSlug(slug: string, version: string, attribution: string | null): Licence {
  const s = (slug || "").toLowerCase();
  if (s === "cc0" || s === "pdm") {
    return {
      kind: "public-domain",
      label: s === "cc0" ? "CC0 · public domain" : "Public domain mark",
      url:
        s === "cc0"
          ? "https://creativecommons.org/publicdomain/zero/1.0/"
          : "https://creativecommons.org/publicdomain/mark/1.0/",
    };
  }
  return {
    kind: "cc",
    label: ("CC " + s.toUpperCase() + (version ? " " + version : "")).trim(),
    url: "https://creativecommons.org/licenses/" + s + "/" + (version || "4.0") + "/",
    attribution: attribution ?? undefined,
  };
}

// --- stage 3: the Internet Archive ----------------------------------------

const ARCHIVE_AUDIO =
  /^(VBR MP3|MP3|128Kbps MP3|64Kbps MP3|Ogg Vorbis|Flac|WAVE|Apple Lossless Audio)$/i;

const FORMAT_LABEL: Record<string, string> = {
  "vbr mp3": "MP3",
  mp3: "MP3",
  "128kbps mp3": "MP3",
  "64kbps mp3": "MP3",
  "ogg vorbis": "OGG",
  flac: "FLAC",
  wave: "WAV",
  "apple lossless audio": "M4A",
  mp32: "MP3",
  mp31: "MP3",
};

function formatLabel(raw: string): string {
  return FORMAT_LABEL[raw.toLowerCase()] ?? raw.toUpperCase();
}

/** Archive's "length" is either seconds ("300") or "mm:ss". */
function archiveLengthMs(length: string | undefined): number | null {
  if (!length) return null;
  if (length.includes(":")) {
    const parts = length.split(":").map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    return parts.reduce((acc, p) => acc * 60 + p, 0) * 1000;
  }
  const n = Number(length);
  return Number.isFinite(n) ? n * 1000 : null;
}

interface ArchiveDoc {
  identifier: string;
  title?: string | string[];
  creator?: string | string[];
  licenseurl?: string;
}

interface ArchiveFile {
  name: string;
  format?: string;
  length?: string;
  size?: string;
}

interface ArchiveMeta {
  metadata?: { title?: string; creator?: string | string[]; licenseurl?: string };
  files?: ArchiveFile[];
}

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";

/** Lucene needs its specials gone, and a bare colon would break the query. */
function lucene(text: string): string {
  return text
    .replace(/["\\]/g, " ")
    .replace(/[+\-!(){}[\]^~*?:/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prefer the formats that play and travel everywhere. */
const FORMAT_PREFERENCE = ["vbr mp3", "mp3", "128kbps mp3", "64kbps mp3", "ogg vorbis", "flac", "wave"];

async function archiveDocs(q: string): Promise<ArchiveDoc[]> {
  const search = new URLSearchParams({ q, rows: "8", page: "1", output: "json" });
  for (const f of ["identifier", "title", "creator", "licenseurl"]) search.append("fl[]", f);
  const found = await getJson<{ response?: { docs?: ArchiveDoc[] } }>(
    "https://archive.org/advancedsearch.php?" + search,
  );
  return found?.response?.docs ?? [];
}

async function fromArchive(track: Track): Promise<Candidate[]> {
  const title = lucene(track.title);
  const artist = lucene(track.artist);
  if (!title) return [];

  const titleClause = '(title:("' + title + '") OR "' + title + '") AND mediatype:(audio)';

  // Narrow first — title AND artist — because that is the recording asked for.
  // When that finds nothing, widen to the title alone rather than showing an
  // empty table: on a piece of music (as opposed to a pop single) the archive
  // holds a dozen honest performances by other people, and the scorer already
  // caps those as covers so the widening cannot quietly mislead.
  let docs = artist
    ? await archiveDocs(titleClause + ' AND (creator:("' + artist + '") OR "' + artist + '")')
    : [];
  if (docs.length === 0) docs = await archiveDocs(titleClause);
  if (docs.length === 0) return [];

  // Item metadata is one request each; six is a reasonable ceiling for a page
  // that has to answer in a couple of seconds.
  const metas = await Promise.all(
    docs.slice(0, 6).map(async (doc) => ({
      doc,
      meta: await getJson<ArchiveMeta>("https://archive.org/metadata/" + doc.identifier, 9_000),
    })),
  );

  const out: Candidate[] = [];
  for (const { doc, meta } of metas) {
    if (!meta?.files) continue;

    const itemLicence: Licence = licenceFromUrl(meta.metadata?.licenseurl ?? doc.licenseurl) ?? {
      kind: "open",
      label: "No licence stated",
      url: "https://archive.org/details/" + doc.identifier,
    };
    const creator = first(meta.metadata?.creator) || first(doc.creator) || "Unknown";

    const audio = meta.files.filter((f) => f.format && ARCHIVE_AUDIO.test(f.format));
    if (audio.length === 0) continue;

    // One row per recording, not per file: an item usually holds the same take
    // as MP3, OGG, FLAC and WAV, and four rows of one song is noise.
    const byRecording = new Map<string, ArchiveFile[]>();
    for (const f of audio) {
      const key = cleanFileTitle(f.name).toLowerCase();
      byRecording.set(key, [...(byRecording.get(key) ?? []), f]);
    }

    for (const group of byRecording.values()) {
      const file =
        FORMAT_PREFERENCE.map((fmt) =>
          group.find((g) => (g.format ?? "").toLowerCase() === fmt),
        ).find(Boolean) ?? group[0];
      if (!file) continue;

      const fileTitle = cleanFileTitle(file.name);
      const durationMs = archiveLengthMs(file.length);
      const { score, reasons } = scoreCandidate(track, { title: fileTitle, creator, durationMs });
      if (score < 30) continue;

      out.push({
        id: "archive:" + doc.identifier + ":" + file.name,
        provider: "archive",
        providerLabel: "Internet Archive",
        title: fileTitle,
        creator,
        pageUrl: "https://archive.org/details/" + doc.identifier,
        fileUrl:
          "https://archive.org/download/" + doc.identifier + "/" + encodeURIComponent(file.name),
        format: formatLabel(file.format ?? ""),
        bytes: file.size ? Number(file.size) || null : null,
        durationMs,
        licence: itemLicence,
        score,
        reasons,
      });
    }
  }
  return out;
}

// --- stage 3: Openverse ----------------------------------------------------

interface OpenverseAudio {
  id: string;
  title?: string;
  creator?: string;
  url?: string;
  filetype?: string;
  filesize?: number | null;
  duration?: number | null;
  license?: string;
  license_version?: string;
  attribution?: string | null;
  foreign_landing_url?: string;
  source?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  jamendo: "Jamendo",
  freesound: "Freesound",
  ccmixter: "ccMixter",
  wikimedia_audio: "Wikimedia",
};

async function fromOpenverse(track: Track): Promise<Candidate[]> {
  const q = (track.title + " " + track.artist).trim();
  const url =
    "https://api.openverse.org/v1/audio/?" +
    new URLSearchParams({ q, page_size: "20", peaks: "false" });

  const data = await getJson<{ results?: OpenverseAudio[] }>(url);
  const rows = data?.results ?? [];

  const out: Candidate[] = [];
  for (const r of rows) {
    if (!r.url) continue;
    const title = r.title ?? "Untitled";
    const creator = r.creator ?? "Unknown";
    const durationMs = r.duration ?? null;
    const { score, reasons } = scoreCandidate(track, { title, creator, durationMs });
    if (score < 30) continue;

    out.push({
      id: "openverse:" + r.id,
      provider: "openverse",
      providerLabel: SOURCE_LABEL[r.source ?? ""] ?? "Openverse",
      title,
      creator,
      pageUrl: r.foreign_landing_url ?? "https://openverse.org",
      fileUrl: r.url,
      format: formatLabel(r.filetype ?? "mp3"),
      bytes: r.filesize ?? null,
      durationMs,
      licence: licenceFromSlug(r.license ?? "by", r.license_version ?? "", r.attribution ?? null),
      score,
      reasons,
    });
  }
  return out;
}

// --- stage 3: Apple's own preview -----------------------------------------

/**
 * The 30-second clip Apple serves publicly on every store page.
 *
 * It is here because it is the one file that is unquestionably *this exact
 * recording*, and sometimes thirty seconds is all a shot needs. It is labelled
 * a preview everywhere it appears and sorted into its own tier at the bottom,
 * so it can never be mistaken for the full track.
 */
function applePreview(track: Track): Candidate[] {
  if (!track.previewUrl) return [];
  return [
    {
      id: "apple:" + track.id,
      provider: "apple-preview",
      providerLabel: "Apple Music",
      title: track.title,
      creator: track.artist,
      pageUrl: track.storeUrl || "https://music.apple.com",
      fileUrl: track.previewUrl,
      format: "M4A",
      bytes: null,
      durationMs: 30_000,
      licence: {
        kind: "preview",
        label: "30s promotional preview",
        url: track.storeUrl || undefined,
      },
      score: 100,
      reasons: ["The confirmed recording", "First 30 seconds only"],
    },
  ];
}

// --- the whole hunt --------------------------------------------------------

export interface SourceReport {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  /** Why a source returned nothing, when the reason is worth showing. */
  note?: string;
}

export interface HuntResult {
  candidates: Candidate[];
  /** Which sources answered — the honest "here is where we looked" line. */
  checked: SourceReport[];
}

export async function findCandidates(track: Track): Promise<HuntResult> {
  const [archive, openverse, youtube, ytdlp] = await Promise.allSettled([
    fromArchive(track),
    fromOpenverse(track),
    searchYouTube(track),
    ytdlpStatus(),
  ]);

  const archiveRows = archive.status === "fulfilled" ? archive.value : [];
  const openverseRows = openverse.status === "fulfilled" ? openverse.value : [];
  const youtubeRows = youtube.status === "fulfilled" ? youtube.value : [];
  const engine = ytdlp.status === "fulfilled" ? ytdlp.value : null;
  const preview = applePreview(track);

  return {
    candidates: rank([...archiveRows, ...openverseRows, ...youtubeRows, ...preview]),
    checked: [
      {
        id: "archive",
        label: "Internet Archive",
        ok: archive.status === "fulfilled",
        count: archiveRows.length,
      },
      {
        id: "openverse",
        label: "Jamendo, Freesound, ccMixter, Wikimedia",
        ok: openverse.status === "fulfilled",
        count: openverseRows.length,
      },
      {
        id: "youtube",
        label: engine?.ok ? "YouTube · yt-dlp " + (engine.version ?? "") : "YouTube · yt-dlp",
        ok: Boolean(engine?.ok) && youtube.status === "fulfilled",
        count: youtubeRows.length,
        note: engine?.ok ? (engine.ffmpeg ? undefined : engine.message) : engine?.message,
      },
      { id: "apple", label: "Apple preview", ok: true, count: preview.length },
    ],
  };
}

// --- the download proxy's guest list --------------------------------------

/**
 * Hosts the file route is allowed to fetch from.
 *
 * That route takes a URL from the browser, so without this it is an open proxy
 * into the deployment's network. The list is exactly the hosts the two search
 * sources above can hand back, matched on the registrable suffix.
 */
const ALLOWED_HOSTS = [
  "archive.org",
  "openverse.org",
  "jamendo.com",
  "freesound.org",
  "ccmixter.org",
  "wikimedia.org",
  "wikipedia.org",
  "apple.com",
  "mzstatic.com",
];

export function isAllowedFileUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
}
