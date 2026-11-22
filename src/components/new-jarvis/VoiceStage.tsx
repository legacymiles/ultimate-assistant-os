"use client";

// ---------------------------------------------------------------------------
// Voice stage — "Choose how Jarvis sounds".
//
// Built from the mockup the owner picked on 2026-11-18 ("Voice stage"): the
// full-width section above the Memory core, with the orb, the accent pills and
// the four-column grid.
//
// The point of the screen is that you can HEAR a voice before you keep it, so
// a preview goes through the same /api/tts the real answers go through, with
// the same body (`ttsBody`). Nothing here has its own audio path to drift.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_VOICE_SETTINGS,
  FILTERS,
  PREVIEW_LINE,
  accentOf,
  clampSettings,
  countsFor,
  filterVoices,
  loadVoiceSettings,
  saveVoiceSettings,
  ttsBody,
  type VoiceFilter,
  type VoiceSettings,
} from "@/lib/voice-settings/settings";
import { VOICES } from "@/lib/voice-settings/voices";
import "./voice-stage.css";

/** Bars of the orb's waveform, as a fraction of its height. */
const WAVE = [0.22, 0.4, 0.62, 0.31, 0.52, 0.26, 0.44];

export function VoiceStage() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [filter, setFilter] = useState<VoiceFilter>("all");
  const [playing, setPlaying] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // localStorage only exists in the browser, so the first paint is the default
  // and the owner's real settings arrive a tick later. Reading during render
  // would make the server and the client disagree.
  useEffect(() => {
    setSettings(loadVoiceSettings());
  }, []);

  useEffect(() => {
    return () => {
      audio.current?.pause();
      audio.current = null;
    };
  }, []);

  const counts = useMemo(() => countsFor(VOICES), []);
  const shown = useMemo(() => filterVoices(VOICES, filter), [filter]);

  const update = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => {
      const next = clampSettings({ ...prev, ...patch });
      saveVoiceSettings(next);
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  }, []);

  /** Speak one line in `name`, through the same route a real answer uses. */
  const preview = useCallback(
    async (name: string) => {
      stop();
      setNote(null);
      setPlaying(name);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ttsBody(PREVIEW_LINE, { ...settings, voice: name })),
        });
        const type = res.headers.get("content-type") ?? "";

        if (!res.ok || !type.startsWith("audio")) {
          // Plain English, and the thing to actually do about it.
          const detail = await res.json().catch(() => null);
          setPlaying(null);
          setNote({
            bad: true,
            text: detail?.fallback
              ? "No voice backend is set up, so there is nothing to play. Start the local one with: npm run tts:phonon"
              : typeof detail?.error === "string"
                ? detail.error
                : "The voice backend could not be reached. If it is the local one, start it with: npm run tts:phonon",
          });
          return;
        }

        const url = URL.createObjectURL(await res.blob());
        const el = new Audio(url);
        audio.current = el;
        el.onended = () => {
          URL.revokeObjectURL(url);
          setPlaying((p) => (p === name ? null : p));
        };
        el.onerror = () => {
          URL.revokeObjectURL(url);
          setPlaying(null);
          setNote({ bad: true, text: "That audio would not play in this browser." });
        };
        await el.play();
      } catch {
        setPlaying(null);
        setNote({
          bad: true,
          text: "The voice backend could not be reached. If it is the local one, start it with: npm run tts:phonon",
        });
      }
    },
    [settings, stop],
  );

  const choose = useCallback(
    (name: string) => {
      update({ voice: name });
      setNote({ bad: false, text: `Jarvis will answer in ${name} from now on.` });
      void preview(name);
    },
    [preview, update],
  );

  return (
    <section
      className="vst"
      data-playing={playing ? "true" : "false"}
      data-standout="the voice stage: a live orb over the catalogue of voices"
      aria-labelledby="vst-title"
    >
      <div className="vst__inner">
        <p className="vst__eyebrow">Voice</p>
        <h2 className="vst__title" id="vst-title">
          Choose how <em>Jarvis</em> sounds
        </h2>
        <p className="vst__sub">
          {counts.all} English voices, running on this PC. Play any one of them, then make it yours.
        </p>

        <div className="vst__orbwrap" aria-hidden>
          <span className="vst__ring vst__ring--two" />
          <span className="vst__ring" />
          <span className="vst__orb" />
          <span className="vst__wave">
            {WAVE.map((h, i) => (
              <span
                key={i}
                style={{ height: `${Math.round(h * 100)}px`, animationDelay: `${i * 90}ms` }}
              />
            ))}
          </span>
        </div>
        <p className="vst__now">{settings.voice}</p>
        <p className="vst__nowmeta">
          {playing ? "Playing" : "Now speaking"} · 24 kHz · on this PC
        </p>

        <div className="vst__filters" role="group" aria-label="Filter voices by accent">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="vst__f"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label} <em>{counts[f.id]}</em>
            </button>
          ))}
        </div>

        <div className="vst__grid">
          {shown.map((v) => {
            const accent = accentOf(v.description);
            const chosen = settings.voice === v.name;
            return (
              // A card with two jobs: keep this voice, or just hear it. The
              // choose button is stretched across the card and the play button
              // sits above it, so neither is nested inside the other.
              <div key={v.name} className="vst__card" data-chosen={chosen ? "true" : undefined}>
                <button
                  type="button"
                  className="vst__choose"
                  aria-pressed={chosen}
                  onClick={() => choose(v.name)}
                >
                  <span className="vst__sr">Use {v.name}</span>
                </button>
                {accent !== "unstated" && (
                  <span className="vst__badge" data-accent={accent}>
                    {accent === "british" ? "British" : "American"}
                  </span>
                )}
                <span className="vst__name">{v.name}</span>
                <span className="vst__desc">{v.description}</span>
                <button
                  type="button"
                  className="vst__play"
                  onClick={() => (playing === v.name ? stop() : void preview(v.name))}
                >
                  {playing === v.name ? "■ Stop" : `▶ Hear ${v.name}`}
                </button>
              </div>
            );
          })}
          {shown.length === 0 && <p className="vst__empty">No voices match that filter.</p>}
        </div>

        <div className="vst__dials">
          <div className="vst__dial">
            <label htmlFor="vst-speed">Speed</label>
            <p className="vst__val">
              {settings.speed.toFixed(2)}
              <span>×</span>
            </p>
            <input
              id="vst-speed"
              className="vst__range"
              type="range"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.speed}
              onChange={(e) => update({ speed: Number(e.target.value) })}
            />
          </div>

          <div className="vst__dial">
            <label htmlFor="vst-expression">Expression</label>
            <p className="vst__val">{settings.expression.toFixed(2)}</p>
            <input
              id="vst-expression"
              className="vst__range"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.expression}
              onChange={(e) => update({ expression: Number(e.target.value) })}
            />
          </div>

          <div className="vst__dial">
            <label htmlFor="vst-consistency">Consistency</label>
            <p className="vst__val">{settings.consistency ? "Locked" : "Free"}</p>
            <button
              id="vst-consistency"
              type="button"
              className="vst__lock"
              aria-pressed={settings.consistency}
              onClick={() => update({ consistency: !settings.consistency })}
            >
              <span className="vst__sw" aria-hidden />
              {settings.consistency ? "Same every time" : "Varies each line"}
            </button>
          </div>
        </div>

        <p className="vst__note" data-bad={note?.bad ? "true" : undefined} role="status">
          {note?.text ?? "Pick a card to keep that voice, or press Hear it to try one first."}
        </p>
      </div>
    </section>
  );
}
