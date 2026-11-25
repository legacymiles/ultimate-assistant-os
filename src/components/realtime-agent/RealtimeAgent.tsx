"use client";

// Realtime Agent — every agent in one place, and one of them costs money.
//
// The whole screen is organised around that last fact:
//   · the billed agent says so on its own card, before it is ever selected
//   · selecting it opens a confirm gate that quotes a real number
//   · while the pod runs, the meter is the loudest thing on the page AND it
//     stays visible even after switching to a free agent, because a pod you
//     forgot about is exactly how this costs money
//   · Stop is red, always reachable, and never hidden behind a menu
//
// Nothing here re-implements an agent. The 3D face is new-jarvis's AvatarScene
// and both photoreal faces are LiveTalking over WebRTC through the existing
// `LiveTalking` client — the same one AI Live Studio uses, pointed at either
// 127.0.0.1:8010 or the pod's address.

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, MonitorPlay, Radio, RefreshCw, Server, Square, Boxes } from "lucide-react";
import AvatarScene from "@/components/new-jarvis/avatar/AvatarScene";
import { LiveTalking, LIVETALKING_URL } from "@/lib/ai-live-studio/livetalking";
import {
  AGENTS,
  HEALTH_LABEL,
  agentById,
  isTalkable,
  type AgentDef,
  type AgentHealth,
  type AgentId,
} from "@/lib/realtime-agent/agents";
import {
  DEFAULT_IDLE_STOP_MINUTES,
  IDLE_STOP_CHOICES,
  costSoFar,
  formatElapsed,
  formatRate,
  formatUsd,
  minutesUntilAutoStop,
  projectedCost,
} from "@/lib/realtime-agent/cost";
import "./realtime-agent.css";

interface PodState {
  configured: boolean;
  missing: string | null;
  status: string | null;
  billing: boolean;
  pending: boolean;
  ratePerHour: number;
  endpoint: string | null;
  lastActivityAt: number | null;
  idleStopMinutes: number;
  autoStopped?: boolean;
}

const POD_IDLE: PodState = {
  configured: false,
  missing: null,
  status: null,
  billing: false,
  pending: false,
  ratePerHour: 0,
  endpoint: null,
  lastActivityAt: null,
  idleStopMinutes: DEFAULT_IDLE_STOP_MINUTES,
};

const ICONS: Record<AgentId, typeof Boxes> = {
  "3d": Boxes,
  "local-face": MonitorPlay,
  "pod-face": Server,
};

