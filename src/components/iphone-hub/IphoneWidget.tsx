"use client";

// ---------------------------------------------------------------------------
// iPhone — ONE Dashboard widget for everything that comes in from the owner's
// iPhone through Shortcuts: Notes (read into proposals with a confidence
// score) and Texts (replies drafted in their voice). Owner's call, Oct 2026:
// the two were separate widgets AND App plugins cards; now they are this one
// widget only, with a Notes | Texts switch in the sheet.
//
// Nothing here acts on its own: every note proposal and every reply still
// waits for the owner's Approve inside its own app.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { MiniBtn, Widget, WidgetSheet } from "../new-jarvis/Widgets";
import { ACTION_LABEL } from "@/lib/iphone-notes/engine";
import { useIphoneNotes } from "@/lib/iphone-notes/client";
import { onIphone, sendFromPhone, useTextInbox } from "@/lib/text-inbox/client";
import { IphoneNotesApp } from "../iphone-notes/IphoneNotesApp";
import { TextInboxApp } from "../text-inbox/TextInboxApp";
import "../iphone-notes/iphone-notes.css";
import "../text-inbox/text-inbox.css";

export type IphoneTab = "notes" | "texts";
const TAB_KEY = "jarvis-iphone:tab";

function useCounts() {
  const n = useIphoneNotes();
  const t = useTextInbox();
  const notes = useMemo(
    () =>
      (n.view?.notes ?? [])
        .flatMap((note) => note.items.filter((i) => i.state === "waiting").map((i) => ({ note, i })))
        .sort((a, b) => b.i.confidence.score - a.i.confidence.score),
    [n.view],
  );
  const texts = useMemo(() => (t.view?.items ?? []).filter((i) => i.status === "waiting" || i.status === "drafting"), [t.view]);
  return { n, t, notes, texts, ready: t.view?.counts.ready ?? 0 };
}

export function IphoneWidget({ onExpand }: { onExpand: (tab?: IphoneTab) => void }) {
  const { n, t, notes, texts, ready } = useCounts();
  const [phone, setPhone] = useState(false);
  useEffect(() => setPhone(onIphone()), []);
  const total = notes.length + texts.length;
  const notesLinked = Boolean(n.view?.lastPushAt);
  const textsLinked = Boolean(t.view?.lastPushAt);
  const loading = !n.view && !t.view;

  return (
    <Widget
      title="iPhone"
      icon="Note"
      count={total || undefined}
      live={total > 0}
      onExpand={() => onExpand()}
      actions={
        ready > 0 && phone ? (
          <MiniBtn label={`Send ${ready} approved text${ready === 1 ? "" : "s"}`} onClick={() => sendFromPhone(`${window.location.origin}/apps/jarvis`)}>
            <Icon.Send width={12} height={12} aria-hidden />
          </MiniBtn>
        ) : undefined
      }
      status={
        loading
          ? "Loading…"
          : `Notes ${notesLinked ? `· ${notes.length} waiting` : "· not linked"} · Texts ${textsLinked ? `· ${texts.length} to approve${ready ? ` · ${ready} ready to send` : ""}` : "· not linked"} · nothing runs until you approve`
      }
    >
      <div className="iph-mini">
        <button
          type="button"
          className="iph-row"
          onClick={(e) => {
            e.stopPropagation();
            onExpand("notes");
          }}
        >
          <span className="iph-head">
            <Icon.Note width={12} height={12} aria-hidden /> Notes
            <span className="iph-num">{notes.length}</span>
          </span>
          {notes.length ? (
            notes.slice(0, 2).map(({ note, i }) => (
              <span key={i.id} className="iph-line">
                <span className="iph-score" data-band={i.confidence.band}>
                  {i.confidence.score}
                </span>
                <span className="iph-text">
                  {i.label} <span className="iph-faint">· {ACTION_LABEL[i.action]} · “{note.title}”</span>
                </span>
              </span>
            ))
          ) : (
            <span className="iph-faint iph-line">{notesLinked ? "All caught up." : "Tap to link your iPhone notes (5 min)."}</span>
          )}
        </button>
        <button
          type="button"
          className="iph-row"
          onClick={(e) => {
            e.stopPropagation();
            onExpand("texts");
          }}
        >
          <span className="iph-head">
            <Icon.Chat width={12} height={12} aria-hidden /> Texts
            <span className="iph-num">{texts.length}</span>
          </span>
          {texts.length ? (
            texts.slice(0, 2).map((i) => (
              <span key={i.id} className="iph-line">
                <span className="iph-avatar" aria-hidden>
                  {i.from.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "#"}
                </span>
                <span className="iph-text">
                  {i.from}: {i.text} <span className="iph-faint">· {i.status === "drafting" ? "writing a reply…" : "reply ready to approve"}</span>
                </span>
              </span>
            ))
          ) : (
            <span className="iph-faint iph-line">{textsLinked ? "All caught up." : "Tap to link your iPhone texts (about 8 min)."}</span>
          )}
        </button>
      </div>
    </Widget>
  );
}

export function IphoneExpanded({ onClose, tab: start }: { onClose: () => void; tab?: IphoneTab }) {
  const { notes, texts } = useCounts();
  const [tab, setTab] = useState<IphoneTab>(start ?? "notes");
  useEffect(() => {
    if (start) return;
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === "notes" || saved === "texts") setTab(saved);
    } catch {
      /* private window: start on Notes */
    }
  }, [start]);
  const pick = (t: IphoneTab) => {
    setTab(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* not remembered — fine */
    }
  };
  return (
    <WidgetSheet
      title="iPhone"
      kicker="Notes and texts from your phone · every one waits for your yes"
      onClose={onClose}
      actions={
        <div className="deck-seg" role="tablist" aria-label="Notes or texts">
          <button type="button" role="tab" aria-selected={tab === "notes"} aria-pressed={tab === "notes"} onClick={() => pick("notes")}>
            Notes{notes.length ? ` · ${notes.length}` : ""}
          </button>
          <button type="button" role="tab" aria-selected={tab === "texts"} aria-pressed={tab === "texts"} onClick={() => pick("texts")}>
            Texts{texts.length ? ` · ${texts.length}` : ""}
          </button>
        </div>
      }
    >
      {tab === "notes" ? <IphoneNotesApp embedded inJarvis /> : <TextInboxApp embedded />}
    </WidgetSheet>
  );
}
