"use client";

// ---------------------------------------------------------------------------
// iPhone Notes — the app (its own page, and the Jarvis widget's sheet).
//
// Every note from the iPhone, read by Jarvis into proposals — each with a
// self-improving confidence score — and NOTHING happens until the owner taps
// Approve (owner's rule, Oct 2026). The score sorts and filters; it never acts.
//
// The toy is the Confidence Rail across the top: every waiting proposal is a
// tick at its score; drag the handle to show only what is at least that sure
// (or flip it to see the least sure first), tap a tick to jump to its card.
//
// Look: Jarvis HUD (Oxanium + JetBrains Mono, cyan on near-black) via the
// interactive-web-studio skill. Words always sit on solid panels.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ACTION_LABEL, type NoteAction, type NoteItem, type NoteView, type ItemView } from "@/lib/iphone-notes/engine";
import { sortByConfidence, type ConfidenceSort } from "@/lib/confidence/calibrate";
import { actionLine, decideItem, runItem, useIphoneNotes } from "@/lib/iphone-notes/client";
import { IphoneNotesSetup } from "./IphoneNotesSetup";
import "./iphone-notes.css";

type Tab = "waiting" | "done" | "all";
type Edit = Partial<Pick<NoteItem, "label" | "text" | "date" | "time" | "location" | "name" | "relation" | "when" | "folder">>;

const SORTS: { id: ConfidenceSort; label: string }[] = [
  { id: "most", label: "Most sure" },
  { id: "least", label: "Least sure" },
  { id: "newest", label: "Newest" },
];
const PREF = "iphone-notes:view";

