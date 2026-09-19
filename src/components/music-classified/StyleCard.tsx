"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { writeStyle } from "./api";
import { STYLE_LIMIT, charCount, checkStyle } from "@/lib/music-classified/style";
import type { Song, SongStyle } from "@/lib/music-classified/types";

interface Props {
  song: Song;
  /** The page is already filing/describing — it writes the style prompt itself, so don't start a second one. */
  busy: boolean;
  /** Keyed by song id, so a write that finishes after you've moved on still lands on its own song. */
  onStyle: (songId: string, style: SongStyle) => void;
}

/**
 * The song's generator style prompt: ≤1,000 characters describing this
 * recording so a song generator can match it. Written automatically when a
 * song is filed; a song filed before this existed gets one when opened.
 */
export function StyleCard({ song, busy, onStyle }: Props) {
  const style = song.style;
  const [text, setText] = useState(style?.text ?? "");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [showChecks, setShowChecks] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const tried = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setText(style?.text ?? ""), [style?.text]);

  useEffect(() => {
    setError("");
    setNote("");
    return () => abort.current?.abort();
  }, [song.id]);

  const write = async () => {
    const ctrl = new AbortController();
    abort.current?.abort();
    abort.current = ctrl;
    setWriting(true);
    setError("");
    setNote("");
    try {
      const res = await writeStyle(song, ctrl.signal);
      onStyle(song.id, res.style);
      setNote(res.warning ?? "");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctrl) setWriting(false);
    }
  };

  // Songs filed before style prompts existed get one the first time they're opened.
  useEffect(() => {
    if (style || busy || writing || tried.current === song.id) return;
    tried.current = song.id;
    void write();
    // Undo on cleanup, so a cancelled attempt (React re-running effects in
    // development, or the song changing) is retried rather than lost.
    return () => {
      abort.current?.abort();
      tried.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, style, busy]);

  const chars = charCount(text);
  const over = chars > STYLE_LIMIT;
  // Checks follow the text, so a hand edit is judged by the same gate.
  const checks = useMemo(() => (style && text ? checkStyle(text, song, style) : []), [text, style, song]);
  const failed = checks.filter((c) => !c.pass);

  const copy = async () => {
    if (over || !text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Clipboard API refused (unfocused frame, older browser) — copy the old way from the box itself.
      if (box.current) {
        box.current.focus();
        box.current.select();
        ok = document.execCommand("copy");
      }
    }
    if (!ok) return setError("The browser blocked the clipboard — the text is selected, press Ctrl+C.");
    setError("");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const saveEdit = () => {
    if (!style || over || !text.trim() || text === style.text) return;
    onStyle(song.id, { ...style, text, trimmed: false });
  };

  return (
    <section className="mcl-card mcl-sp">
      <div className="mcl-sp__head">
        <span className="mcl-sp__title">Style prompt</span>
        {style?.source === "offline" && (
          <span className="mcl-sp__badge" title="Built from the filed profile — no AI key">
            from profile
          </span>
        )}
        {style && (
          <span className={"mcl-sp__count" + (over ? " is-over" : "")}>
            <b>{chars.toLocaleString()}</b> / {STYLE_LIMIT.toLocaleString()} characters
          </span>
        )}
      </div>

      {style ? (
        <>
          <div className="mcl-sp__meter" aria-hidden>
            <span
              style={{ width: `${Math.min(100, (chars / STYLE_LIMIT) * 100)}%` }}
              className={over ? "is-over" : ""}
            />
          </div>
          <textarea
            ref={box}
            className="mcl-textarea mcl-sp__text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={saveEdit}
            rows={8}
            aria-label="Style prompt (editable)"
          />
          <div className="mcl-sp__actions">
            <button
              className="mcl-btn mcl-btn--primary mcl-btn--sm"
              onClick={copy}
              disabled={over || !text}
              title={over ? `Over ${STYLE_LIMIT} characters — trim it first` : "Copy for your song generator"}
            >
              {copied ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
              {copied ? "Copied" : "Copy Style"}
            </button>
            <button
              className="mcl-btn mcl-btn--sm"
              onClick={write}
              disabled={writing || busy}
              title="Write it again from scratch"
            >
              <Icon.Refresh width={11} height={11} />
              {writing ? "Writing…" : "Rewrite"}
            </button>
            {text !== style.text && (
              <button className="mcl-btn mcl-btn--sm" onClick={() => setText(style.text)}>
                Undo edits
              </button>
            )}
            <button
              className={"mcl-sp__qc" + (failed.length ? " is-fail" : "")}
              onClick={() => setShowChecks((v) => !v)}
              aria-expanded={showChecks}
              title="Quality check"
            >
              {failed.length ? "✕" : "✓"} {checks.length - failed.length}/{checks.length} checks
            </button>
          </div>
          {over && <p className="mcl-sp__warn">Over the limit by {chars - STYLE_LIMIT} — trim it before copying.</p>}
          {(note || style.trimmed) && !over && (
            <p className="mcl-sp__warn">{note || "Ended at the last full clause to stay under the limit."}</p>
          )}
          {showChecks && (
            <ul className="mcl-qc">
              {checks.map((c) => (
                <li key={c.id} className={c.pass ? "is-pass" : "is-fail"} title={c.pass ? undefined : c.fix}>
                  <span aria-hidden>{c.pass ? "✓" : "✕"}</span>
                  {c.label}
                </li>
              ))}
            </ul>
          )}
          {style.identity && (
            <p className="mcl-sp__identity">
              <span>Signature sound</span>
              {style.identity}
            </p>
          )}
        </>
      ) : (
        <p className={"mcl-console__note" + (writing || busy ? " is-busy" : "")} style={{ marginTop: "0.5rem" }}>
          {writing || busy
            ? "Writing a ≤1,000-character prompt that makes a song generator sound like this recording…"
            : "No style prompt yet."}
        </p>
      )}
      {!style && !writing && !busy && (
        <button className="mcl-btn mcl-btn--primary mcl-btn--sm" style={{ marginTop: "0.5rem" }} onClick={write}>
          <Icon.Sparkles width={11} height={11} />
          Write style prompt
        </button>
      )}
      {error && (
        <p className="mcl-error" style={{ marginTop: "0.4rem" }}>
          {error}
        </p>
      )}
    </section>
  );
}
