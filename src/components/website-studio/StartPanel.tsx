"use client";

// ---------------------------------------------------------------------------
// The start — three ways in, one surface.
//
// The owner's rule when this replaced three apps: starting a website should
// feel like one app with three ways in, not three apps behind a switcher. So
// there is ONE slab. The mode chips under it change what the slab asks for —
// a description, or an address — and the design skills ride along either way
// because the look is a decision about the build, not about how it started.
//
// Both modes end in the same place: an App Builder project, which is what the
// rest of the road (Felix, the feature list, the mockups, the harness build,
// the client link) already runs on. Nothing new is invented to carry a start.
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState } from "react";
import { ACCEPT, MAX_ITEMS, prepare, type PreparedMedia } from "@/lib/app-builder/media";
import { handRedesignToAppBuilder } from "@/lib/app-builder/fromRedesigner";
import { normalizeSiteUrl } from "@/lib/app-builder/redesign";
import { combine, studioSkills } from "@/lib/website-studio/skills";
import { SkillsMenu } from "./SkillsMenu";

export type StartMode = "prompt" | "redesign";

interface Props {
  /** Start a new build from a description plus any reference pictures. */
  onPrompt: (idea: string, media: PreparedMedia[], skills: string[]) => Promise<void> | void;
  /** A redesign project has been made; open it. */
  onRedesign: (draftId: string, warning?: string) => void;
  busy: boolean;
}

const SKILLS = studioSkills();

export function StartPanel({ onPrompt, onRedesign, busy }: Props) {
  const [mode, setMode] = useState<StartMode>("prompt");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [picks, setPicks] = useState<string[]>([]);
  const [media, setMedia] = useState<PreparedMedia[]>([]);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list?.length) return;
    setError("");
    const room = MAX_ITEMS - media.length;
    const files = Array.from(list).slice(0, Math.max(0, room));
    if (!files.length) {
      setError(`That's the most references at once (${MAX_ITEMS}).`);
      return;
    }
    for (const f of files) {
      void prepare(f)
        .then((p) => setMedia((m) => (m.length >= MAX_ITEMS ? m : [...m, p])))
        .catch(() => setError(`Couldn't read ${f.name}. Try a picture or a short clip.`));
    }
  }, [media.length]);

  const go = useCallback(async () => {
    setError("");
    if (mode === "prompt") {
      if (!text.trim() && !media.length) {
        box.current?.focus();
        return;
      }
      await onPrompt(text.trim(), media, picks);
      setText("");
      setMedia([]);
      return;
    }
    const clean = normalizeSiteUrl(url);
    if (!clean) {
      setError("Paste the site's address, like https://example.com.");
      return;
    }
    setReading(true);
    try {
      const out = await handRedesignToAppBuilder({ url: clean, note: note.trim(), skills: combine(picks, SKILLS).order });
      onRedesign(out.id, out.warning);
      setUrl("");
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }, [mode, text, media, picks, url, note, onPrompt, onRedesign]);

  const working = busy || reading;
  const combo = combine(picks, SKILLS);

  return (
    <div className="ws-start" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
      <div className="ws-slab" data-mode={mode}>
        {mode === "prompt" ? (
          <>
            <textarea
              ref={box}
              className="ws-slab-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void go();
              }}
              rows={3}
              placeholder="A booking site for a mobile dog groomer — online payments, client accounts, and a gallery of before-and-afters."
              aria-label="What should this website be?"
              disabled={working}
            />
            {media.length > 0 && (
              <ul className="ws-refs" aria-label="References">
                {media.map((m) => (
                  <li key={m.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.thumb} alt={m.name} />
                    <button type="button" onClick={() => setMedia((x) => x.filter((y) => y.id !== m.id))} aria-label={`Remove ${m.name}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <div className="ws-url-row">
              <span className="ws-url-scheme" aria-hidden>https://</span>
              <input
                className="ws-slab-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void go()}
                placeholder="the-site-you-want-redesigned.com"
                aria-label="The website to redesign"
                spellCheck={false}
                disabled={working}
              />
            </div>
            <textarea
              className="ws-slab-input small"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="What should change? Everything it does today is kept — only the look is rebuilt."
              aria-label="What should change about it"
              disabled={working}
            />
            {media.length > 0 && (
              <ul className="ws-refs" aria-label="Visual references">
                {media.map((m) => (
                  <li key={m.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={m.thumb} alt={m.name} />
                    <button type="button" onClick={() => setMedia((x) => x.filter((y) => y.id !== m.id))} aria-label={`Remove ${m.name}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="ws-slab-bar">
          <button
            type="button"
            className="ws-icon-btn"
            onClick={() => file.current?.click()}
            title={mode === "prompt" ? "Attach reference pictures or a screen recording" : "Attach visual references"}
            aria-label="Attach references"
            disabled={working}
          >
            <ClipIcon />
          </button>
          <input ref={file} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

          <SkillsMenu picks={picks} onChange={setPicks} skills={SKILLS} compact />

          <button type="button" className="ws-go" onClick={() => void go()} disabled={working}>
            {working ? (mode === "redesign" ? "Reading the site…" : "Starting…") : mode === "prompt" ? "Start building" : "Read it and redesign"}
            {!working && <ArrowIcon />}
          </button>
        </div>
      </div>

      <div className="ws-modes" role="tablist" aria-label="How to start">
        <button role="tab" aria-selected={mode === "prompt"} className={mode === "prompt" ? "on" : ""} onClick={() => setMode("prompt")}>
          Build from a prompt
        </button>
        <button role="tab" aria-selected={mode === "redesign"} className={mode === "redesign" ? "on" : ""} onClick={() => setMode("redesign")}>
          Redesign a website
        </button>
      </div>

      <p className="ws-start-foot">
        {combo.base} owns the look{combo.order.length > 2 ? `, with ${combo.order.length - 2} more stacked on it` : ""} ·{" "}
        {mode === "prompt" ? "Felix asks what it's for, then you approve the mockups" : "everything the site does today is kept"}
      </p>
      {error && <p className="ws-error" role="alert">{error}</p>}
    </div>
  );
}

function ClipIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.4 11.1 12.3 20.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.1a3.7 3.7 0 1 1 5.2 5.2l-9.2 9.1a1.8 1.8 0 0 1-2.6-2.6l8.5-8.4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}
