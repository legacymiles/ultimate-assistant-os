"use client";
// All DOM chrome over the canvas. Live gameplay values (timer, tension, balance,
// toasts) are updated from a private rAF loop reading signals.ts, so nothing here
// re-renders at frame rate. Phase screens (menu/won/lost/paused) are plain React.

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { useGame } from "@/lib/slippery/store";
import { hud } from "@/lib/slippery/signals";

const mono = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace";
const fmt = (t: number) => t.toFixed(2) + "s";

function LiveHud() {
  const timer = useRef<HTMLSpanElement>(null);
  const speed = useRef<HTMLSpanElement>(null);
  const bal = useRef<HTMLDivElement>(null);
  const tension = useRef<HTMLDivElement>(null);
  const toast = useRef<HTMLDivElement>(null);
  const dist = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (timer.current) timer.current.textContent = fmt(hud.timer);
      if (speed.current) speed.current.textContent = hud.speed.toFixed(1);
      if (dist.current) dist.current.textContent = hud.oppDist.toFixed(1) + "m";
      if (bal.current) {
        bal.current.style.width = `${Math.min(1, hud.balance) * 100}%`;
        bal.current.style.background =
          hud.balance > 0.8 ? "#ff4d4d" : hud.balance > 0.55 ? "#ffb04d" : "#4dd2ff";
      }
      if (tension.current) tension.current.style.opacity = String(hud.tension * 0.55);
      if (toast.current) {
        const now = performance.now();
        if (hud.event && now < hud.eventUntil) {
          toast.current.textContent = hud.event;
          toast.current.style.opacity = "1";
          toast.current.style.transform = "translate(-50%,0) scale(1)";
        } else {
          toast.current.style.opacity = "0";
          toast.current.style.transform = "translate(-50%,0) scale(0.9)";
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <>
      {/* danger vignette */}
      <div
        ref={tension}
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          opacity: 0,
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(180,0,0,0.9) 100%)",
        }}
      />
      {/* crosshair */}
      <div
        style={{
          position: "fixed",
          left: "50%",
          top: "50%",
          width: 6,
          height: 6,
          marginLeft: -3,
          marginTop: -3,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.75)",
          boxShadow: "0 0 4px rgba(0,0,0,0.8)",
        }}
      />
      {/* top-left readouts */}
      <div style={{ position: "fixed", top: 18, left: 20, fontFamily: mono, color: "#eaf1ff" }}>
        <Stat label="TIME" node={<span ref={timer}>0.00s</span>} />
        <Stat label="SPEED" node={<span ref={speed}>0.0</span>} unit=" m/s" />
        <Stat label="OPPONENT" node={<span ref={dist}>—</span>} />
      </div>
      {/* round + score top-right */}
      <TopRight />
      {/* balance meter bottom-center */}
      <div
        style={{
          position: "fixed",
          bottom: 34,
          left: "50%",
          transform: "translateX(-50%)",
          width: 260,
          textAlign: "center",
          fontFamily: mono,
          color: "#9fb2c4",
          fontSize: 10,
          letterSpacing: "0.25em",
        }}
      >
        BALANCE
        <div
          style={{
            marginTop: 5,
            height: 6,
            width: "100%",
            borderRadius: 6,
            background: "rgba(255,255,255,0.12)",
            overflow: "hidden",
          }}
        >
          <div ref={bal} style={{ height: "100%", width: "0%", background: "#4dd2ff", transition: "background 0.15s" }} />
        </div>
      </div>
      {/* transient toast */}
      <div
        ref={toast}
        style={{
          position: "fixed",
          left: "50%",
          top: "30%",
          transform: "translate(-50%,0) scale(0.9)",
          fontFamily: mono,
          fontWeight: 700,
          fontSize: 34,
          letterSpacing: "0.06em",
          color: "#fff",
          textShadow: "0 2px 18px rgba(0,0,0,0.8)",
          opacity: 0,
          transition: "opacity 0.15s, transform 0.15s",
          pointerEvents: "none",
        }}
      />
    </>
  );
}

function Stat({ label, node, unit }: { label: string; node: ReactNode; unit?: string }) {
  return (
    <div style={{ marginBottom: 4, fontSize: 12 }}>
      <span style={{ color: "#5f7183", letterSpacing: "0.2em", fontSize: 10 }}>{label} </span>
      <span style={{ fontWeight: 600 }}>{node}</span>
      {unit && <span style={{ color: "#5f7183" }}>{unit}</span>}
    </div>
  );
}

function TopRight() {
  const round = useGame((s) => s.round);
  const score = useGame((s) => s.score);
  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 20,
        textAlign: "right",
        fontFamily: mono,
        color: "#eaf1ff",
      }}
    >
      <div style={{ fontSize: 12 }}>
        <span style={{ color: "#5f7183", letterSpacing: "0.2em", fontSize: 10 }}>ROUND </span>
        <span style={{ fontWeight: 700 }}>{round}</span>
      </div>
      <div style={{ fontSize: 12 }}>
        <span style={{ color: "#5f7183", letterSpacing: "0.2em", fontSize: 10 }}>SCORE </span>
        <span style={{ fontWeight: 700, color: "#ffd27a" }}>{score.toLocaleString()}</span>
      </div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "auto",
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(ellipse at center, rgba(6,8,12,0.55), rgba(6,8,12,0.9))",
        fontFamily: mono,
        color: "#eaf1ff",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 620, padding: 24 }}>{children}</div>
    </div>
  );
}

