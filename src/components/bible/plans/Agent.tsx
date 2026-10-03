"use client";

// ---------------------------------------------------------------------------
// The agent, and the gate.
//
// The agent answers in words AND returns the edit its answer implies, as
// operations against step ids. Nothing it proposes touches the plan until the
// owner presses Accept — so the preview here is computed, shown, and thrown
// away on Discard.
//
// Two things this surface must never do:
//
//   * Apply an edit silently. "Make it cheaper" and "the good version" both
//     have to survive, which is why Accept makes v2 and leaves v1 readable.
//   * Hide a dropped op. When the agent names a step that is not in the plan,
//     the gate says so — that is the signal that it and the sheet have drifted
//     apart, and swallowing it would make the next answer untrustworthy too.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { uid } from "@/lib/bible/ids";
import { applyOps, opSummary, type Dropped, type Op } from "@/lib/bible/ops";
import { fmtMoney, totals } from "@/lib/bible/totals";
import type { HomeBase, Idea, Message, Plan } from "@/lib/bible/types";

interface Pending {
  messageId: string;
  ops: Op[];
  dropped: Dropped[];
  preview: Plan;
}

export function Agent({
  idea,
  plan,
  homeBase,
  prefill,
  onPrefillUsed,
  onIdea,
  onAccept,
}: {
  idea: Idea;
  plan: Plan;
  homeBase: HomeBase | null;
  prefill: string;
  onPrefillUsed: () => void;
  onIdea: (idea: Idea) => void;
  onAccept: (plan: Plan) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);

  // An open question clicked on the sheet lands in the box, focused but not
  // sent: it is a question he may want to edit before asking.
  useEffect(() => {
    if (!prefill) return;
    setText(prefill);
    onPrefillUsed();
  }, [prefill, onPrefillUsed]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "end" });
  }, [idea.chat.length, pending]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;

    const mine: Message = {
      id: uid("msg"),
      role: "owner",
      text: message,
      at: new Date().toISOString(),
      againstVersion: plan.version,
    };
    const withMine = { ...idea, chat: [...idea.chat, mine] };
    onIdea(withMine);
    setText("");
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/bible/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, plan, history: idea.chat, homeBase }),
      });
      const json = await res.json();
      if (!res.ok || !json?.reply) {
        setError(json?.error ?? "No answer came back. The plan is untouched.");
        return;
      }

      const ops: Op[] = Array.isArray(json.ops) ? json.ops : [];
      const reply: Message = {
        id: uid("msg"),
        role: "agent",
        text: json.reply,
        at: new Date().toISOString(),
        againstVersion: plan.version,
        proposed: ops,
        outcome: ops.length ? "pending" : undefined,
      };
      onIdea({ ...withMine, chat: [...withMine.chat, reply] });

      if (ops.length) {
        const result = applyOps(plan, ops);
        setPending({ messageId: reply.id, ops, dropped: result.dropped, preview: result.plan });
      }
    } catch {
      setError("The connection dropped. The plan is untouched.");
    } finally {
      setBusy(false);
    }
  };

  const settle = (outcome: "accepted" | "discarded") => {
    if (!pending) return;
    if (outcome === "accepted") onAccept(pending.preview);
    onIdea({
      ...idea,
      chat: idea.chat.map((m) => (m.id === pending.messageId ? { ...m, outcome } : m)),
    });
    setPending(null);
  };

  const before = totals(plan);
  const after = pending ? totals(pending.preview) : null;

  return (
    <aside className="bible-dock">
      <div className="bible-dock-head">
        Talk to the plan
        <b>Cheaper, different material, is this even allowed?</b>
      </div>

      <div className="bible-thread">
        {!idea.chat.length && (
          <p className="bible-hint">
            Ask it anything about this build. It answers, and when the answer changes the plan it shows
            you the edit before anything moves.
          </p>
        )}

        {idea.chat.map((m) => (
          <div key={m.id} className="bible-msg" data-role={m.role}>
            {m.role === "agent" && <span className="bible-msg-k">Plan agent</span>}
            {m.text}
            {m.outcome === "accepted" && (
              <span className="bible-msg-k" style={{ marginTop: 4 }}>Edit accepted</span>
            )}
            {m.outcome === "discarded" && (
              <span className="bible-msg-k" style={{ marginTop: 4 }}>Edit discarded</span>
            )}
          </div>
        ))}

        {pending && (
          <div className="bible-gate">
            <div className="bible-gate-head">{opSummary(pending.ops)} — accept or discard</div>

            <div className="bible-gate-move">
              <span className="bible-gate-from">{fmtMoney(before.cost)}</span>
              <span aria-hidden="true">→</span>
              <span className="bible-gate-to">{after?.mixed ? "two currencies" : fmtMoney(after?.cost ?? null)}</span>
            </div>

            <ul className="bible-gate-ops">
              {pending.ops.map((op, i) => {
                const line = describe(op, plan);
                return <li key={i} data-k={line.kind}><b>{line.verb}</b> {line.what}</li>;
              })}
            </ul>

            {!!pending.dropped.length && (
              <div className="bible-gate-dropped">
                {pending.dropped.length} edit{pending.dropped.length === 1 ? "" : "s"} ignored — they named
                steps that are not in this plan. ({pending.dropped[0].why})
              </div>
            )}

            <div className="bible-gate-actions">
              <button type="button" className="bb" data-tone="go" onClick={() => settle("accepted")}>
                Accept — makes v{plan.version + 1}
              </button>
              <button type="button" className="bb" data-tone="ghost" onClick={() => settle("discarded")}>
                Discard
              </button>
            </div>
          </div>
        )}

        {busy && (
          <p className="bible-hint">
            <span className="bible-working" aria-hidden="true" /> Thinking about it…
          </p>
        )}
        {error && <p className="bible-hint" style={{ color: "#e6a39b" }}>{error}</p>}
        <div ref={threadEnd} />
      </div>

      <div className="bible-dock-foot">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Make it cheaper. Use oak instead. Do I need a permit to sell these?"
          aria-label="Ask the plan agent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
        />
        <div>
          <span className="bible-hint">⌘/Ctrl + Enter</span>
          <button type="button" className="bb" data-tone="go" disabled={busy || !text.trim()} onClick={() => void send()}>
            {busy ? "Asking…" : "Ask"}
          </button>
        </div>
      </div>
    </aside>
  );
}

/** One readable line per op, naming the step it actually touches. */
function describe(op: Op, plan: Plan): { kind: "change" | "add" | "remove"; verb: string; what: string } {
  const steps = plan.phases.flatMap((p) => p.steps);
  const titleOf = (id: string) => steps.find((s) => s.id === id)?.title ?? "a step that is not here";

  switch (op.op) {
    case "replace-step":
      return { kind: "change", verb: "Change", what: titleOf(op.stepId) };
    case "add-step":
      return { kind: "add", verb: "Add", what: op.step.title };
    case "remove-step":
      return { kind: "remove", verb: "Remove", what: titleOf(op.stepId) };
    case "replace-phase":
      return { kind: "change", verb: "Rewrite phase", what: op.phase.title };
    case "add-phase":
      return { kind: "add", verb: "Add phase", what: op.phase.title };
    case "remove-phase":
      return {
        kind: "remove",
        verb: "Remove phase",
        what: plan.phases.find((p) => p.id === op.phaseId)?.title ?? "one that is not here",
      };
    case "set-summary":
      return { kind: "change", verb: "Reword", what: "what this plan is" };
    case "set-assumptions":
      return { kind: "change", verb: "Change", what: "what it assumes" };
    default:
      return { kind: "change", verb: "Change", what: "the unit economics" };
  }
}
