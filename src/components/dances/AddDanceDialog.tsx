"use client";

// ---------------------------------------------------------------------------
// Add a dance by name, or by TikTok link.
//
// Either way the playable video is resolved through the same gate the seed
// passed — there is no "trust me" route into the vault.
//
// What the user typed is NEVER discarded because a lookup failed. A dance with
// no resolved video can still be saved; it just says so.
// ---------------------------------------------------------------------------

import { useState } from "react";

import type { Dance, DanceVideo } from "@/lib/dances/types";

interface Props {
  existingRefs: string[];
  onClose: () => void;
  onAdd: (dance: Partial<Dance> & { name: string }) => void;
}

interface Resolved {
  name: string;
  video: DanceVideo | null;
  tiktok: { url: string; resolved: boolean; author?: string } | null;
}

export function AddDanceDialog({ existingRefs, onClose, onAdd }: Props) {
  const [name, setName] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [song, setSong] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Resolved | null>(null);

  const lookup = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/dances/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, tiktokUrl, exclude: existingRefs }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "That didn't work.");
      } else {
        setFound(json);
        if (!name && json.name) setName(json.name);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const finalName = name.trim() || found?.name?.trim();
    if (!finalName) return setError("A dance needs a name.");
    onAdd({
      name: finalName,
      song: song.trim() || undefined,
      artist: artist.trim() || undefined,
      video: found?.video ?? undefined,
      tiktokUrl: tiktokUrl.trim() || undefined,
      tags: [],
      aka: [],
    });
  };

  return (
    <div className="dm__backdrop" onClick={onClose} role="presentation">
      <div
        className="dm dm--narrow"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add a dance"
      >
        <button type="button" className="dm__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dm__body">
          <h2 className="dm__name">Add a dance</h2>

          <label className="dm__field">
            <span>Dance name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="What do people call it?"
              autoFocus
            />
          </label>

          <label className="dm__field">
            <span>
              TikTok link <small>optional — kept for credit</small>
            </span>
            <input
              value={tiktokUrl}
              onChange={(e) => setTiktokUrl(e.target.value)}
              placeholder="https://www.tiktok.com/@…"
            />
          </label>

          <div className="dm__row">
            <label className="dm__field">
              <span>Song</span>
              <input value={song} onChange={(e) => setSong(e.target.value)} />
            </label>
            <label className="dm__field">
              <span>Artist</span>
              <input value={artist} onChange={(e) => setArtist(e.target.value)} />
            </label>
          </div>

          <button
            type="button"
            className="btn"
            onClick={lookup}
            disabled={busy || (!name.trim() && !tiktokUrl.trim())}
          >
            {busy ? "Looking…" : "Find a playable video"}
          </button>

          {error && <p className="dm__err">{error}</p>}

          {found && (
            <div className="dm__found">
              {found.video ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={found.video.poster} alt="" />
                  <div>
                    <strong>Found and verified</strong>
                    <p>{found.video.sourceTitle}</p>
                    <small>{found.video.channel}</small>
                  </div>
                </>
              ) : (
                <div>
                  <strong>No playable video found</strong>
                  <p>
                    You can still save it — the tile will show as having no video, and re-running
                    the resolver later can fill it in.
                  </p>
                </div>
              )}
              {found.tiktok && !found.tiktok.resolved && (
                <p className="dm__err">
                  That TikTok link didn&apos;t resolve — it may be private or deleted. Everything
                  you typed is kept.
                </p>
              )}
            </div>
          )}

          <div className="dm__actions">
            <span className="dm__spacer" />
            <button type="button" className="btn btn--quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={save}>
              Add to vault
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
