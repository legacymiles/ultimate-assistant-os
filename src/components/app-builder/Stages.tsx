"use client";

// The first two rooms: the idea (type it any way you like) and the interview
// (the super agent's questions about what the app is FOR — Felix step 1).

import { useRef } from "react";
import { asList } from "@/lib/app-builder/engine";
import type { PreparedMedia } from "@/lib/app-builder/media";
import { Composer } from "./Composer";
import type { Answers, Question } from "@/lib/app-builder/types";

const EXAMPLES = [
  "A marketplace where people book local dog walkers and pay in the app",
  "An AI fitness coach that builds my week of workouts from how I slept",
  "A CRM for roofing companies that turns phone calls into jobs",
  "A website for my cousin's food truck that shows where it is today",
  "Recreate the workflow in this video, but for roofing companies",
];

export function IdeaStage({
  busy,
  onStart,
  onType,
}: {
  busy: boolean;
  onStart: (idea: string, media: PreparedMedia[]) => void;
  onType: (n: number) => void;
}) {
  const fill = useRef<((t: string) => void) | null>(null);
  return (
    <div className="ab-idea">
      <p className="ab-eyebrow">App Builder · super agent</p>
      <h1 className="ab-hero">
        Say the idea — or show it.
        <br />
        <span>Get the app it should be.</span>
      </h1>
      <p className="ab-lede">
        Type it simple or detailed, or drop a screen recording of an app or workflow. The super agent takes it apart,
        asks what it&rsquo;s for, designs the features that make it great — and hands the build to your pro team.
      </p>
      <Composer
        hero
        autoFocus
        busy={busy}
        textRef={fill}
        onTyping={onType}
        placeholder="Describe the app, or attach a video of one to recreate or change…"
        onSend={(text, media) => onStart(text, media)}
      />
      <div className="ab-examples" aria-label="Examples">
        {EXAMPLES.map((e) => (
          <button key={e} className="ab-chip" onClick={() => fill.current?.(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Interview({
  questions,
  answers,
  busy,
  onAnswer,
  onDesign,
}: {
  questions: Question[];
  answers: Answers;
  busy: boolean;
  onAnswer: (id: string, v: string | string[]) => void;
  onDesign: (useGuesses: boolean) => void;
}) {
  const answered = questions.filter((q) => asList(answers[q.id]).length).length;
  return (
    <div className="ab-interview">
      <div className="ab-interview-head">
        <p className="ab-eyebrow">Step 1 of 3 · the purpose</p>
        <h2>What is it for?</h2>
        <p className="ab-lede">Features are chosen because of the purpose — so the agent asks first. Skip anything; it&rsquo;ll make a sensible guess.</p>
      </div>
      <ol className="ab-questions">
        {questions.map((q, i) => {
          const picked = asList(answers[q.id]);
          const freeText = typeof answers[q.id] === "string" && !q.options.includes(answers[q.id] as string) ? (answers[q.id] as string) : "";
          const toggle = (o: string) => {
            if (q.multi) onAnswer(q.id, picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o]);
            else onAnswer(q.id, picked[0] === o ? "" : o);
          };
          return (
            <li key={q.id} className={`ab-q${picked.length ? " is-done" : ""}`}>
              <div className="ab-q-label">
                <span className="ab-q-n">{String(i + 1).padStart(2, "0")}</span>
                {q.label}
                {q.multi && <span className="ab-q-multi">pick any</span>}
              </div>
              {q.hint && <p className="ab-q-hint">{q.hint}</p>}
              {q.options.length > 0 && (
                <div className="ab-q-opts">
                  {q.options.map((o, j) => (
                    <button key={o} type="button" className="ab-opt" aria-pressed={picked.includes(o)} onClick={() => toggle(o)}>
                      {o}
                      {j === 0 && !picked.length && <span className="ab-rec">suggested</span>}
                    </button>
                  ))}
                </div>
              )}
              {q.free && !q.multi && (
                <input
                  className="ab-q-free"
                  aria-label={q.label}
                  placeholder={q.options.length ? "…or say it your way" : "In your words"}
                  value={freeText}
                  maxLength={600}
                  onChange={(e) => onAnswer(q.id, e.target.value)}
                />
              )}
              {q.free && q.multi && (
                <input
                  className="ab-q-free"
                  aria-label={`${q.label} — add your own`}
                  placeholder="…or add your own and press Enter"
                  maxLength={300}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const input = e.currentTarget;
                    const v = input.value.trim();
                    if (v && !picked.includes(v)) onAnswer(q.id, [...picked, v]);
                    input.value = "";
                  }}
                />
              )}
              {q.multi && picked.filter((p) => !q.options.includes(p)).length > 0 && (
                <div className="ab-q-opts">
                  {picked
                    .filter((p) => !q.options.includes(p))
                    .map((p) => (
                      <button key={p} type="button" className="ab-opt" aria-pressed onClick={() => toggle(p)}>
                        {p} ✕
                      </button>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="ab-interview-go">
        <button className="ab-primary" disabled={busy} onClick={() => onDesign(answered < questions.length)}>
          {busy ? "Designing features…" : "Design my features"}
          <span aria-hidden>→</span>
        </button>
        <button className="ab-ghost" disabled={busy} onClick={() => onDesign(true)}>
          Skip — use your best guesses
        </button>
        <span className="ab-count">
          {answered}/{questions.length} answered
        </span>
      </div>
    </div>
  );
}
