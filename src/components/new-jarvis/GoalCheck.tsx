"use client";

// ---------------------------------------------------------------------------
// Goal check — Felix's intake, and the prompt enhancer, above the command line.
//
// Opens from the ✦ Enhance button, or from the "set the end goal first" chip
// that appears when what you're typing is about building or fixing something.
//
//   1. The end goal first, then who it's for, how we'll know it worked, your
//      must-haves your way… — chips where there are sensible answers, a box
//      where only you know. Every question is optional.
//   2. Enhance: the server writes the strongest prompt from your words and
//      answers (Anthropic's practices + Felix). No AI key → a structured
//      version built right here, still far better than one line.
//   3. Use it (replaces what you typed), copy it, or send it to the board as a
//      card in Backlog, acceptance criteria and all.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { QUESTIONS, TOPIC_LABEL, ticketFrom, type FelixAnswers, type FelixBrief, type FelixTopic } from "@/lib/new-jarvis/felix";
import { sendToBoard } from "@/lib/new-jarvis/board";

const TOPICS = Object.keys(TOPIC_LABEL) as FelixTopic[];

export function GoalCheck({
  text,
  topic: detected,
  onUse,
  onClose,
}: {
  text: string;
  /** What the prompt looks like; null = a general prompt (no intake, straight to Enhance). */
  topic: FelixTopic | null;
  onUse: (prompt: string) => void;
  onClose: () => void;
}) {
  const [topic, setTopic] = useState<FelixTopic | null>(detected);
  const [answers, setAnswers] = useState<FelixAnswers>({});
  const [brief, setBrief] = useState<FelixBrief | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [board, setBoard] = useState<{ ok: boolean; message: string; url?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const questions = useMemo(() => (topic ? QUESTIONS[topic] : []), [topic]);

  const enhance = useCallback(async (sent: FelixAnswers) => {
    setBusy(true);
    setNotice(null);
    setBoard(null);
    try {
      const res = await fetch("/api/new-jarvis/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, topic, answers: sent }),
      });
      const data = (await res.json()) as { brief?: FelixBrief; notice?: string; error?: string };
      if (!res.ok || !data.brief) {
        setNotice(data.error || "Couldn't enhance that just now. Try again.");
        return;
      }
      setBrief(data.brief);
      setDraft(data.brief.prompt);
      if (data.notice) setNotice(data.notice);
    } catch {
      setNotice("Couldn't reach Jarvis. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [text, topic]);

  // A general prompt has nothing to ask: go straight to the rewrite.
  useEffect(() => {
    if (!detected) void enhance({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (id: string, v: string | string[]) => setAnswers((a) => ({ ...a, [id]: v }));
  const toggle = (id: string, opt: string, multi?: boolean) =>
    setAnswers((a) => {
      const cur = a[id];
      if (!multi) return { ...a, [id]: cur === opt ? "" : opt };
      const list = Array.isArray(cur) ? cur : cur ? [cur] : [];
      return { ...a, [id]: list.includes(opt) ? list.filter((x) => x !== opt) : [...list, opt] };
    });
  const picked = (id: string, opt: string) => {
    const cur = answers[id];
    return Array.isArray(cur) ? cur.includes(opt) : cur === opt;
  };
  const freeText = (id: string) => {
    const cur = answers[`${id}:text`];
    return typeof cur === "string" ? cur : "";
  };

  /** Chips and free text for one question, merged the way the server reads them. */
  const merged = useMemo(() => {
    const out: FelixAnswers = {};
    for (const q of questions) {
      const chips = answers[q.id];
      const list = (Array.isArray(chips) ? chips : chips ? [chips] : []).filter(Boolean);
      const typed = freeText(q.id).trim();
      const all = typed ? [...list, typed] : list;
      if (all.length) out[q.id] = q.multi ? all : all.join("; ");
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, questions]);


  const toBoard = async () => {
    if (!brief) return;
    setBusy(true);
    const ticket = ticketFrom({ ...brief, prompt: draft }, text);
    const r = await sendToBoard(ticket);
    setBoard({ ok: r.ok, message: r.message, url: r.url });
    setBusy(false);
  };

  return (
    <div className="border-b border-line bg-panel px-3 py-3" role="region" aria-label="Goal check">
      <div className="flex items-center gap-2">
        <Icon.Sparkles width={14} height={14} className="text-brand" aria-hidden />
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink">{brief ? "Enhanced prompt" : "Goal check"}</h2>
        <span className="text-[10.5px] text-ink-muted">{brief ? "Felix + Anthropic best practices" : "End goal first — every question is optional"}</span>
        <button type="button" onClick={onClose} aria-label="Close goal check" className="ml-auto rounded p-1 text-ink-muted hover:bg-elevated hover:text-ink">
          <Icon.Close width={12} height={12} aria-hidden />
        </button>
      </div>

      {!brief && (
        <>
          <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="What is this">
            {TOPICS.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={topic === t}
                onClick={() => setTopic(t)}
                className={`rounded-md border px-2 py-0.5 text-[11px] transition ${topic === t ? "border-brand-2 bg-brand-2/15 text-ink" : "border-line text-ink-muted hover:bg-elevated hover:text-ink"}`}
              >
                {TOPIC_LABEL[t]}
              </button>
            ))}
          </div>

          {topic && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {questions.map((q) => (
                <fieldset key={q.id} className="min-w-0">
                  <legend className="text-[11.5px] font-medium text-ink">{q.label}</legend>
                  {q.hint && <p className="text-[10.5px] text-ink-muted">{q.hint}</p>}
                  {q.options && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {q.options.map((o) => (
                        <button
                          key={o}
                          type="button"
                          aria-pressed={picked(q.id, o)}
                          onClick={() => toggle(q.id, o, q.multi)}
                          className={`rounded-full border px-2 py-0.5 text-[11px] transition ${picked(q.id, o) ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:bg-elevated hover:text-ink"}`}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  )}
                  {(q.free || !q.options) && (
                    <input
                      value={freeText(q.id)}
                      onChange={(e) => set(`${q.id}:text`, e.target.value)}
                      placeholder={q.placeholder ?? "In your words…"}
                      aria-label={q.label}
                      className="mt-1 w-full rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-brand-2"
                    />
                  )}
                </fieldset>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void enhance(merged)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-2 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:opacity-50"
            >
              {busy ? <Icon.Refresh width={12} height={12} className="animate-spin" aria-hidden /> : <Icon.Sparkles width={12} height={12} aria-hidden />}
              {busy ? "Writing…" : "Enhance"}
            </button>
            <span className="text-[10.5px] text-ink-muted">Skip any question — Jarvis says what it assumed.</span>
          </div>
        </>
      )}

      {brief && (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] text-ink">
            <span className="text-ink-muted">Goal:</span> {brief.goal}
          </p>
          <p className="text-[11.5px] text-ink-muted">
            <span>Beyond that:</span> {brief.beyond}
          </p>
          {brief.assumptions.length > 0 && (
            <ul className="text-[11px] text-ink-muted">
              {brief.assumptions.map((a) => (
                <li key={a}>· Assumed: {a}</li>
              ))}
            </ul>
          )}
          <details className="text-[11px] text-ink-muted">
            <summary className="cursor-pointer select-none text-ink">How we&apos;ll know it worked ({brief.acceptance.length})</summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {brief.acceptance.map((a) => (
                <li key={a}>☐ {a}</li>
              ))}
            </ul>
            {brief.checklist.length > 0 && <p className="mt-1">Checklist: {brief.checklist.map((c) => c.id).join(" ")}</p>}
          </details>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Enhanced prompt"
            rows={8}
            className="w-full resize-y rounded-md border border-line bg-canvas p-2 font-mono text-[11.5px] leading-relaxed text-ink outline-none focus:border-brand-2"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onUse(draft)}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-2 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[var(--nj-brand-press)]"
            >
              <Icon.Check width={12} height={12} aria-hidden /> Use this prompt
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(draft).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1_500);
                });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink-muted transition hover:bg-elevated hover:text-ink"
            >
              <Icon.Copy width={11} height={11} aria-hidden /> {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => void toBoard()}
              disabled={busy}
              title="File it as a card in Backlog on the super-board. Nothing builds until you move it to Ready."
              className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-[11.5px] text-ink-muted transition hover:bg-elevated hover:text-ink disabled:opacity-50"
            >
              <Icon.ListChecks width={11} height={11} aria-hidden /> Send to board
            </button>
            <button
              type="button"
              onClick={() => {
                setBrief(null);
                setNotice(null);
                setBoard(null);
              }}
              className="text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            >
              Back to the questions
            </button>
          </div>
        </div>
      )}

      {notice && <p className="mt-2 text-[11px] text-[#f8b471]">{notice}</p>}
      {board && (
        <p className={`mt-1 text-[11px] ${board.ok ? "text-[var(--nj-done)]" : "text-[#f8b471]"}`}>
          {board.message}{" "}
          {board.url && (
            <a href={board.url} target="_blank" rel="noreferrer" className="underline">
              Open card
            </a>
          )}
        </p>
      )}
    </div>
  );
}
