"use client";

// The stage: the host, the light, and what viewers see. LiveTalking's
// lip-synced stream when it is connected; otherwise the host's photograph,
// kept alive with breathing and sway. The key light behind it is driven by
// the voice (--lvl, written per frame by useStudio) — the page's one standout.

import { useEffect, useRef, type RefObject } from "react";
import { Gift } from "lucide-react";
import { EMOTION_LABEL } from "@/lib/ai-live-studio/performance";
import { Monogram, eventLine } from "./bits";
import type { AiState, Studio } from "./useStudio";

type ShownState = AiState | "paused";

const LABEL: Record<ShownState, string> = {
  offline: "Off air",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  paused: "AI paused",
};

/**
 * Five bars sized by the voice level — single series, one hue (dataviz).
 * Scaled, not resized, so a per-frame level never triggers layout.
 */
function Bars() {
  const peaks = [0.5, 0.83, 1, 0.75, 0.42];
  return (
    <span className="als-bars" aria-hidden="true">
      {peaks.map((p, i) => (
        <i key={i} style={{ transform: `scaleY(calc(0.25 + var(--lvl) * ${p}))` }} />
      ))}
    </span>
  );
}

export function StatePill({ state, name }: { state: ShownState; name: string }) {
  return (
    <span className="als-state als-glass" data-state={state} role="status" aria-label={`${name}: ${LABEL[state]}`}>
      <span className="lamp" />
      {state === "thinking" ? <span className="shimmer">Thinking</span> : LABEL[state]}
      {state === "speaking" && <Bars />}
    </span>
  );
}

export function Stage({
  studio,
  stageRef,
  output,
}: {
  studio: Studio;
  stageRef: RefObject<HTMLDivElement | null>;
  output: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const { source, stream, live, muted, paused, aiState, settings, caption, question, gift, expression, perf, publicSink } = studio;

  useEffect(() => {
    if (video.current) video.current.srcObject = source === "livetalking" ? stream : null;
  }, [source, stream]);

  // LiveTalking's voice goes where the stream's audio goes — never the director's headphones.
  useEffect(() => {
    const el = video.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId) void el.setSinkId(publicSink || "").catch(() => undefined);
  }, [publicSink, source]);

  const shown: ShownState = !live ? "offline" : paused ? "paused" : aiState;
  const light = shown === "paused" ? "listening" : shown;

  return (
    <div className="als-stage" ref={stageRef} data-state={light} data-output={output} data-standout="voice-light">
      <div className="als-light" aria-hidden="true" />
      <div className="als-frame">
        {/* The actor's body: eye contact, head movement and expression move this layer. */}
        <div className="als-perf">
        {source === "livetalking" ? (
          <video
            ref={video}
            className="als-media"
            autoPlay
            playsInline
            // Silent until the owner goes live: a click is what lets the browser play sound.
            muted={!live || muted}
            aria-label={`${settings.name}, live`}
          />
        ) : (
          <div className="als-photo-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element -- local 145 KB still, the poster for the live stream */}
            <img
              className="als-photo"
              src="/ai-live-studio/alex.jpg"
              width={900}
              height={1612}
              alt={`${settings.name}, the AI host`}
              fetchPriority="high"
            />
          </div>
        )}
        </div>
        <div className="als-vignette" aria-hidden="true" />

        <div className="als-overlays">
          <div className="als-row als-op">
            <StatePill state={shown} name={settings.name} />
            <span
              className="als-expr als-glass"
              role="status"
              aria-label={`Expression: ${EMOTION_LABEL[expression]}`}
              title={source === "preview" ? "The portrait performs with head, gaze and lean. Real lip sync comes from LiveTalking — pick it under Avatar." : undefined}
            >
              <b>{EMOTION_LABEL[expression]}</b>
              <small>
                eyes {perf.eyeContact} · head {perf.headMotion}
                {source === "preview" ? " · no lip sync" : ""}
              </small>
            </span>

          </div>

          {gift && (
            <div className="als-gift als-glass" key={`g-${gift.handle}-${gift.text}`}>
              <Gift size={16} aria-hidden="true" />
              <span>
                <b>{gift.user}</b> {eventLine("gift", gift.text)}
              </span>
            </div>
          )}

          {question && (
            <div className="als-question als-glass" key={`q-${question.handle}-${question.text}`}>
              <Monogram name={question.user} handle={question.handle} src={question.avatar} size={30} />
              <div>
                <div className="who">@{question.handle}</div>
                <div className="what">{question.kind === "comment" || question.kind === "speech" ? question.text : `${question.user} ${eventLine(question.kind, question.text)}`}</div>
              </div>
            </div>
          )}

          <div className="als-captions" aria-live="polite">
            {caption && <span className="als-caption als-glass">{caption}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
