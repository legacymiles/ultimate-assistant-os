"use client";

import { briefProblem, MAX_DURATION, MIN_DURATION } from "@/lib/video-studio/brief";
import { ASPECT_RATIOS, NARRATIONS } from "@/lib/video-studio/types";
import type { Studio } from "./studio";
import { Choices, Field, Panel } from "./ui";

// Step 1. The prompt is the only thing that matters, so it gets the whole
// first screen; everything else is an optional refinement underneath it.

const EXAMPLES = [
  "Create a 20-second animated explanation of how compound interest works.",
  "A 30-second cinematic shot of a robot walking through a futuristic city at dusk.",
  "A 15-second product film of a matte black espresso machine, turntable and close-ups.",
  "A 45-second explainer comparing our pricing tiers, with charts.",
];

export function Brief({ s }: { s: Studio }) {
  const b = s.brief;
  const problem = briefProblem(b);

  return (
    <div className="vsa-screen">
      <Panel className="vsa-prompt-panel">
        <label className="vsa-prompt">
          <span className="vsa-step-tag">Step 1 · Your request</span>
          <textarea
            value={b.prompt}
            onChange={(e) => s.setBrief({ ...b, prompt: e.target.value })}
            placeholder="Describe the video you want to create..."
            rows={5}
            autoFocus
          />
        </label>
        <div className="vsa-examples">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => s.setBrief({ ...b, prompt: example })}>
              {example}
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="The details" hint="All optional — the planner fills in anything you leave blank.">
        <div className="vsa-grid-2">
          <Field label="Subject" hint="what it's about">
            <input
              value={b.subject}
              onChange={(e) => s.setBrief({ ...b, subject: e.target.value })}
              placeholder="Compound interest"
            />
          </Field>
          <Field label="Duration" hint={`${MIN_DURATION}–${MAX_DURATION}s`}>
            <div className="vsa-duration">
              <input
                type="range"
                min={MIN_DURATION}
                max={120}
                value={Math.min(120, b.durationSec)}
                onChange={(e) => s.setBrief({ ...b, durationSec: Number(e.target.value) })}
              />
              <input
                type="number"
                min={MIN_DURATION}
                max={MAX_DURATION}
                value={b.durationSec}
                onChange={(e) => s.setBrief({ ...b, durationSec: Number(e.target.value) })}
              />
              <span>sec</span>
            </div>
          </Field>
          <Field label="Visual style">
            <input
              value={b.style}
              onChange={(e) => s.setBrief({ ...b, style: e.target.value })}
              placeholder="Clean, editorial, warm accent colour"
            />
          </Field>
          <Field label="Audience">
            <input
              value={b.audience}
              onChange={(e) => s.setBrief({ ...b, audience: e.target.value })}
              placeholder="People who've never invested before"
            />
          </Field>
        </div>

        <Field label="Aspect ratio">
          <Choices
            name="Aspect ratio"
            value={b.aspectRatio}
            options={ASPECT_RATIOS}
            onChange={(aspectRatio) => s.setBrief({ ...b, aspectRatio })}
          />
        </Field>

        <Field label="Narration">
          <Choices
            name="Narration"
            value={b.narration}
            options={NARRATIONS}
            onChange={(narration) => s.setBrief({ ...b, narration })}
          />
        </Field>

        <div className="vsa-grid-2">
          <Field label="Voice" hint="tone, accent, pace">
            <input
              value={b.voiceNote}
              onChange={(e) => s.setBrief({ ...b, voiceNote: e.target.value })}
              placeholder="Calm, mid-30s, unhurried"
              disabled={b.narration === "none"}
            />
          </Field>
          <Field label="Music">
            <input
              value={b.music}
              onChange={(e) => s.setBrief({ ...b, music: e.target.value })}
              placeholder="Soft ambient bed, no drums"
            />
          </Field>
        </div>

        <label className="vsa-check">
          <input
            type="checkbox"
            checked={b.captions}
            onChange={(e) => s.setBrief({ ...b, captions: e.target.checked })}
          />
          <span>Burn in captions</span>
        </label>

        <Field label="Other creative instructions">
          <textarea
            value={b.notes}
            onChange={(e) => s.setBrief({ ...b, notes: e.target.value })}
            rows={3}
            placeholder="Brand colours, things to avoid, data to animate, a reference you like…"
          />
        </Field>
      </Panel>

      <div className="vsa-actions">
        <span className="vsa-hint">{problem ?? "Next: choose how it gets made."}</span>
        <button type="button" className="vsa-btn is-primary" disabled={Boolean(problem)} onClick={() => s.setView("method")}>
          Choose creation method
        </button>
      </div>
    </div>
  );
}
