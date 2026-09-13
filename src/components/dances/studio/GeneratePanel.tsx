"use client";

// ---------------------------------------------------------------------------
// The generation screen: reference dance → character → optional prompt → go.
//
// A new reference (upload or link) is filed as a library dance at the moment
// you press Generate, and the panel then switches to "From library" with that
// dance selected — so pressing Generate again with another character makes
// Dance 001 + Character B instead of uploading the same clip twice.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";

import {
  canCutClips,
  capturePoster,
  cutClip,
  mediaUrl,
  probeVideo,
  sendJson,
  uploadMedia,
} from "@/lib/dance-studio/client";
import {
  REF_MAX_BYTES,
  REF_MAX_SEC,
  REF_MIN_SEC,
  estimateCostUsd,
  outputSeconds,
  prepReason,
} from "@/lib/dance-studio/limits";
import type { Generation, ImportedSource, ReferenceDance, Resolution, StudioState } from "@/lib/dance-studio/types";
import { PLATFORM_LABEL, parseLink } from "@/lib/social-import/platform";

import type { GenerateIntent } from "./DanceStudio";
import { GenerationTile } from "./GenerationTile";

type RefMode = "upload" | "url" | "library";

interface Source {
  kind: "upload" | "import";
  src: string;
  durationSec: number;
  width: number;
  height: number;
  sizeBytes: number;
  contentType: string;
  file?: File;
  sourceKey?: string;
  posterKey?: string;
  link?: { url: string; platform: ImportedSource["platform"]; author?: string };
}

interface Props {
  state: StudioState;
  intent: GenerateIntent;
  onIntentUsed: () => void;
  onChanged: () => Promise<void>;
  latestId: string | null;
  onStarted: (id: string) => void;
  onCreateCharacter: () => void;
}

const BUSY_LABEL = {
  importing: "Downloading the video…",
  preparing: "Cutting the clip in your browser…",
  uploading: "Uploading…",
  starting: "Sending to MiniMax H3…",
} as const;

function prettyName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60);
}

