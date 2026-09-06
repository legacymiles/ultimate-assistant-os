"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  HISTORY_KEY,
  VOICES_KEY,
  addHistory,
  addVoice,
  clearHistory,
  loadHistory,
  loadVoices,
  removeHistory,
  removeVoice,
} from "@/lib/voice-studio/store";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  getBrowserVoices,
  isSpeechSupported,
  pauseBrowser,
  resumeBrowser,
  speakBrowser,
  stopBrowser,
} from "@/lib/voice-studio/speech";
import type {
  ClonedVoice,
  HistoryItem,
  TtsCapabilities,
  TtsFormat,
  TtsRequest,
} from "@/lib/voice-studio/types";
import { clipUrl, toBase64 } from "@/lib/voice-studio/media";
import { Icon } from "../icons";
import { ClonePanel } from "./ClonePanel";

type Current =
  | { kind: "fish"; url: string; download: string; name: string }
  | { kind: "browser"; text: string; name: string }
  | null;

const MAX_TEXT = 5000;

export function VoiceStudio() {
  const [caps, setCaps] = useState<TtsCapabilities | null>(null);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<TtsFormat>("mp3");
  const [speed, setSpeed] = useState(1);
  const [voiceValue, setVoiceValue] = useState("default");
  const [pasteId, setPasteId] = useState("");

  const [cloned, setCloned] = useState<ClonedVoice[]>([]);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [generating, setGenerating] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState<Current>(null);
  const [error, setError] = useState<string | null>(null);

  const browserMode = caps?.mode === "browser";

  // Load capabilities + persisted data on mount.
  useEffect(() => {
    fetch("/api/tts")
      .then((r) => r.json())
      .then((c: TtsCapabilities) => setCaps(c))
      .catch(() => setCaps({ mode: "browser", cloning: false }));
    setCloned(loadVoices());
    setHistory(loadHistory());
    if (isSpeechSupported()) getBrowserVoices().then(setBrowserVoices);
  }, []);

  // Records synced from another device carry a storage path instead of inline
  // audio. Resolving it to a signed URL in state (never back into storage, so
  // the short-lived URL is not persisted) lets every player and download link
  // below keep reading audioDataUrl without caring where the clip came from.
  const resolveClips = useCallback(async <T extends ClonedVoice | HistoryItem>(
    items: T[],
  ): Promise<T[]> =>
    Promise.all(
      items.map(async (item) =>
        !item.audioDataUrl && item.audioPath
          ? { ...item, audioDataUrl: (await clipUrl(item.audioPath)) ?? undefined }
          : item,
      ),
    ), []);

  useRemotePull(VOICES_KEY, () => {
    void resolveClips(loadVoices()).then(setCloned);
  });
  useRemotePull(HISTORY_KEY, () => {
    void resolveClips(loadHistory()).then(setHistory);
  });

  // In browser mode, default the picker to the system voice.
  useEffect(() => {
    if (browserMode) setVoiceValue("");
  }, [browserMode]);

  const voiceName = useMemo(() => {
    if (voiceValue.startsWith("cloned:")) {
      return cloned.find((v) => `cloned:${v.id}` === voiceValue)?.name ?? "Cloned voice";
    }
    if (voiceValue.startsWith("browser:")) {
      const uri = voiceValue.slice("browser:".length);
      return browserVoices.find((v) => v.voiceURI === uri)?.name ?? "Browser voice";
    }
    if (voiceValue === "paste") return pasteId.trim() ? `Voice ${pasteId.trim().slice(0, 6)}…` : "Default";
    if (voiceValue === "") return "System voice";
    return "Default";
  }, [voiceValue, cloned, browserVoices, pasteId]);

  function speakWithBrowser(t: string) {
    const uri = voiceValue.startsWith("browser:") ? voiceValue.slice("browser:".length) : undefined;
    setSpeaking(true);
    setPaused(false);
    setCurrent({ kind: "browser", text: t, name: voiceName });
    setHistory(
      addHistory({
        id: crypto.randomUUID(),
        text: t,
        voiceName,
        createdAt: new Date().toISOString(),
        source: "browser",
      }),
    );
    speakBrowser(t, {
      voiceURI: uri,
      rate: speed,
      onend: () => {
        setSpeaking(false);
        setPaused(false);
      },
      onerror: () => {
        setSpeaking(false);
        setPaused(false);
        setError("Browser speech failed.");
      },
    });
  }

  function togglePause() {
    if (paused) {
      resumeBrowser();
      setPaused(false);
    } else {
      pauseBrowser();
      setPaused(true);
    }
  }

  function stopSpeaking() {
    stopBrowser();
    setSpeaking(false);
    setPaused(false);
  }

  // Speak text without touching history (used by replay + the player's Replay).
  function justSpeak(t: string, voiceURI?: string) {
    setSpeaking(true);
    setPaused(false);
    speakBrowser(t, {
      voiceURI,
      rate: speed,
      onend: () => {
        setSpeaking(false);
        setPaused(false);
      },
      onerror: () => {
        setSpeaking(false);
        setPaused(false);
      },
    });
  }

  async function generate() {
    setError(null);
    const t = text.trim();
    if (!t) {
      setError("Type something to say.");
      return;
    }
    if (browserMode) {
      speakWithBrowser(t);
      return;
    }

    setGenerating(true);
    try {
      const reqBody: TtsRequest = { text: t, format, speed };
      if (voiceValue.startsWith("cloned:")) {
        const v = cloned.find((x) => `cloned:${x.id}` === voiceValue);
        if (v) {
          // The clip is a local data: URL on the device that recorded it, but
          // only a storage path on any other one — so resolve before encoding.
          const src =
            v.audioDataUrl ?? (v.audioPath ? await clipUrl(v.audioPath) : null);
          const audioBase64 = src ? await toBase64(src) : null;
          if (!audioBase64) {
            setError("That cloned voice's audio could not be loaded.");
            setGenerating(false);
            return;
          }
          reqBody.reference = { audioBase64, transcript: v.transcript };
        }
      } else if (voiceValue === "paste" && pasteId.trim()) {
        reqBody.voiceId = pasteId.trim();
      }

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        if (data?.fallback) {
          speakWithBrowser(t);
          return;
        }
        throw new Error(data?.error || "Generation failed.");
      }
      if (!res.ok) throw new Error(`Generation failed (${res.status}).`);

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const dataUrl = await blobToDataUrl(blob);
      setCurrent({ kind: "fish", url, download: dataUrl, name: voiceName });
      setHistory(
        addHistory({
          id: crypto.randomUUID(),
          text: t,
          voiceName,
          createdAt: new Date().toISOString(),
          source: "fish",
          audioDataUrl: dataUrl,
          format,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  function onSaveVoice(v: ClonedVoice) {
    setCloned(addVoice(v));
    setVoiceValue(`cloned:${v.id}`);
  }

  function onDeleteVoice(id: string) {
    setCloned(removeVoice(id));
    if (voiceValue === `cloned:${id}`) setVoiceValue("default");
  }

  function replay(item: HistoryItem) {
    setError(null);
    if (item.source === "fish" && item.audioDataUrl) {
      setCurrent({ kind: "fish", url: item.audioDataUrl, download: item.audioDataUrl, name: item.voiceName });
    } else {
      setCurrent({ kind: "browser", text: item.text, name: item.voiceName });
      justSpeak(item.text);
    }
  }

  const busy = generating;

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          aria-label="Back to hub"
        >
          <Icon.ArrowLeft width={14} height={14} />
          <span className="hidden sm:inline">Hub</span>
        </Link>
        <span className="ml-1 text-sm font-semibold text-ink">Voice Studio</span>
        <span className="ml-2 rounded-md bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand">
          Text → Speech
        </span>
        <ModeBadge caps={caps} />
      </div>

      {/* Aurora header */}
      <header className="relative overflow-hidden border-b border-line">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70 motion-reduce:opacity-40"
          style={{
            background:
              "radial-gradient(60% 120% at 15% 0%, rgba(56,189,248,0.26), transparent 60%)," +
              "radial-gradient(50% 120% at 85% 10%, rgba(139,92,246,0.20), transparent 55%)," +
              "radial-gradient(60% 140% at 60% 120%, rgba(16,185,129,0.16), transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Give your words a voice
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            Type anything in 80+ languages and hear it spoken — or{" "}
            <span className="text-brand">clone a voice</span> from a 10–30s clip and make it say
            whatever you type. Powered by fish-speech, with browser voices as a free fallback.
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
          {/* Fallback notice — the robotic sound is browser voices, not fish-speech */}
          {browserMode && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200/90">
              <span className="font-semibold text-amber-200">You&apos;re on free browser voices.</span>
              <span className="text-amber-200/80">
                That robotic sound is Windows&apos; built-in speech — <span className="font-medium">fish-speech is off</span> until you add a free API key. Then voices turn natural and cloning + downloads unlock.
              </span>
              <a
                href="https://fish.audio/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 font-semibold text-amber-100 transition hover:bg-amber-400/20"
              >
                Get a free key
                <Icon.Launch width={11} height={11} />
              </a>
            </div>
          )}

          {/* Compose */}
          <section className="rounded-2xl border border-line bg-panel p-4">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
              rows={4}
              placeholder="Type what you want spoken…"
              className="w-full resize-y rounded-xl border border-line bg-canvas px-4 py-3 text-sm leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
            />

            <div className="mt-3 flex flex-wrap items-end gap-3">
              {/* Voice picker */}
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Voice
                </span>
                <select
                  value={voiceValue}
                  onChange={(e) => setVoiceValue(e.target.value)}
                  className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
                >
                  {browserMode ? (
                    <>
                      <option value="">System voice</option>
                      {browserVoices.map((v) => (
                        <option key={v.voiceURI} value={`browser:${v.voiceURI}`}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </>
                  ) : (
                    <>
                      <option value="default">Default voice</option>
                      {cloned.map((v) => (
                        <option key={v.id} value={`cloned:${v.id}`}>
                          🎤 {v.name}
                        </option>
                      ))}
                      <option value="paste">Paste a fish.audio voice ID…</option>
                    </>
                  )}
                </select>
              </label>

              {/* Speed */}
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Speed {speed.toFixed(2)}×
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="h-9 w-32 accent-brand"
                />
              </label>

              {/* Format */}
              {!browserMode && (
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                    Format
                  </span>
                  <select
                    value={format}
                    onChange={(e) => setFormat(e.target.value as TtsFormat)}
                    className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/30"
                  >
                    <option value="mp3">MP3</option>
                    <option value="wav">WAV</option>
                  </select>
                </label>
              )}

              <div className="ml-auto flex items-center gap-2">
                <span className="text-[11px] tabular-nums text-ink-faint">
                  {text.length}/{MAX_TEXT}
                </span>
                <button
                  onClick={generate}
                  disabled={busy || !text.trim()}
                  className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? <Spinner /> : <Icon.Sparkles width={15} height={15} />}
                  {busy ? "Generating…" : "Generate"}
                </button>
              </div>
            </div>

            {voiceValue === "paste" && !browserMode && (
              <input
                value={pasteId}
                onChange={(e) => setPasteId(e.target.value)}
                placeholder="fish.audio voice/model reference_id"
                className="mt-2 w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
              />
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {error}
              </div>
            )}

            {/* Player */}
            {current && (
              <div className="mt-4 rounded-xl border border-line bg-canvas p-3">
                <div className="mb-2 flex items-center gap-2 text-xs text-ink-muted">
                  <Icon.Sparkles width={12} height={12} className="text-brand" />
                  <span className="font-medium text-ink">{current.name}</span>
                  {current.kind === "browser" && (
                    <span className="text-ink-faint">· browser voice{speaking ? " · speaking…" : ""}</span>
                  )}
                </div>
                {current.kind === "fish" ? (
                  <div className="flex items-center gap-2">
                    <audio controls src={current.url} className="h-9 w-full" />
                    <a
                      href={current.download}
                      download={`voice-studio.${format}`}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
                    >
                      <Icon.Download width={13} height={13} />
                      Download
                    </a>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={togglePause}
                        disabled={!speaking}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-panel-2 disabled:opacity-40"
                      >
                        {paused ? "▶ Resume" : "⏸ Pause"}
                      </button>
                      <button
                        onClick={stopSpeaking}
                        disabled={!speaking}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-40"
                      >
                        ⏹ Stop
                      </button>
                      <button
                        onClick={() => justSpeak(current.text)}
                        disabled={speaking}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-40"
                      >
                        <Icon.Refresh width={13} height={13} />
                        Replay
                      </button>
                    </div>
                    <p className="text-[11px] text-ink-faint">
                      Browser voice — playback only. Add a fish.audio key for natural{" "}
                      <span className="text-ink-muted">fish-speech</span> voices, cloning and downloads.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Voices + History */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Voices / cloning */}
            <section className="rounded-2xl border border-line bg-panel p-4">
              <h2 className="mb-3 text-sm font-semibold text-ink">Voices</h2>
              {!browserMode && cloned.length > 0 && (
                <ul className="mb-3 space-y-1.5">
                  {cloned.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/50 px-2.5 py-1.5"
                    >
                      <Icon.Mic width={13} height={13} className="text-brand" />
                      <span className="flex-1 truncate text-sm text-ink">{v.name}</span>
                      <button
                        onClick={() => setVoiceValue(`cloned:${v.id}`)}
                        className="rounded px-1.5 py-0.5 text-[11px] font-medium text-brand transition hover:bg-brand/10"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => onDeleteVoice(v.id)}
                        aria-label="Delete voice"
                        className="rounded p-0.5 text-ink-faint transition hover:text-red-400"
                      >
                        <Icon.Trash width={13} height={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <ClonePanel disabled={!caps?.cloning} onSave={onSaveVoice} />
            </section>

            {/* History */}
            <section className="rounded-2xl border border-line bg-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">History</h2>
                {history.length > 0 && (
                  <button
                    onClick={() => setHistory(clearHistory())}
                    className="text-[11px] font-medium text-ink-faint transition hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </div>
              {history.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[11px] text-ink-faint">
                  Your generated clips will show up here.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {history.map((h) => (
                    <li
                      key={h.id}
                      className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/50 px-2.5 py-1.5"
                    >
                      <button
                        onClick={() => replay(h)}
                        aria-label="Replay"
                        className="rounded p-0.5 text-brand transition hover:bg-brand/10"
                      >
                        <Icon.Refresh width={14} height={14} />
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-ink">{h.text}</p>
                        <p className="text-[10px] text-ink-faint">
                          {h.voiceName}
                          {h.source === "browser" ? " · browser" : ""}
                        </p>
                      </div>
                      {h.audioDataUrl && (
                        <a
                          href={h.audioDataUrl}
                          download={`voice-studio.${h.format ?? "mp3"}`}
                          aria-label="Download"
                          className="rounded p-0.5 text-ink-faint transition hover:text-ink"
                        >
                          <Icon.Download width={13} height={13} />
                        </a>
                      )}
                      <button
                        onClick={() => setHistory(removeHistory(h.id))}
                        aria-label="Delete"
                        className="rounded p-0.5 text-ink-faint transition hover:text-red-400"
                      >
                        <Icon.Close width={13} height={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function ModeBadge({ caps }: { caps: TtsCapabilities | null }) {
  if (!caps) return null;
  const label =
    caps.mode === "fish-audio" ? "fish-speech" : caps.mode === "self-hosted" ? "self-hosted" : "browser voices";
  const keyed = caps.mode !== "browser";
  return (
    <span
      className={cn(
        "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        keyed ? "bg-brand/15 text-brand" : "bg-panel-2 text-ink-faint",
      )}
      title={keyed ? "Using the fish-speech backend" : "No key set — using free browser voices; add FISH_API_KEY for fish-speech + cloning"}
    >
      <Icon.Sparkles width={10} height={10} />
      {label}
    </span>
  );
}

function Spinner() {
  return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
}

// ----- helpers ---------------------------------------------------------------

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}
