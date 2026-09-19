"use client";

// ---------------------------------------------------------------------------
// Talking to Jarvis.
//
// A conversation is a list of turns, each of Jarvis's carrying the memories it
// used. Three things appear under an answer when they exist, and each is the
// owner's decision to make, never Jarvis's:
//
//   citations  — what he read to answer
//   proposals  — what he thinks is worth remembering (save or discard)
//   pending    — what he wants to do in the outside world (yes or no)
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { SOURCE_COLOR } from "./MemoryCore";
import { uid } from "@/lib/jarvis/store";
import { useMemory } from "@/lib/jarvis/useMemory";
import { SOURCE_LABEL, type ChatTurn, type Conversation, type JarvisStore, type PendingAction } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";

interface AgentResponse {
  text?: string;
  citations?: { memoryId: string; title: string; source: keyof typeof SOURCE_COLOR; capturedAt: string }[];
  proposals?: { title: string; content: string }[];
  pending?: { tool: string; app: string; summary: string; args: Record<string, unknown> } | null;
  notices?: string[];
  did?: string[];
  error?: string;
}

/** What Jarvis should know about the owner without having to search for it. */
function profileContext(p: Profile | null): string {
  if (!p) return "";
  const lines = [
    `Name: ${p.name}`,
    p.intake.q1 ? `Their work: ${p.intake.q1}` : "",
    p.intake.q3.filter(Boolean).length ? `90-day priorities: ${p.intake.q3.filter(Boolean).join(" | ")}` : "",
    p.intake.q4 ? `Tools they use: ${p.intake.q4}` : "",
    p.intake.q6 ? `How they want help: ${p.intake.q6}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function ChatTab({
  store,
  commit,
  profile,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
}) {
  const memory = useMemory(store, commit);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<{ title: string; content: string }[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const conversation: Conversation | null = useMemo(
    () => store.conversations[0] ?? null,
    [store.conversations],
  );
  const turns = conversation?.turns ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  const writeTurns = (fn: (t: ChatTurn[]) => ChatTurn[]) => {
    const now = new Date().toISOString();
    const existing = store.conversations[0];
    const next: Conversation = existing
      ? { ...existing, turns: fn(existing.turns), updatedAt: now }
      : { id: uid(), title: "Conversation", startedAt: now, updatedAt: now, turns: fn([]) };
    commit({ ...store, conversations: [next, ...store.conversations.slice(existing ? 1 : 0)] });
  };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setError("");
    setProposals([]);
    setPending(null);
    const asked: ChatTurn = { id: uid(), role: "you", text: question, at: new Date().toISOString() };
    writeTurns((t) => [...t, asked]);
    setBusy(true);

    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...turns, asked].map((t) => ({
            role: t.role === "you" ? "user" : "assistant",
            content: t.text,
          })),
          ownerName: profile?.name ?? "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          extraContext: profileContext(profile),
        }),
      });
      const data = (await res.json()) as AgentResponse;
      if (!res.ok || data.error) {
        setError(data.error ?? `The assistant failed (${res.status}).`);
        setBusy(false);
        return;
      }
      const answer: ChatTurn = {
        id: uid(),
        role: "jarvis",
        text: data.text ?? "",
        at: new Date().toISOString(),
        citations: (data.citations ?? []).map((c) => ({ ...c, source: c.source })),
        did: (data.did ?? []).join(" · ") || undefined,
      };
      writeTurns((t) => [...t, answer]);
      setProposals(data.proposals ?? []);
      if (data.pending) {
        setPending({
          id: uid(),
          tool: data.pending.tool,
          app: data.pending.app,
          summary: data.pending.summary,
          args: data.pending.args,
          createdAt: new Date().toISOString(),
          status: "pending",
        });
      }
      if (data.notices?.length) setError(data.notices.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach Jarvis.");
    } finally {
      setBusy(false);
    }
  };

  const saveProposal = async (p: { title: string; content: string }) => {
    await memory.save({ source: "chat", title: p.title, content: p.content, origin: "this conversation" });
    setProposals((list) => list.filter((x) => x !== p));
  };

  const clear = () => {
    if (!turns.length || !confirm("Clear this conversation? Saved memories stay.")) return;
    commit({ ...store, conversations: store.conversations.slice(1) });
  };

  return (
    <div className="flex h-[calc(100dvh-49px)] flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">Chat</h2>
        <span className="text-[11px] text-ink-faint">
          {memory.remote ? `${memory.memories.length} memories, meaning search` : "local memory only"}
        </span>
        {turns.length > 0 && (
          <button onClick={clear} className="ml-auto text-[11px] text-ink-faint underline hover:text-ink">
            Clear
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="mx-auto max-w-lg py-8 text-center">
            <p className="text-sm text-ink">Ask me something.</p>
            <p className="mt-1 text-xs text-ink-muted">
              I answer from what I actually know — your memories, your master Claude folder and your
              profile — and I name my sources. If I don&apos;t know, I say so.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {["What do you know about me?", "What should I focus on this week?", "What's in my master folder?"].map(
                (q) => (
                  <button
                    key={q}
                    onClick={() => void ask(q)}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:bg-panel-2 hover:text-ink"
                  >
                    {q}
                  </button>
                ),
              )}
            </div>
          </div>
        )}

        <div className="mx-auto max-w-2xl space-y-3">
          {turns.map((t) => (
            <div key={t.id} className={t.role === "you" ? "flex justify-end" : ""}>
              <div
                className={
                  t.role === "you"
                    ? "max-w-[85%] rounded-xl rounded-br-sm bg-panel-2 px-3 py-2 text-xs text-ink"
                    : "max-w-[92%] rounded-xl rounded-bl-sm border border-line bg-panel px-3 py-2"
                }
              >
                {t.role === "jarvis" && (
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                    <Icon.Bot width={11} height={11} /> Jarvis
                  </p>
                )}
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{t.text}</p>
                {t.did && <p className="mt-1.5 text-[10px] text-ink-faint">{t.did}</p>}
                {t.citations && t.citations.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t border-line-soft pt-1.5">
                    {t.citations.map((c) => (
                      <li key={c.memoryId} className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: SOURCE_COLOR[c.source] }}
                          aria-hidden
                        />
                        {c.title} · {SOURCE_LABEL[c.source]} ·{" "}
                        {c.capturedAt ? new Date(c.capturedAt).toLocaleDateString() : "unknown date"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <p className="text-[11px] text-ink-faint">Jarvis is reading his memory…</p>
          )}

          {pending && (
            <ConfirmCard
              action={pending}
              onConfirm={() => {
                // Stage 4 wires this to the connector. Until then, be honest.
                setPending({
                  ...pending,
                  status: "failed",
                  error: "No app is connected yet, so I can't actually do this. Stage 4 connects them.",
                });
              }}
              onCancel={() => setPending(null)}
            />
          )}

          {proposals.length > 0 && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <p className="mb-1.5 text-xs font-semibold text-ink">Worth remembering?</p>
              <ul className="space-y-2">
                {proposals.map((p, i) => (
                  <li key={i} className="rounded-lg border border-line-soft p-2">
                    <p className="text-xs font-medium text-ink">{p.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">{p.content}</p>
                    <div className="mt-1.5 flex gap-2">
                      <button
                        onClick={() => void saveProposal(p)}
                        className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:text-ink"
                      >
                        Remember it
                      </button>
                      <button
                        onClick={() => setProposals((list) => list.filter((x) => x !== p))}
                        className="text-[11px] text-ink-faint underline hover:text-ink"
                      >
                        No
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-[11px] text-amber-400">{error}</p>}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="border-t border-line bg-panel px-3 py-2"
      >
        <div className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            placeholder="Ask Jarvis…"
            className="max-h-32 min-h-[34px] flex-1 resize-y rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
          >
            <Icon.Send width={13} height={13} /> Ask
          </button>
        </div>
      </form>
    </div>
  );
}
