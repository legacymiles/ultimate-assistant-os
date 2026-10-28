"use client";

// The cast: each person in the clip, an arrow, and who they become. The left
// side fills itself when the person is tapped on the video; the right side is
// the new character's picture. When both sides are there the arrow lights up.

import { Icon } from "../../icons";
import type { VideoSwap } from "@/lib/studio/video-swap/useVideoSwap";
import { MAX_PEOPLE, isMarked, sideOf } from "@/lib/studio/video-swap/plan";
import { Slot } from "./Slot";

export function CastPanel({ swap }: { swap: VideoSwap }) {
  const { draft, clip } = swap;
  const people = draft.people;

  return (
    <div className="grid gap-0">
      {/* One chrome gradient for every lit arrow */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="vs-chrome-line" gradientUnits="userSpaceOnUse" x1="6" x2="54" y1="20" y2="20">
            <stop offset="0" stopColor="#f6f6f4" stopOpacity="0.2" />
            <stop offset="0.5" stopColor="#ffffff" />
            <stop offset="1" stopColor="#c9cacd" />
          </linearGradient>
        </defs>
      </svg>

      {people.length === 0 && (
        <div className="grid gap-3">
          <div className="vs-pair">
            <Ghost label={clip ? "Tap them in the video" : "Their person in the clip"} />
            <Arrow linked={false} />
            <Slot
              label="New character"
              hint="A clear photo of the face"
              icon={<Icon.Users width={18} height={18} aria-hidden />}
              className="aspect-[4/5] w-full"
              onFile={(f) => void swap.addPersonWithImage(f)}
            />
          </div>
          <p className="text-[11.5px] leading-relaxed text-[var(--vs-ink-3)]">
            Skip this to keep the people as they are and only change the world.
          </p>
        </div>
      )}

      {people.map((p, i) => {
        const linked = Boolean(p.image && (isMarked(p) || people.length === 1));
        return (
          <div key={p.id} className={`vs-pair vs-rise ${linked ? "is-linked" : ""}`}>
            <div className="col-span-3 vs-who">
              <span>
                <b>Person {i + 1}</b> · {isMarked(p) ? sideOf(p.x) : people.length === 1 ? "the main person in frame" : "tap them on the video"}
              </span>
              <span className="flex items-center gap-1">
                {isMarked(p) && (
                  <button type="button" className="vs-ghost !h-6 !px-2 text-[10.5px]" onClick={() => swap.unmark(p.id)}>
                    Unmark
                  </button>
                )}
                <button
                  type="button"
                  className="vs-ghost !h-6 !px-2 text-[10.5px]"
                  onClick={() => swap.removePerson(p.id)}
                  aria-label={`Remove person ${i + 1}`}
                >
                  <Icon.Trash width={11} height={11} aria-hidden />
                </button>
              </span>
            </div>
            {p.crop ? (
              <div className="vs-slot is-full aspect-[4/5] w-full cursor-default">
                {/* eslint-disable-next-line @next/next/no-img-element -- cut from the local frame */}
                <img src={p.crop} alt={`Person ${i + 1} in the clip`} />
                <span className="vs-slot__tag">Original</span>
              </div>
            ) : (
              <Ghost label={people.length === 1 ? "Whoever is in frame" : "Tap them in the video"} />
            )}
            <Arrow linked={linked} />
            <div>
              <Slot
                src={p.image}
                label="New character"
                hint="A clear photo of the face"
                tag="Becomes"
                icon={<Icon.Users width={18} height={18} aria-hidden />}
                className="aspect-[4/5] w-full"
                onFile={(f) => void swap.setPersonImage(p.id, f)}
                onClear={() => swap.patchPerson(p.id, { image: "" })}
              />
            </div>
            <input
              className="vs-note col-span-3"
              value={p.note}
              onChange={(e) => swap.patchPerson(p.id, { note: e.target.value })}
              placeholder="Anything about the new look — “in a red tracksuit”, “keep his cap”"
              aria-label={`Notes for person ${i + 1}`}
            />
          </div>
        );
      })}

      {people.length > 0 && people.length < MAX_PEOPLE && (
        <button type="button" className="vs-ghost mt-4 justify-self-start" onClick={swap.addPerson}>
          <Icon.Plus width={12} height={12} aria-hidden /> Add a person
        </button>
      )}
    </div>
  );
}

function Ghost({ label }: { label: string }) {
  return (
    <div className="vs-slot aspect-[4/5] w-full cursor-default" aria-label={label}>
      <span className="vs-slot__empty">
        <Icon.Target width={18} height={18} aria-hidden />
        <span>{label}</span>
      </span>
    </div>
  );
}

function Arrow({ linked }: { linked: boolean }) {
  return (
    <div className="vs-arrow" aria-hidden>
      <svg viewBox="0 0 64 40" preserveAspectRatio="none">
        <line className="vs-arrow__line" x1="6" y1="20" x2="54" y2="20" />
        <polyline className="vs-arrow__head" points="48,13 56,20 48,27" />
        <circle className="vs-arrow__spark" cx="8" cy="20" r="2.2" />
      </svg>
      <span className="sr-only">{linked ? "ready" : "waiting"}</span>
    </div>
  );
}
