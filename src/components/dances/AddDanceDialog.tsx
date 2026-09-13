"use client";

// ---------------------------------------------------------------------------
// Add a dance by name, or by a link from any social network.
//
// Either way the playable video is resolved through the same gate the seed
// passed — there is no "trust me" route into the vault. A YouTube link that
// plays embedded is used directly; any other link supplies a name draft and
// is kept as the original.
//
// What the user typed is NEVER discarded because a lookup failed. A dance with
// no resolved video can still be saved; it just says so.
// ---------------------------------------------------------------------------

import { useState } from "react";

import type { Dance, DanceVideo } from "@/lib/dances/types";
import { PLATFORM_LABEL, parseLink } from "@/lib/social-import/platform";

interface Props {
  existingRefs: string[];
  onClose: () => void;
  onAdd: (dance: Partial<Dance> & { name: string }) => void;
}

interface Resolved {
  name: string;
  video: DanceVideo | null;
  link: { url: string; platform: string; label: string; resolved: boolean; author?: string; hint?: string } | null;
  duplicate?: boolean;
}

export function AddDanceDialog({ existingRefs, onClose, onAdd }: Props) {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [song, setSong] = useState("");
  const [artist, setArtist] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<Resolved | null>(null);

  const parsed = link.trim() ? parseLink(link) : null;

  const lookup = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/dances/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, link, exclude: existingRefs }),
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
    const url = found?.link?.url ?? parsed?.url.href;
    const platform = found?.link?.platform ?? parsed?.platform;
    onAdd({
      name: finalName,
      song: song.trim() || undefined,
      artist: artist.trim() || undefined,
      video: found?.video ?? undefined,
      sourceUrl: url,
      sourcePlatform: platform,
      tiktokUrl: platform === "tiktok" ? url : undefined,
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
            <span>
              Link <small>optional — TikTok, Instagram, YouTube, Facebook, X or any page</small>
            </span>
            <input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setFound(null);
              }}
              placeholder="Paste a link from any social media…"
              autoFocus
            />
            {parsed && (
              <small>
                {PLATFORM_LABEL[parsed.platform]} link
                {parsed.platform === "youtube" ? " — used as the video if it plays embedded" : " — kept as the original"}
              </small>
            )}
          </label>

          <label className="dm__field">
            <span>Dance name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={link ? "Filled in from the link if you leave it empty" : "What do people call it?"}
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
            disabled={busy || (!name.trim() && !link.trim())}
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
              {found.duplicate && <p className="dm__err">That video is already on your wall.</p>}
              {found.link?.hint && <p className="dm__err">{found.link.hint}</p>}
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
