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

import { dashboardDigest, isDashboardTool, runDashboardTool } from "@/lib/jarvis/dashboardBridge";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { SOURCE_COLOR } from "./MemoryCore";
import { uid } from "@/lib/jarvis/store";
import { listSkills } from "@/lib/skills/store";
import { imageFiles, MAX_ATTACHMENTS, toAttachment, type Attachment } from "@/lib/jarvis/chatImages";
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
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<{ title: string; content: string }[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Full-size copies of pictures sent this session, by turn id. The saved turn
  // keeps only thumbnails, so this is what lets a follow-up still see them.
  const fullImages = useRef(new Map<string, string[]>());
  // The Skills tab's list (Supabase-synced), so Jarvis knows every skill on any
  // device — not only after a master-folder sync run on the owner's PC.
  const skills = useRef<{ name: string; about: string; from: string }[]>([]);
  useEffect(() => {
    listSkills()
      .then((list) => {
        skills.current = list.map((s) => ({
          name: s.slug || s.title,
          about: s.overview.slice(0, 160),
          from: s.origin ?? s.source,
        }));
      })
      .catch(() => {});
  }, []);

  const conversation: Conversation | null = useMemo(
    () => store.conversations[0] ?? null,
    [store.conversations],
  );
  const turns = conversation?.turns ?? [];

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

  const attach = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setError(`Up to ${MAX_ATTACHMENTS} images per message.`);
      return;
    }
    setError(files.length > room ? `Up to ${MAX_ATTACHMENTS} images per message — I added the first ${room}.` : "");
    const added: Attachment[] = [];
    for (const f of files.slice(0, room)) {
      try {
        added.push(await toAttachment(f, uid()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that image.");
      }
    }
    setAttachments((list) => [...list, ...added].slice(0, MAX_ATTACHMENTS));
    inputRef.current?.focus();
  };

  // The answer lands after an await; writing it onto the store captured when
  // the question was asked would drop the question. Always write onto the latest.
  const storeRef = useRef(store);
  storeRef.current = store;

  const writeTurns = (fn: (t: ChatTurn[]) => ChatTurn[]) => {
    const now = new Date().toISOString();
    const store = storeRef.current;
    const existing = store.conversations[0];
    const next: Conversation = existing
      ? { ...existing, turns: fn(existing.turns), updatedAt: now }
      : { id: uid(), title: "Conversation", startedAt: now, updatedAt: now, turns: fn([]) };
    commit({ ...store, conversations: [next, ...store.conversations.slice(existing ? 1 : 0)] });
  };

  const ask = async (text: string) => {
    const question = text.trim();
    const pictures = attachments;
    if ((!question && !pictures.length) || busy) return;
    setInput("");
    setAttachments([]);
    setError("");
    setProposals([]);
    setPending(null);
    const asked: ChatTurn = {
      id: uid(),
      role: "you",
      text: question,
      at: new Date().toISOString(),
      ...(pictures.length ? { images: pictures.map((p) => p.thumb) } : {}),
    };
    if (pictures.length) fullImages.current.set(asked.id, pictures.map((p) => p.full));
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
            // After a reload only the thumbnails remain; they still beat nothing.
            images: t.role === "you" ? (fullImages.current.get(t.id) ?? t.images ?? []) : [],
          })),
          ownerName: profile?.name ?? "",
          skills: skills.current,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          extraContext: [profileContext(profile), await dashboardDigest()].filter(Boolean).join("\n\n"),
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

  /** The owner said yes. This is the only path from chat to a real action. */
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
    commit({ ...store, conversations: store.conversations.slice(1) });
  };

  return (
    <div
      className="relative flex h-[calc(100dvh-49px)] flex-col"
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
            <Icon.Image width={16} height={16} /> Drop images for Jarvis to look at
          </p>
        </div>
      )}
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
                {t.images && t.images.length > 0 && (
                  <div className={`flex flex-wrap justify-end gap-1.5 ${t.text ? "mb-1.5" : ""}`}>
                    {t.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt={`Attached image ${i + 1}`}
                        className="h-24 max-w-[160px] rounded-lg border border-line object-cover"
                      />
                    ))}
                  </div>
                )}
                {t.text && <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{t.text}</p>}
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
              busy={acting}
              onConfirm={(args) => void act(args)}
              onCancel={() => setPending({ ...pending, status: "cancelled" })}
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
        className="border-t border-line bg-panel px-3 py-3"
      >
        <div className="mx-auto max-w-3xl rounded-xl border border-line bg-panel-2 transition focus-within:border-ink-faint">
          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((a) => (
                <li key={a.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.thumb} alt={a.name} className="h-16 w-16 rounded-lg border border-line object-cover" />
                  <button
                    type="button"
                    onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                    aria-label={`Remove ${a.name}`}
                    className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-panel text-ink-muted shadow-sm transition hover:text-ink"
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
            placeholder={attachments.length ? "Ask about the image…" : "Ask Jarvis…"}
            className="block max-h-60 min-h-[64px] w-full resize-none bg-transparent px-3 pt-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
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
              disabled={attachments.length >= MAX_ATTACHMENTS}
              title="Add images (or paste / drop them)"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-ink-muted transition hover:bg-panel hover:text-ink disabled:opacity-50"
            >
              <Icon.Image width={14} height={14} /> Image
            </button>
            <span className="hidden text-[11px] text-ink-faint sm:inline">
              Enter to send · Shift+Enter for a new line · paste or drop images
            </span>
            <button
              type="submit"
              disabled={busy || (!input.trim() && !attachments.length)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-panel-2 disabled:opacity-50"
            >
              <Icon.Send width={13} height={13} /> Ask
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
