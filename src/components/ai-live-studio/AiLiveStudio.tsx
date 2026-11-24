"use client";

// AI Live Studio — run a photoreal AI host on TikTok LIVE and keep a hand on
// the stream. The stage dominates; the chat sits beside it; one floating dock holds
// every control that matters mid-stream.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronLeft, Mic, Users } from "lucide-react";
import { vsFonts } from "@/components/jarvis/video-swap/fonts";
import { ChatPanel } from "./ChatPanel";
import { ControlDock, StatusCluster } from "./ControlDock";
import { DirectorBooth } from "./DirectorBooth";
import { PersonalityPanel } from "./PersonalityPanel";
import { Stage } from "./Stage";
import { elapsed } from "./bits";
import { useDirector } from "./useDirector";
import { useStudio } from "./useStudio";
import "./ai-live-studio.css";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function AiLiveStudio() {
  const stageRef = useRef<HTMLDivElement>(null);
  const studio = useStudio(stageRef);
  const boothRef = useRef<HTMLElement>(null);
  const director = useDirector(studio, boothRef);
  // On narrower screens the booth slides in over the room; on wide ones it's always there.
  const [boothOpen, setBoothOpen] = useState(false);
  const [panel, setPanel] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [output, setOutput] = useState(false);
  const now = useNow(studio.live);

  // "Stage only": the frame goes full screen with operator chrome hidden —
  // exactly what a window capture sends out to TikTok.
  const fullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => setOutput((o) => !o));
    else setOutput((o) => !o);
  }, []);
  useEffect(() => {
    const onChange = () => setOutput(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!output) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.fullscreenElement && setOutput(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [output]);

  const closePanel = useCallback(() => setPanel(false), []);
  useEffect(() => {
    if (!boothOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setBoothOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [boothOpen]);
  const { live, liveSince, metrics, feed, settings } = studio;

  return (
    <div className={`als ${vsFonts}`} data-live={live ? "true" : "false"}>
      <header className="als-top">
        <Link href="/apps/jarvis" className="als-back">
          <ChevronLeft size={14} aria-hidden="true" />
          Jarvis
        </Link>
        <div className="als-brand">
          <h1 className="als-title" style={{ margin: 0 }}>AI Live Studio</h1>
          <span className="als-sub">{settings.name} · real-time AI host for TikTok LIVE</span>
        </div>
        <div className="als-top-right">
          <button
            className="als-booth-toggle"
            aria-expanded={boothOpen}
            onClick={() => setBoothOpen((o) => !o)}
            data-on={director.on ? "true" : "false"}
            aria-label={`Director booth${director.on ? " — listening" : ""}`}
          >
            <Mic size={13} aria-hidden="true" />
            <span className="als-hide-sm">Director</span>
          </button>
          {live && metrics.viewers !== null && (
            <span className="als-count" title={feed === "demo" ? "Simulated by the demo audience" : "Viewers"}>
              <Users size={13} aria-hidden="true" style={{ verticalAlign: "-2px", marginRight: 5 }} />
              <span className="mono">{metrics.viewers}</span>
              <span className="als-hide-sm">{feed === "demo" ? " demo viewers" : " watching"}</span>
            </span>
          )}
          {live && feed === "demo" && <span className="als-chip-demo">Demo</span>}
          <span className="als-onair" data-live={live} role="status">
            <span className="dot" />
            {live ? (
              <>
                LIVE <span className="mono" style={{ fontWeight: 500, letterSpacing: 0 }}>{elapsed(now - (liveSince ?? now))}</span>
              </>
            ) : (
              "OFF AIR"
            )}
          </span>
        </div>
      </header>

      <div className="als-main">
        <DirectorBooth studio={studio} d={director} boothRef={boothRef} open={boothOpen} onClose={() => setBoothOpen(false)} />
        <section className="als-room" aria-label="Stage">
          {director.ticker.length > 0 && (
            <div className="als-ticker" aria-hidden="true">
              {director.ticker.map((t, i) => (
                <span key={t.id} className="als-tk" data-old={i < director.ticker.length - 1 ? "true" : "false"}>
                  <Check size={11} />
                  {t.text}
                </span>
              ))}
            </div>
          )}
          <StatusCluster studio={studio} />
          <Stage studio={studio} stageRef={stageRef} output={output} />
          <ControlDock studio={studio} onSettings={() => setPanel(true)} onFullscreen={fullscreen} />
        </section>
        <ChatPanel studio={studio} director={director} collapsed={chatCollapsed} onToggle={() => setChatCollapsed((c) => !c)} />

      </div>

      {panel && (
        <>
          <div className="als-scrim" onClick={closePanel} aria-hidden="true" />
          <PersonalityPanel studio={studio} onClose={closePanel} />
        </>
      )}

      {studio.toast && (
        <div className="als-toast als-glass" role="status">
          {studio.toast.text}
        </div>
      )}
    </div>
  );
}
