"use client";

// Who the host is. Every control here changes real behaviour — the prompt,
// sampling, voice, speed, how often he speaks, how soon he fills a silence,
// and what he will never read aloud. Changes apply mid-stream and sync to
// every device (D3).

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleDashed, CircleAlert, Play, Plus, RefreshCw, X } from "lucide-react";
import { VOICES } from "@/lib/voice-settings/voices";
import { PRESETS, idleMsFor, type ConversationStyle } from "@/lib/ai-live-studio/personality";
import type { Studio } from "./useStudio";

function Range({
  label, value, min, max, step = 1, onChange, show, ends,
}: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; show: string; ends?: [string, string];
}) {
  const id = `als-r-${label.replace(/\W+/g, "-").toLowerCase()}`;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="als-field">
      <span>
        <label htmlFor={id}>{label}</label>
        <span className="mono">{show}</span>
      </span>
      <input
        id={id}
        className="als-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={show}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--p" as string]: `${pct}%` }}
      />
      {ends && (
        <div className="als-scale">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}

const STYLES: { id: ConversationStyle; label: string }[] = [
  { id: "punchy", label: "Short & punchy" },
  { id: "conversational", label: "Conversational" },
  { id: "storyteller", label: "Storyteller" },
];

export function PersonalityPanel({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const { settings: s, update, applyPreset, live, feed, setFeed, feedState, ltState, useLive, setUseLive, voiceMode, reconnectLiveTalking, previewVoice } = studio;
  const [word, setWord] = useState("");
  const closeBtn = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const wordInput = useRef<HTMLInputElement>(null);

  // A modal drawer keeps the keyboard inside it, and hands focus back to
  // whatever opened it when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab" || !drawer.current) return;
      const focusable = drawer.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const addWord = () => {
    const w = word.trim().toLowerCase();
    if (!w) return wordInput.current?.focus();
    if (!s.blocklist.includes(w)) update({ blocklist: [...s.blocklist, w] });
    setWord("");
  };

  return (
    <div ref={drawer} className="als-drawer" role="dialog" aria-modal="true" aria-labelledby="als-pers-title">
      <div className="als-drawer-head">
        <h2 id="als-pers-title">Personality</h2>
        <span className="als-count">{s.preset === "custom" ? "Custom" : PRESETS.find((p) => p.id === s.preset)?.label}</span>
        <span style={{ flex: 1 }} />
        <button ref={closeBtn} className="als-btn icon" onClick={onClose} aria-label="Close personality">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="als-drawer-body">
        <section className="als-sec">
          <h3>Presets</h3>
          <div className="als-presets">
            {PRESETS.map((p) => (
              <button key={p.id} className="als-preset" aria-pressed={s.preset === p.id} onClick={() => applyPreset(p.id)}>
                <div className="t">{p.label}</div>
                <div className="d">{p.blurb}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="als-sec">
          <h3>Who {s.name} is</h3>
          <label className="als-field">
            <span>Name</span>
            <input className="als-text" name="host-name" autoComplete="off" value={s.name} maxLength={24} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="als-field">
            <span>Personality</span>
            <textarea className="als-area" name="persona" autoComplete="off" value={s.persona} maxLength={400} onChange={(e) => update({ persona: e.target.value })} />
          </label>
        </section>

        <section className="als-sec">
          <h3>Character</h3>
          <Range label="Humour" value={s.humor} min={0} max={10} onChange={(v) => update({ humor: v })} show={`${s.humor}/10`} ends={["Dry", "Constant"]} />
          <Range label="Energy" value={s.energy} min={0} max={10} onChange={(v) => update({ energy: v })} show={`${s.energy}/10`} ends={["Calm", "Hype"]} />
          <Range label="Emotional expressiveness" value={s.expressiveness} min={0} max={10} onChange={(v) => update({ expressiveness: v })} show={`${s.expressiveness}/10`} ends={["Understated", "Animated"]} />
        </section>

        <section className="als-sec">
          <h3>Conversation</h3>
          <div className="als-field">
            <span>Style</span>
            <div className="als-seg" role="group" aria-label="Conversation style">
              {STYLES.map((st) => (
                <button key={st.id} aria-pressed={s.style === st.id} onClick={() => update({ style: st.id })}>
                  {st.label}
                </button>
              ))}
            </div>
          </div>
          <Range label="Response frequency" value={s.frequency} min={3} max={12} onChange={(v) => update({ frequency: v })} show={`up to ${s.frequency} / min`} ends={["Picky", "Answers everyone"]} />
          <Range
            label="Audience interaction"
            value={s.interaction}
            min={0}
            max={10}
            onChange={(v) => update({ interaction: v })}
            show={`speaks up after ${Math.round(idleMsFor(s.interaction) / 1000)} s quiet`}
            ends={["Just answers", "Drives the chat"]}
          />
        </section>

        <section className="als-sec">
          <h3>Voice</h3>
          <label className="als-field">
            <span>Voice</span>
            <select className="als-select" name="voice" value={s.voice} onChange={(e) => update({ voice: e.target.value })}>
              {VOICES.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <p className="als-hint" style={{ marginTop: -6, marginBottom: 12 }}>
            {VOICES.find((v) => v.name === s.voice)?.description}
          </p>
          <Range label="Speaking speed" value={s.speed} min={0.8} max={1.3} step={0.01} onChange={(v) => update({ speed: v })} show={`${s.speed.toFixed(2)}×`} ends={["Slower", "Faster"]} />
          {!live && (
            <button className="als-ghost" onClick={() => void previewVoice()}>
              <Play size={14} aria-hidden="true" />
              Hear it
            </button>
          )}
        </section>

        <section className="als-sec">
          <h3>Never say</h3>
          <p className="als-hint" style={{ marginTop: 0 }}>
            Harassment, links, phone numbers, emails and spam are always held back. Add any words of your own — comments containing them are hidden, and never read aloud.
          </p>
          <form
            className="als-input-row"
            style={{ marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              addWord();
            }}
          >
            <label className="sr" htmlFor="als-word">
              Add a blocked word
            </label>
            <input
              ref={wordInput}
              id="als-word"
              name="blocked-word"
              className="als-input"
              value={word}
              maxLength={40}
              onChange={(e) => setWord(e.target.value)}
              placeholder="Add a word…"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="als-send" type="submit" aria-label="Add blocked word">
              <Plus size={16} aria-hidden="true" />
            </button>
          </form>
          {s.blocklist.length > 0 && (
            <div className="als-words">
              {s.blocklist.map((w) => (
                <span key={w} className="als-word">
                  {w}
                  <button aria-label={`Remove ${w}`} onClick={() => update({ blocklist: s.blocklist.filter((x) => x !== w) })}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="als-sec">
          <h3>Connections</h3>
          <div className="als-field">
            <span>Comments from</span>
            <div className="als-seg" role="group" aria-label="Where comments come from">
              <button aria-pressed={feed === "demo"} onClick={() => setFeed("demo")}>
                Demo audience
              </button>
              <button aria-pressed={feed === "tiktok"} onClick={() => setFeed("tiktok")}>
                TikTok LIVE
              </button>
            </div>
          </div>
          <label className="als-field">
            <span>TikTok account</span>
            <input
              className="als-text"
              name="tiktok-handle"
              autoComplete="off"
              spellCheck={false}
              translate="no"
              value={s.tiktokHandle}
              placeholder="e.g. your.handle…"
              maxLength={25}
              onChange={(e) => update({ tiktokHandle: e.target.value })}
            />
          </label>
          <label className="als-field">
            <span>LiveTalking avatar</span>
            <input
              className="als-text mono"
              name="avatar-id"
              autoComplete="off"
              spellCheck={false}
              translate="no"
              value={s.avatarId}
              maxLength={64}
              onChange={(e) => update({ avatarId: e.target.value })}
            />
          </label>

          <div className="als-conn">
            <div className="als-conn-row" data-tone={feed === "demo" ? "good" : feedState === "connected" ? "good" : feedState === "unreachable" ? "warn" : "idle"}>
              {feed === "demo" || feedState === "connected" ? <CheckCircle2 size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
              <div>
                <div className="t">TikTok comments</div>
                <div className="d">
                  {feed === "demo"
                    ? "Using the demo audience — a scripted room that exercises every rule."
                    : feedState === "connected"
                      ? `Reading @${s.tiktokHandle || "your account"} live.`
                      : feedState === "connecting"
                        ? "Connecting to the relay…"
                        : feedState === "unreachable"
                          ? "The relay isn't running. It reads your TikTok room and forwards each comment to this studio on ws://127.0.0.1:8787."
                          : `Connects when you go live${s.tiktokHandle ? `, and reads @${s.tiktokHandle}'s comments` : ""}.`}
                </div>
              </div>
            </div>

            <div className="als-conn-row" data-tone={ltState === "online" ? "good" : ltState === "offline" ? "warn" : "idle"}>
              {ltState === "online" ? <CheckCircle2 size={16} aria-hidden="true" /> : ltState === "offline" ? <CircleAlert size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}
              <div>
                <div className="t">LiveTalking face</div>
                <div className="d">
                  {ltState === "online" ? (
                    "Connected — lip sync is live."
                  ) : ltState === "available" ? (
                    `Running on this PC, not in use — the stage shows ${s.name}’s portrait.${s.avatarId === "wav2lip256_avatar1" ? ` It would show LiveTalking’s sample face, not ${s.name}, until ${s.name}’s own avatar is built.` : ""}`
                  ) : ltState === "checking" ? (
                    "Checking…"
                  ) : (
                    <>
                      Not running. Start it on this PC: <code>cd C:\dev\livetalking; .venv\Scripts\python.exe app.py --transport webrtc --model wav2lip --avatar_id {s.avatarId} --modelres 256</code>
                    </>
                  )}
                </div>
                {(ltState === "available" || ltState === "offline") && (
                  <button
                    className="als-ghost"
                    style={{ marginTop: 8 }}
                    onClick={() => (useLive ? void reconnectLiveTalking() : setUseLive(true))}
                  >
                    <RefreshCw size={13} aria-hidden="true" />
                    {ltState === "available" ? "Use LiveTalking" : "Connect"}
                  </button>
                )}
              </div>
            </div>

            <div className="als-conn-row" data-tone={voiceMode === "browser" ? "warn" : voiceMode === "checking" ? "idle" : "good"}>
              {voiceMode === "browser" ? <CircleAlert size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
              <div>
                <div className="t">Voice</div>
                <div className="d">
                  {voiceMode === "phonon"
                    ? "Phonon, on this PC's CPU — free, no key."
                    : voiceMode === "fish-audio"
                      ? "fish.audio's hosted voice."
                      : voiceMode === "browser"
                        ? <>Using the browser&rsquo;s voice. For {s.voice}, start Phonon: <code>npm run tts:phonon</code></>
                        : "Checking…"}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
