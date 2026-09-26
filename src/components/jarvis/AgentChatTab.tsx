"use client";

// ---------------------------------------------------------------------------
// The Chat tab: the owner's general agent, on DeepSeek.
//
// It is not the Studio composer with the film parts hidden — it is a different
// job. Studio plans and renders; this one answers, reads the owner's memory and
// folders, and drafts anything that would touch the outside world. So there is
// no camera deck here, no workflows, no shot plan and no track: a picture, a
// question, and what the agent did to answer it.
//
// Three things can appear under an answer, and each is the owner's decision,
// never the agent's:
//
//   trace      — what it actually ran to get there
//   proposals  — what it thinks is worth remembering (save or discard)
//   pending    — what it wants to do in the outside world (yes or no)
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { Markdown } from "./Markdown";
import { SOURCE_COLOR } from "./MemoryCore";
import { traceLines, withImageBudget } from "@/lib/jarvis/agentChat";
import { ACCEPT_IMAGES, imageFiles, MAX_ATTACHMENTS, toAttachment, type Attachment } from "@/lib/jarvis/chatImages";
import { dashboardDigest, isDashboardTool, runDashboardTool } from "@/lib/jarvis/dashboardBridge";
import { recordDigest } from "@/lib/jarvis/record/digest";
import { getRecord } from "@/lib/jarvis/record/store";
import { uid } from "@/lib/jarvis/store";
import { useMemory } from "@/lib/jarvis/useMemory";
import { SOURCE_LABEL, type ChatTurn, type Conversation, type JarvisStore, type PendingAction } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";
import "./agent-chat.css";

interface AgentResponse {
  text?: string;
  citations?: { memoryId: string; title: string; source: keyof typeof SOURCE_COLOR; capturedAt: string }[];
  proposals?: { title: string; content: string }[];
  pending?: { tool: string; app: string; summary: string; args: Record<string, unknown> } | null;
  notices?: string[];
  did?: string[];
  error?: string;
}

/** Pictures per message. Fewer than Studio takes: this is a question, not a shoot. */
const MAX_PICTURES = Math.min(4, MAX_ATTACHMENTS);

