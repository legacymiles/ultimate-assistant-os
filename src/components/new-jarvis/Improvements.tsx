"use client";

// ---------------------------------------------------------------------------
// The Improvements widget.
//
// Jarvis's ideas for the person: for their life (from what they've been going
// through in chat), workflows it could take over, apps worth having, and ways
// Jarvis itself could be easier. The system self-audit's findings show under
// "Jarvis" too, so there is one place for "what could be better".
//
// Nothing here acts on its own. Each idea offers: start it in chat, add it to
// the to-do list, save it for later, mark it done, or "not for me" — which
// also teaches the next refresh to steer away from that direction.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";
import { MiniBtn, Widget, WidgetSheet, stop } from "./Widgets";
import { listsApi } from "@/lib/recall/lists/client";
import { IDEA_KINDS, type Idea, type IdeaKind, type IdeaView } from "@/lib/new-jarvis/ideas";
import type { UseIdeas } from "@/lib/new-jarvis/useIdeas";
import { sendToBoard, ticketForIdea } from "@/lib/new-jarvis/board";

const KIND_COLOR: Record<IdeaKind, string> = {
  life: "var(--hud-green)",
  workflow: "var(--hud)",
  app: "var(--hud-amber)",
  jarvis: "var(--hud-dim)",
};

const KIND_LABEL: Record<IdeaKind, string> = { life: "Life", workflow: "Workflow", app: "App", jarvis: "Jarvis" };

function Dot({ kind }: { kind: IdeaKind }) {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: KIND_COLOR[kind] }} title={KIND_LABEL[kind]} aria-hidden />;
}

function statusLine(ideas: UseIdeas): string | undefined {
  if (ideas.busy) return "Reading your recent chats for ideas…";
  if (ideas.notice) return ideas.notice;
  if (ideas.state.generatedAt) {
    const mins = Math.round((Date.now() - Date.parse(ideas.state.generatedAt)) / 60_000);
    const when = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
    return `From your chats · updated ${when}`;
  }
  return undefined;
}

