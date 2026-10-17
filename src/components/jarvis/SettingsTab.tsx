"use client";

// ---------------------------------------------------------------------------
// Settings — every switch Jarvis has, in one place.
//
// Nothing here is new machinery: each row is a control that already existed
// somewhere (the hub's AI pill, Dashboard's security dialog and Drive card,
// the calendar's reminder permission, Composio's connection list) and was hard
// to find. One section per concern, a status on the left, the action on the
// right — dense, like the rest of the app.
// ---------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { AiPanel } from "../hub/AiPanel";
import { DriveBackupCard } from "../recall/DriveBackupCard";
import { SecurityDialog } from "../recall/SecurityDialog";
import type { TabId } from "./tabs";
import { downloadIcs, getEvents } from "@/lib/recall/calendar/store";
import {
  notificationPermission,
  notificationsAvailable,
  requestNotifications,
} from "@/lib/recall/calendar/reminders";
import { getData } from "@/lib/recall/store";
import { UPDATE_ABOUT, UPDATE_COLOR, UPDATE_LABEL, UPDATE_SOURCES } from "@/lib/jarvis/updates";
import type { UpdateSource } from "@/lib/jarvis/updates";
import type { UpdatesApi } from "@/lib/jarvis/useUpdates";

const select =
  "shrink-0 rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink transition-colors hover:border-ink-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const btn =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

function Row({ title, status, children }: { title: ReactNode; status: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line-soft px-3 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{status}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 px-1 text-[11px] font-semibold text-ink-faint">{title}</h3>
      <div className="rounded-xl border border-line bg-panel">{children}</div>
    </section>
  );
}

/**
 * A labelled switch. Two per source row — whether it appears in the feed, and
 * whether it is also allowed to interrupt — because those are genuinely
 * different questions and collapsing them into one control loses the quiet
 * middle setting that most sources want.
 */
