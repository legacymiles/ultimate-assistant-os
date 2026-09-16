"use client";

// ---------------------------------------------------------------------------
// Music Creator — cutting the reference clip.
//
// A voice clone is only as good as the seconds it was cloned from, and which
// seconds those are is a listening decision: a phrase with the music ducked, no
// second speaker, no laugh, no reverb tail. So the waveform is here, the
// selection is draggable, and the selection is auditioned before it is used.
//
// Deliberately not automatic. Something that silently grabbed the first five
// seconds would clone an intro, and the user would have no way to see why the
// voice came out wrong.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { CLIP, type Clip, cutToWavDataUrl } from "@/lib/music-creator/audio";

export function ClipPicker({
  clip,
  onUse,
  busy,
  useLabel = "Use this clip",
}: {
  clip: Clip;
  onUse: (dataUrl: string, seconds: number) => void;
  busy?: boolean;
  useLabel?: string;
}) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(CLIP.idealS, clip.durationS));
  const [playing, setPlaying] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ anchor: number } | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // A new file means the old selection is meaningless.
  useEffect(() => {
    setStart(0);
    setEnd(Math.min(CLIP.idealS, clip.durationS));
  }, [clip]);

  const atPointer = useCallback(
    (clientX: number): number => {
      const box = wrap.current?.getBoundingClientRect();
      if (!box) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      return ratio * clip.durationS;
    },
    [clip.durationS],
  );

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = atPointer(e.clientX);
    drag.current = { anchor: t };
    setStart(t);
    setEnd(t);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const t = atPointer(e.clientX);
    setStart(Math.min(drag.current.anchor, t));
    setEnd(Math.max(drag.current.anchor, t));
  };

  const onUp = () => {
    drag.current = null;
    // A stray click is a zero-length selection, which is not a clip — give it
    // the ideal length forwards from where the click landed instead.
    setEnd((e) => (e - start < 0.4 ? Math.min(start + CLIP.idealS, clip.durationS) : e));
  };

  const seconds = Math.max(0, end - start);
  const tooShort = seconds < CLIP.minS;
  const tooLong = seconds > CLIP.maxS;

  function audition() {
    audio.current?.pause();
    const el = new Audio(cutToWavDataUrl(clip.buffer, start, end));
    audio.current = el;
    el.onended = () => setPlaying(false);
    setPlaying(true);
    void el.play().catch(() => setPlaying(false));
  }

  const left = (start / clip.durationS) * 100;
  const width = (seconds / clip.durationS) * 100;

  return (
    <div>
      <div className="mc-wave" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <svg viewBox="0 0 480 100" preserveAspectRatio="none" aria-hidden>
          {clip.peaks.map((p, i) => {
            const h = Math.max(1.5, p * 92);
            return <rect key={i} x={i} y={(100 - h) / 2} width={0.8} height={h} fill="#4a4a5c" />;
          })}
        </svg>
        <div className="mc-wave-sel" style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }} />
      </div>

      <div className="mc-wave-hint">
        <span>drag across the waveform to choose the clip</span>
        <span>
          {start.toFixed(1)}s → {end.toFixed(1)}s ({seconds.toFixed(1)}s of {clip.durationS.toFixed(1)}s)
        </span>
      </div>

      <div className="mc-row" style={{ marginTop: 10 }}>
        <button type="button" className="mc-btn mc-btn-s" onClick={audition} disabled={seconds < 0.3}>
          <Icon.Launch width={12} height={12} /> {playing ? "Playing…" : "Audition the selection"}
        </button>
        <button
          type="button"
          className="mc-btn mc-btn-go"
          disabled={!!busy || tooShort || tooLong}
          onClick={() => onUse(cutToWavDataUrl(clip.buffer, start, end), seconds)}
        >
          {busy ? "Working…" : useLabel}
        </button>
        {tooShort && <span className="mc-note is-warn">Too short — {CLIP.minS}s is the minimum.</span>}
        {tooLong && <span className="mc-note is-warn">Too long — keep it under {CLIP.maxS}s.</span>}
      </div>

      <p className="mc-note">{CLIP.advice}</p>
    </div>
  );
}
