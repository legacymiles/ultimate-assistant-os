"use client";

// ---------------------------------------------------------------------------
// One side of a mashup: the card that decides which record this is.
//
// Two ways in, and they are not equivalent — the card says which one you are
// on rather than presenting them as interchangeable:
//
//   The CATALOGUE (Apple's public search, no key, no account). Gives the real
//   title, artist, year and artwork, and a 30-SECOND preview. Thirty seconds is
//   a chorus. Everything downstream — transcription, separation, the mix — then
//   only ever sees that chorus, so a catalogue-sourced mashup is a mashup of
//   two choruses. Said here, once, plainly.
//
//   A FILE from disk. The whole record, at whatever length you have. This is
//   the only way to mash up more than half a minute, and the only way to use
//   something the catalogue does not carry.
//
// Audio lives in React state and never enters `project.data`. Projects sync as
// JSON rows; a few megabytes of base64 per side would either blow the row or
// stop the whole store saving. What persists is the identity of the song — the
// catalogue record or the file's name — which is what the writer needs anyway.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../../icons";
import { searchArtist } from "@/lib/music-creator/client";
import type { Side, SongPick } from "@/lib/music-creator/mashup";
import type { ArtistTrack } from "@/lib/music-creator/types";
import "./tools.css";

/** An audio clip held for one side, in this tab only. */
export interface SideClip {
  dataUrl: string;
  name: string;
  bytes: number;
  /** True when this is a 30-second catalogue preview rather than a whole file. */
  preview: boolean;
}

/**
 * Above this the request is likely refused before it reaches the GPU: audio
 * travels as base64 inside a JSON body and serverless bodies cap around 4.5 MB.
 * Stated rather than enforced — a self-hosted deployment has no such cap.
 */
const BIG_FILE = 4_500_000;

export function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That file could not be read in this browser."));
    reader.readAsDataURL(blob);
  });
}

export function isAudio(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(mp3|wav|m4a|flac|ogg|aac|aiff?)$/i.test(file.name);
}

export function SongPicker({
  side,
  role,
  pick,
  clip,
  busy,
  onPick,
  onClip,
}: {
  side: Side;
  /** What this side contributes, in the current blend. One line, above the card. */
  role: string;
  pick: SongPick | undefined;
  clip: SideClip | null;
  busy: boolean;
  onPick: (pick: SongPick) => void;
  onClip: (clip: SideClip | null) => void;
}) {
  const [query, setQuery] = useState(pick?.query ?? "");
  const [tracks, setTracks] = useState<ArtistTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async (term?: string) => {
    const q = (term ?? query).trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const result = await searchArtist(q);
      setTracks(result.tracks ?? []);
      if (!result.tracks?.length) setError(`Nothing in the catalogue matches "${q}".`);
    } catch (err) {
      setTracks([]);
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  /** Take a catalogue track as this side, pulling its preview through the proxy. */
  const choose = async (track: ArtistTrack) => {
    onPick({ query: query.trim() || `${track.title} ${track.artist}`, track });
    setTracks([]);
    if (!track.previewUrl) {
      onClip(null);
      setError(
        `The catalogue has no preview clip for "${track.title}". Its name and artist are enough to describe the ` +
          "sound, but a melody cannot be transcribed and stems cannot be split without audio — drop the file in below for that.",
      );
      return;
    }
    setFetching(track.id);
    setError(null);
    try {
      const res = await fetch(`/api/music-creator/artist?preview=${encodeURIComponent(track.previewUrl)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The preview returned ${res.status}.`);
      }
      const blob = await res.blob();
      onClip({
        dataUrl: await readDataUrl(blob),
        name: `${track.artist} — ${track.title} (30s preview)`,
        bytes: blob.size,
        preview: true,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetching(null);
    }
  };

  const takeFile = async (file: File) => {
    setError(null);
    if (!isAudio(file)) {
      setError(`"${file.name}" does not look like an audio file.`);
      return;
    }
    try {
      onClip({ dataUrl: await readDataUrl(file), name: file.name, bytes: file.size, preview: false });
      onPick({ ...(pick ?? { query: "" }), fileName: file.name });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const track = pick?.track;

  return (
    <section className="mc-panel mct-side">
      <div className="mc-panel-h">
        <h3>
          <span className="mct-ab">{side.toUpperCase()}</span>
          {track ? track.title : pick?.fileName || (side === "a" ? "First song" : "Second song")}
        </h3>
        <p>{role}</p>
      </div>

      <div className="mct-bar">
        <input
          className="mc-input"
          value={query}
          placeholder={side === "a" ? "e.g. Take On Me a-ha" : "e.g. Blinding Lights"}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void search();
          }}
          aria-label={`Search for song ${side.toUpperCase()}`}
        />
        <button type="button" className="mc-btn" onClick={() => void search()} disabled={searching || busy}>
          <Icon.Search width={13} height={13} /> {searching ? "Searching…" : "Search"}
        </button>
        <label className="mc-btn mct-file">
          <Icon.Upload width={13} height={13} /> Use a file
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void takeFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {tracks.length > 0 && (
        <div className="mc-tracks mct-results">
          {tracks.map((t) => (
            <button
              key={t.id}
              type="button"
              className="mc-track"
              onClick={() => void choose(t)}
              disabled={!!fetching || busy}
            >
              {t.artwork ? <img src={t.artwork} alt="" /> : <span className="mct-art" />}
              <span className="mc-track-m">
                <strong>{t.title}</strong>
                <span>
                  {t.artist}
                  {t.releaseYear ? ` · ${t.releaseYear}` : ""}
                  {!t.previewUrl ? " · no preview clip" : fetching === t.id ? " · fetching…" : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        className={`mct-drop mct-drop-s ${over ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void takeFile(file);
        }}
      >
        <Icon.Upload width={15} height={15} />
        <span>…or drop the whole track here — the catalogue only gives 30 seconds</span>
      </div>

      {track && (
        <div className="mct-chosen">
          {track.artwork ? <img src={track.artwork} alt="" /> : <span className="mct-art" />}
          <span className="mct-chosen-m">
            <strong>{track.title}</strong>
            <span>
              {track.artist}
              {track.album ? ` · ${track.album}` : ""}
              {track.releaseYear ? ` · ${track.releaseYear}` : ""}
            </span>
          </span>
        </div>
      )}

      {clip && (
        <div className="mct-clip">
          <Icon.Note width={13} height={13} />
          <strong>{clip.name}</strong>
          <span>{(clip.bytes / 1_000_000).toFixed(1)} MB</span>
          <audio controls preload="metadata" src={clip.dataUrl} />
          <button type="button" className="mc-btn mc-btn-s" onClick={() => onClip(null)} disabled={busy}>
            Clear
          </button>
        </div>
      )}

      {clip?.preview && (
        <p className="mc-note">
          This is the catalogue&apos;s 30-second preview. Everything built from it — the transcribed melody, the split
          stems, the mix — covers those 30 seconds and nothing else. Drop the full track in above for a whole song.
        </p>
      )}
      {clip && clip.bytes > BIG_FILE && (
        <p className="mc-note is-warn">
          {(clip.bytes / 1_000_000).toFixed(1)} MB is large for this path. The clip travels as base64 inside a JSON
          request and hosted deployments usually cap bodies around 4.5 MB — if a job comes back with a 413, trim the
          file to the section you want.
        </p>
      )}
      {error && <p className="mc-note is-bad">{error}</p>}
      {!clip && (
        <p className="mc-note">
          No audio on this side yet. A song can still be named and described without it — but transcribing its melody
          or lifting its stems needs the actual sound.
        </p>
      )}
    </section>
  );
}