export function GeneratePanel({ state, intent, onIntentUsed, onChanged, latestId, onStarted, onCreateCharacter }: Props) {
  const { library, provider, storage } = state;
  const activeChars = library.characters.filter((c) => c.active);

  const [mode, setMode] = useState<RefMode>(library.dances.length ? "library" : "upload");
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [danceName, setDanceName] = useState("");
  const [danceId, setDanceId] = useState(library.dances[0]?.id ?? "");
  const [trimStart, setTrimStart] = useState(0);
  const [characterId, setCharacterId] = useState(activeChars.length === 1 ? activeChars[0].id : "");
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState<Resolution>("768p");
  const [useExtra, setUseExtra] = useState(false);
  const [busy, setBusy] = useState<"" | keyof typeof BUSY_LABEL>("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [trail, setTrail] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLVideoElement>(null);

  // Object URLs for uploaded files are freed when replaced.
  useEffect(() => {
    const src = source?.kind === "upload" ? source.src : null;
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [source]);

  useEffect(() => {
    if (!intent.danceId && !intent.characterId && !intent.link) return;
    if (intent.danceId) {
      setMode("library");
      setDanceId(intent.danceId);
    }
    if (intent.characterId) setCharacterId(intent.characterId);
    if (intent.link) {
      setMode("url");
      setUrl(intent.link.url);
      void importLink(intent.link.url, intent.link.name);
    }
    onIntentUsed();
    // importLink is stable in behaviour; only a new intent should trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  const selectedDance = library.dances.find((d) => d.id === danceId);
  const character = library.characters.find((c) => c.id === characterId);
  const tooShort = !!source && source.durationSec > 0 && source.durationSec < REF_MIN_SEC;
  const reason = source ? prepReason(source) : null;
  const clipLength = source ? Math.min(REF_MAX_SEC, Math.max(0, source.durationSec - trimStart)) : 0;
  const referenceSec = mode === "library" ? (selectedDance?.durationSec ?? 0) : reason ? clipLength : (source?.durationSec ?? 0);
  const imageCount = character ? 1 + (useExtra ? character.extraImageKeys.length : 0) : 1;
  const cost = referenceSec
    ? estimateCostUsd(provider.pricing, { resolution, durationSec: outputSeconds(referenceSec) }, referenceSec, imageCount)
    : undefined;

  const referenceReady = mode === "library" ? !!selectedDance : !!source && !tooShort && !!danceName.trim() && clipLength >= REF_MIN_SEC;
  const blocker = !provider.ready
    ? provider.reason
    : !storage.remote
      ? storage.note
      : !referenceReady
        ? mode === "library"
          ? "Pick a dance."
          : source
            ? tooShort
              ? `The clip is under ${REF_MIN_SEC} seconds — too short to copy motion from.`
              : "Name the dance."
            : "Add a reference dance."
        : !character
          ? "Pick a character."
          : "";

  const latest = library.generations.find((g) => g.id === latestId);

  function clearSource() {
    setSource(null);
    setDanceName("");
    setTrimStart(0);
    setTrail([]);
  }

  async function takeFile(file: File) {
    setError("");
    if (!file.type.startsWith("video/")) return setError("That isn't a video file.");
    const src = URL.createObjectURL(file);
    try {
      const p = await probeVideo(src);
      setSource({ kind: "upload", src, ...p, sizeBytes: file.size, contentType: file.type || "video/mp4", file });
      setDanceName((n) => n || prettyName(file.name));
      setTrimStart(0);
      setTrail([]);
    } catch (err) {
      URL.revokeObjectURL(src);
      setError((err as Error).message);
    }
  }

  async function importLink(link: string, name?: string) {
    setBusy("importing");
    setError("");
    setTrail([]);
    try {
      const res = await fetch("/api/dance-studio/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: link }),
      });
      const json = (await res.json().catch(() => ({}))) as ImportedSource & { error?: string; trail?: string[] };
      if (!res.ok) {
        setTrail(json.trail ?? []);
        throw new Error(json.error ?? `Import failed (${res.status}).`);
      }
      const r = json;
      const src = mediaUrl(r.sourceKey);
      const p = await probeVideo(src).catch(() => ({ durationSec: r.durationSec ?? 0, width: r.width ?? 0, height: r.height ?? 0 }));
      setSource({
        kind: "import",
        src,
        ...p,
        sizeBytes: r.sizeBytes,
        contentType: r.contentType,
        sourceKey: r.sourceKey,
        posterKey: r.posterKey,
        link: { url: r.url, platform: r.platform, author: r.author || undefined },
      });
      setDanceName(name || r.title || "Untitled dance");
      setTrimStart(0);
      setTrail(r.trail);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function fileDance(s: Source): Promise<string> {
    let videoKey: string;
    let originalKey: string | undefined;
    let clipStartSec: number | undefined;
    let durationSec = s.durationSec;

    if (reason) {
      if (!canCutClips()) throw new Error("This browser can't cut video. Use Chrome, Edge or Safari, or upload a clip that's already an MP4 of 15 seconds or less.");
      setBusy("preparing");
      setProgress(0);
      const blob = await cutClip(s.src, trimStart, clipLength, setProgress);
      setBusy("uploading");
      videoKey = await uploadMedia("clips", blob, "video/mp4");
      clipStartSec = trimStart;
      durationSec = clipLength;
      if (s.kind === "import") originalKey = s.sourceKey;
      else if (s.file && s.file.size <= REF_MAX_BYTES && ["video/mp4", "video/quicktime", "video/webm"].includes(s.contentType)) {
        originalKey = await uploadMedia("sources", s.file, s.contentType).catch(() => undefined);
      }
    } else {
      setBusy("uploading");
      videoKey = s.kind === "import" ? s.sourceKey! : await uploadMedia("clips", s.file!, "video/mp4");
    }

    let posterKey = s.posterKey;
    if (!posterKey) {
      const poster = await capturePoster(s.src, (clipStartSec ?? 0) + Math.min(1, durationSec / 2));
      if (poster) posterKey = await uploadMedia("posters", poster, "image/jpeg").catch(() => undefined);
    }

    const { dance } = await sendJson<{ dance: ReferenceDance }>("/api/dance-studio/dances", {
      name: danceName.trim(),
      videoKey,
      originalKey,
      clipStartSec,
      posterKey,
      durationSec,
      width: s.width,
      height: s.height,
      source: s.link,
    });
    return dance.id;
  }

  async function generate() {
    if (blocker || busy) return;
    setError("");
    try {
      let id = danceId;
      if (mode !== "library" && source) {
        id = await fileDance(source);
        // File once: from here on this dance is reused, not re-uploaded.
        clearSource();
        setUrl("");
        setMode("library");
        setDanceId(id);
      }
      setBusy("starting");
      const res = await fetch("/api/dance-studio/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ danceId: id, characterId, userPrompt: prompt, settings: { resolution, useExtraImages: useExtra } }),
      });
      const json = (await res.json().catch(() => ({}))) as { generation?: Generation; error?: string };
      if (json.generation) onStarted(json.generation.id);
      await onChanged();
      if (!res.ok) setError(json.error ?? json.generation?.error ?? `Couldn't start (${res.status}).`);
    } catch (err) {
      setError((err as Error).message);
      await onChanged();
    } finally {
      setBusy("");
      setProgress(0);
    }
  }

  const typedLink = mode === "url" && url.trim() ? parseLink(url) : null;
  const linkWarning =
    typedLink?.platform === "instagram" || typedLink?.platform === "facebook"
      ? "private or login-only posts need that site's cookies configured on the server"
      : "";

  return (
    <div className="ds-gen">
      <div className="ds-card">
        <h3 className="ds-step">
          <span>1</span> Reference dance
        </h3>
        <div className="ds-seg" role="tablist">
          {(
            [
              ["upload", "Upload Video"],
              ["url", "Video URL"],
              ["library", `From library (${library.dances.length})`],
            ] as [RefMode, string][]
          ).map(([m, label]) => (
            <button key={m} type="button" className={`dv-chip${mode === m ? " is-on" : ""}`} onClick={() => setMode(m)} disabled={!!busy}>
              {label}
            </button>
          ))}
        </div>

        {mode === "upload" && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void takeFile(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`ds-drop${dragOver ? " is-over" : ""}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void takeFile(f);
              }}
              disabled={!!busy}
            >
              {source?.kind === "upload" ? "Choose a different video" : "Upload a dance video"}
              <small>Drop a file or click · one dancer, full body in frame works best</small>
            </button>
          </>
        )}

        {mode === "url" && (
          <>
            <div className="ds-urlrow">
              <input
                className="ds-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && url.trim() && !busy && importLink(url)}
                placeholder="Paste a TikTok, YouTube, Instagram, Facebook, X or video link…"
              />
              <button type="button" className="btn" onClick={() => importLink(url)} disabled={!url.trim() || !!busy}>
                {busy === "importing" ? "Fetching…" : "Fetch video"}
              </button>
            </div>
            {typedLink && (
              <p className="ds-muted">
                {PLATFORM_LABEL[typedLink.platform]} link{linkWarning && <span className="ds-warn"> — {linkWarning}</span>}
              </p>
            )}
            {busy === "importing" && <p className="ds-muted">Downloading — the first link from a new site can take a minute while the downloader starts.</p>}
            {!source && trail.length > 0 && (
              <details className="ds-muted">
                <summary>What was tried</summary>
                <ul>
                  {trail.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {mode === "library" &&
          (library.dances.length ? (
            <div className="ds-pick">
              {library.dances.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={`ds-pick__item${d.id === danceId ? " is-on" : ""}`}
                  onClick={() => setDanceId(d.id)}
                  title={d.name}
                >
                  {d.posterKey ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(d.posterKey)} alt="" />
                  ) : (
                    <video src={mediaUrl(d.videoKey)} muted preload="metadata" />
                  )}
                  <span>{d.name}</span>
                  <small>{d.durationSec.toFixed(1)}s</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="ds-muted">No dances yet — upload one or paste a link.</p>
          ))}

        {mode !== "library" && source && (
          <div className="ds-source">
            <video ref={preview} src={source.src} crossOrigin="anonymous" controls muted loop playsInline />
            <div className="ds-source__meta">
              <label className="dm__field">
                <span>Dance name</span>
                <input value={danceName} onChange={(e) => setDanceName(e.target.value)} placeholder="What's this dance called?" />
              </label>
              <p className="ds-muted">
                {source.durationSec.toFixed(1)}s · {source.width}×{source.height} · {(source.sizeBytes / 1e6).toFixed(1)} MB
                {source.link ? ` · ${PLATFORM_LABEL[source.link.platform]}${source.link.author ? ` (${source.link.author})` : ""}` : ""}
              </p>
              {tooShort ? (
                <p className="dm__err">Under {REF_MIN_SEC} seconds — too short to copy a dance from.</p>
              ) : reason ? (
                <div className="ds-trim">
                  <p>{reason}</p>
                  {source.durationSec > REF_MAX_SEC && (
                    <label>
                      Start at <strong>{trimStart.toFixed(1)}s</strong>
                      <input
                        type="range"
                        min={0}
                        max={Math.max(0, source.durationSec - REF_MIN_SEC)}
                        step={0.1}
                        value={trimStart}
                        onChange={(e) => {
                          const t = Number(e.target.value);
                          setTrimStart(t);
                          if (preview.current) preview.current.currentTime = t;
                        }}
                      />
                    </label>
                  )}
                  <p className="ds-muted">
                    Uses {trimStart.toFixed(1)}s → {(trimStart + clipLength).toFixed(1)}s ({clipLength.toFixed(1)}s). The original is kept too.
                  </p>
                </div>
              ) : (
                <p className="ds-ok">Ready — this clip is the motion reference.</p>
              )}
              {trail.length > 0 && <p className="ds-muted">{trail.join(" ")}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="ds-card">
        <h3 className="ds-step">
          <span>2</span> Character
        </h3>
        {activeChars.length === 0 ? (
          <div className="ds-empty">
            <p>No active characters yet. Make one once and use it in every dance.</p>
            <button type="button" className="btn btn--primary" onClick={onCreateCharacter}>
              Create a character
            </button>
          </div>
        ) : (
          <>
            <label className="dm__field">
              <span>Select character</span>
              <select className="ds-input" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
                <option value="">Choose…</option>
                {activeChars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {character && (
              <div className="ds-charsel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(character.imageKey)} alt={character.name} />
                <div>
                  <strong>{character.name}</strong>
                  {character.description && <p className="ds-muted">{character.description}</p>}
                  {character.extraImageKeys.length > 0 && (
                    <label className="ds-check">
                      <input type="checkbox" checked={useExtra} onChange={(e) => setUseExtra(e.target.checked)} />
                      Also send {character.extraImageKeys.length} extra reference image{character.extraImageKeys.length === 1 ? "" : "s"}
                    </label>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="ds-card">
        <h3 className="ds-step">
          <span>3</span> Optional prompt
        </h3>
        <label className="dm__field">
          <span>
            Direction <small>the dance itself always comes from the reference video</small>
          </span>
          <textarea
            className="ds-input"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. on a neon-lit rooftop at night. Leave empty to keep the original setting."
          />
        </label>
        <div className="ds-row">
          <label className="dm__field">
            <span>Resolution</span>
            <select className="ds-input" value={resolution} onChange={(e) => setResolution(e.target.value as Resolution)}>
              {provider.resolutions.map((r) => (
                <option key={r} value={r}>
                  {r === "2k" ? "2K" : "768p"}
                </option>
              ))}
            </select>
          </label>
          <div className="ds-est">
            {referenceSec > 0 && <span>{outputSeconds(referenceSec)}s video</span>}
            {cost !== undefined && <strong>≈ ${cost.toFixed(2)}</strong>}
          </div>
        </div>

        <button type="button" className="btn btn--primary ds-go" onClick={generate} disabled={!!blocker || !!busy}>
          {busy ? BUSY_LABEL[busy] : "Generate Dance"}
        </button>
        {busy === "preparing" && (
          <div className="ds-progress" aria-label="Cutting progress">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        {blocker && !busy && <p className="ds-muted">{blocker}</p>}
        {error && <p className="dm__err">{error}</p>}
      </div>

      {latest && (
        <div className="ds-result">
          <h3 className="ds-step">Result</h3>
          <GenerationTile generation={latest} dance={library.dances.find((d) => d.id === latest.danceId)} />
        </div>
      )}
    </div>
  );
}