/** What the agent should know about the owner without having to look it up. */
function profileContext(p: Profile | null): string {
  if (!p) return "";
  return [
    `Name: ${p.name}`,
    p.intake.q1 ? `Their work: ${p.intake.q1}` : "",
    p.intake.q3.filter(Boolean).length ? `90-day priorities: ${p.intake.q3.filter(Boolean).join(" | ")}` : "",
    p.intake.q4 ? `Tools they use: ${p.intake.q4}` : "",
    p.intake.q6 ? `How they want help: ${p.intake.q6}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const OPENERS = [
  "What do you know about me?",
  "What should I focus on this week?",
  "Go through my lists and tell me what's overdue",
];

export function AgentChatTab({
  store,
  commit,
  profile,
  onDashboardChanged,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
  /** A confirmed folder / calendar / list action ran; the shell re-reads. */
  onDashboardChanged?: () => void;
}) {
  const memory = useMemory(store, commit);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  /**
   * What the agent could not do, as opposed to what went wrong.
   *
   * "Memory is local-only" is not a failure - the answer still stands - so it
   * is told in the quiet voice. An error is told in the loud one.
   */
  const [notice, setNotice] = useState("");
  const [proposals, setProposals] = useState<{ title: string; content: string }[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * Full-size copies of pictures sent this session, by turn id. The saved turn
   * keeps only thumbnails, so this is what lets a follow-up still see them
   * properly — and why a reloaded conversation sends the small ones.
   */
  const fullImages = useRef(new Map<string, string[]>());

  const conversation = store.chat;
  const turns = useMemo(() => conversation?.turns ?? [], [conversation]);
  /** The newest turn animates in; everything above it stays still. */
  const landed = turns[turns.length - 1]?.id ?? "";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  // The box grows with what is typed, up to a point, then scrolls.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  // How long it has been working. An agent chaining tool calls can take half a
  // minute, and a count is the difference between "thinking" and "hung".
  useEffect(() => {
    if (!busy) return setElapsed(0);
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // The answer lands after an await; writing it onto the store captured when
  // the question was asked would drop the question. Always write onto the latest.
  const storeRef = useRef(store);
  storeRef.current = store;

  const writeTurns = (fn: (t: ChatTurn[]) => ChatTurn[]) => {
    const now = new Date().toISOString();
    const current = storeRef.current;
    const existing = current.chat;
    const next: Conversation = existing
      ? { ...existing, turns: fn(existing.turns), updatedAt: now }
      : { id: uid(), title: "Chat", startedAt: now, updatedAt: now, turns: fn([]) };
    commit({ ...current, chat: next });
  };

  const attach = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_PICTURES - attachments.length;
    if (room <= 0) return setError(`Up to ${MAX_PICTURES} pictures on one message.`);
    setError(
      files.length > room ? `Up to ${MAX_PICTURES} pictures on one message — I added the first ${room}.` : "",
    );
    const added: Attachment[] = [];
    for (const f of files.slice(0, room)) {
      try {
        added.push(await toAttachment(f, uid()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that picture.");
      }
    }
    setAttachments((list) => [...list, ...added].slice(0, MAX_PICTURES));
    inputRef.current?.focus();
  };

  const ask = async (text: string) => {
    const question = text.trim();
    const pictures = attachments;
    if ((!question && !pictures.length) || busy) return;
    setInput("");
    setAttachments([]);
    setError("");
    setNotice("");
    setProposals([]);
    setPending(null);

    const asked: ChatTurn = {
      id: uid(),
      role: "you",
      text: question,
      at: new Date().toISOString(),
      ...(pictures.length
        ? {
            images: pictures.map((p) => p.thumb),
            imageInfo: pictures.map((p) => ({ name: p.name, kind: "image" as const })),
          }
        : {}),
    };
    if (pictures.length) fullImages.current.set(asked.id, pictures.map((p) => p.full));
    writeTurns((t) => [...t, asked]);
    setBusy(true);

    try {
      const res = await fetch("/api/jarvis/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: withImageBudget([...turns, asked], fullImages.current),
          ownerName: profile?.name ?? "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          extraContext: [recordDigest(getRecord()), profileContext(profile), await dashboardDigest()].filter(Boolean).join("\n\n"),
        }),
      });
      const data = (await res.json()) as AgentResponse;
      if (!res.ok || data.error) {
        setError(data.error ?? `The agent failed (${res.status}).`);
        setBusy(false);
        return;
      }
      const steps = traceLines(data.did);
      writeTurns((t) => [
        ...t,
        {
          id: uid(),
          role: "jarvis",
          text: data.text ?? "",
          at: new Date().toISOString(),
          citations: data.citations ?? [],
          ...(steps.length ? { steps } : {}),
        },
      ]);
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
      setNotice(data.notices?.length ? data.notices.join(" ") : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the agent.");
    } finally {
      setBusy(false);
    }
  };

  /** The owner said yes. This is the only path from this tab to a real action. */
  const act = async (args: Record<string, unknown>) => {
    if (!pending) return;
    setActing(true);
    try {
      // Folders, the owner's calendar and Lists are written from the browser.
      if (isDashboardTool(pending.tool)) {
        const result = await runDashboardTool(pending.tool, args);
        setPending({ ...pending, status: "done", result });
        onDashboardChanged?.();
        return;
      }
      const res = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: pending.tool, args, confirmed: true }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setPending(
        data.ok
          ? { ...pending, status: "done", result: "Done." }
          : { ...pending, status: "failed", error: data.error ?? "It failed." },
      );
    } catch (e) {
      setPending({ ...pending, status: "failed", error: e instanceof Error ? e.message : "It failed." });
    } finally {
      setActing(false);
    }
  };

  const saveProposal = async (p: { title: string; content: string }) => {
    await memory.save({ source: "chat", title: p.title, content: p.content, origin: "this conversation" });
    setProposals((list) => list.filter((x) => x !== p));
  };

  const clear = () => {
    if (!turns.length || !confirm("Clear this conversation? Saved memories stay.")) return;
    fullImages.current.clear();
    commit({ ...storeRef.current, chat: null });
  };

  return (
    <div
      className="agc relative flex h-[calc(100dvh-49px)] flex-col"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void attach(imageFiles(e.dataTransfer));
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border border-dashed border-ink-faint bg-panel/85 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-sm text-ink">
            <Icon.Image width={16} height={16} /> Drop a picture
          </p>
        </div>
      )}

      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">Chat</h2>
        <span
          title="Every answer on this tab is DeepSeek. Video and shot plans are on Studio."
          className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] tracking-wide text-ink-muted"
        >
          deepseek
        </span>
        <span className="truncate text-[11px] text-ink-faint">
          {memory.remote ? `${memory.memories.length} memories, meaning search` : "local memory only"}
        </span>
        {turns.length > 0 && (
          <button onClick={clear} className="ml-auto text-[11px] text-ink-faint underline hover:text-ink">
            Clear
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto w-full max-w-[760px] space-y-5">
          {turns.length === 0 && (
            <div className="py-10">
              <p className="text-sm text-ink">Ask me something, or drop a picture in.</p>
              <p className="mt-1.5 max-w-[62ch] text-xs leading-relaxed text-ink-muted">
                I work the question: I search your memory, read your master folder, your folders and your
                lists, and chain whatever else I need. Anything that leaves this machine — an email, an
                event, a list entry — I draft and wait for your yes. If I don&apos;t know, I say so.
              </p>
              <div className="mt-5 flex flex-col items-start gap-1.5">
                {OPENERS.map((q) => (
                  <button
                    key={q}
                    onClick={() => void ask(q)}
                    className="group flex items-center gap-2 text-xs text-ink-muted transition hover:text-ink"
                  >
                    <Icon.ArrowRight
                      width={12}
                      height={12}
                      className="text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-ink"
                    />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t) =>
            t.role === "you" ? (
              <div key={t.id} className={`flex justify-end ${t.id === landed ? "agc-land" : ""}`}>
                <div className="max-w-[54ch] rounded-xl rounded-br-sm bg-panel-2 px-3 py-2">
                  {t.images && t.images.length > 0 && (
                    <div className={`flex flex-wrap justify-end gap-1.5 ${t.text ? "mb-2" : ""}`}>
                      {t.images.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={src}
                          alt={t.imageInfo?.[i]?.name ?? `Picture ${i + 1}`}
                          className="h-24 max-w-[160px] rounded-lg border border-line object-cover"
                        />
                      ))}
                    </div>
                  )}
                  {t.text && (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{t.text}</p>
                  )}
                </div>
              </div>
            ) : (
              <article key={t.id} className={t.id === landed ? "agc-land" : ""}>
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                  <Icon.Bot width={11} height={11} /> Jarvis
                </p>
                {t.steps && t.steps.length > 0 && (
                  <ul className="agc-trace mb-2.5 space-y-1 py-0.5 pl-3">
                    {t.steps.map((s, i) => (
                      <li key={i} className="text-[11px] leading-snug text-ink-faint">
                        {s}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="max-w-[70ch]">
                  <Markdown text={t.text} />
                </div>
                {t.citations && t.citations.length > 0 && (
                  <ul className="mt-2.5 space-y-1 border-t border-line-soft pt-2">
                    {t.citations.map((c) => (
                      <li key={c.memoryId} className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: SOURCE_COLOR[c.source] }}
                          aria-hidden
                        />
                        <span className="truncate text-ink-muted">{c.title}</span>
                        <span className="shrink-0">
                          {SOURCE_LABEL[c.source]} ·{" "}
                          {c.capturedAt ? new Date(c.capturedAt).toLocaleDateString() : "unknown date"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ),
          )}

          {busy && (
            <div aria-live="polite">
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                <Icon.Bot width={11} height={11} /> Jarvis
              </p>
              <div className="agc-rail max-w-[70ch]" />
              <p className="mt-1.5 text-[11px] text-ink-faint">
                Working{elapsed > 2 ? ` · ${elapsed}s` : "…"}
              </p>
            </div>
          )}

          {pending && (
            <ConfirmCard
              action={pending}
              busy={acting}
              onConfirm={(args) => void act(args)}
              onCancel={() => setPending({ ...pending, status: "cancelled" })}
            />
          )}

          {proposals.length > 0 && (
            <section className="rounded-xl border border-line bg-panel p-3">
              <p className="mb-2 text-xs font-semibold text-ink">Worth remembering?</p>
              <ul className="space-y-2">
                {proposals.map((p, i) => (
                  <li key={i} className="rounded-lg border border-line-soft p-2">
                    <p className="text-xs font-medium text-ink">{p.title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">{p.content}</p>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void saveProposal(p)}
                        className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
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
            </section>
          )}

          {notice && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-faint">
              <Icon.Bulb width={11} height={11} className="mt-0.5 shrink-0" aria-hidden />
              {notice}
            </p>
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
        className="border-t border-line bg-panel px-3 py-3"
      >
        <div className="agc-composer mx-auto w-full max-w-[760px] rounded-2xl border border-line bg-panel-2 transition">
          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="Pictures on this message">
              {attachments.map((a) => (
                <li key={a.id} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.thumb}
                    alt={a.name}
                    title={a.name}
                    className="h-14 w-14 rounded-lg border border-line object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                    aria-label={`Remove ${a.name}`}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-elevated text-ink-muted opacity-0 transition hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Icon.Close width={10} height={10} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            onPaste={(e) => {
              const files = imageFiles(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              void attach(files);
            }}
            rows={2}
            placeholder="Ask, or give me something to work on…"
            className="block max-h-60 min-h-[72px] w-full resize-none bg-transparent px-3.5 pt-3.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2 px-2 pb-2">
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_IMAGES}
              multiple
              hidden
              onChange={(e) => {
                void attach(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={attachments.length >= MAX_PICTURES}
              title="Add a picture (or paste / drop one)"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line px-2 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-40"
            >
              <Icon.Image width={13} height={13} />
              {attachments.length ? `${attachments.length}/${MAX_PICTURES}` : "Picture"}
            </button>
            <span className="hidden text-[11px] text-ink-faint sm:inline">Enter to send</span>
            <button
              type="submit"
              disabled={busy || (!input.trim() && !attachments.length)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-canvas transition hover:opacity-90 disabled:opacity-40"
            >
              <Icon.Send width={13} height={13} /> {busy ? "Working…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