export function ImprovementsWidget({ ideas, onExpand }: { ideas: UseIdeas; onExpand: () => void }) {
  const rows = ideas.open.ideas.slice(0, 4);
  return (
    <Widget
      title="Improvements"
      icon="Bulb"
      count={ideas.open.ideas.length}
      live={ideas.open.fresh > 0}
      onExpand={onExpand}
      status={statusLine(ideas)}
      actions={
        <MiniBtn label="Get new ideas" onClick={() => void ideas.refresh()} disabled={ideas.busy}>
          <Icon.Refresh width={13} height={13} className={ideas.busy ? "animate-spin" : ""} aria-hidden />
        </MiniBtn>
      }
    >
      {rows.length === 0 ? (
        <div className="py-4 text-center">
          <p className="text-[11.5px] text-ink-faint">
            {ideas.busy
              ? "Thinking…"
              : ideas.saidCount < 3
                ? "Chat with Jarvis a bit — ideas come from what you talk about."
                : "No ideas yet."}
          </p>
          {!ideas.busy && ideas.saidCount >= 3 && (
            <button type="button" className="deck-btn mt-2" onClick={(e) => { stop(e); void ideas.refresh(); }}>
              <Icon.Sparkles width={12} height={12} aria-hidden /> Suggest ideas
            </button>
          )}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((i) => (
            <li key={i.id} className="flex min-w-0 items-start gap-2">
              <span className="mt-[5px]">
                <Dot kind={i.kind} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-ink">{i.title}</p>
                <p className="truncate text-[10.5px] text-ink-faint">
                  {KIND_LABEL[i.kind]} · {i.effort}
                  {ideas.state.saved.includes(i.id) ? " · saved" : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}

const VIEWS: { id: IdeaView; label: string }[] = [
  { id: "open", label: "Ideas" },
  { id: "saved", label: "Saved" },
  { id: "done", label: "Done" },
];

export function ImprovementsExpanded({ ideas, go, onClose }: { ideas: UseIdeas; go: (tab: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState<IdeaKind | "all">("all");
  const [view, setView] = useState<IdeaView>("open");
  const [open, setOpen] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const shown = ideas.view(view, kind);
  const all = ideas.view(view, "all");

  const flash = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2500);
  };

  const toTodo = async (i: Idea) => {
    try {
      await listsApi.addItem({ listId: "todo", text: i.title, note: i.firstStep });
      flash("Added to your to-do list.");
    } catch {
      flash("Couldn't add that to your to-do list. Try again.");
    }
  };

  // App and Jarvis ideas can go straight to the super-board as a Felix card in
  // Backlog — the "build it" button, with the owner still approving the merge.
  const toBoard = async (i: Idea) => {
    flash("Sending to the board…");
    const r = await sendToBoard(ticketForIdea(i));
    flash(r.message);
  };

  const ask = (i: Idea) => {
    ideas.ask(i);
    onClose();
    go("chat");
  };

  return (
    <WidgetSheet
      title="Improvements"
      kicker="Ideas for your life, your workflows, your apps — and Jarvis"
      onClose={onClose}
      actions={
        <button type="button" className="deck-btn" onClick={() => void ideas.refresh()} disabled={ideas.busy}>
          <Icon.Refresh width={12} height={12} className={ideas.busy ? "animate-spin" : ""} aria-hidden />
          {ideas.busy ? "Thinking…" : "New ideas"}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-line-soft px-4 py-2">
        <button
          type="button"
          onClick={() => setKind("all")}
          aria-pressed={kind === "all"}
          className={`rounded-md px-2 py-1 text-[11.5px] transition ${kind === "all" ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"}`}
        >
          All <span className="font-mono text-[10px] text-ink-faint">{all.ideas.length}</span>
        </button>
        {IDEA_KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => setKind(k.id)}
            aria-pressed={kind === k.id}
            title={k.blurb}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] transition ${kind === k.id ? "bg-elevated text-ink" : "text-ink-muted hover:bg-panel-2 hover:text-ink"}`}
          >
            <Dot kind={k.id} />
            {k.label} <span className="font-mono text-[10px] text-ink-faint">{all.counts[k.id]}</span>
          </button>
        ))}
        <div className="ml-auto flex gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              aria-pressed={view === v.id}
              className={`rounded px-2 py-1 text-[11px] transition ${view === v.id ? "text-[var(--hud)]" : "text-ink-faint hover:text-ink"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {(ideas.notice || toast) && (
        <p className="border-b border-line-soft px-4 py-2 text-[11.5px] text-ink-muted" role="status">
          {toast ?? ideas.notice}
        </p>
      )}

      {shown.ideas.length === 0 ? (
        <div className="p-6 text-[12px] text-ink-muted">
          {view === "saved"
            ? "Nothing saved yet. Tap the star on an idea to keep it here."
            : view === "done"
              ? "Nothing marked done yet."
              : ideas.saidCount < 3
                ? "Ideas come from what you talk to Jarvis about. Chat a little, then tap New ideas."
                : kind === "all"
                  ? "No ideas right now. Tap New ideas to have Jarvis read your recent chats."
                  : `No ${KIND_LABEL[kind as IdeaKind].toLowerCase()} ideas right now.`}
        </div>
      ) : (
        <ul className="divide-y divide-line-soft">
          {shown.ideas.map((i) => {
            const isOpen = open === i.id;
            const saved = ideas.state.saved.includes(i.id);
            return (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-panel-2"
                >
                  <span className="mt-[6px]">
                    <Dot kind={i.kind} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-ink">{i.title}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-muted">{i.why}</span>
                  </span>
                  <span className="shrink-0 text-right font-mono text-[10px] text-ink-faint">
                    {KIND_LABEL[i.kind]}
                    <br />
                    {i.effort}
                  </span>
                  {saved && <Icon.Star width={11} height={11} fill="currentColor" className="mt-1 shrink-0 text-[var(--hud-amber)]" aria-label="Saved" />}
                </button>

                {isOpen && (
                  <div className="space-y-2.5 px-4 pb-3 pl-[34px]">
                    <div>
                      <p className="deck-kicker">First step</p>
                      <p className="mt-0.5 text-[12px] text-ink">{i.firstStep}</p>
                    </div>
                    <div>
                      <p className="deck-kicker">{i.origin === "audit" ? "What Jarvis saw in its setup" : "What Jarvis noticed"}</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {i.evidence.map((e, n) => (
                          <li key={n} className="font-mono text-[10.5px] leading-relaxed text-ink-muted">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {view === "done" ? (
                        <button type="button" className="deck-btn" onClick={() => ideas.reopen(i)}>
                          Bring it back
                        </button>
                      ) : (
                        <>
                          <button type="button" className="deck-btn deck-btn--go" onClick={() => ask(i)}>
                            <Icon.Send width={12} height={12} aria-hidden /> Start in chat
                          </button>
                          <button type="button" className="deck-btn" onClick={() => void toTodo(i)}>
                            <Icon.Plus width={12} height={12} aria-hidden /> Add to to-do
                          </button>
                          {(i.kind === "app" || i.kind === "jarvis" || i.kind === "workflow") && (
                            <button
                              type="button"
                              className="deck-btn"
                              title="File it as a card in Backlog on the super-board. Nothing builds until you move it to Ready."
                              onClick={() => void toBoard(i)}
                            >
                              <Icon.ListChecks width={12} height={12} aria-hidden /> Build it (board)
                            </button>
                          )}
                          <button type="button" className="deck-btn" onClick={() => ideas.save(i)}>
                            <Icon.Star width={12} height={12} fill={saved ? "currentColor" : "none"} aria-hidden /> {saved ? "Saved" : "Save"}
                          </button>
                          <button type="button" className="deck-btn" onClick={() => ideas.done(i)}>
                            <Icon.Check width={12} height={12} aria-hidden /> Done
                          </button>
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-[11px] text-ink-faint transition hover:text-ink"
                            onClick={() => {
                              ideas.dismiss(i);
                              setOpen(null);
                            }}
                          >
                            Not for me
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-4 py-3 text-[10.5px] text-ink-faint">
        Ideas come only from what you&apos;ve said to Jarvis{ideas.saidCount ? ` (${ideas.saidCount} messages so far)` : ""}. Nothing happens unless you
        tap a button. &ldquo;Not for me&rdquo; teaches Jarvis what to stop suggesting.
      </p>
    </WidgetSheet>
  );
}
