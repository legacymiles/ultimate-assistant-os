"use client";

// ---------------------------------------------------------------------------
// The owner's site picker — every app in the hub and every client website in
// one searchable dropdown, so the Client view can open any of them and edit it
// on the page like a client would.
//
//   menu  the title of the Client view: tap it, type a few letters, pick.
//   page  the same list, laid out in full, for when nothing is open yet.
//
// Keyboard: ↑ ↓ to move, Enter to open, Esc to close, / to search from the menu.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editableApps } from "@/lib/client-review/apps";
import { admin } from "@/lib/client-review/client";
import type { ClientProject } from "@/lib/client-review/types";

export type Target = { kind: "app"; slug: string } | { kind: "site"; token: string };

interface Row {
  key: string;
  target: Target;
  title: string;
  sub: string;
  status: string;
  tone: "idle" | "wait" | "build";
  group: "Client websites" | "My apps";
}

export function sameTarget(a: Target | null, b: Target | null): boolean {
  if (!a || !b) return false;
  return a.kind === "app" ? b.kind === "app" && b.slug === a.slug : b.kind === "site" && b.token === a.token;
}

function statusOf(p: ClientProject | undefined): Pick<Row, "status" | "tone"> {
  if (!p) return { status: "", tone: "idle" };
  const building = p.versions.find((v) => v.status === "building");
  if (building) return { status: `building ${building.number}`, tone: "build" };
  const waiting = p.batches.filter((b) => b.status === "pending").length;
  if (waiting) return { status: `${waiting} waiting`, tone: "wait" };
  const drafts = p.requests.filter((r) => r.status === "draft").length;
  if (drafts) return { status: `${drafts} not sent`, tone: "wait" };
  const live = [...p.versions].reverse().find((v) => v.status === "review" && v.siteUrl);
  return { status: live && live.number !== "v1" ? live.number : "", tone: "idle" };
}

/** Every client project and app, loaded once per picker. */
function useRows(): { rows: Row[]; error: string; reload: () => void } {
  const [projects, setProjects] = useState<ClientProject[] | null>(null);
  const [error, setError] = useState("");
  const load = () =>
    admin
      .load()
      .then((s) => {
        setProjects(s.projects);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => {
    const list = projects ?? [];
    const clients: Row[] = list
      .filter((p) => !p.appSlug && !p.archived)
      .map((p) => ({
        key: `site:${p.token}`,
        target: { kind: "site", token: p.token },
        title: p.name,
        sub: p.clientName || p.clientUserEmail || "Client website",
        group: "Client websites",
        ...statusOf(p),
      }));
    const byApp = new Map(list.filter((p) => p.appSlug).map((p) => [p.appSlug!, p]));
    const apps: Row[] = editableApps().map((a) => ({
      key: `app:${a.slug}`,
      target: { kind: "app", slug: a.slug },
      title: a.title,
      sub: a.category,
      group: "My apps",
      ...statusOf(byApp.get(a.slug)),
    }));
    return [...clients, ...apps];
  }, [projects]);

  return { rows, error, reload: () => void load() };
}

function matches(r: Row, q: string): boolean {
  if (!q) return true;
  const hay = `${r.title} ${r.sub} ${r.group}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function RowList({
  rows,
  current,
  active,
  onPick,
  onHover,
  dense,
}: {
  rows: Row[];
  current: Target | null;
  active: number;
  onPick: (t: Target) => void;
  onHover?: (i: number) => void;
  dense?: boolean;
}) {
  const groups: Row["group"][] = ["Client websites", "My apps"];
  let i = -1;
  return (
    <>
      {groups.map((g) => {
        const inGroup = rows.filter((r) => r.group === g);
        if (!inGroup.length) return null;
        return (
          <div key={g} className="crp-group" role="group" aria-label={g}>
            <p className="crp-group-name">
              {g} <span>{inGroup.length}</span>
            </p>
            <ul>
              {inGroup.map((r) => {
                i += 1;
                const idx = i;
                const on = sameTarget(r.target, current);
                return (
                  <li key={r.key}>
                    <button
                      role="option"
                      aria-selected={on}
                      data-idx={idx}
                      className={`crp-row ${idx === active ? "is-active" : ""} ${on ? "is-on" : ""} ${dense ? "dense" : ""}`}
                      onMouseEnter={() => onHover?.(idx)}
                      onClick={() => onPick(r.target)}
                    >
                      <span className="crp-title">{r.title}</span>
                      <span className="crp-sub">{r.sub}</span>
                      {r.status && <span className={`crp-status tone-${r.tone}`}>{r.status}</span>}
                      {on && <span className="crp-check" aria-hidden>✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/** The dropdown that sits where the Client view's title was. */
export function SitePickerMenu({ current, label, onPick }: { current: Target | null; label: string; onPick: (t: Target) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const { rows, error, reload } = useRows();
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [phone, setPhone] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => {
    const m = rows.filter((r) => matches(r, q));
    // Same order as the groups render in, so ↑ ↓ walk the list top to bottom.
    return [...m.filter((r) => r.group === "Client websites"), ...m.filter((r) => r.group === "My apps")];
  }, [rows, q]);

  useEffect(() => {
    if (!open) return;
    reload();
    setQ("");
    const at = shown.findIndex((r) => sameTarget(r.target, current));
    setActive(at >= 0 ? at : 0);
    window.setTimeout(() => search.current?.focus(), 30);
    setPhone(window.matchMedia("(max-width: 640px)").matches);
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!wrap.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // "/" opens it from anywhere on the page (not while typing somewhere else).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !open && !t.closest("input, textarea, select, [contenteditable]")) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [open]);

  const pick = (t: Target) => {
    setOpen(false);
    if (!sameTarget(t, current)) onPick(t);
  };

  const popover = (
        <div className="crp-pop" ref={pop} role="dialog" aria-label="Open an app or website">
          <div className="crp-search">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={search}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find an app or website…"
              aria-label="Find an app or website"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(shown.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter" && shown[active]) {
                  e.preventDefault();
                  pick(shown[active].target);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
            <button className="crp-close" onClick={() => setOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="crp-list" role="listbox" ref={list}>
            {error && <p className="crp-note">{error}</p>}
            {!error && !shown.length && <p className="crp-note">Nothing called “{q}”.</p>}
            <RowList rows={shown} current={current} active={active} onPick={pick} onHover={setActive} />
          </div>
        </div>
  );

  return (
    <div className="crp" ref={wrap}>
      <button className="crp-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Switch app or website ( / )">
        <span className="crp-trigger-label">{label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        (phone
          ? createPortal(<div className="crp-scrim">{popover}</div>, document.body)
          : popover)}
    </div>
  );
}

/** The full list, for the Client view when nothing is open yet. */
export function SitePickerPage({ onPick }: { onPick: (t: Target) => void }) {
  const [q, setQ] = useState("");
  const { rows, error } = useRows();
  const shown = rows.filter((r) => matches(r, q));
  return (
    <div className="crp-page">
      <div className="crp-page-head">
        <p className="cr-kicker">Client view</p>
        <h1>What do you want to work on?</h1>
        <p>Open any of your apps or client websites, point at what you want changed, and Send &amp; build — Claude Code makes it and the preview shows up right here.</p>
        <div className="crp-search big">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an app or website…" aria-label="Find an app or website" autoFocus />
        </div>
      </div>
      {error && <p className="crp-note">{error}</p>}
      <div className="crp-page-list">
        <RowList rows={shown} current={null} active={-1} onPick={onPick} dense />
      </div>
    </div>
  );
}
