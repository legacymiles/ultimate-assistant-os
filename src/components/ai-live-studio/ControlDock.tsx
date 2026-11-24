"use client";

// The floating control bar and the technical readouts.
//
// Go live / End live is the one primary action, and it changes colour only
// when it means "you are on air". Mute and Pause are the kill switches: one
// press each, visibly different. Readouts are stat tiles — a status is always
// an icon AND a word, never a colour alone (dataviz).

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity, AudioLines, CheckCircle2, CircleAlert, CircleDashed, Expand, Gauge, Pause, Play, Radio, RefreshCw, Settings2,
  Timer, UserRound, Users, Volume2, VolumeX, Wifi,
} from "lucide-react";
import { VOICES } from "@/lib/voice-settings/voices";
import { SAMPLE_AVATAR, type Studio } from "./useStudio";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

function Menu({ label, icon, children, wide }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(open, close);
  return (
    <div className="als-menu-anchor" ref={ref}>
      <button className="als-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={label}>
        {icon}
        <span className="lbl">{label}</span>
      </button>
      {open && (
        <div className="als-menu als-glass" role="group" aria-label={label} style={wide ? { width: 340 } : undefined}>
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** How long "End live" stays armed after the first press. */
const END_CONFIRM_MS = 3000;

export function ControlDock({ studio, onSettings, onFullscreen }: { studio: Studio; onSettings: () => void; onFullscreen: () => void }) {
  const { live, muted, paused, settings, update, ltState, useLive, setUseLive, reconnectLiveTalking, previewVoice } = studio;
  // Ending a stream is the one press that can't be quietly taken back mid-show,
  // so it takes two: the first arms it, the second (within 3 s) ends it.
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), END_CONFIRM_MS);
    return () => clearTimeout(t);
  }, [arming]);
  useEffect(() => {
    if (!live) setArming(false);
  }, [live]);

  const onPrimary = () => {
    if (!live) return studio.goLive();
    if (!arming) return setArming(true);
    setArming(false);
    studio.endLive();
  };

  return (
    <div className="als-dock als-glass" role="toolbar" aria-label="Stream controls">
      <button className="als-golive" data-live={live} data-arming={arming} onClick={onPrimary} aria-live="polite">
        <Radio size={16} aria-hidden="true" />
        {!live ? "Go live" : arming ? "Press again to end" : "End live"}
      </button>
      <span className="als-sep" />
      <button className="als-btn" aria-pressed={muted} onClick={studio.toggleMute} aria-label={muted ? "Unmute voice" : "Mute voice"}>
        {muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
        <span className="lbl">{muted ? "Muted" : "Mute"}</span>
      </button>
      <button
        className="als-btn"
        data-tone="warn"
        aria-pressed={paused}
        onClick={studio.togglePause}
        aria-label={paused ? "Resume AI" : live ? "Pause AI" : "Start with the AI paused"}
        title={live ? undefined : "Go live with the AI paused, so you can set up first"}
      >
        {paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}
        <span className="lbl">{paused ? "Resume AI" : "Pause AI"}</span>
      </button>
      <span className="als-sep" />

      <Menu label={settings.voice} icon={<AudioLines size={17} aria-hidden="true" />} wide>
        {(close) => (
          <>
            {/* Offered only off air — while live, any sound would go out on stream. */}
            {!live && (
              <button className="als-opt" onClick={() => void previewVoice()}>
                <Play size={15} aria-hidden="true" style={{ marginTop: 2 }} />
                <span>
                  <span className="t">Hear {settings.voice}</span>
                  <span className="d">Plays a sample line here. Nothing goes out on stream.</span>
                </span>
              </button>
            )}
            <h4>Voice</h4>
            {VOICES.map((v) => (
              <button
                key={v.name}
                className="als-opt"
               
                aria-pressed={v.name === settings.voice}
                onClick={() => {
                  update({ voice: v.name });
                  close();
                }}
              >
                <span>
                  <span className="t">{v.name}</span>
                  <span className="d">{v.description}</span>
                </span>
              </button>
            ))}
          </>
        )}
      </Menu>

      <Menu label="Avatar" icon={<UserRound size={17} aria-hidden="true" />}>
        {(close) => (
          <>
            <h4>Face</h4>
            <button
              className="als-opt"
             
              aria-pressed={useLive}
              onClick={() => {
                setUseLive(true);
                if (ltState !== "online") void reconnectLiveTalking();
                close();
              }}
            >
              <Wifi size={15} aria-hidden="true" style={{ marginTop: 2 }} />
              <span>
                <span className="t">LiveTalking — live lip sync</span>
                <span className="d">
                  {settings.avatarId === SAMPLE_AVATAR
                    ? `Uses LiveTalking’s sample face, not ${settings.name}, until ${settings.name}’s own avatar is built. Good for testing lip sync.`
                    : ltState === "online"
                      ? `Connected · avatar ${settings.avatarId}`
                      : ltState === "available"
                        ? "Running on this PC. Pick this to use it."
                        : ltState === "checking"
                          ? "Checking…"
                          : "Not running on this PC. Start it, then pick this again."}
                </span>
              </span>
            </button>
            <button
              className="als-opt"
             
              aria-pressed={!useLive}
              onClick={() => {
                setUseLive(false);
                close();
              }}
            >
              <UserRound size={15} aria-hidden="true" style={{ marginTop: 2 }} />
              <span>
                <span className="t">{settings.name}&rsquo;s portrait</span>
                <span className="d">Breathing, and lit by the voice as it speaks. No lip sync yet.</span>
              </span>
            </button>
            {useLive && ltState === "offline" && (
              <button className="als-opt" onClick={() => void reconnectLiveTalking()}>
                <RefreshCw size={15} aria-hidden="true" style={{ marginTop: 2 }} />
                <span className="t">Try LiveTalking again</span>
              </button>
            )}
          </>
        )}
      </Menu>

      <span className="als-sep" />
      <button className="als-btn" onClick={onSettings} aria-label="Personality and settings">
        <Settings2 size={17} aria-hidden="true" />
        <span className="lbl">Personality</span>
      </button>
      <button className="als-btn icon" onClick={onFullscreen} aria-label="Stage only, full screen (what goes out on stream)" title="Stage only — what goes out on stream">
        <Expand size={17} aria-hidden="true" />
      </button>
    </div>
  );
}

type Tone = "good" | "warn" | "crit" | "idle";
const ICON: Record<Tone, ReactNode> = {
  good: <CheckCircle2 size={13} aria-hidden="true" />,
  warn: <CircleAlert size={13} aria-hidden="true" />,
  crit: <CircleAlert size={13} aria-hidden="true" />,
  idle: <CircleDashed size={13} aria-hidden="true" />,
};

function Stat({ tone, icon, label, value, keep }: { tone: Tone; icon?: ReactNode; label: string; value: string; keep?: boolean }) {
  return (
    <span className="als-stat" data-tone={tone} data-keep={keep ? "" : undefined} title={`${label}: ${value}`}>
      {icon ?? ICON[tone]}
      <span className="sr">{label}: </span>
      <b>{value}</b>
    </span>
  );
}

export function StatusCluster({ studio }: { studio: Studio }) {
  const { metrics, feed, feedState, ltState, voiceMode, live, source, useLive } = studio;

  const feedStat: [Tone, string] =
    feed === "demo"
      ? [live ? "good" : "idle", "Demo audience"]
      : feedState === "connected"
        ? ["good", "TikTok connected"]
        : feedState === "connecting"
          ? ["warn", "TikTok connecting"]
          : feedState === "unreachable"
            ? ["crit", "TikTok relay off"]
            : ["idle", "TikTok"];

  const face: [Tone, string] =
    source === "livetalking" ? ["good", "LiveTalking"] : useLive && ltState === "checking" ? ["warn", "Face connecting"] : ["idle", "Photo preview"];

  const voice: [Tone, string] =
    voiceMode === "phonon" ? ["good", "Phonon voice"] : voiceMode === "fish-audio" ? ["good", "Fish voice"] : voiceMode === "self-hosted" ? ["good", "Own voice server"] : voiceMode === "checking" ? ["idle", "Voice…"] : ["warn", "Browser voice"];

  const fpsTone: Tone = metrics.fps === 0 ? "idle" : metrics.fps >= 24 ? "good" : metrics.fps >= 15 ? "warn" : "crit";
  const lat = metrics.latencyMs;
  const latTone: Tone = lat === null ? "idle" : lat < 2500 ? "good" : lat < 4000 ? "warn" : "crit";

  // Health: the worst of what matters to viewers right now.
  const parts: Tone[] = [fpsTone, latTone, feedStat[0]];
  const health: [Tone, string] = !live
    ? ["idle", "Ready"]
    : parts.includes("crit")
      ? ["crit", "Health poor"]
      : parts.includes("warn")
        ? ["warn", "Health fair"]
        : ["good", "Health good"];

  return (
    <div className="als-status" aria-label="Stream status">
      <Stat tone={health[0]} icon={<Activity size={13} aria-hidden="true" />} label="Stream health" value={health[1]} keep />
      <Stat tone={feedStat[0]} label="Comments" value={feedStat[1]} />
      <Stat tone={face[0]} label="Face" value={face[1]} />
      <Stat tone={voice[0]} label="Voice" value={voice[1]} />
      <Stat tone={fpsTone} icon={<Gauge size={13} aria-hidden="true" />} label={metrics.fpsSource === "stream" ? "Stream frame rate" : "Render frame rate"} value={`${metrics.fps} fps ${metrics.fpsSource}`} keep />
      <Stat tone={latTone} icon={<Timer size={13} aria-hidden="true" />} label="Reply speed, from picking a comment to the first word" value={lat === null ? "— reply" : `${(lat / 1000).toFixed(1)} s reply`} />
      <Stat tone={metrics.queue > 8 ? "warn" : "idle"} icon={<Users size={13} aria-hidden="true" />} label="Comments waiting" value={`${metrics.queue} waiting`} />
    </div>
  );
}
