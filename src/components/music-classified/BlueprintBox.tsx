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
    <div className="shrink-0 border-b border-line-soft bg-panel/60">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Icon.Bulb width={13} height={13} className="shrink-0 text-brand" />
        <button
          onClick={() => blueprint && setOpen((v) => !v)}
          className="min-w-0 flex-1 truncate text-left text-[12px] text-ink-muted"
        >
          <span className="font-medium text-ink">Blueprint</span> — what{" "}
          {blueprint ? `these ${blueprint.songCount}` : `these ${songs.length}`} songs share, and how to make one
          {stale && <span className="text-amber-300"> · {songs.length - blueprint.songCount > 0 ? "new songs since" : "changed since"}</span>}
        </button>
        {blueprint && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[11px] text-ink-faint transition hover:text-ink"
          >
            {open ? "hide" : "show"}
          </button>
        )}
        {songs.length >= 2 && (
          <button
            onClick={generate}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-[11px] font-medium text-ink-muted transition hover:border-brand hover:text-ink disabled:opacity-50"
          >
            <Icon.Sparkles width={11} height={11} />
            {busy ? "Writing…" : blueprint ? "Regenerate" : "Generate"}
          </button>
        )}
      </div>
      {error && <p className="px-3 pb-2 text-[12px] text-rose-300">{error}</p>}
      {open && blueprint && !busy && (
        <div className="max-h-[45vh] overflow-y-auto border-t border-line-soft px-4 py-3">
          <Prose text={blueprint.text} />
        </div>
      )}
      {busy && (
        <p className="animate-pulse px-3 pb-2 font-mono text-[11px] text-ink-faint">
          Reading {songs.length} songs for what they have in common…
        </p>
      )}
    </div>
  );
}
