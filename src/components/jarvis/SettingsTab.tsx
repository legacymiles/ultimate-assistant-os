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
import type { TabId } from "./Jarvis";
import { downloadIcs, getEvents } from "@/lib/recall/calendar/store";
import {
  notificationPermission,
  notificationsAvailable,
  requestNotifications,
} from "@/lib/recall/calendar/reminders";
import { getData } from "@/lib/recall/store";

const btn =
  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

function Row({ title, status, children }: { title: string; status: ReactNode; children?: ReactNode }) {
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

const Dot = ({ ok }: { ok: boolean }) => (
  <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${ok ? "bg-emerald-400" : "bg-amber-400"}`} />
);

export function SettingsTab({ go }: { go: (t: TabId) => void }) {
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
