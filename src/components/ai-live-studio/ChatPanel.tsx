"use client";

// The live conversation. Reads like a stream's chat, not a messenger: newest
// at the bottom, scrolling by itself unless the owner has scrolled up to read
// (then a "new messages" pill). Viewers, the AI and stream events are three
// different objects. Every queued comment can be answered now, skipped, or
// its sender muted — the owner's hand on a live room.
//
// U6 exception, on purpose: the owner's checklist says newest-first at the
// top, but the brief asks for a real livestream chat, and every livestream
// (TikTok, Twitch) puts the newest line at the bottom.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDown, AtSign, Check, Clock, CornerDownRight, EyeOff, Gift, History, MessageCircle, Mic, PenLine, Send, Share2, ShieldAlert, SkipForward, Star,
  UserPlus, VolumeX, Zap,
} from "lucide-react";
import type { Resolved } from "@/lib/ai-live-studio/command";
import { Monogram, clock, eventLine } from "./bits";
import type { DirectorApi } from "./useDirector";
import type { ChatItem, Studio } from "./useStudio";

const EVENT_ICON = { gift: Gift, follow: UserPlus, share: Share2 } as const;
/** The host's own face beside his lines, so the chat and the stage read as one person. */
const HOST_FACE = "/ai-live-studio/alex.jpg";

function Status({ item }: { item: ChatItem }) {
  switch (item.status) {
    case "queued":
      return <span className="als-tag"><Clock size={11} aria-hidden="true" />{item.note ?? "Queued"}</span>;
    case "answering":
      return <span className="als-tag" data-tone="key"><Mic size={11} aria-hidden="true" />Answering now</span>;
    case "answered":
      return <span className="als-tag"><Check size={11} aria-hidden="true" />Answered</span>;
    case "hidden":
    case "muted":
      return <span className="als-tag" data-tone="crit"><ShieldAlert size={11} aria-hidden="true" />{item.note}</span>;
    default:
      return item.note ? <span className="als-tag"><EyeOff size={11} aria-hidden="true" />{item.note}</span> : null;
  }
}

/** Everything one viewer said this stream, and what Alex said back. */
function ViewerHistory({ item, items }: { item: ChatItem; items: ChatItem[] }) {
  const theirs = items.filter((i) => i.role === "viewer" && i.handle === item.handle);
  const ids = new Set(theirs.map((i) => i.id));
  const thread = items.filter((i) => ids.has(i.id) || (i.role === "ai" && i.replyTo && ids.has(i.replyTo.id)));
  return (
    <div className="als-history" aria-label={`Everything @${item.handle} said this stream`}>
      {thread.map((i) => (
        <div key={i.id} className={i.role === "ai" ? "a" : "v"}>
          <span className="mono">{clock(i.ts)}</span> {i.role === "ai" ? `${i.user}: ` : ""}
          {i.text || eventLine(i.kind ?? "", i.text)}
        </div>
      ))}
    </div>
  );
}