const btn: CSSProperties = {
  marginTop: 22,
  padding: "14px 34px",
  fontFamily: mono,
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: "0.18em",
  color: "#06121a",
  background: "linear-gradient(180deg,#7fe9ff,#39c0ff)",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  boxShadow: "0 8px 30px rgba(57,192,255,0.4)",
};

export function HUD({
  onPlay,
  onNext,
  onRetry,
  locked,
}: {
  onPlay: () => void;
  onNext: () => void;
  onRetry: () => void;
  locked: boolean;
}) {
  const phase = useGame((s) => s.phase);
  const lastRun = useGame((s) => s.lastRun);
  const lastStats = useGame((s) => s.lastStats);
  const bestTime = useGame((s) => s.bestTime);

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", userSelect: "none" }}>
      {phase === "playing" && <LiveHud />}

      {/* non-blocking hint: the game is already running, this just captures the mouse */}
      {phase === "playing" && !locked && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: "58%",
            transform: "translateX(-50%)",
            padding: "10px 18px",
            borderRadius: 10,
            background: "rgba(6,10,16,0.72)",
            border: "1px solid rgba(127,233,255,0.3)",
            fontFamily: mono,
            fontSize: 13,
            color: "#cfe6ff",
            letterSpacing: "0.06em",
            pointerEvents: "none",
          }}
        >
          🖱 Click to capture mouse-look · <b style={{ color: "#fff" }}>WASD</b> already works
        </div>
      )}

      {phase === "menu" && (
        <Panel>
          <div style={{ color: "#39c0ff", letterSpacing: "0.4em", fontSize: 11, marginBottom: 10 }}>
            FIRST-PERSON · PHYSICS ESCAPE
          </div>
          <h1 style={{ fontSize: 54, margin: 0, letterSpacing: "0.02em", textShadow: "0 4px 30px rgba(0,0,0,0.7)" }}>
            SLIPPERY ESCAPE
          </h1>
          <p style={{ color: "#9fb2c4", fontSize: 14, lineHeight: 1.6, marginTop: 14 }}>
            The floor is drenched in baby oil and a glistening bruiser is blocking the only door.
            Build momentum, fake him out, and slide to the <span style={{ color: "#39ff9a" }}>EXIT</span> —
            without wiping out.
          </p>
          <div style={{ marginTop: 16, color: "#6f8296", fontSize: 12, lineHeight: 1.9 }}>
            <b style={{ color: "#c7d4e2" }}>WASD</b> move · <b style={{ color: "#c7d4e2" }}>Mouse</b> look ·{" "}
            <b style={{ color: "#c7d4e2" }}>Shift</b> sprint · <b style={{ color: "#c7d4e2" }}>Space</b> slide
          </div>
          <button style={btn} onClick={onPlay}>
            CLICK TO ESCAPE
          </button>
        </Panel>
      )}

      {phase === "won" && lastRun && (
        <Panel>
          <div style={{ color: "#39ff9a", letterSpacing: "0.4em", fontSize: 12 }}>YOU MADE IT OUT</div>
          <h1 style={{ fontSize: 52, margin: "6px 0 0", color: "#39ff9a" }}>ESCAPED!</h1>
          <div style={{ fontSize: 40, fontWeight: 800, color: "#ffd27a", marginTop: 8 }}>
            +{lastRun.score.toLocaleString()}
          </div>
          <div style={{ color: "#9fb2c4", fontSize: 13, marginTop: 12, lineHeight: 1.9 }}>
            Time <b style={{ color: "#eaf1ff" }}>{fmt(lastRun.stats.time)}</b>
            {lastRun.newBestTime && <span style={{ color: "#39ff9a" }}> · NEW BEST</span>} · Falls{" "}
            <b style={{ color: "#eaf1ff" }}>{lastRun.stats.falls}</b> · Jukes{" "}
            <b style={{ color: "#eaf1ff" }}>{lastRun.stats.jukes}</b>
            <br />
            Closest call <b style={{ color: "#eaf1ff" }}>{lastRun.stats.closest.toFixed(1)}m</b>
            {lastRun.stats.falls === 0 && <span style={{ color: "#39ff9a" }}> · CLEAN RUN ×1.75</span>}
          </div>
          <button style={btn} onClick={onNext}>
            NEXT ROUND →
          </button>
        </Panel>
      )}

      {phase === "lost" && (
        <Panel>
          <div style={{ color: "#ff6b6b", letterSpacing: "0.4em", fontSize: 12 }}>HE GOT YOU</div>
          <h1 style={{ fontSize: 52, margin: "6px 0 0", color: "#ff6b6b" }}>GOTCHA!</h1>
          <p style={{ color: "#9fb2c4", fontSize: 14, marginTop: 12 }}>
            {lastStats && lastStats.closest < 3
              ? "So close. The door was right there."
              : "Read his lean — cut the other way and let him slide past."}
          </p>
          {lastStats && (
            <div style={{ color: "#6f8296", fontSize: 12, marginTop: 6 }}>
              Survived {fmt(lastStats.time)} · {lastStats.falls} falls
              {bestTime !== null && ` · best escape ${fmt(bestTime)}`}
            </div>
          )}
          <button style={{ ...btn, background: "linear-gradient(180deg,#ff9a9a,#ff5b5b)", boxShadow: "0 8px 30px rgba(255,91,91,0.4)" }} onClick={onRetry}>
            RETRY (R)
          </button>
        </Panel>
      )}
    </div>
  );
}
