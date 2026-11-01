"use client";

// A dev-only mount of the REAL StoryboardSheet, fed a board from
// public/__dump/. It exists so a board built outside the app — by film-plan in
// a terminal, say — can be reviewed in the same sheet the app renders, rather
// than as a pile of loose images that prove nothing about whether the pipeline
// agrees with itself.
//
// Nothing here is part of Jarvis Studio's own flow: the sheet's callbacks are
// wired to local state so edits are visible, and Render is inert.
import { useEffect, useState } from "react";
import { StoryboardSheet } from "@/components/jarvis/StoryboardSheet";
import { cleanStoryboard, type Storyboard } from "@/lib/studio/storyboard";

export default function SheetPreviewPage() {
  const [board, setBoard] = useState<Storyboard | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const file = new URLSearchParams(window.location.search).get("board") || "board9-drawn";
    fetch(`/__dump/${file}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} fetching ${file}.json`))))
      // Through the same normaliser the app uses, so the preview cannot flatter
      // a board that the real sheet would reject.
      .then((raw) => {
        const clean = cleanStoryboard(raw as Record<string, unknown>);
        if (!clean) throw new Error("cleanStoryboard rejected this board.");
        setBoard(clean);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="p-8 font-mono text-sm text-red-400">{error}</p>;
  if (!board) return <p className="p-8 font-mono text-sm text-neutral-400">Loading the board…</p>;

  return (
    <StoryboardSheet
      board={board}
      onChange={setBoard}
      onRender={() => undefined}
      busy={false}
      done={false}
    />
  );
}
