"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { QUESTIONS, isConcretePriority, voiceWarning } from "@/lib/new-dashboard/questions";
import type { Intake } from "@/lib/new-dashboard/types";

interface Props {
  name: string;
  initial: Intake;
  /** Set when answers were pre-filled from what Claude knows about the owner. */
  suggested: boolean;
  onSave: (intake: Intake, finished: boolean) => void;
  onCancel: () => void;
}

const field =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none";

export function Onboarding({ name, initial, suggested, onSave, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [intake, setIntake] = useState<Intake>(initial);
  // Per voice box: characters typed by hand, and whether anything was pasted.
  const [typed, setTyped] = useState([0, 0]);
  const [pasted, setPasted] = useState([initial.q2[0].length > 0, initial.q2[1].length > 0]);

  const q = QUESTIONS[step];
  const last = step === QUESTIONS.length - 1;

  const go = (next: number) => {
    // Checkpoint every step, like the kit writes aios-intake.md as it goes, so
    // closing the tab mid-interview loses nothing.
    onSave(intake, false);
    setStep(next);
  };

  const setVoice = (n: 0 | 1, value: string, viaPaste: boolean) => {
    const q2 = [...intake.q2] as [string, string];
    const grew = value.length - q2[n].length;
    q2[n] = value;
    setIntake({ ...intake, q2 });
    if (viaPaste) setPasted((p) => p.map((v, k) => (k === n ? true : v)));
    else if (grew > 0) setTyped((t) => t.map((v, k) => (k === n ? v + grew : v)));
    if (!value) {
      setPasted((p) => p.map((v, k) => (k === n ? false : v)));
      setTyped((t) => t.map((v, k) => (k === n ? 0 : v)));
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-3 py-6 sm:px-5 sm:py-10">
      <div className="mb-1 flex items-center justify-between text-xs text-ink-faint">
        <span>
          Onboarding {name} · question {step + 1} of {QUESTIONS.length}
        </span>
        <button onClick={onCancel} className="hover:text-ink">
          Save & exit
        </button>
      </div>
      <div className="mb-6 flex gap-1">
        {QUESTIONS.map((x, n) => (
          <button
            key={x.id}
            onClick={() => go(n)}
            aria-label={`Question ${n + 1}`}
            className={`h-1.5 flex-1 rounded-full transition ${n <= step ? "bg-accent" : "bg-line"}`}
          />
        ))}
      </div>

      <h2 className="text-xl font-bold text-ink sm:text-2xl">{q.title}</h2>
      <p className="mt-1.5 text-sm text-ink-muted">{q.help}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide text-ink-faint">Feeds → {q.feeds}</p>

      {suggested && q.id !== "q2" && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs text-ink-muted">
          <Icon.Sparkles width={14} height={14} className="mt-0.5 shrink-0 text-accent" />
          Pre-filled from what Claude already knows about you. Edit anything that&apos;s wrong — you know better.
        </div>
      )}

      <div className="mt-4 space-y-3">
        {q.id === "q2" &&
          ([0, 1] as const).map((n) => {
            const warn = voiceWarning(typed[n], pasted[n]);
            return (
              <div key={n}>
                <label className="mb-1 block text-xs font-medium text-ink-muted">
                  Sample {n + 1} {n === 1 && <span className="text-ink-faint">(optional)</span>}
                </label>
                <textarea
                  rows={6}
                  className={field}
                  placeholder="Paste an email or post here — unedited."
                  value={intake.q2[n]}
                  onPaste={(e) => {
                    e.preventDefault();
                    const text = e.clipboardData.getData("text");
                    const el = e.currentTarget;
                    const v = el.value.slice(0, el.selectionStart) + text + el.value.slice(el.selectionEnd);
                    setVoice(n, v, true);
                  }}
                  onChange={(e) => setVoice(n, e.target.value, false)}
                />
                {warn && <p className="mt-1 text-xs text-amber-400">{warn}</p>}
              </div>
            );
          })}

        {q.id === "q3" &&
          ([0, 1, 2] as const).map((n) => {
            const vague = !isConcretePriority(intake.q3[n]);
            return (
              <div key={n}>
                <div className="flex items-center gap-2">
                  <span className="w-5 text-right text-sm text-ink-faint">{n + 1}.</span>
                  <input
                    className={field}
                    placeholder={n === 0 ? q.placeholder : n === 2 ? "Optional third priority" : "Second priority"}
                    value={intake.q3[n]}
                    onChange={(e) => {
                      const q3 = [...intake.q3] as Intake["q3"];
                      q3[n] = e.target.value;
                      setIntake({ ...intake, q3 });
                    }}
                  />
                </div>
                {vague && (
                  <p className="ml-7 mt-1 text-xs text-amber-400">
                    Too vague to check off. Name a number, a deadline or a deliverable.
                  </p>
                )}
              </div>
            );
          })}

        {q.id !== "q2" && q.id !== "q3" && (
          <textarea
            rows={5}
            className={field}
            placeholder={q.placeholder}
            value={intake[q.id]}
            onChange={(e) => setIntake({ ...intake, [q.id]: e.target.value })}
            autoFocus
          />
        )}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={() => go(Math.max(0, step - 1))}
          disabled={step === 0}
          className="rounded-lg border border-line px-3 py-2 text-sm text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-40"
        >
          Back
        </button>
        {last ? (
          <button
            onClick={() => onSave(intake, true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:bg-accent-2"
          >
            <Icon.Check width={16} height={16} /> Build my dashboard
          </button>
        ) : (
          <button
            onClick={() => go(step + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:bg-accent-2"
          >
            Next <Icon.ArrowRight width={16} height={16} />
          </button>
        )}
      </div>
    </div>
  );
}