function Switch({
  on,
  label,
  disabled,
  title,
  onChange,
  children,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  title?: string;
  onChange: (next: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-35 ${
        on
          ? "border-brand bg-brand/15 text-ink"
          : "border-line text-ink-muted hover:border-ink-faint hover:bg-panel-2 hover:text-ink"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

const Dot = ({ ok }: { ok: boolean }) => (
  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
);

export function SettingsTab({ go, updates }: { go: (t: TabId) => void; updates: UpdatesApi }) {
  const [gated, setGated] = useState<boolean | null>(null);
  const [security, setSecurity] = useState(false);
  const [perm, setPerm] = useState<string>("default");
  const [apps, setApps] = useState<{ available: boolean; reason: string; connectUrl: string; apps: { slug: string; name: string; connected: boolean }[] } | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    setPerm(notificationPermission());
    fetch("/api/recall-unlock")
      .then((r) => r.json())
      .then((d: { gated?: boolean }) => setGated(Boolean(d.gated)))
      .catch(() => setGated(null));
    fetch("/api/jarvis/connectors")
      .then((r) => r.json())
      .then(setApps)
      .catch(() => setApps(null));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const connected = apps?.apps.filter((a) => a.connected) ?? [];

  return (
    <div className="max-w-3xl p-3 sm:p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink">Settings</h2>

      <Group title="Dashboard updates">
        <Row
          title="Pop-ups"
          status={
            !notificationsAvailable() ? (
              "This browser can't show notifications, so updates stay inside Jarvis."
            ) : perm === "granted" ? (
              <>
                <Dot ok />
                Allowed. A source with its bell on will pop up while a Jarvis tab is open — a web
                page cannot reach you once every tab is closed.
              </>
            ) : perm === "denied" ? (
              <>
                <Dot ok={false} />
                Blocked in this browser's site settings. The feed below still works.
              </>
            ) : (
              <>
                <Dot ok={false} />
                Not allowed yet, so the bells below have nothing to ring. The feed still works.
              </>
            )
          }
        >
          {notificationsAvailable() && perm === "default" && (
            <button className={btn} onClick={() => void requestNotifications().then(setPerm)}>
              <Icon.Bell width={13} height={13} /> Allow
            </button>
          )}
        </Row>

        {UPDATE_SOURCES.map((source: UpdateSource) => {
          const pref = updates.settings.sources?.[source] ?? { on: true, popup: false };
          const live = updates.counts?.[source] ?? 0;
          // A bell that cannot ring should not look switchable. The saved
          // preference is kept either way, so allowing notifications later
          // turns the source's pop-ups straight back on.
          const canRing = notificationsAvailable() && perm === "granted";
          return (
            <Row
              key={source}
              title={
                <>
                  <span
                    className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full align-middle"
                    style={{ background: UPDATE_COLOR[source] }}
                    aria-hidden
                  />
                  {UPDATE_LABEL[source]}
                </>
              }
              status={
                <>
                  {UPDATE_ABOUT[source]}{" "}
                  <span className="text-ink-faint">
                    {pref.on ? (live ? `${live} in the feed now.` : "Nothing in the feed now.") : "Switched off."}
                  </span>
                </>
              }
            >
              <Switch
                on={pref.on}
                label="Show"
                title={`Show ${UPDATE_LABEL[source]} in the Updates feed`}
                onChange={(next) =>
                  updates.patchSettings({
                    sources: { ...updates.settings.sources, [source]: { ...pref, on: next } },
                  })
                }
              />
              <Switch
                on={pref.popup}
                label="Pop up"
                disabled={!pref.on || !canRing}
                title={
                  !pref.on
                    ? "Turn this source on first"
                    : !canRing
                      ? "Allow notifications above first"
                      : `Raise a browser notification for ${UPDATE_LABEL[source]}`
                }
                onChange={(next) =>
                  updates.patchSettings({
                    sources: { ...updates.settings.sources, [source]: { ...pref, popup: next } },
                  })
                }
              >
                {pref.popup ? <Icon.Bell width={12} height={12} /> : <Icon.BellOff width={12} height={12} />}
              </Switch>
            </Row>
          );
        })}

        <Row
          title="Your own changes"
          status="Lists can tell you about the items you added yourself. Off by default — you were there."
        >
          <Switch
            on={updates.settings.includeMine === true}
            label={updates.settings.includeMine ? "Included" : "Hidden"}
            onChange={(next) => updates.patchSettings({ includeMine: next })}
          />
        </Row>

        <Row
          title="How far back the feed looks"
          status="Anything older than this stops being an update. It is not deleted — it is just no longer news."
        >
          <select
            className={select}
            value={updates.settings.windowDays ?? 7}
            aria-label="How far back the feed looks"
            onChange={(e) => updates.patchSettings({ windowDays: Number(e.target.value) })}
          >
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "24 hours" : `${d} days`}
              </option>
            ))}
          </select>
        </Row>

        <Row
          title="How early an event counts as news"
          status="A calendar event enters the feed this long before it starts, and drops out once it is underway."
        >
          <select
            className={select}
            value={updates.settings.aheadHours ?? 3}
            aria-label="How early an event counts as news"
            onChange={(e) => updates.patchSettings({ aheadHours: Number(e.target.value) })}
          >
            {[1, 3, 6, 12, 24].map((h) => (
              <option key={h} value={h}>
                {h === 1 ? "1 hour" : `${h} hours`}
              </option>
            ))}
          </select>
        </Row>
      </Group>

      <Group title="AI">
        <Row
          title="Model provider"
          status="Which service every AI call goes through, the fallback, and anything broken — shared by the whole hub."
        >
          <AiPanel inline />
        </Row>
      </Group>

      <Group title="Security">
        <Row
          title="App password and saved passwords"
          status={
            gated === null ? (
              "Checking…"
            ) : (
              <>
                <Dot ok={gated} />
                {gated
                  ? "Jarvis is locked behind a password."
                  : "No password set — anyone who reaches this page can open it."}
              </>
            )
          }
        >
          <button className={btn} onClick={() => setSecurity(true)}>
            <Icon.Shield width={13} height={13} /> Manage
          </button>
          {gated && (
            <button
              className={btn}
              onClick={async () => {
                await fetch("/api/recall-unlock", { method: "DELETE" });
                window.location.href = "/recall-unlock";
              }}
            >
              <Icon.ArrowRight width={13} height={13} /> Sign out
            </button>
          )}
        </Row>
        <Row
          title="Family members"
          status="Invite links, names, colours and who can see private list entries live on the Lists board."
        >
          <button className={btn} onClick={() => go("lists")}>
            <Icon.Users width={13} height={13} /> Open Lists
          </button>
        </Row>
      </Group>

      <Group title="Backup">
        <div className="p-3">
          <DriveBackupCard data={getData()} onToast={setToast} />
        </div>
      </Group>

      <Group title="Calendar">
        <Row
          title="Reminder pop-ups"
          status={
            !notificationsAvailable() ? (
              "This browser can't show notifications — reminders still appear as a banner inside Jarvis."
            ) : (
              <>
                <Dot ok={perm === "granted"} />
                {perm === "granted"
                  ? "On — reminders pop up even when Jarvis is in a background tab."
                  : perm === "denied"
                    ? "Blocked in this browser's site settings. Reminders still show as a banner inside Jarvis."
                    : "Off — reminders only show as a banner while Jarvis is on screen."}
              </>
            )
          }
        >
          {notificationsAvailable() && perm === "default" && (
            <button className={btn} onClick={() => void requestNotifications().then(setPerm)}>
              <Icon.Clock width={13} height={13} /> Turn on
            </button>
          )}
        </Row>
        <Row
          title="Phone calendar"
          status="A web page can't ring your phone when it's closed. Export your events and import the file into your phone's calendar."
        >
          <button className={btn} onClick={() => downloadIcs(getEvents(), "jarvis-calendar.ics")}>
            <Icon.Download width={13} height={13} /> Export .ics
          </button>
        </Row>
      </Group>

      <Group title="Connected apps">
        <Row
          title="Gmail, Google Calendar, Slack and more"
          status={
            !apps ? (
              "Checking…"
            ) : apps.available ? (
              <>
                <Dot ok={connected.length > 0} />
                {connected.length
                  ? `Connected: ${connected.map((a) => a.name).join(", ")}.`
                  : "Composio is set up, but no app is connected yet."}
              </>
            ) : (
              <>
                <Dot ok={false} />
                {apps.reason}
              </>
            )
          }
        >
          {apps?.connectUrl && (
            <a href={apps.connectUrl} target="_blank" rel="noreferrer noopener" className={btn}>
              <Icon.Launch width={13} height={13} /> Connect apps
            </a>
          )}
        </Row>
      </Group>

      {security && (
        <SecurityDialog onClose={() => setSecurity(false)} onData={() => undefined} onToast={setToast} />
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-elevated px-4 py-2 text-xs font-medium text-ink shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
