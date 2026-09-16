"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { connectLucy, fetchHealth, type LucyConnection } from "@/lib/realtime-lucy/client";
import {
  DEFAULT_SERVER_URL,
  MODEL_FPS,
  PROMPT_PRESETS,
  STRENGTHS,
  type CondMode,
  type Health,
  type ServerMessage,
  type Stats,
  type Strength,
  type StreamInfo,
} from "@/lib/realtime-lucy/protocol";
import "./realtime-lucy.css";

type Phase = "idle" | "camera" | "connecting" | "opening" | "streaming" | "error";

const LS_URL = "lucy.serverUrl";
const LS_TOKEN = "lucy.token";
const CAMERA_KEYS = ["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright"];

function readLS(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function ms(v?: number) {
  return v === undefined ? "—" : `${Math.round(v)} ms`;
}

export function RealtimeLucy() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [token, setToken] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState(PROMPT_PRESETS[0]);
  const [livePrompt, setLivePrompt] = useState(PROMPT_PRESETS[0]);
  const [strength, setStrength] = useState<Strength>(2);
  const [condMode, setCondMode] = useState<CondMode>("sdedit");
  const [stats, setStats] = useState<Stats>({});
  const [info, setInfo] = useState<StreamInfo | null>(null);
  const [held, setHeld] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const camRef = useRef<HTMLVideoElement>(null);
  const outRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const conn = useRef<LucyConnection | null>(null);
  const heldRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setServerUrl(readLS(LS_URL, DEFAULT_SERVER_URL));
    setToken(readLS(LS_TOKEN, ""));
  }, []);

  // Poll the server's /health while not streaming so the status dot is honest.
  const checkHealth = useCallback(async () => {
    try {
      const h = await fetchHealth(serverUrl, token || undefined);
      setHealth(h);
      setHealthError("");
    } catch (err) {
      setHealth(null);
      setHealthError((err as Error).message);
    }
  }, [serverUrl, token]);

  useEffect(() => {
    void checkHealth();
    const id = setInterval(() => {
      if (phase !== "streaming") void checkHealth();
    }, 5000);
    return () => clearInterval(id);
  }, [checkHealth, phase]);

  const persist = (url: string, tok: string) => {
    try {
      localStorage.setItem(LS_URL, url);
      localStorage.setItem(LS_TOKEN, tok);
    } catch {
      /* private mode */
    }
  };

  const startCamera = useCallback(async () => {
    if (cameraStream.current) return cameraStream.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    cameraStream.current = stream;
    if (camRef.current) {
      camRef.current.srcObject = stream;
      await camRef.current.play().catch(() => undefined);
    }
    setPhase((p) => (p === "idle" ? "camera" : p));
    return stream;
  }, []);

  const onMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "stats") {
      const { type: _t, ...rest } = msg;
      void _t;
      setStats((s) => ({ ...s, ...rest }));
      setPhase((p) => (p === "opening" || p === "connecting" ? "streaming" : p));
    } else if (msg.type === "status") {
      if (msg.state === "streaming") {
        setPhase("streaming");
        if (msg.stream) setInfo(msg.stream);
        setStatusText("");
      } else if (msg.state === "opening" || msg.state === "prompt") {
        setPhase((p) => (p === "streaming" && msg.state === "prompt" ? "streaming" : "opening"));
        setStatusText(msg.message ?? "");
      } else {
        setStatusText(msg.message ?? "");
      }
    } else if (msg.type === "error") {
      setError(msg.message);
      setPhase("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    conn.current?.close();
    conn.current = null;
    if (outRef.current) outRef.current.srcObject = null;
    setPhase(cameraStream.current ? "camera" : "idle");
    setInfo(null);
    setStatusText("");
    heldRef.current.clear();
    setHeld([]);
  }, []);

  const connect = useCallback(async () => {
    setError("");
    persist(serverUrl, token);
    try {
      const camera = await startCamera();
      setPhase("connecting");
      setStatusText("negotiating WebRTC");
      const c = await connectLucy({
        serverUrl,
        token: token || undefined,
        camera,
        prompt,
        strength,
        condMode,
        onMessage,
        onRemoteStream: (remote) => {
          if (outRef.current) {
            outRef.current.srcObject = remote;
            void outRef.current.play().catch(() => undefined);
          }
        },
        onConnectionState: (state) => {
          if (state === "failed" || state === "disconnected" || state === "closed") {
            setError((e) => e || `connection ${state}`);
            setPhase("error");
          }
        },
      });
      conn.current = c;
      setLivePrompt(prompt);
      setPhase("opening");
      setStatusText("connected — anchoring on the first camera frame");
    } catch (err) {
      setError((err as Error).message);
      setPhase(cameraStream.current ? "camera" : "idle");
    }
  }, [serverUrl, token, startCamera, prompt, strength, condMode, onMessage]);

  useEffect(() => () => disconnect(), [disconnect]);

  // Live controls.
  const applyPrompt = () => {
    const text = prompt.trim();
    if (!text || !conn.current) return;
    conn.current.send({ type: "prompt", text });
    setLivePrompt(text);
  };
  const chooseStrength = (v: Strength) => {
    setStrength(v);
    conn.current?.send({ type: "strength", value: v });
  };
  const chooseCond = (v: CondMode) => {
    setCondMode(v);
    conn.current?.send({ type: "cond_mode", value: v });
  };
  const reanchor = () => conn.current?.send({ type: "reset" });

  // Camera keys (WASD / QE / arrows) while streaming — the model's own
  // camera-control conditioning, not a viewport trick.
  useEffect(() => {
    if (phase !== "streaming") return;
    const sendKeys = () => {
      const keys = [...heldRef.current];
      setHeld(keys);
      conn.current?.send({ type: "keys", keys });
    };
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      const k = e.key.toLowerCase();
      if (!CAMERA_KEYS.includes(k)) return;
      e.preventDefault();
      if (!heldRef.current.has(k)) {
        heldRef.current.add(k);
        sendKeys();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (heldRef.current.delete(k)) sendKeys();
    };
    const blur = () => {
      if (heldRef.current.size) {
        heldRef.current.clear();
        sendKeys();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [phase]);

  const online = !!health?.ok;
  const ready = !!health?.ready;
  const streaming = phase === "streaming";
  const busy = phase === "connecting" || phase === "opening";
  const realtimeFactor = stats.gen_fps !== undefined ? stats.gen_fps / MODEL_FPS : undefined;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
        >
          <Icon.ArrowLeft width={13} height={13} />
          Hub
        </Link>
        <span className="text-sm font-semibold text-ink">Realtime Lucy</span>
        <span className="ml-auto inline-flex items-center gap-2 text-xs text-ink-faint">
          <span className="rl-dot" data-on={online ? (ready ? "true" : "warn") : "false"} aria-hidden />
          {online
            ? ready
              ? `Lucy server online · ${health?.gpu ?? "GPU"} · ${health?.model ?? ""}`
              : health?.error
                ? `Lucy server: model failed to load`
                : "Lucy server online · model loading…"
            : "Lucy server offline"}
        </span>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6">
        <section className="relative overflow-hidden rounded-3xl border border-line bg-panel p-5 sm:p-7">
          <div className="rl-hero__glow" aria-hidden />
          <div className="relative flex flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              LingBot-World 2.0 · causal-fast · live
            </p>
            <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Your webcam, re-imagined frame by frame.</h1>
            <p className="max-w-3xl text-sm text-ink-muted">
              Every frame on the right is generated by the world model on your GPU: the camera&apos;s last quarter
              second is encoded, noised into the model&apos;s few-step schedule, denoised against a rolling memory of
              what it already generated, and decoded back — then streamed here over WebRTC. No filters, no
              interpolation, no pre-recorded video.
            </p>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <figure className="relative overflow-hidden rounded-2xl border border-line bg-canvas">
            <figcaption className="absolute left-3 top-3 z-10 rounded-full border border-line bg-panel/80 px-2.5 py-1 text-[11px] font-medium text-ink-muted backdrop-blur">
              Camera
            </figcaption>
            <div className="aspect-[4/3]">
              <video ref={camRef} muted playsInline autoPlay className="h-full w-full bg-black object-contain" />
            </div>
            {!cameraStream.current && phase === "idle" && (
              <button
                type="button"
                onClick={() => void startCamera().catch((e) => setError((e as Error).message))}
                className="absolute inset-0 flex items-center justify-center text-sm font-medium text-ink-muted transition hover:text-ink"
              >
                Click to turn the camera on
              </button>
            )}
          </figure>

          <figure className="rl-stage relative overflow-hidden rounded-2xl border border-line" data-state={phase}>
            <figcaption className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border border-line bg-panel/80 px-2.5 py-1 text-[11px] font-medium text-ink-muted backdrop-blur">
              <span className="rl-dot" data-on={streaming ? "true" : busy ? "warn" : "false"} aria-hidden />
              {streaming ? "Generated · live" : busy ? statusText || "starting…" : "Generated"}
            </figcaption>
            <div className="aspect-[4/3]">
              <video ref={outRef} muted playsInline autoPlay />
            </div>
            {streaming && (
              <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap gap-1">
                {[
                  ["w", "W"],
                  ["a", "A"],
                  ["s", "S"],
                  ["d", "D"],
                  ["arrowleft", "◀"],
                  ["arrowright", "▶"],
                  ["arrowup", "▲"],
                  ["arrowdown", "▼"],
                ].map(([k, label]) => (
                  <span key={k} className="rl-key" data-held={held.includes(k)}>
                    {label}
                  </span>
                ))}
              </div>
            )}
          </figure>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="rl-prompt" className="text-xs font-medium text-ink-muted">
                Prompt {streaming && livePrompt !== prompt.trim() && <span className="text-accent">· edited, not applied</span>}
              </label>
              <textarea
                id="rl-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) applyPrompt();
                }}
                rows={2}
                className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_PRESETS.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPrompt(p)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                      prompt === p ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
                    }`}
                  >
                    {["Cinematic", "Oil painting", "Cyberpunk", "Anime", "Claymation", "Film noir"][i]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-ink-muted">How much of the camera to keep</p>
              <div className="flex flex-wrap gap-1.5">
                {STRENGTHS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    title={s.blurb}
                    aria-pressed={strength === s.value}
                    onClick={() => chooseStrength(s.value)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      strength === s.value ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-ink-faint">{STRENGTHS.find((s) => s.value === strength)?.blurb}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!streaming && !busy ? (
                <button
                  type="button"
                  onClick={() => void connect()}
                  disabled={!online}
                  className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_-10px] shadow-brand transition hover:brightness-110 disabled:opacity-50"
                >
                  Go live
                </button>
              ) : (
                <button
                  type="button"
                  onClick={disconnect}
                  className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-elevated"
                >
                  Stop
                </button>
              )}
              {streaming && (
                <>
                  <button
                    type="button"
                    onClick={applyPrompt}
                    disabled={livePrompt === prompt.trim()}
                    className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-elevated disabled:opacity-40"
                  >
                    Apply prompt
                  </button>
                  <button
                    type="button"
                    onClick={reanchor}
                    title="Forget the model's memory and start again from the current camera frame"
                    className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-elevated"
                  >
                    Re-anchor
                  </button>
                </>
              )}
              <span className="text-xs text-ink-faint">
                {!online
                  ? "Start the Lucy server on the PC with the GPU (see below)."
                  : streaming
                    ? "Hold W A S D or the arrow keys to move the model's camera."
                    : busy
                      ? statusText
                      : phase === "camera"
                        ? "Camera on, server ready."
                        : "Server ready. Go live turns the camera on."}
              </span>
            </div>
            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="self-start text-[11px] font-medium text-ink-faint transition hover:text-ink"
            >
              {showAdvanced ? "Hide" : "Show"} connection settings
            </button>
            {showAdvanced && (
              <div className="grid gap-3 rounded-xl border border-line bg-canvas/60 p-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
                  Lucy server URL
                  <input
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    onBlur={() => persist(serverUrl, token)}
                    placeholder={DEFAULT_SERVER_URL}
                    className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/60"
                  />
                  <span className="text-[10px] text-ink-faint">
                    Leave empty to go through this site&apos;s proxy (LUCY_SERVER_URL on the host).
                  </span>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-ink-muted">
                  Token (if the server was started with --token)
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    onBlur={() => persist(serverUrl, token)}
                    type="password"
                    className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/60"
                  />
                </label>
                <div className="flex flex-col gap-1 text-[11px] text-ink-muted sm:col-span-2">
                  Conditioning
                  <div className="flex gap-1.5">
                    {(
                      [
                        ["sdedit", "SDEdit (noise the camera latents)"],
                        ["keyframe", "Keyframe (camera latents as i2v condition)"],
                      ] as [CondMode, string][]
                    ).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={condMode === v}
                        onClick={() => chooseCond(v)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                          condMode === v ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:text-ink"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {healthError && <p className="text-[11px] text-ink-faint sm:col-span-2">Last health check: {healthError}</p>}
              </div>
            )}
          </div>

          <aside className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold text-ink">Live numbers</h2>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <dt className="text-ink-faint">Generated fps</dt>
              <dd className="font-mono text-ink">
                {stats.gen_fps !== undefined ? stats.gen_fps.toFixed(2) : "—"}
                {realtimeFactor !== undefined && (
                  <span className="text-ink-faint"> · {Math.round(realtimeFactor * 100)}% of 16 fps</span>
                )}
              </dd>
              <dt className="text-ink-faint">Glass to glass</dt>
              <dd className="font-mono text-ink">{ms(stats.glass_to_glass_ms)}</dd>
              <dt className="text-ink-faint">Step (one chunk)</dt>
              <dd className="font-mono text-ink">{ms(stats.total_ms)}</dd>
              <dt className="pl-2 text-ink-faint">VAE encode</dt>
              <dd className="font-mono text-ink-muted">{ms(stats.encode_ms)}</dd>
              <dt className="pl-2 text-ink-faint">Denoise ({stats.steps ?? "—"} steps)</dt>
              <dd className="font-mono text-ink-muted">{ms(stats.denoise_ms)}</dd>
              <dt className="pl-2 text-ink-faint">KV update</dt>
              <dd className="font-mono text-ink-muted">{ms(stats.kv_update_ms)}</dd>
              <dt className="pl-2 text-ink-faint">VAE decode</dt>
              <dd className="font-mono text-ink-muted">{ms(stats.decode_ms)}</dd>
              <dt className="text-ink-faint">Queue wait</dt>
              <dd className="font-mono text-ink">{ms(stats.queue_wait_ms)}</dd>
              <dt className="text-ink-faint">Peak VRAM</dt>
              <dd className="font-mono text-ink">
                {stats.peak_vram_mb !== undefined ? `${(stats.peak_vram_mb / 1000).toFixed(2)} GB` : "—"}
              </dd>
              <dt className="text-ink-faint">Resolution</dt>
              <dd className="font-mono text-ink">{info ? `${info.width}×${info.height}` : "—"}</dd>
              <dt className="text-ink-faint">Chunk</dt>
              <dd className="font-mono text-ink">
                {info ? `${info.chunk_size} latent · ${info.frames_per_chunk} frames` : "—"}
              </dd>
              <dt className="text-ink-faint">KV window</dt>
              <dd className="font-mono text-ink">
                {info ? `${info.kv_latents} latents · ${info.kv_tokens.toLocaleString()} tokens` : "—"}
              </dd>
              <dt className="text-ink-faint">Position</dt>
              <dd className="font-mono text-ink">
                {stats.latent_pos !== undefined && info ? `${stats.latent_pos} / ${info.max_stream_latents}` : "—"}
                {stats.reanchors ? <span className="text-ink-faint"> · re-anchored ×{stats.reanchors}</span> : null}
              </dd>
              <dt className="text-ink-faint">Camera frames</dt>
              <dd className="font-mono text-ink">
                {stats.cam_kept !== undefined ? `${stats.cam_kept} kept / ${stats.cam_received} received` : "—"}
              </dd>
              <dt className="text-ink-faint">Frames sent</dt>
              <dd className="font-mono text-ink">{stats.frames_sent ?? "—"}</dd>
            </dl>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              Glass to glass is measured on the server: from the capture time of the chunk&apos;s last camera frame to
              the moment its first generated frame is handed to WebRTC. Add roughly 50–100 ms of encode and display
              on top. Below 100% of 16 fps the picture plays as fast as the GPU produces it.
            </p>
          </aside>
        </section>

        <section className="rounded-2xl border border-line bg-panel p-4 text-xs text-ink-muted">
          <h2 className="mb-2 text-sm font-semibold text-ink">Run the server on the PC with the GPU</h2>
          <p className="mb-2">
            The model runs in <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[11px]">tools/realtime-lucy</code>{" "}
            (a modified LingBot-World-V2 causal-fast pipeline; see its README for install and the CC BY-NC-SA 4.0 licence).
            Once it prints <em>engine ready</em>, this page can go live:
          </p>
          <pre className="overflow-x-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[11px] text-ink">
            {`python tools/realtime-lucy/server/server.py --port 8765 --size 288*384 --chunk_size 1 --local_attn_size 9`}
          </pre>
        </section>
      </main>
    </div>
  );
}