async function podApi(body: unknown): Promise<PodState & { error?: string }> {
  const res = await fetch("/api/realtime-agent/pod", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((json.error as string) ?? "The pod did not answer.");
  return { ...POD_IDLE, ...(json as Partial<PodState>) };
}

/** The WebRTC handshake LiveTalking expects, local or on the pod. */
async function openFace(base: string, video: HTMLVideoElement): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  const stream = new MediaStream();
  pc.ontrack = (e) => {
    stream.addTrack(e.track);
    video.srcObject = stream;
  };
  await pc.setLocalDescription(await pc.createOffer());
  // LiveTalking wants one complete SDP rather than trickled candidates.
  if (pc.iceGatheringState !== "complete") {
    await new Promise<void>((resolve) => {
      const done = () => {
        if (pc.iceGatheringState === "complete") {
          pc.removeEventListener("icegatheringstatechange", done);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", done);
      setTimeout(resolve, 2500);
    });
  }
  const local = pc.localDescription;
  if (!local) throw new Error("The browser produced no offer.");
  const answer = await new LiveTalking(base).offer({ sdp: local.sdp, type: local.type });
  await pc.setRemoteDescription(answer as RTCSessionDescriptionInit);
  return pc;
}

export default function RealtimeAgent() {
  const [selected, setSelected] = useState<AgentId>("3d");
  const [pod, setPod] = useState<PodState>(POD_IDLE);
  const [localUp, setLocalUp] = useState<boolean | null>(null);
  const [faceUp, setFaceUp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState<number>(DEFAULT_IDLE_STOP_MINUTES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reduced, setReduced] = useState(false);
  // React Three Fiber measures its container once, when it mounts, and does
  // not recover if that measurement was taken before layout settled — the
  // canvas then draws nothing until some later reflow. Mounting it two frames
  // late means it measures a box that is already laid out.
  const [canvasReady, setCanvasReady] = useState(false);
  // ...and it does not re-measure when its container later changes size, so a
  // resize after load leaves a blank canvas until some unrelated reflow.
  // Rotating a phone is exactly that. Remounting on a real size change is the
  // only reliable fix, and it is cheap because it only fires on a real change.
  const [canvasKey, setCanvasKey] = useState(0);
  const stage3d = useRef<HTMLDivElement>(null);

  const video = useRef<HTMLVideoElement>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setCanvasReady(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, []);

  useEffect(() => {
    const el = stage3d.current;
    if (!el || !canvasReady) return;
    let last = `${el.clientWidth}x${el.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`;
      if (size !== last && el.clientWidth > 0 && el.clientHeight > 0) {
        last = size;
        setCanvasKey((k) => k + 1);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasReady, selected]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // ---- pod status, polled ------------------------------------------------
  const readPod = useCallback(async () => {
    try {
      const res = await fetch("/api/realtime-agent/pod", { cache: "no-store" });
      const json = (await res.json()) as Partial<PodState>;
      const next = { ...POD_IDLE, ...json };
      setPod(next);
      if (next.billing && startedAt.current === null) startedAt.current = next.lastActivityAt ?? Date.now();
      if (!next.billing) startedAt.current = null;
      if (typeof json.idleStopMinutes === "number") setIdleMinutes(json.idleStopMinutes);
    } catch {
      // A failed poll is not worth a banner; the next one in 15s will say.
    }
  }, []);

  useEffect(() => {
    void readPod();
  }, [readPod]);

  // Poll faster while it is costing money or coming up.
  useEffect(() => {
    const period = pod.billing || pod.pending ? 15_000 : 60_000;
    const t = setInterval(() => void readPod(), period);
    return () => clearInterval(t);
  }, [pod.billing, pod.pending, readPod]);

  // The meter ticks once a second, but only while there is something to tick.
  useEffect(() => {
    if (!pod.billing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pod.billing]);

  // Keepalive while the owner is actually here and the pod is on. If this
  // stops arriving, the server's idle check stops the pod.
  useEffect(() => {
    if (!pod.billing) return;
    const ping = () => {
      if (document.visibilityState === "visible") {
        void podApi({ action: "keepalive", idleStopMinutes: idleMinutes }).catch(() => {});
      }
    };
    ping();
    const t = setInterval(ping, 60_000);
    return () => clearInterval(t);
  }, [pod.billing, idleMinutes]);

  // ---- is local LiveTalking up? -----------------------------------------
  useEffect(() => {
    let alive = true;
    void new LiveTalking(LIVETALKING_URL).reachable().then((up) => alive && setLocalUp(up));
    return () => {
      alive = false;
    };
  }, []);

  // ---- the face stream ---------------------------------------------------
  const closeFace = useCallback(() => {
    peer.current?.close();
    peer.current = null;
    if (video.current) video.current.srcObject = null;
    setFaceUp(false);
  }, []);

  const agent = agentById(selected) as AgentDef;

  const health = useCallback(
    (a: AgentDef): AgentHealth => {
      if (a.id === "3d") return "ready";
      if (a.id === "local-face") return localUp === null ? "starting" : localUp ? "ready" : "offline";
      if (!pod.configured) return "unset";
      if (pod.billing) return pod.pending || !pod.endpoint ? "starting" : "billing";
      return "offline";
    },
    [localUp, pod],
  );

  const faceBase = agent.id === "local-face" ? LIVETALKING_URL : pod.endpoint;

  useEffect(() => {
    if (agent.surface !== "livetalking" || !faceBase || !isTalkable(health(agent))) {
      closeFace();
      return;
    }
    let cancelled = false;
    const el = video.current;
    if (!el) return;
    void openFace(faceBase, el)
      .then((pc) => {
        if (cancelled) {
          pc.close();
          return;
        }
        peer.current = pc;
        setFaceUp(true);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError("That face is reachable but refused the connection. Try again.");
      });
    return () => {
      cancelled = true;
      closeFace();
    };
  }, [agent, faceBase, health, closeFace]);

  useEffect(() => closeFace, [closeFace]);

  // ---- picking an agent --------------------------------------------------
  function pick(id: AgentId) {
    setError(null);
    const a = agentById(id);
    if (!a) return;
    // The gate: only for the billed agent, only when it is not already on, and
    // only when it could actually start. Gating an unconfigured pod would show
    // a confirm dialog quoting $0.00 for a button that can only fail — so that
    // case selects it instead and lets the stage say what is missing.
    if (a.billed && !pod.billing && pod.configured) {
      setConfirming(true);
      return;
    }
    setSelected(id);
  }

  async function startPod() {
    setBusy(true);
    setError(null);
    try {
      const next = await podApi({ action: "start", idleStopMinutes: idleMinutes });
      setPod({ ...next, configured: true });
      startedAt.current = Date.now();
      setConfirming(false);
      setSelected("pod-face");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The pod would not start.");
    } finally {
      setBusy(false);
    }
  }

  async function stopPod() {
    setBusy(true);
    setError(null);
    try {
      closeFace();
      const next = await podApi({ action: "stop" });
      setPod({ ...next, configured: true });
      startedAt.current = null;
      if (selected === "pod-face") setSelected("3d");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The pod would not stop — stop it in RunPod.");
    } finally {
      setBusy(false);
    }
  }

  const since = startedAt.current ?? pod.lastActivityAt ?? now;
  const spent = costSoFar(pod.ratePerHour, since, now);
  const quiet = pod.lastActivityAt ? minutesUntilAutoStop(pod.lastActivityAt, now, idleMinutes) : idleMinutes;

  return (
    <div className="rta">
      <header className="rta-head">
        <h1>Realtime Agent</h1>
        <p>
          Every agent in one place. Switch between them and talk — the 3D face and the one on this PC are free, the
          RunPod one is rented by the hour and asks first.
        </p>
      </header>

      {/* The standout, and only while it is true. */}
      {pod.billing && (
        <section className="rta-meter" data-standout aria-live="polite">
          <div>
            <div className="rta-meter-label">Spent this session</div>
            <div className="rta-meter-figure">{formatUsd(spent)}</div>
          </div>
          <div>
            <div className="rta-meter-label">Running</div>
            <div className="rta-meter-fact">{formatElapsed(since, now)}</div>
          </div>
          <div>
            <div className="rta-meter-label">Rate</div>
            <div className="rta-meter-fact">{formatRate(pod.ratePerHour)}</div>
          </div>
          <div>
            <div className="rta-meter-label">Auto-stop in</div>
            <div className="rta-meter-fact">{quiet}m quiet</div>
          </div>
          <span className="rta-meter-spacer" />
          <button className="rta-btn" data-kind="stop" onClick={() => void stopPod()} disabled={busy}>
            <Square size={13} aria-hidden /> Stop the pod
          </button>
        </section>
      )}

      <nav className="rta-picker" aria-label="Choose an agent">
        {AGENTS.map((a) => {
          const h = health(a);
          const Icon = ICONS[a.id];
          return (
            <button
              key={a.id}
              className="rta-card"
              data-selected={selected === a.id}
              aria-pressed={selected === a.id}
              onClick={() => pick(a.id)}
            >
              <div className="rta-card-top">
                <span className="rta-card-name">
                  <Icon size={14} aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  {a.name}
                </span>
                <span className="rta-state" data-health={h}>
                  <span className="rta-dot" aria-hidden />
                  {HEALTH_LABEL[h]}
                </span>
              </div>
              <span className="rta-card-tag">{a.tag}</span>
              {a.billed && (
                <span className="rta-card-cost">
                  {pod.ratePerHour > 0 ? `${formatRate(pod.ratePerHour)} while running` : "billed by the hour"}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {error && (
        <p className="rta-error" role="alert">
          <CircleAlert size={13} aria-hidden style={{ verticalAlign: "-2px", marginRight: 4 }} />
          {error}
        </p>
      )}

      <section className="rta-stage" data-surface={agent.surface} aria-label={`${agent.name} stage`}>
        {agent.surface === "three" ? (
          <div className="rta-stage-3d" ref={stage3d}>
            {canvasReady && <AvatarScene key={canvasKey} voice={null} variant="hero" reduced={reduced} />}
          </div>
        ) : isTalkable(health(agent)) ? (
          <video ref={video} autoPlay playsInline muted={false} />
        ) : (
          <div className="rta-empty">
            {health(agent) === "unset" ? (
              <>
                <strong>The RunPod agent is not set up yet</strong>
                {pod.missing ?? "Set RUNPOD_API_KEY and RUNPOD_POD_ID in .env.local."} The image and deploy steps are
                in <code>deploy/runpod</code> in the LiveTalking checkout.
              </>
            ) : health(agent) === "starting" ? (
              <>
                <strong>Starting</strong>
                {agent.id === "pod-face"
                  ? "RunPod is bringing the pod up. It usually takes under a minute, and it is already billing."
                  : "Looking for LiveTalking on this PC."}
              </>
            ) : (
              <>
                <strong>{agent.name} is not running</strong>
                {agent.needs}
              </>
            )}
          </div>
        )}
      </section>

      <div className="rta-field">
        <button className="rta-btn" onClick={() => void readPod()} disabled={busy}>
          <RefreshCw size={13} aria-hidden /> Re-check
        </button>
        {faceUp && (
          <span className="rta-state" data-health="ready">
            <span className="rta-dot" aria-hidden />
            <Radio size={12} aria-hidden /> Streaming
          </span>
        )}
      </div>

      {confirming && (
        <div
          className="rta-scrim"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rta-confirm-title"
          onKeyDown={(e) => e.key === "Escape" && setConfirming(false)}
        >
          <div className="rta-dialog">
            <h2 id="rta-confirm-title">Start the RunPod agent? This costs money.</h2>
            <p>
              RunPod bills the GPU by the hour from the moment it starts, not from the moment you talk to it. It keeps
              billing until you stop it.
            </p>
            <div className="rta-quote">
              <div className="rta-quote-row">
                <span>Rate</span>
                <span>{formatRate(pod.ratePerHour)}</span>
              </div>
              <div className="rta-quote-row">
                <span>An hour costs</span>
                <span>{formatUsd(projectedCost(pod.ratePerHour, 60))}</span>
              </div>
              <div className="rta-quote-row">
                <span>If you forget, auto-stop caps it at</span>
                <span>{formatUsd(projectedCost(pod.ratePerHour, idleMinutes))}</span>
              </div>
            </div>
            <div className="rta-field">
              <label htmlFor="rta-idle">Stop it after</label>
              <select
                id="rta-idle"
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(Number(e.target.value))}
              >
                {IDLE_STOP_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {m} minutes quiet
                  </option>
                ))}
              </select>
            </div>
            <p>
              Auto-stop is checked by the server on every status poll, so it fires even if you close this tab — but it
              needs something to ask. If you shut the laptop, stop the pod here or in RunPod.
            </p>
            {pod.ratePerHour === 0 && (
              <p className="rta-error">
                RunPod has not reported a rate for this pod yet, so the figures above read as zero. Check the pod&apos;s
                price in RunPod before starting it.
              </p>
            )}
            {error && (
              <p className="rta-error" role="alert">
                {error}
              </p>
            )}
            <div className="rta-actions">
              <button className="rta-btn" onClick={() => setConfirming(false)} disabled={busy}>
                Not now
              </button>
              <button className="rta-btn" data-kind="primary" onClick={() => void startPod()} disabled={busy}>
                {busy ? "Starting…" : "Start it and bill me"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
