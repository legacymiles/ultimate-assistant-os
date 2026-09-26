"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { connectLucy, fetchHealth, type LucyConnection } from "@/lib/realtime-lucy/client";
import {
  BRIDGE_DOWN,
  LS_BRIDGE,
  LUCY_BRIDGE,
  bridgeBase,
  lastLogLine,
  launcherStatus,
  startEngine,
  stopEngine,
  type LauncherStatus,
} from "@/lib/realtime-lucy/launcher";
import { createSegmenter, type Segmenter } from "@/lib/realtime-lucy/segmenter";
import {
  DEFAULT_SERVER_URL,
  MODEL_FPS,
  PROMPT_PRESETS,
  STRENGTHS,
  type CondMode,
  type Health,
  type MaskTarget,
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
  const [promptBusy, setPromptBusy] = useState(false);
  const [maskTarget, setMaskTarget] = useState<MaskTarget>("background");
  const [maskState, setMaskState] = useState<"off" | "loading" | "on" | "error">("off");
  const [maskError, setMaskError] = useState("");
  const [maskCoverage, setMaskCoverage] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // The one button: the launcher on the PC with the GPU, as this page sees it.
  const [launcher, setLauncher] = useState<LauncherStatus | null>(null);
  const [bridgeDown, setBridgeDown] = useState(false);
  const [booting, setBooting] = useState(false);
  const [bootNote, setBootNote] = useState("");
  const [bridgeUrl, setBridgeUrl] = useState(LUCY_BRIDGE);

  const camRef = useRef<HTMLVideoElement>(null);
  const outRef = useRef<HTMLVideoElement>(null);
  const cameraStream = useRef<MediaStream | null>(null);
  const conn = useRef<LucyConnection | null>(null);
  const heldRef = useRef<Set<string>>(new Set());
  // Read inside the segmentation loop so flipping the target does not tear
  // the segmenter down and reload the model.
  const maskTargetRef = useRef<MaskTarget>("background");
  maskTargetRef.current = maskTarget;

  useEffect(() => {
    setServerUrl(readLS(LS_URL, DEFAULT_SERVER_URL));
    setToken(readLS(LS_TOKEN, ""));
    setBridgeUrl(bridgeBase());
  }, []);

  // Poll the server's /health while not streaming so the status dot is honest.
  const checkHealth = useCallback(async () => {
    try {
      const h = await fetchHealth(serverUrl, token || undefined);
      setHealth(h);
      setHealthError("");
      return h;
    } catch (err) {
      setHealth(null);
      setHealthError((err as Error).message);
      return null;
    }
  }, [serverUrl, token]);

  // With the engine down, ask the launcher instead: it knows whether it is
  // starting, whether the install is even there, and why the last start died.
  const checkLauncher = useCallback(async () => {
    try {
      const s = await launcherStatus();
      setLauncher(s);
      setBridgeDown(false);
      return s;
    } catch {
      setLauncher(null);
      setBridgeDown(true);
      return null;
    }
  }, []);

  useEffect(() => {
    const poll = async () => {
      const h = await checkHealth();
      if (!h?.ready) await checkLauncher();
    };
    void poll();
    const id = setInterval(() => {
      if (phase !== "streaming") void poll();
    }, 5000);
    return () => clearInterval(id);
  }, [checkHealth, checkLauncher, phase]);

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
        setPromptBusy(false);
      } else if (msg.state === "opening" || msg.state === "prompt") {
        // A prompt the T5 has not seen before takes ~50 s to encode, and the
        // GPU loop is blocked for all of it. Without this the picture just
        // freezes while the caption still reads "live".
        if (msg.state === "prompt") setPromptBusy(true);
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
    setPromptBusy(false);
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

  // One press, the whole way: start the engine on the PC with the GPU, wait for
  // the model to land on the card, then turn the camera on and go live. Before
  // this the page could only ever say "run this command", which is why it read
  // as broken — the client was fine, nothing was generating.
  const boot = useCallback(async () => {
    setError("");
    setBooting(true);
    setBootNote("checking the engine on this PC…");
    try {
      let h = await checkHealth();
      if (!h) {
        setBootNote("starting the engine — this loads the model onto the card");
        await startEngine();
      }
      // The Python process answers /health within a second or two; the model
      // itself takes 20–30 s more, and a cold first prompt about a minute.
      const deadline = Date.now() + 5 * 60_000;
      while (!h?.ready && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        h = await checkHealth();
        if (h?.error) throw new Error(h.error);
        if (h) {
          setBootNote("streaming the DiT, the VAE and the T5 onto the card…");
        } else {
          // A start that died (no venv, out of memory, a bad flag) must surface
          // as an error here instead of spinning for five minutes.
          const s = await checkLauncher();
          if (s?.exited) {
            throw new Error(
              s.exited.message || lastLogLine(s.log) || `the engine stopped (exit code ${s.exited.code})`,
            );
          }
          setBootNote("waiting for the engine to answer…");
        }
      }
      if (!h?.ready) throw new Error("the engine did not come up within five minutes — see tools/studio-bridge/out/lucy.log");
      setBootNote("going live…");
      await connect();
    } catch (err) {
      const message = (err as Error).message;
      setError(
        message === BRIDGE_DOWN
          ? "Can't reach the launcher on this PC. It runs the GPU server for this page; start it once with tools\\studio-bridge\\install-autostart.cmd and it will be there at every login."
          : message,
      );
    } finally {
      setBooting(false);
      setBootNote("");
    }
  }, [checkHealth, checkLauncher, connect]);

  // Handing the card back matters on a 6 GB laptop: the model holds ~5.2 GB for
  // as long as it is loaded, whether or not anything is streaming.
  const shutdownEngine = useCallback(async () => {
    disconnect();
    setError("");
    setBooting(true);
    setBootNote("stopping the engine…");
    try {
      await stopEngine();
      await checkHealth();
      await checkLauncher();
    } catch (err) {
      const message = (err as Error).message;
      setError(message === BRIDGE_DOWN ? "Can't reach the launcher on this PC." : message);
    } finally {
      setBooting(false);
      setBootNote("");
    }
  }, [checkHealth, checkLauncher, disconnect]);

  // Live controls.
  const applyPrompt = (override?: string) => {
    const text = (override ?? prompt).trim();
    if (!text || !conn.current) return;
    conn.current.send({ type: "prompt", text });
    setLivePrompt(text);
  };
  // Picking a preset mid-stream should change the picture, not just the textarea.
  const choosePreset = (p: string) => {
    setPrompt(p);
    applyPrompt(p);
  };
  const chooseStrength = (v: Strength) => {
    setStrength(v);
    conn.current?.send({ type: "strength", value: v });
  };
  const chooseCond = (v: CondMode) => {
    setCondMode(v);
    conn.current?.send({ type: "cond_mode", value: v });
  };
  // Switching between background and subject only changes the mask, so it must
  // not go through chooseCond — a cond_mode change re-anchors the stream and
  // would throw away the model's memory for nothing.
  const chooseRegion = (region: "whole" | MaskTarget) => {
    if (region === "whole") {
      if (condMode === "masked") chooseCond("sdedit");
      return;
    }
    setMaskTarget(region);
    if (condMode !== "masked") chooseCond("masked");
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

  // Person-vs-background masking for cond_mode "masked". One mask per
  // generated chunk (4 Hz) is plenty — the server holds the last one and the
  // GPU is producing about one frame a second anyway.
  useEffect(() => {
    if (condMode !== "masked" || phase !== "streaming") {
      setMaskState("off");
      setMaskCoverage(null);
      return;
    }
    let cancelled = false;
    let seg: Segmenter | null = null;
    let timer: number | undefined;
    setMaskState("loading");
    setMaskError("");
    createSegmenter()
      .then((s) => {
        if (cancelled) {
          s.close();
          return;
        }
        seg = s;
        setMaskState("on");
        timer = window.setInterval(() => {
          if (!seg || !camRef.current) return;
          const frame = seg.run(camRef.current, maskTargetRef.current, performance.now());
          if (!frame) return;
          setMaskCoverage(frame.coverage);
          conn.current?.send({ type: "mask", w: frame.w, h: frame.h, data: frame.data });
        }, 250);
      })
      .catch((err) => {
        if (cancelled) return;
        // No segmenter means no region lock — clear the server's mask so the
        // stream keeps running as plain SDEdit instead of freezing behind a
        // stale region.
        setMaskState("error");
        setMaskError((err as Error).message);
        conn.current?.send({ type: "mask", w: 0, h: 0, data: null });
      });
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      seg?.close();
    };
  }, [condMode, phase]);

  const online = !!health?.ok;
  const ready = !!health?.ready;
  const streaming = phase === "streaming";
  const busy = phase === "connecting" || phase === "opening";
  // Starting counts whether this tab pressed the button or another one did.
  const starting = booting || (!online && !!launcher?.starting);
  const notInstalled = !!launcher && !launcher.installed;
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
          <span
            className="rl-dot"
            data-on={online ? (ready ? "true" : "warn") : starting ? "warn" : "false"}
            aria-hidden
          />
          {online
            ? ready
              ? `Lucy server online · ${health?.gpu ?? "GPU"} · ${health?.model ?? ""}`
              : health?.error
                ? `Lucy server: model failed to load`
                : "Lucy server online · model loading…"
            : starting
              ? "Starting the engine on this PC…"
              : bridgeDown
                ? "Engine offline · launcher unreachable"
                : "Engine offline · press Start Lucy"}
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
              <span
                className="rl-dot"
                data-on={streaming ? (promptBusy ? "warn" : "true") : busy ? "warn" : "false"}
                aria-hidden
              />
              {streaming
                ? promptBusy
                  ? "Encoding the new prompt — the picture holds until it lands"
                  : "Generated · live"
                : busy
                  ? statusText || "starting…"
                  : "Generated"}
            </figcaption>
            <div className="aspect-[4/3]">
              <video ref={outRef} muted playsInline autoPlay />
            </div>
            {!streaming && !busy && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-8 text-center">
                <p className="text-sm font-semibold text-ink">
                  {starting
                    ? bootNote || "Starting the engine…"
                    : !online
                      ? notInstalled
                        ? "The model isn't installed on this PC yet"
                        : bridgeDown
                          ? "Can't reach the launcher on this PC"
                          : "Engine off — press Start Lucy"
                      : !ready
                        ? "Model loading on the GPU…"
                        : "Server ready — press Go live"}
                </p>
                <p className="max-w-sm text-[11px] leading-relaxed text-ink-faint">
                  {starting
                    ? "The server is coming up on the GPU. Loading the 1.3B DiT, the VAE and the T5 takes 20–30 seconds; the stream starts by itself the moment it is ready."
                    : !online
                      ? notInstalled
                        ? "The Python environment and the weights live outside this repo and aren't there yet. tools/realtime-lucy/README.md has the one-time install."
                        : bridgeDown
                          ? "This page is only the WebRTC client; something on the PC has to run the model. That is the studio bridge, and it isn't answering — start it once with install-autostart.cmd (see below) and it will be there at every login."
                          : "This page is only the client — nothing generates until the model is running on the GPU. Start Lucy does the whole thing: start the engine, wait for it, and go live."
                      : !ready
                        ? "The 1.3B DiT, the VAE and the T5 are being streamed onto the card. This takes 20–30 seconds; the first uncached prompt adds about a minute more."
                        : "Every frame here will be generated by the model. The prompt only takes effect once the stream is live — editing it before then changes nothing."}
                </p>
              </div>
            )}
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
                Prompt{" "}
                {streaming ? (
                  livePrompt !== prompt.trim() && (
                    <span className="text-accent">· edited, not applied — press Enter</span>
                  )
                ) : (
                  <span className="text-ink-faint">· takes effect when the stream starts</span>
                )}
              </label>
              <textarea
                id="rl-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  // Enter applies it to the live stream; Shift+Enter is a newline.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    applyPrompt();
                  }
                }}
                rows={2}
                className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60 focus:ring-2 focus:ring-brand/20"
              />
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_PRESETS.map((p, i) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => choosePreset(p)}
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

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-ink-muted">Which part of the frame the prompt may repaint</p>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["whole", "Whole frame"],
                    ["background", "Background only"],
                    ["subject", "Me only"],
                  ] as [("whole" | MaskTarget), string][]
                ).map(([v, label]) => {
                  const active = v === "whole" ? condMode !== "masked" : condMode === "masked" && maskTarget === v;
                  return (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={active}
                      onClick={() => chooseRegion(v)}
                      className={`rounded-full border px-3 py-1 text-xs transition ${
                        active ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px] text-ink-faint">
                {condMode !== "masked"
                  ? "Every pixel is the model's to re-imagine."
                  : maskState === "loading"
                    ? "Loading the segmenter…"
                    : maskState === "error"
                      ? `Segmenter unavailable (${maskError}) — running unmasked.`
                      : maskState === "on"
                        ? `Outside the region the camera's own latents are pinned at every denoising step, so it comes back untouched.${
                            maskCoverage !== null ? ` Repainting ${Math.round(maskCoverage * 100)}% of the frame.` : ""
                          }`
                        : "Go live to start segmenting."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {!streaming && !busy ? (
                <button
                  type="button"
                  onClick={() => (ready ? void connect() : void boot())}
                  disabled={starting || notInstalled}
                  className="rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_-10px] shadow-brand transition hover:brightness-110 disabled:opacity-50"
                >
                  {starting ? "Starting…" : ready ? "Go live" : "Start Lucy"}
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
                    onClick={() => applyPrompt()}
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
              {online && !streaming && !busy && !starting && (
                <button
                  type="button"
                  onClick={() => void shutdownEngine()}
                  title="Unload the model and hand the VRAM back to the rest of the PC"
                  className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
                >
                  Stop the engine
                </button>
              )}
              <span className="text-xs text-ink-faint">
                {starting
                  ? bootNote || "Starting the engine on the GPU…"
                  : !online
                    ? notInstalled
                      ? "Not installed on this PC yet — see tools/realtime-lucy/README.md."
                      : bridgeDown
                        ? "The launcher on this PC isn't answering (see below)."
                        : "Start Lucy starts the engine on this PC and goes live by itself."
                    : streaming
                    ? promptBusy
                      ? "A prompt the model has not seen before is run through the T5 once — about 50 s on this GPU, then it is cached on disk and instant forever after."
                      : "Hold W A S D or the arrow keys to move the model's camera."
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
                  Launcher (the PC that starts the engine)
                  <input
                    value={bridgeUrl}
                    onChange={(e) => setBridgeUrl(e.target.value)}
                    onBlur={() => {
                      try {
                        const v = bridgeUrl.trim().replace(/\/+$/, "");
                        if (v) localStorage.setItem(LS_BRIDGE, v);
                        else localStorage.removeItem(LS_BRIDGE);
                      } catch {
                        /* private mode */
                      }
                      void checkLauncher();
                    }}
                    placeholder={LUCY_BRIDGE}
                    className="rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none focus:border-brand/60"
                  />
                  <span className="text-[10px] text-ink-faint">
                    The studio bridge on the PC with the GPU. Start Lucy asks this to run the engine.
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
                        ["masked", "Masked (SDEdit + region lock)"],
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
              <dt className="text-ink-faint">Region locked</dt>
              <dd className="font-mono text-ink">
                {info?.cond_mode === "masked" && stats.mask_coverage != null
                  ? `${Math.round((1 - stats.mask_coverage) * 100)}% held`
                  : "—"}
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
          <h2 className="mb-2 text-sm font-semibold text-ink">What the button does, and what to do if it can&apos;t</h2>
          <p className="mb-2">
            <strong className="text-ink">Start Lucy</strong> asks the studio bridge — the small server already running
            on this PC for Jarvis Studio — to start{" "}
            <code className="rounded bg-canvas px-1 py-0.5 font-mono text-[11px]">tools/realtime-lucy</code> on the GPU,
            waits for the model to land on the card, and goes live by itself. The engine is not started at login on
            purpose: it holds about 5.2 GB of VRAM the whole time it is loaded, so{" "}
            <strong className="text-ink">Stop the engine</strong> gives the card back.
          </p>
          <p className="mb-2">
            {bridgeDown
              ? "The bridge is not answering right now, which is why the button can't do it. Run this once — it starts it now and at every login:"
              : "If the bridge is ever not running, this installs and starts it — once, then at every login:"}
          </p>
          <pre className="overflow-x-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[11px] text-ink">
            {`tools\\studio-bridge\\install-autostart.cmd`}
          </pre>
          {launcher?.log && !ready && (
            <>
              <p className="mt-2">Last lines from the engine&apos;s own log ({`tools/studio-bridge/out/lucy.log`}):</p>
              <pre className="mt-1 max-h-32 overflow-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[10px] leading-relaxed text-ink-muted">
                {launcher.log.trim()}
              </pre>
            </>
          )}
          <p className="mt-3">
            To start it by hand instead (a window you can watch, on this PC or a bigger GPU box):
          </p>
          <pre className="mt-1 overflow-x-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[11px] text-ink">
            {`powershell -File tools/realtime-lucy/start.ps1`}
          </pre>
          <p className="mt-2">
            That script picks the resolution your card can actually hold — the same one the button uses. Size matters
            more than anything else here: on a 6 GB laptop GPU the 384×288 config allocates ~7.2 GB, the driver spills
            it into system RAM and one chunk takes <strong>21 seconds</strong> instead of 2.6 — which looks exactly like
            &ldquo;the prompt does nothing&rdquo;. To choose by hand:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-canvas p-3 font-mono text-[11px] text-ink">
            {`# 6 GB card (fits: ~5.2 GB, ~1.6 gen fps on an RTX 3050)
python tools/realtime-lucy/server/server.py --port 8765 --size 192*256 --chunk_size 1 --local_attn_size 6 --sink_size 2

# 12 GB card and up
python tools/realtime-lucy/server/server.py --port 8765 --size 288*384 --chunk_size 1 --local_attn_size 9 --sink_size 3`}
          </pre>
        </section>
      </main>
    </div>
  );
}
