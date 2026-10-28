"use client";

// ---------------------------------------------------------------------------
// Text Inbox — the app (its own page, and the Jarvis widget's sheet).
//
// Texts from the iPhone, each with a reply Jarvis drafted in the user's
// voice. NOTHING is sent until the user approves (owner's rule, Oct 2026):
//   · on the iPhone, Approve hands the reply straight to the "Jarvis Send"
//     Shortcut, which sends it with Messages and comes back here;
//   · on the computer, Approve puts it in Ready to send and buzzes the phone —
//     one tap on the notification sends it.
// Every reply the user rewrites teaches the next draft their style.
//
// Look: Jarvis HUD (Oxanium + JetBrains Mono, cyan on near-black) via the
// interactive-web-studio skill — a conversation strip per text: their bubble,
// your draft as an editable bubble, one action bar. Words always sit on
// solid panels; phone first (16px inputs, 44px targets).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { SEND_SHORTCUT } from "@/lib/text-inbox/engine";
import { ago, onIphone, sendFromPhone, useTextInbox, type TextView } from "@/lib/text-inbox/client";
import { TextInboxSetup } from "./TextInboxSetup";
import "./text-inbox.css";

type Tab = "approve" | "ready" | "done" | "setup";

function Draft({
  item,
  phone,
  busy,
  onApprove,
  onRedo,
  onDecline,
}: {
  item: TextView;
  phone: boolean;
  busy: boolean;
  onApprove: (reply: string) => void;
  onRedo: (instruction: string) => void;
  onDecline: () => void;
}) {
  const [text, setText] = useState(item.draft);
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  const last = useRef(item.draft);
  // A fresh draft (Redo) replaces the box — unless the user is mid-edit.
  useEffect(() => {
    if (item.draft !== last.current) {
      setText((cur) => (cur === last.current ? item.draft : cur));
      last.current = item.draft;
    }
  }, [item.draft]);
  const drafting = item.status === "drafting";
  return (
    <div className="txi-reply">
      {drafting ? (
        <p className="txi-bubble txi-bubble--me txi-typing" aria-live="polite">
          <span />
          <span />
          <span />
          <em className="txi-faint">{item.instruction ? `Rewriting: ${item.instruction}` : "Writing a reply in your voice…"}</em>
        </p>
      ) : (
        <textarea
          className="txi-bubble txi-bubble--me txi-edit"
          value={text}
          rows={Math.min(6, Math.max(2, Math.ceil(text.length / 38)))}
          maxLength={1500}
          aria-label={`Your reply to ${item.from}`}
          placeholder="Write your reply…"
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {item.draftNote && !drafting && <p className="txi-faint txi-note">{item.draftNote}</p>}
      {asking && (
        <form
          className="txi-ask"
          onSubmit={(e) => {
            e.preventDefault();
            onRedo(instruction);
            setAsking(false);
            setInstruction("");
          }}
        >
          <input
            className="txi-input"
            autoFocus
            value={instruction}
            maxLength={400}
            placeholder="What should it say? e.g. say no nicely, ask what time"
            onChange={(e) => setInstruction(e.target.value)}
          />
          <button type="submit" className="txi-btn">
            Rewrite
          </button>
        </form>
      )}
      <div className="txi-actions">
        <button type="button" className="txi-btn txi-btn--go txi-btn--big" disabled={busy || drafting || !text.trim()} onClick={() => onApprove(text)}>
          <Icon.Send width={14} height={14} aria-hidden /> {phone ? "Approve & send" : "Approve"}
        </button>
        <button type="button" className="txi-btn" disabled={busy || drafting} onClick={() => (asking ? onRedo("") : setAsking(true))} title="Write it again">
          <Icon.Refresh width={13} height={13} aria-hidden /> {asking ? "Just redo" : "Redo"}
        </button>
        <button type="button" className="txi-btn txi-btn--quiet" disabled={busy} onClick={onDecline}>
          <Icon.Close width={13} height={13} aria-hidden /> Decline
        </button>
      </div>
    </div>
  );
}

export function TextInboxApp({ embedded = false }: { embedded?: boolean }) {
  const t = useTextInbox();
  const [tab, setTab] = useState<Tab>("approve");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [phone, setPhone] = useState(false);
  const [sendAsk, setSendAsk] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testFrom, setTestFrom] = useState("Test");
  const [testText, setTestText] = useState("");
  const [, tick] = useState(0);

  const say = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast((x) => (x?.text === text ? null : x)), 4500);
  }, []);
  useEffect(() => {
    if (t.error) say(t.error, true);
  }, [t.error, say]);

  useEffect(() => {
    setPhone(onIphone());
    const iv = window.setInterval(() => tick((x) => x + 1), 30_000);
    // Coming back from the Shortcut, or opened from "Reply ready — tap to send".
    const q = new URLSearchParams(window.location.search);
    if (q.get("sent") === "1") say("Sent from your iPhone ✓");
    if (q.get("send") === "1") setSendAsk(true);
    if (q.has("sent") || q.has("send")) window.history.replaceState(window.history.state, "", window.location.pathname);
    return () => window.clearInterval(iv);
  }, [say]);

  const view = t.view;
  const now = view ? Date.parse(view.now) : Date.now();
  const items = view?.items ?? [];
  const waiting = useMemo(() => items.filter((i) => i.status === "waiting" || i.status === "drafting"), [items]);
  const ready = useMemo(() => items.filter((i) => i.status === "ready"), [items]);
  const done = useMemo(() => items.filter((i) => i.status === "sent" || i.status === "declined"), [items]);

  const firstRun = Boolean(view && !items.length && !view.lastPushAt);
  useEffect(() => {
    if (firstRun) setTab("setup");
  }, [firstRun]);

  // Opened from the notification with replies waiting: hand them to the phone at once.
  useEffect(() => {
    if (!sendAsk || !view) return;
    if (ready.length && onIphone()) {
      setSendAsk(false);
      sendFromPhone();
    } else if (!ready.length) setSendAsk(false);
  }, [sendAsk, view, ready.length]);

  const run = useCallback(
    async (key: string, body: Record<string, unknown>, done?: string) => {
      setBusy(key);
      try {
        await t.act(body);
        if (done) say(done);
        return true;
      } catch (e) {
        say(e instanceof Error ? e.message : "That didn't work.", true);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [t, say],
  );

  const approveOne = useCallback(
    async (item: TextView, reply: string) => {
      const on = phone ? "phone" : "computer";
      const ok = await run(item.id, { action: "approve", id: item.id, reply, on });
      if (!ok) return;
      if (phone) sendFromPhone();
      else
        say(
          view?.pushDevices
            ? `Approved — your phone will buzz. Tap it to send to ${item.from}.`
            : `Approved — it sends the next time ${SEND_SHORTCUT} runs on your phone. Turn on notifications in Set up so it buzzes.`,
        );
    },
    [phone, run, say, view?.pushDevices],
  );

  const tabs: { id: Tab; label: string; n?: number }[] = [
    { id: "approve", label: "To approve", n: waiting.length },
    { id: "ready", label: "Ready to send", n: ready.length },
    { id: "done", label: "Sent" },
    { id: "setup", label: "Set up" },
  ];

  return (
    <div className={`txi ${embedded ? "txi-embedded" : "txi-page"}`}>
      <div className="txi-wrap">
        {!embedded && (
          <header className="txi-head">
            <span className="txi-glyph" aria-hidden>
              <Icon.Chat width={20} height={20} />
            </span>
            <div>
              <p className="txi-kicker">Jarvis · Text Inbox</p>
              <h1 className="txi-display">Your texts, answered in your voice</h1>
            </div>
          </header>
        )}

        <div className="txi-meter txi-mono" aria-label="Summary">
          <span>
            <b>{waiting.length}</b> to approve
          </span>
          <span>
            <b>{ready.length}</b> ready
          </span>
          <span>
            <b>{view?.counts.sent ?? 0}</b> sent
          </span>
          <span className="txi-faint">
            {view?.lastCheckInAt ? `phone checked in ${ago(view.lastCheckInAt, now)}` : view?.lastPushAt ? "phone linked" : "phone not linked yet"}
          </span>
        </div>

        <nav className="txi-tabs" role="tablist" aria-label="Text Inbox">
          {tabs.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className="txi-tab" onClick={() => setTab(x.id)}>
              {x.label}
              {x.n ? <span className="txi-count txi-mono">{x.n}</span> : null}
            </button>
          ))}
        </nav>

        {ready.length > 0 && tab !== "ready" && (
          <button type="button" className="txi-banner" onClick={() => (phone ? sendFromPhone() : setTab("ready"))}>
            <Icon.Send width={14} height={14} aria-hidden />
            {phone ? `Send ${ready.length} approved ${ready.length === 1 ? "reply" : "replies"} now` : `${ready.length} approved — waiting for your phone`}
            <Icon.ArrowRight width={14} height={14} aria-hidden />
          </button>
        )}

        {!view && !t.error && <p className="txi-soft txi-empty">Loading your texts…</p>}

        {view && tab === "approve" && (
          <section className="txi-list" aria-label="Texts to approve">
            {waiting.length === 0 ? (
              <div className="txi-panel txi-empty">
                <p className="txi-soft">{view.lastPushAt ? "All caught up. New texts land here with a reply drafted." : "No texts yet. Link your iPhone in Set up — about 8 minutes."}</p>
                <button type="button" className="txi-btn" onClick={() => setTestOpen((v) => !v)}>
                  Try it with a pretend text
                </button>
                {testOpen && (
                  <form
                    className="txi-ask"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await run("add", { action: "add", from: testFrom, text: testText }, "Drafted — see below.")) setTestText("");
                    }}
                  >
                    <input className="txi-input" value={testFrom} maxLength={60} aria-label="From" onChange={(e) => setTestFrom(e.target.value)} />
                    <input className="txi-input" value={testText} maxLength={500} placeholder="e.g. you still coming tonight?" aria-label="Message" onChange={(e) => setTestText(e.target.value)} />
                    <button type="submit" className="txi-btn txi-btn--go" disabled={!testText.trim() || busy === "add"}>
                      {busy === "add" ? "Drafting…" : "Draft a reply"}
                    </button>
                  </form>
                )}
              </div>
            ) : (
              waiting.map((item) => (
                <article key={item.id} className="txi-card txi-panel">
                  <header className="txi-card-head">
                    <span className="txi-avatar" aria-hidden>
                      {item.from.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "#"}
                    </span>
                    <div>
                      <p className="txi-name">{item.from}</p>
                      <p className="txi-faint txi-mono">
                        {item.to && item.to !== item.from ? `${item.to} · ` : ""}
                        {ago(item.receivedAt, now)}
                      </p>
                    </div>
                  </header>
                  <p className="txi-bubble txi-bubble--them">{item.text}</p>
                  <Draft
                    item={item}
                    phone={phone}
                    busy={busy === item.id}
                    onApprove={(reply) => void approveOne(item, reply)}
                    onRedo={(instruction) => void run(item.id, { action: "redo", id: item.id, instruction })}
                    onDecline={() => void run(item.id, { action: "decline", id: item.id }, "Declined — nothing sent.")}
                  />
                </article>
              ))
            )}
          </section>
        )}

        {view && tab === "ready" && (
          <section className="txi-list" aria-label="Ready to send">
            {phone ? (
              ready.length > 0 && (
                <button type="button" className="txi-btn txi-btn--go txi-btn--big txi-wide" onClick={() => sendFromPhone()}>
                  <Icon.Send width={14} height={14} aria-hidden /> Send {ready.length} now
                </button>
              )
            ) : (
              <div className="txi-panel txi-tip">
                <p className="txi-soft">
                  Your phone sends these. {view.pushDevices ? "It's been buzzed — one tap on the notification sends them." : "Turn on notifications (Set up › Part 3) so it buzzes when you approve here."}
                </p>
                {ready.length > 0 && view.pushDevices > 0 && (
                  <button type="button" className="txi-btn" disabled={busy === "buzz"} onClick={() => void run("buzz", { action: "buzz" }, "Buzzed your phone.")}>
                    <Icon.Bell width={13} height={13} aria-hidden /> Buzz my phone again
                  </button>
                )}
              </div>
            )}
            {ready.length === 0 ? (
              <p className="txi-soft txi-empty">Nothing waiting to send.</p>
            ) : (
              <ul className="txi-rows">
                {ready.map((item) => (
                  <li key={item.id} className="txi-rowitem">
                    <div>
                      <p className="txi-name">
                        To {item.from} <span className="txi-faint txi-mono">· approved {ago(item.approvedAt, now)}</span>
                      </p>
                      <p className="txi-soft">{item.reply}</p>
                    </div>
                    <button type="button" className="txi-btn txi-btn--quiet" disabled={busy === item.id} onClick={() => void run(item.id, { action: "unapprove", id: item.id }, "Back in To approve.")}>
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {view && tab === "done" && (
          <section className="txi-list" aria-label="Sent and declined">
            {done.length === 0 ? (
              <p className="txi-soft txi-empty">Nothing sent yet.</p>
            ) : (
              <ul className="txi-rows">
                {done.map((item) => (
                  <li key={item.id} className="txi-rowitem" data-status={item.status}>
                    <div>
                      <p className="txi-name">
                        {item.from}{" "}
                        <span className="txi-faint txi-mono">
                          · {item.status === "sent" ? `sent ${ago(item.sentAt, now)}` : `declined ${ago(item.declinedAt, now)}`}
                          {item.edited ? " · you rewrote it" : ""}
                        </span>
                      </p>
                      <p className="txi-faint">“{item.text.slice(0, 140)}”</p>
                      {item.reply && item.status === "sent" && <p className="txi-soft">↳ {item.reply}</p>}
                    </div>
                    <div className="txi-row">
                      {item.reply && (
                        <button type="button" className="txi-btn txi-btn--quiet" disabled={busy === item.id} onClick={() => void run(item.id, { action: "sendAgain", id: item.id }, "Back in Ready to send.")}>
                          Send again
                        </button>
                      )}
                      <button type="button" className="txi-btn txi-btn--quiet" disabled={busy === item.id} onClick={() => void run(item.id, { action: "remove", id: item.id })} aria-label="Remove">
                        <Icon.Trash width={13} height={13} aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {view && tab === "setup" && (
          <TextInboxSetup view={view} act={t.act} busy={busy === "key"} say={say} onRotate={() => void run("key", { action: "key.rotate" }, "New links made — paste them into both Shortcuts.")} />
        )}
      </div>

      {toast && (
        <div className={`txi-toast ${toast.bad ? "txi-toast--bad" : ""}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
