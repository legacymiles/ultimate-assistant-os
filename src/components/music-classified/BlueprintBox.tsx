"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { postJson } from "./api";
import { Prose } from "./Prose";
import type { Blueprint, Song } from "@/lib/music-classified/types";

interface Props {
  scope: string;
  scopeLabel: string;
  songs: Song[];
  blueprint?: Blueprint;
  onSaved: (bp: Blueprint) => void;
}

/** What a playlist's songs share, written as a guide to making the next one. */
export function BlueprintBox({ scope, scopeLabel, songs, blueprint, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const generate = async () => {
    setBusy(true);
    setError("");
    setOpen(true);
    try {
      const { text } = await postJson<{ text: string }>("/api/music-classified/blueprint", { scopeLabel, songs });
      onSaved({ scope, text, songCount: songs.length, at: new Date().toISOString() });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (songs.length < 2 && !blueprint) return null;
  const stale = blueprint && blueprint.songCount !== songs.length;

  return (
    <div className="mcl-blueprint">
      <div className="mcl-blueprint__bar">
        <Icon.Bulb width={15} height={15} className="shrink-0" style={{ color: "var(--color-brand)" }} />
        <button onClick={() => blueprint && setOpen((v) => !v)} className="mcl-blueprint__text">
          <strong>Blueprint</strong> — what {blueprint ? `these ${blueprint.songCount}` : `these ${songs.length}`} songs
          share, and how to make one
          {stale && (
            <span style={{ color: "#fcd34d" }}>
              {" "}
              · {songs.length - blueprint.songCount > 0 ? "new songs since" : "changed since"}
            </span>
          )}
        </button>
        {blueprint && (
          <button onClick={() => setOpen((v) => !v)} className="mcl-btn mcl-btn--sm">
            {open ? "Hide" : "Show"}
          </button>
        )}
        {songs.length >= 2 && (
          <button onClick={generate} disabled={busy} className="mcl-btn mcl-btn--sm">
            <Icon.Sparkles width={11} height={11} />
            {busy ? "Writing…" : blueprint ? "Regenerate" : "Generate"}
          </button>
        )}
      </div>
      {error && (
        <p className="mcl-error" style={{ padding: "0 0.75rem 0.6rem" }}>
          {error}
        </p>
      )}
      {open && blueprint && !busy && (
        <div className="mcl-blueprint__body mcl-scroll">
          <Prose text={blueprint.text} />
        </div>
      )}
      {busy && (
        <p className="mcl-console__note is-busy" style={{ padding: "0 0.75rem 0.6rem", marginTop: 0 }}>
          Reading {songs.length} songs for what they have in common…
        </p>
      )}
    </div>
  );
}
