"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { looksLikeQuestion, search } from "@/lib/profile/model";
import type { Node } from "@/lib/profile/types";

/**
 * One bar, two modes — the owner asked for "a simple search bar / chat bar",
 * and the honest answer is that it should be one input with no mode to learn.
 *
 * Typing filters every folder name, field label and field value live. If what
 * you typed reads like a question, an Ask affordance appears and Enter sends it
 * to the model with the (redacted) tree as context.
 *
 * Secret values are never searched: the bar must not become a way to read a
 * password by guessing at it. Labels still match, so you can navigate to a
 * credential — you just cannot grep it out.
 */

export interface Answer {
  text: string;
  open: string;
  missing: boolean;
  note?: string;
}

interface Props {
  nodes: Node[];
  onJump: (nodeId: string) => void;
  onAsk: (question: string) => void;
  asking: boolean;
  answer: Answer | null;
  onClear: () => void;
}

export function OneBar({ nodes, onJump, onAsk, asking, answer, onClear }: Props) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => search(nodes, q), [nodes, q]);
  const question = looksLikeQuestion(q);

  const ask = () => {
    if (!q.trim()) return;
    onAsk(q.trim());
  };

  return (
    <div className="border-b border-line bg-panel-2/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon.Search width={14} height={14} className="shrink-0 text-ink-faint" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (answer) onClear();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && question) ask();
            if (e.key === "Escape") {
              setQ("");
              onClear();
            }
          }}
          placeholder="Find anything — or ask a question about yourself"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          aria-label="Search or ask"
        />
        {question && (
          <button
            type="button"
            onClick={ask}
            disabled={asking}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-60"
          >
            {asking ? <Icon.Refresh width={11} height={11} className="animate-spin" /> : <Icon.Send width={11} height={11} />}
            Ask
          </button>
        )}
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              onClear();
            }}
            className="shrink-0 rounded p-1 text-ink-faint hover:text-ink"
            aria-label="Clear"
          >
            <Icon.Close width={12} height={12} />
          </button>
        )}
      </div>

      {answer && (
        <div className="border-t border-line px-3 py-2">
          {answer.text ? (
            <p className="text-xs leading-relaxed text-ink">{answer.text}</p>
          ) : (
            <p className="text-xs text-ink-muted">{answer.note || "No answer came back."}</p>
          )}
          <div className="mt-1.5 flex items-center gap-2">
            {answer.open && (
              <button
                type="button"
                onClick={() => onJump(answer.open)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
              >
                <Icon.Folder width={10} height={10} /> Open the folder it came from
              </button>
            )}
            {answer.missing && (
              <span className="font-mono text-[10px] text-amber-400">not on file — nothing was guessed</span>
            )}
          </div>
        </div>
      )}

      {q && !answer && (
        <div className="max-h-56 overflow-y-auto border-t border-line">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-ink-faint">
              Nothing matches “{q}”.{question ? " Press Ask and the model will say where it would go." : ""}
            </p>
          ) : (
            hits.map((h) => (
              <button
                key={h.node.id}
                type="button"
                onClick={() => {
                  onJump(h.node.id);
                  setQ("");
                }}
                className="pf-row"
              >
                <Icon.Folder width={12} height={12} className="shrink-0 opacity-60" />
                <span className="truncate font-mono text-[11px] text-ink">{h.path}</span>
                {h.on !== "name" && <span className="pf-row__count truncate">{h.on}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
