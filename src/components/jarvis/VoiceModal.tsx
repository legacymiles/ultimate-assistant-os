"use client";

// ---------------------------------------------------------------------------
// The voice window: the ball, a status line, what was heard, and — when Jarvis
// wants to do something in the outside world — the same confirm card the chat
// uses, answerable by voice or by tapping.
//
// One rule this screen exists to keep visible: hearing "book it" is not
// permission. Jarvis prepares the action, says so out loud, and waits.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { MemoryCore } from "./MemoryCore";
import { isNo, isYes, useVoice } from "@/lib/jarvis/useVoice";
import type { GraphNode } from "@/lib/jarvis/memoryClient";
import type { ChatTurn, PendingAction } from "@/lib/jarvis/types";

interface AgentResponse {
  text?: string;
  pending?: { tool: string; app: string; summary: string; args: Record<string, unknown> } | null;
  proposals?: { title: string; content: string }[];
  error?: string;
}

export function VoiceModal({
  open,
  onClose,
  nodes,
  ownerName,
  history,
  onExchange,
  onProposals,
  runAction,
}: {
  open: boolean;
  onClose: () => void;
  nodes: GraphNode[];
  ownerName: string;
  history: ChatTurn[];
  /** Called with each completed pair so the conversation is kept. */
  onExchange: (question: string, answer: string) => void;
  onProposals: (p: { title: string; content: string }[]) => void;
  /** Executes a confirmed action. Stage 4 supplies the real one. */
  runAction?: (action: PendingAction, args: Record<string, unknown>) => Promise<string>;
}) {
  const voice = useVoice();
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const historyRef = useRef(history);
  historyRef.current = history;

  const ask = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      setHeard(question);
      setSaid("");
      voice.setState("thinking");
      try {
        const res = await fetch("/api/jarvis/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              ...historyRef.current.map((t) => ({
                role: t.role === "you" ? "user" : "assistant",
                content: t.text,
              })),
              { role: "user", content: question },
            ],
            ownerName,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            extraContext: "This is a spoken conversation. Keep the answer to a few sentences a person can follow by ear.",
          }),
        });
        const data = (await res.json()) as AgentResponse;
        if (!res.ok || data.error) {
          setError(data.error ?? `Failed (${res.status}).`);
          voice.setState("idle");
          return;
        }
        const answer = data.text ?? "";
        setSaid(answer);
        onExchange(question, answer);
        if (data.proposals?.length) onProposals(data.proposals);
        if (data.pending) {
          setPending({
            id: Math.random().toString(36).slice(2),
            tool: data.pending.tool,
            app: data.pending.app,
            summary: data.pending.summary,
            args: data.pending.args,
            createdAt: new Date().toISOString(),
            status: "pending",
          });
        }
        await voice.speak(answer);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach Jarvis.");
        voice.setState("idle");
      }
    },
    [ownerName, onExchange, onProposals, voice],
  );

  const confirm = useCallback(
    async (args: Record<string, unknown>) => {
      if (!pending) return;
      setBusy(true);
      if (!runAction) {
        setPending({
          ...pending,
          status: "failed",
          error: "No app is connected yet, so I can't actually do this.",
        });
        setBusy(false);
        return;
      }
      try {
        const result = await runAction(pending, args);
        setPending({ ...pending, status: "done", result });
      } catch (e) {
        setPending({ ...pending, status: "failed", error: e instanceof Error ? e.message : "It failed." });
      } finally {
        setBusy(false);
      }
    },
    [pending, runAction],
  );

  // Press to talk: release ends the turn. A pending action turns the same
  // press into a yes/no answer rather than a new question.
  const finish = useCallback(async () => {
    const text = voice.stopListening();
    if (!text) return;
    if (pending && pending.status === "pending") {
      if (isYes(text)) {
        await confirm(pending.args);
        return;
      }
      if (isNo(text)) {
        setPending({ ...pending, status: "cancelled" });
        return;
      }
    }
    await ask(text);
  }, [voice, pending, confirm, ask]);

  // Space bar as push-to-talk, since this window is meant to be used hands-free.
  useEffect(() => {
    if (!open) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        onClose();
        return;
      }
      if (e.code !== "Space" || e.repeat) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (voice.state === "idle") void voice.startListening();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (voice.state === "listening") void finish();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [open, voice, finish, onClose]);

  useEffect(() => {
    if (!open) {
      voice.stopSpeaking();
      setPending(null);
      setError("");
    }
    // Only react to the window opening and closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const status =
    voice.state === "listening"
      ? "Listening…"
      : voice.state === "thinking"
        ? "Reading my memory…"
        : voice.state === "speaking"
          ? "Speaking…"
          : pending?.status === "pending"
            ? "Waiting for your yes"
            : "Hold the button, or press space";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
      onMouseDown={(e) => {
        // A click on the backdrop closes it; a click inside must not.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-panel/90 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Icon.Mic width={13} height={13} className="text-ink-muted" />
          <span className="text-xs font-semibold text-ink">Talk to Jarvis</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-ink-faint hover:text-ink">
            <Icon.Close width={14} height={14} />
          </button>
        </div>

        <div className="relative bg-black">
          <MemoryCore nodes={nodes} amplitude={voice.amplitude} className="h-52 w-full" />
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center gap-1.5">
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">{status}</p>
            {/* The waveform: the same amplitude the ball uses, as bars. */}
            <div className="flex h-5 items-end gap-0.5">
              {Array.from({ length: 24 }, (_, i) => {
                const wave = Math.sin(i * 0.7 + Date.now() / 200) * 0.5 + 0.5;
                const h = 2 + voice.amplitude * wave * 18;
                return (
                  <span
                    key={i}
                    className="w-0.5 rounded-full bg-ink-muted/70"
                    style={{ height: `${h}px` }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
          {heard && (
            <p className="text-xs text-ink-muted">
              <span className="text-ink-faint">You said:</span> {heard}
            </p>
          )}
          {voice.transcript && voice.state === "listening" && (
            <p className="text-xs text-ink">{voice.transcript}</p>
          )}
          {said && <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{said}</p>}
          {pending && (
            <ConfirmCard
              action={pending}
              busy={busy}
              onConfirm={(args) => void confirm(args)}
              onCancel={() => setPending({ ...pending, status: "cancelled" })}
            />
          )}
          {(error || voice.error) && <p className="text-[11px] text-amber-400">{error || voice.error}</p>}
          {!voice.supported && (
            <p className="text-[11px] text-amber-400">
              This browser can&apos;t listen. Chrome, Edge or Safari can — or type in the Chat tab.
            </p>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 border-t border-line px-3 py-3">
          <button
            onMouseDown={() => void voice.startListening()}
            onMouseUp={() => void finish()}
            onTouchStart={(e) => {
              e.preventDefault();
              void voice.startListening();
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              void finish();
            }}
            disabled={!voice.supported || voice.state === "thinking"}
            className={`flex h-14 w-14 items-center justify-center rounded-full border transition disabled:opacity-40 ${
              voice.state === "listening"
                ? "border-rose-400 bg-rose-500/20 text-rose-200"
                : "border-line bg-panel-2 text-ink-muted hover:text-ink"
            }`}
            aria-label="Hold to talk"
          >
            <Icon.Mic width={20} height={20} />
          </button>
          {voice.state === "speaking" && (
            <button onClick={voice.stopSpeaking} className="text-[11px] text-ink-faint underline hover:text-ink">
              Stop talking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