function ago(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function loadPref(): { sort: ConfidenceSort; min: number } {
  try {
    const p = JSON.parse(localStorage.getItem(PREF) || "{}") as { sort?: ConfidenceSort; min?: number };
    return { sort: SORTS.some((s) => s.id === p.sort) ? p.sort! : "most", min: typeof p.min === "number" ? p.min : 0 };
  } catch {
    return { sort: "most", min: 0 };
  }
}

export function IphoneNotesApp({ embedded = false, inJarvis = false }: { embedded?: boolean; inJarvis?: boolean }) {
  const n = useIphoneNotes();
  const [tab, setTab] = useState<Tab>("waiting");
  const [sort, setSort] = useState<ConfidenceSort>("most");
  const [min, setMin] = useState(0);
  const [query, setQuery] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const p = loadPref();
    setSort(p.sort);
    setMin(p.min);
    const t = setInterval(() => tick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREF, JSON.stringify({ sort, min }));
    } catch {
      /* private window — the choice just isn't remembered */
    }
  }, [sort, min]);

  const say = useCallback((text: string, bad = false) => {
    setToast({ text, bad });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 4200);
  }, []);
  useEffect(() => {
    if (n.error) say(n.error, true);
  }, [n.error, say]);

  const view = n.view;
  const now = view ? Date.parse(view.now) : Date.now();
  const notes = view?.notes ?? [];
  const firstRun = Boolean(view && !notes.length && !view.lastPushAt);
  useEffect(() => {
    if (firstRun) setSetupOpen(true);
  }, [firstRun]);

  const waitingItems = useMemo(() => notes.flatMap((x) => x.items.filter((i) => i.state === "waiting").map((i) => ({ note: x, item: i }))), [notes]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = notes.filter((x) => (tab === "waiting" ? x.waiting > 0 || x.status === "reading" : tab === "done" ? x.waiting === 0 && x.status !== "reading" : true));
    if (q) list = list.filter((x) => `${x.title} ${x.body} ${x.items.map((i) => i.label).join(" ")}`.toLowerCase().includes(q));
    if (tab === "waiting" && min > 0) list = list.filter((x) => x.status === "reading" || (x.top ?? 0) >= min);
    return sortByConfidence(list, tab === "waiting" ? sort : "newest", (x) => x.top, (x) => Date.parse(x.receivedAt) || 0);
  }, [notes, tab, query, min, sort]);

  const approve = useCallback(
    async (note: NoteView, item: ItemView, edit?: Edit) => {
      const ready = { ...item, ...(edit ?? {}) };
      setBusy(item.id);
      try {
        // The action runs first; only once it worked is the yes recorded.
        const said = await runItem(note, ready, { inJarvis });
        await decideItem(n.act, { noteId: note.id, itemId: item.id, decision: "approve", changed: Boolean(edit), patch: edit });
        say(said);
      } catch (e) {
        say(e instanceof Error ? e.message : "That didn't work — it's still waiting.", true);
      } finally {
        setBusy(null);
      }
    },
    [inJarvis, n.act, say],
  );

  const decline = useCallback(
    async (note: NoteView, item: ItemView) => {
      setBusy(item.id);
      try {
        await decideItem(n.act, { noteId: note.id, itemId: item.id, decision: "decline" });
        say("Declined — Jarvis will remember.");
      } catch (e) {
        say(e instanceof Error ? e.message : "Couldn't decline that.", true);
      } finally {
        setBusy(null);
      }
    },
    [n.act, say],
  );

  const run = useCallback(
    async (key: string, body: Record<string, unknown>, done?: string) => {
      setBusy(key);
      try {
        await n.act(body);
        if (done) say(done);
        return true;
      } catch (e) {
        say(e instanceof Error ? e.message : "That didn't work.", true);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [n, say],
  );

  const jumpTo = (noteId: string) => {
    document.getElementById(`ipn-${noteId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const learning = view?.learning;

  return (
    <div className={`ipn ${embedded ? "" : "ipn-page"}`}>
      <div className="ipn-wrap">
        {!embedded && (
          <header className="ipn-head">
            <span className="ipn-glyph" aria-hidden>
              <Icon.Note width={16} height={16} />
            </span>
            <div>
              <p className="ipn-kicker">Jarvis · App plugin</p>
              <h1 className="ipn-display">iPhone Notes</h1>
            </div>
          </header>
        )}

        <section className="ipn-panel ipn-summary" aria-label="Summary">
          <div>
            <p className="ipn-big ipn-mono" data-num>
              {waitingItems.length}
            </p>
            <p className="ipn-soft">waiting for your yes</p>
          </div>
          <p className="ipn-soft ipn-learn">
            {learning && learning.decisions
              ? `Learned from ${learning.decisions} of your decisions — ${learning.accepted} taken as guessed. Scores follow what you actually approve.`
              : "Nothing runs until you tap Approve. Scores start as Jarvis's own read and sharpen with every yes and no."}
            {view && !view.ai && " · Simple mode (no AI key yet) — guesses are scored low."}
          </p>
          <div className="ipn-head-actions">
            <button type="button" className="ipn-btn" onClick={() => setSetupOpen((o) => !o)} aria-expanded={setupOpen}>
              <Icon.Settings width={13} height={13} aria-hidden /> {setupOpen ? "Hide setup" : "iPhone setup"}
            </button>
            <button type="button" className="ipn-btn" onClick={() => void n.load()} aria-label="Check for new notes">
              <Icon.Refresh width={13} height={13} aria-hidden />
            </button>
          </div>
          <p className="ipn-faint ipn-mono ipn-last">
            {view?.lastPushAt ? `Last note from your iPhone ${ago(view.lastPushAt, now)}` : view ? "No notes from your iPhone yet" : "Loading…"}
          </p>
        </section>

        {setupOpen && view && (
          <IphoneNotesSetup
            push={view.push}
            pushError={view.pushError}
            lastFail={view.lastFail && (!view.lastPushAt || view.lastFail.at > view.lastPushAt) ? view.lastFail : null}
            busy={busy === "rotate"}
            onRotate={() => void run("rotate", { action: "key.rotate" }, "New link made — paste it into your Shortcut. The old one stopped working.")}
            onCopied={() => say("Link copied — paste it into the Shortcut's URL.")}
          />
        )}

        <ConfidenceRail items={waitingItems} min={min} setMin={setMin} onJump={jumpTo} />

        <div className="ipn-controls">
          <div className="ipn-seg" role="tablist" aria-label="Which notes">
            {(["waiting", "done", "all"] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t === "waiting" ? `Waiting${waitingItems.length ? ` · ${waitingItems.length}` : ""}` : t === "done" ? "Decided" : "All"}
              </button>
            ))}
          </div>
          {tab === "waiting" && (
            <label className="ipn-select">
              <span className="sr-only">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as ConfidenceSort)} aria-label="Sort by">
                {SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label} first
                  </option>
                ))}
              </select>
            </label>
          )}
          <input className="ipn-input ipn-search" type="search" placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
        </div>

        <PasteNote busy={busy === "add"} onAdd={(title, body) => run("add", { action: "add", title, body }, "Read it — see what Jarvis proposes below.")} />

        {!view && !n.error && <p className="ipn-empty">Loading your notes…</p>}
        {view && !shown.length && (
          <p className="ipn-empty">
            {tab === "waiting"
              ? min > 0
                ? `Nothing waiting at ${min}% or higher. Drag the rail's handle left to see the rest.`
                : notes.length
                  ? "All caught up — every note is decided."
                  : "No notes yet. Set up the Shortcut above (5 minutes), or paste a note to try it."
              : query
                ? "No notes match that search."
                : "Nothing here yet."}
          </p>
        )}

        <ul className="ipn-list">
          {shown.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              now={now}
              busy={busy}
              onApprove={approve}
              onDecline={decline}
              onChange={(instruction) => run(`change:${note.id}`, { action: "change", noteId: note.id, instruction }, "Read it again with your words.")}
              onRetry={() => run(`change:${note.id}`, { action: "retry", noteId: note.id })}
              onRemove={() => {
                if (window.confirm(`Remove "${note.title}" from Jarvis? It stays on your iPhone.`)) void run(`rm:${note.id}`, { action: "remove", noteId: note.id }, "Removed from Jarvis — still on your phone.");
              }}
            />
          ))}
        </ul>
      </div>

      {toast && (
        <div role="status" className={`ipn-toast ${toast.bad ? "is-bad" : ""}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

// --- the toy: the Confidence Rail --------------------------------------------

function ConfidenceRail({
  items,
  min,
  setMin,
  onJump,
}: {
  items: { note: NoteView; item: ItemView }[];
  min: number;
  setMin: (n: number) => void;
  onJump: (noteId: string) => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fromPointer = (clientX: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r) return;
    const v = Math.round(((clientX - r.left) / r.width) * 100);
    setMin(Math.max(0, Math.min(95, Math.round(v / 5) * 5)));
  };
  const shownCount = items.filter((x) => x.item.confidence.score >= min).length;
  return (
    <section className="ipn-panel ipn-rail-wrap" aria-label="Confidence rail">
      <div className="ipn-rail-top">
        <p className="ipn-kicker">Confidence</p>
        <p className="ipn-soft ipn-mono">
          {min > 0 ? `showing ${shownCount} at ${min}%+` : `${items.length} waiting · drag to filter`}
          {min > 0 && (
            <button type="button" className="ipn-link" onClick={() => setMin(0)}>
              show all
            </button>
          )}
        </p>
      </div>
      <div
        ref={rail}
        className="ipn-rail"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest(".ipn-tick")) return;
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          fromPointer(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <span className="ipn-rail-band ipn-rail-band--low" aria-hidden />
        <span className="ipn-rail-band ipn-rail-band--mid" aria-hidden />
        <span className="ipn-rail-band ipn-rail-band--high" aria-hidden />
        <span className="ipn-rail-shade" style={{ width: `${min}%` }} aria-hidden />
        {items.map(({ note, item }, k) => (
          <button
            key={item.id}
            type="button"
            className="ipn-tick"
            data-band={item.confidence.band}
            data-dim={item.confidence.score < min || undefined}
            style={{ left: `${item.confidence.score}%`, ["--lift" as string]: `${(k % 3) * 7}px` }}
            title={`${item.confidence.score}% — ${item.label}`}
            aria-label={`${item.label}, ${item.confidence.score}% sure — go to it`}
            onClick={() => onJump(note.id)}
          />
        ))}
        <span className="ipn-handle" style={{ left: `${min}%` }} aria-hidden>
          <span className="ipn-mono">{min}%</span>
        </span>
      </div>
      <input
        className="sr-only"
        type="range"
        min={0}
        max={95}
        step={5}
        value={min}
        onChange={(e) => setMin(Number(e.target.value))}
        aria-label="Only show proposals at least this sure"
      />
      <div className="ipn-rail-scale ipn-mono" aria-hidden>
        <span>0</span>
        <span>50</span>
        <span>80</span>
        <span>100</span>
      </div>
    </section>
  );
}

function Ring({ score, band }: { score: number; band: string }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <span className="ipn-ring" data-band={band} role="img" aria-label={`${score}% sure`}>
      <svg viewBox="0 0 44 44" width="44" height="44" aria-hidden>
        <circle cx="22" cy="22" r={r} className="ipn-ring-track" />
        <circle cx="22" cy="22" r={r} className="ipn-ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 22 22)" />
      </svg>
      <span className="ipn-mono">{score}</span>
    </span>
  );
}

// --- one note ---------------------------------------------------------------------

function NoteCard({
  note,
  now,
  busy,
  onApprove,
  onDecline,
  onChange,
  onRetry,
  onRemove,
}: {
  note: NoteView;
  now: number;
  busy: string | null;
  onApprove: (note: NoteView, item: ItemView, edit?: Edit) => void;
  onDecline: (note: NoteView, item: ItemView) => void;
  onChange: (instruction: string) => Promise<boolean>;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [words, setWords] = useState("");
  const rereading = busy === `change:${note.id}`;
  const body = note.body.trim();
  const long = body.length > 220;
  return (
    <li id={`ipn-${note.id}`} className="ipn-panel ipn-note" data-reading={note.status === "reading" || rereading || undefined}>
      <header className="ipn-note-head">
        <div className="min-w-0">
          <h3 className="ipn-display ipn-note-title">{note.title}</h3>
          <p className="ipn-faint ipn-mono">
            {note.folder ? `${note.folder} · ` : ""}
            {ago(note.receivedAt, now)}
          </p>
        </div>
        <button type="button" className="ipn-icon" onClick={onRemove} aria-label={`Remove ${note.title} from Jarvis`} disabled={busy === `rm:${note.id}`}>
          <Icon.Trash width={14} height={14} aria-hidden />
        </button>
      </header>

      {body && body !== note.title && (
        <button type="button" className="ipn-body" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open || !long ? body : `${body.slice(0, 220)}…`}
          {long && <span className="ipn-link">{open ? " less" : " more"}</span>}
        </button>
      )}

      {note.status === "reading" || rereading ? (
        <p className="ipn-reading ipn-mono">Jarvis is reading this note…</p>
      ) : note.status === "failed" ? (
        <p className="ipn-soft">
          Couldn&apos;t read this one.{" "}
          <button type="button" className="ipn-link" onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : null}

      <ul className="ipn-items">
        {note.items.map((item) => (
          <ItemRow key={item.id} note={note} item={item} busy={busy === item.id} onApprove={onApprove} onDecline={onDecline} />
        ))}
      </ul>

      {note.status !== "reading" && !rereading && (
        <div className="ipn-change">
          {changing ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!words.trim()) return;
                if (await onChange(words.trim())) {
                  setWords("");
                  setChanging(false);
                }
              }}
            >
              <input
                className="ipn-input"
                autoFocus
                value={words}
                onChange={(e) => setWords(e.target.value)}
                placeholder='e.g. "this is my wife&apos;s appointment, Saturday 3pm"'
                aria-label="Tell Jarvis what this note is instead"
              />
              <button type="submit" className="ipn-btn ipn-btn--go" disabled={!words.trim()}>
                Read again
              </button>
              <button type="button" className="ipn-btn" onClick={() => setChanging(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="ipn-link" onClick={() => setChanging(true)}>
              Not right? Tell Jarvis what this note is →
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function ItemRow({
  note,
  item,
  busy,
  onApprove,
  onDecline,
}: {
  note: NoteView;
  item: ItemView;
  busy: boolean;
  onApprove: (note: NoteView, item: ItemView, edit?: Edit) => void;
  onDecline: (note: NoteView, item: ItemView) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<Edit>({});
  const waiting = item.state === "waiting";
  const merged = { ...item, ...edit } as ItemView;
  const changed = Object.keys(edit).length > 0;
  const set = (k: keyof Edit, v: string) => setEdit((e) => ({ ...e, [k]: v }));

  return (
    <li className="ipn-item" data-state={item.state}>
      <Ring score={item.confidence.score} band={waiting ? item.confidence.band : "off"} />
      <div className="ipn-item-main">
        <p className="ipn-item-line">
          <span className="ipn-chip" data-action={item.action}>
            {ACTION_LABEL[item.action]}
          </span>
          <span className="ipn-item-label">{merged.label}</span>
        </p>
        {waiting ? (
          <>
            <p className="ipn-why">{item.why || item.confidence.why}</p>
            {item.why && <p className="ipn-faint ipn-calib">{item.confidence.why}</p>}
          </>
        ) : (
          <p className="ipn-faint ipn-mono">
            {item.state === "done" ? `Approved${item.changed ? " (edited)" : ""}` : "Declined"}
          </p>
        )}

        {waiting && editing && <EditFields item={merged} action={item.action} set={set} />}

        {waiting && (
          <div className="ipn-item-actions">
            <button type="button" className="ipn-btn ipn-btn--go" disabled={busy} onClick={() => onApprove(note, item, changed ? edit : undefined)}>
              <Icon.Check width={13} height={13} aria-hidden />
              {busy ? "Working…" : `Approve · ${actionLine(merged)}`}
            </button>
            <button type="button" className="ipn-btn" disabled={busy} onClick={() => setEditing((x) => !x)} aria-expanded={editing}>
              <Icon.Edit width={13} height={13} aria-hidden /> {editing ? "Done editing" : "Edit"}
            </button>
            <button type="button" className="ipn-btn" disabled={busy} onClick={() => onDecline(note, item)}>
              <Icon.Close width={12} height={12} aria-hidden /> Decline
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function EditFields({ item, action, set }: { item: ItemView; action: NoteAction; set: (k: keyof Edit, v: string) => void }) {
  const field = (k: keyof Edit, label: string, type = "text") => (
    <label className="ipn-field">
      <span>{label}</span>
      <input className="ipn-input" type={type} value={(item[k] as string | null | undefined) ?? ""} onChange={(e) => set(k, e.target.value)} />
    </label>
  );
  return (
    <div className="ipn-edit">
      {field("label", "Title")}
      {(action === "todo" || action === "memory" || action === "queue" || action === "task") && field("text", action === "todo" ? "To-do" : "Text")}
      {action === "todo" && field("date", "Due", "date")}
      {action === "event" && (
        <>
          {field("date", "Day", "date")}
          {field("time", "Time", "time")}
          {field("location", "Where")}
        </>
      )}
      {action === "birthday" && (
        <>
          {field("name", "Whose")}
          {field("when", "Date (e.g. Nov 12)")}
          {field("relation", "Relation")}
        </>
      )}
      {action === "save" && field("folder", "Folder")}
    </div>
  );
}

function PasteNote({ busy, onAdd }: { busy: boolean; onAdd: (title: string, body: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open) {
    return (
      <button type="button" className="ipn-link ipn-paste-open" onClick={() => setOpen(true)}>
        + Paste or type a note to try it
      </button>
    );
  }
  return (
    <form
      className="ipn-panel ipn-paste"
      onSubmit={async (e) => {
        e.preventDefault();
        const body = text.trim();
        if (!body) return;
        if (await onAdd(body.split("\n")[0].slice(0, 200), body)) {
          setText("");
          setOpen(false);
        }
      }}
    >
      <textarea className="ipn-input" rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={"Groceries\n- milk\n- eggs\nMom bday Nov 12"} aria-label="Note text" />
      <div className="ipn-item-actions">
        <button type="submit" className="ipn-btn ipn-btn--go" disabled={busy || !text.trim()}>
          {busy ? "Reading…" : "Read it"}
        </button>
        <button type="button" className="ipn-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