function ViewerRow({ item, studio, d }: { item: ChatItem; studio: Studio; d: DirectorApi }) {
  const [showHistory, setShowHistory] = useState(false);
  if (item.kind === "gift" || item.kind === "follow" || item.kind === "share") {
    const Icon = EVENT_ICON[item.kind];
    return (
      <div className="als-event" data-kind={item.kind}>
        <Icon size={15} aria-hidden="true" />
        <span>
          <b>{item.user}</b> {eventLine(item.kind, item.text)}
        </span>
      </div>
    );
  }
  const canAct = item.status === "queued";
  const canMute = !!item.handle && item.handle !== "you.testing" && item.status !== "muted";
  const selected = studio.selectedId === item.id;
  const isNew = item.status === "queued" && Date.now() - item.ts < 8000;
  const handle = item.handle ?? "";
  const target: Resolved = { by: "comment", id: item.id, handle, user: item.user, text: item.text };
  const mine = studio.items.filter((i) => i.role === "viewer" && i.handle === handle).length;
  const selectable = studio.live && item.status !== "hidden" && item.status !== "muted";
  return (
    <div className="als-msg" data-status={item.status} data-selected={selected ? "true" : "false"}>
      <Monogram name={item.user} handle={item.handle} src={item.avatar} />
      <div>
        <div className="name">
          {isNew && <span className="als-newdot" aria-label="New" />}
          {item.user}
          <span className="time mono">{clock(item.ts)}</span>
          {selected && <span className="als-seltag">Selected</span>}
        </div>
        {selectable ? (
          <button className="text als-textbtn" aria-pressed={selected} onClick={() => studio.setSelectedId(selected ? null : item.id)} title="Select — then direct Alex about it">
            {item.text}
          </button>
        ) : (
          <div className="text">{item.text}</div>
        )}
        <Status item={item} />
        {item.prioritized && canAct && (
          <span className="als-tag" data-tone="priv">
            <Star size={11} aria-hidden="true" />
            Prioritized by you
          </span>
        )}
        {item.instruction && (canAct || item.status === "answering") && (
          <span className="als-tag" data-tone="priv">
            <PenLine size={11} aria-hidden="true" />“{item.instruction}”
          </span>
        )}
        {selected && studio.live && (
          <div className="als-selacts" role="group" aria-label={`Direct Alex about ${item.user}'s comment`}>
            {canAct ? (
              <button className="als-act priv" onClick={() => d.quick(`Answer @${handle} next`, [{ type: "reply", target, instruction: "", promote: true }])}>
                <Zap size={12} aria-hidden="true" />
                Answer next
              </button>
            ) : (
              <button className="als-act priv" onClick={() => d.quick(`Reply again to @${handle}`, [{ type: "reply", target, instruction: "", promote: true }])}>
                <CornerDownRight size={12} aria-hidden="true" />
                Reply again
              </button>
            )}
            <button className="als-act" onClick={() => d.aim("reply-comment", item.id)}>
              <PenLine size={12} aria-hidden="true" />
              Instruct…
            </button>
            <button className="als-act" onClick={() => d.aim("reply-person", item.id)}>
              <AtSign size={12} aria-hidden="true" />
              Reply to @{handle.slice(0, 14)}
            </button>
            {canAct && (
              <button className="als-act" onClick={() => d.quick(`Skip @${handle}'s comment`, [{ type: "skip", target }])}>
                <SkipForward size={12} aria-hidden="true" />
                Skip
              </button>
            )}
            {canMute && (
              <button className="als-act" onClick={() => d.quick(`Ignore @${handle}`, [{ type: "mute", target }])} aria-label={`Ignore ${item.user} for the rest of the stream`}>
                <VolumeX size={12} aria-hidden="true" />
                Mute
              </button>
            )}
            <button className="als-act" aria-expanded={showHistory} onClick={() => setShowHistory((h) => !h)}>
              <History size={12} aria-hidden="true" />
              History ({mine})
            </button>
          </div>
        )}
        {selected && showHistory && <ViewerHistory item={item} items={studio.items} />}
      </div>
      {!selected && (canAct || canMute) && studio.live && (
        <div className="als-actions" role="group" aria-label={`Actions for ${item.user}'s comment`}>
          {canAct && (
            <button className="als-act" onClick={() => studio.answerNow(item.id)}>
              <Zap size={12} aria-hidden="true" />
              Answer now
            </button>
          )}
          {canAct && (
            <button className="als-act" onClick={() => studio.skip(item.id)}>
              <SkipForward size={12} aria-hidden="true" />
              Skip
            </button>
          )}
          {canMute && (
            <button className="als-act" onClick={() => item.handle && studio.muteViewer(item.handle)} aria-label={`Mute ${item.user} for this stream`}>
              <VolumeX size={12} aria-hidden="true" />
              Mute
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AiRow({ item }: { item: ChatItem }) {
  const r = item.replyTo;
  return (
    <div className="als-ai" data-speaking={item.speaking ? "true" : "false"}>
      <div className="head">
        <Monogram name={item.user} src={HOST_FACE} size={20} />
        <span className="me">{item.user}</span>
        {r ? (
          <span className="to">
            <CornerDownRight size={11} aria-hidden="true" style={{ verticalAlign: "-1px" }} /> to <b>@{r.user}</b>
            {r.kind === "comment" || r.kind === "speech" ? <>: {r.text}</> : <> · {eventLine(r.kind, r.text)}</>}
          </span>
        ) : (
          <span className="to">{item.kind === "say" ? "your line" : item.kind === "cue" ? "to the room" : "spoke up"}</span>

        )}
      </div>
      <div className="text">{item.text}</div>
      <div className="foot">
        <span className="mono">{clock(item.ts)}</span>
        {item.speaking && <span>speaking now</span>}
        {item.canned && <span>stock line — no AI key</span>}
        {item.mood && item.mood !== "neutral" && <span>{item.mood}</span>}
      </div>
    </div>
  );
}

/** The response queue: what Alex answers next, in order, and why. */
function UpNextList({ studio }: { studio: Studio }) {
  const { upNext, question, live, metrics, setSelectedId } = studio;
  if (!live || (!upNext.length && !question)) return null;
  return (
    <div className="als-next" aria-label="Up next">
      <div className="h">
        <span>Up next</span>
        <span className="mono">{metrics.queue} waiting</span>
      </div>
      <ol>
        {question && (
          <li data-now="true">
            <span className="n" aria-hidden="true">●</span>
            <span className="t">
              <b>@{question.handle}</b> {question.kind === "comment" || question.kind === "speech" ? question.text : eventLine(question.kind, question.text)}
              <span className="w">Answering now</span>
            </span>
          </li>
        )}
        {upNext.slice(0, question ? 3 : 4).map((u, i) => (
          <li key={u.id}>
            <button onClick={() => setSelectedId(u.id)} aria-label={`Select @${u.handle}'s comment`}>
              <span className="n">{i + (question ? 2 : 1)}</span>
              <span className="t">
                <b>@{u.handle}</b> {u.kind === "comment" || u.kind === "speech" ? u.text : eventLine(u.kind, u.text)}
                <span className="w" data-priv={u.prioritized ? "true" : "false"}>
                  {u.why}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ChatPanel({ studio, director, collapsed, onToggle }: { studio: Studio; director: DirectorApi; collapsed: boolean; onToggle: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [mode, setMode] = useState<"say" | "viewer">("say");
  const [draft, setDraft] = useState("");
  const draftInput = useRef<HTMLInputElement>(null);
  const { items, live, feed, aiState, question, settings } = studio;
  const viewerCount = items.filter((i) => i.role === "viewer").length;

  // New lines scroll into view by themselves (A1) — unless the owner is reading back.
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    if (atBottom) el.scrollTop = el.scrollHeight;
    else setUnseen((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  useEffect(() => {
    if (feed !== "demo" && mode === "viewer") setMode("say");
  }, [feed, mode]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAtBottom(bottom);
    if (bottom) setUnseen(0);
  };

  const jump = () => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
    setUnseen(0);
    setAtBottom(true);
  };

  const submit = () => {
    const t = draft.trim();
    // Nothing typed yet: put the cursor where the words go, rather than a dead button.
    if (!t) return draftInput.current?.focus();
    if (mode === "say") studio.sayLine(t);
    else studio.commentAsViewer(t);
    setDraft("");
  };

  return (
    <aside className="als-chat" data-collapsed={collapsed ? "true" : "false"} data-empty={items.length === 0 ? "true" : "false"} aria-label="Live chat">
      <div className="als-chat-head">
        <MessageCircle size={15} aria-hidden="true" style={{ color: "var(--ink-3)" }} />
        <h2>Live chat</h2>
        <span className="als-count mono">{viewerCount}</span>
        <span className="grow" />
        <span className="als-count">{feed === "demo" ? "Demo audience" : settings.tiktokHandle ? `@${settings.tiktokHandle}` : "TikTok"}</span>
        <button className="als-ghost sm" onClick={onToggle} aria-expanded={!collapsed}>
          {collapsed ? "Show" : "Hide"}
        </button>
      </div>

      <UpNextList studio={studio} />

      <div className="als-list" ref={list} onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions">
        {items.length === 0 ? (
          <div className="als-empty">
            <MessageCircle size={26} aria-hidden="true" />
            <h3>Chat appears here when you go live</h3>
            Press <b style={{ color: "var(--ink)" }}>Go live</b> and {feed === "demo" ? "a demo audience starts talking to " : "TikTok comments start reaching "}
            {settings.name}. You can answer, skip or mute anyone, and type lines for {settings.name} to say.
          </div>
        ) : (
          items.map((item) =>
            item.role === "system" ? (
              <div key={item.id} className="als-hint" style={{ textAlign: "center", margin: "10px 0" }}>
                {item.text}
              </div>
            ) : item.role === "ai" ? (
              <AiRow key={item.id} item={item} />
            ) : (
              <ViewerRow key={item.id} item={item} studio={studio} d={director} />
            ),
          )
        )}
        {live && aiState === "thinking" && question && (
          <div className="als-thinking">
            <Monogram name={settings.name} src={HOST_FACE} size={22} />
            <span className="shimmer">
              {settings.name} is reading {question.user}&rsquo;s {question.kind === "comment" ? "comment" : "moment"}…
            </span>
          </div>
        )}
      </div>

      {!atBottom && unseen > 0 && (
        <button className="als-jump als-glass" onClick={jump}>
          <ArrowDown size={13} aria-hidden="true" />
          {unseen} new
        </button>
      )}

      <div className="als-compose">
        <div className="als-seg" role="group" aria-label="What the message does">
          <button aria-pressed={mode === "say"} onClick={() => setMode("say")}>
            Make {settings.name} say
          </button>
          {feed === "demo" && (
            <button aria-pressed={mode === "viewer"} onClick={() => setMode("viewer")}>
              Comment as a viewer
            </button>
          )}
        </div>
        <form
          className="als-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="sr" htmlFor="als-draft">
            {mode === "say" ? `A line for ${settings.name} to say` : "A test comment"}
          </label>
          <input
            ref={draftInput}
            id="als-draft"
            name={mode === "say" ? "line" : "comment"}
            className="als-input"
            value={draft}
            maxLength={280}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mode === "say" ? `Type a line for ${settings.name}…` : "Type a comment to test…"}
            autoComplete="off"
          />
          <button className="als-send" type="submit" aria-label={mode === "say" ? `Send to ${settings.name}` : "Send test comment"}>
            <Send size={16} aria-hidden="true" />
          </button>
        </form>
        <div className="als-hint">
          {mode === "say"
            ? `${settings.name} says it next, word for word — ahead of every comment.`
            : "Runs the whole pipeline: moderation, the queue, and a real reply."}
        </div>
      </div>
    </aside>
  );
}
