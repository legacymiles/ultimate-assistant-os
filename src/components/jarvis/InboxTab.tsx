"use client";

// ---------------------------------------------------------------------------
// One list for every connected mailbox and chat app, plus the place messages
// are sent from.
//
// Reading is automatic. Sending never is: a reply — whether the owner wrote it
// or Jarvis drafted it — goes through the confirm card, and only the action
// route can actually send.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { uid } from "@/lib/jarvis/store";
import type { InboxLabel, InboxMessage, JarvisStore, PendingAction } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

const LABELS: { id: InboxLabel; label: string }[] = [
  { id: "needs-reply", label: "Needs reply" },
  { id: "task", label: "Task" },
  { id: "reference", label: "Reference" },
  { id: "done", label: "Done" },
];

/** Which tool sends on a given app. The confirm card shows it before it runs. */
function sendToolFor(app: string): string {
  if (app === "slack") return "slack.send_message";
  if (app === "outlook") return "outlook.send_email";
  return "gmail.send_email";
}

export function InboxTab({
  store,
  commit,
  profile,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
}) {
  const [apps, setApps] = useState<{ slug: string; name: string; connected: boolean }[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [connectUrl, setConnectUrl] = useState("https://app.composio.dev/apps");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<InboxLabel | "all">("all");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const [compose, setCompose] = useState({ app: "gmail", to: "", subject: "", body: "" });

  useEffect(() => {
    fetch("/api/jarvis/connectors")
      .then((r) => r.json())
      .then((d: { available: boolean; reason?: string; connectUrl?: string; apps?: typeof apps }) => {
        setAvailable(d.available);
        setReason(d.reason ?? "");
        setApps(d.apps ?? []);
        if (d.connectUrl) setConnectUrl(d.connectUrl);
      })
      .catch(() => {
        setAvailable(false);
        setReason("Couldn't check your connected apps.");
      });
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setNote("");
    try {
      const res = await fetch("/api/jarvis/inbox?limit=20");
      const data = (await res.json()) as {
        available: boolean;
        reason?: string;
        note?: string;
        failures?: string[];
        messages?: { id: string; app: string; from: string; subject: string; body: string; at: string; link?: string }[];
      };
      if (!data.available) {
        setNote(data.reason ?? "No apps connected.");
        return;
      }
      const incoming: InboxMessage[] = (data.messages ?? []).map((m) => {
        const existing = store.messages.find((x) => x.id === m.id);
        return {
          ...m,
          label: existing?.label ?? "needs-reply",
          read: existing?.read ?? false,
        };
      });
      // Keep anything already stored that the refresh did not return.
      const kept = store.messages.filter((m) => !incoming.some((i) => i.id === m.id));
      commit({ ...store, messages: [...incoming, ...kept].slice(0, 300) });
      setNote(
        [data.note, ...(data.failures ?? [])].filter(Boolean).join(" · ") ||
          `${incoming.length} messages.`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't read your inbox.");
    } finally {
      setLoading(false);
    }
  }, [store, commit]);

  const shown = useMemo(
    () => (filter === "all" ? store.messages : store.messages.filter((m) => m.label === filter)),
    [store.messages, filter],
  );
  const open = useMemo(() => store.messages.find((m) => m.id === selected) ?? null, [store.messages, selected]);

  const setLabel = (id: string, label: InboxLabel) =>
    commit({ ...store, messages: store.messages.map((m) => (m.id === id ? { ...m, label } : m)) });

  const markRead = (id: string) =>
    commit({ ...store, messages: store.messages.map((m) => (m.id === id ? { ...m, read: true } : m)) });

  /** Ask Jarvis for a reply draft. It lands in the compose box, unsent. */
  const draftReply = async (m: InboxMessage) => {
    setBusy(true);
    setNote("Drafting…");
    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content:
                `Draft a reply to this message. Use only confirmed information, mark anything ` +
                `missing as [fill in], and keep it short and in my voice. Reply with the message ` +
                `body only — no preamble.\n\nFrom: ${m.from}\nSubject: ${m.subject}\n\n${m.body}`,
            },
          ],
          ownerName: profile?.name ?? "",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      if (data.error) {
        setNote(data.error);
        return;
      }
      setCompose({ app: m.app, to: m.from, subject: m.subject.startsWith("Re:") ? m.subject : `Re: ${m.subject}`, body: data.text ?? "" });
      setNote("Draft ready — nothing has been sent.");
    } finally {
      setBusy(false);
    }
  };

  const prepareSend = () => {
    if (!compose.to.trim() || !compose.body.trim()) return;
    setPending({
      id: uid(),
      tool: sendToolFor(compose.app),
      app: compose.app,
      summary: `Send a message to ${compose.to}${compose.subject ? ` — "${compose.subject}"` : ""}.`,
      args: {
        recipient_email: compose.to,
        to: compose.to,
        subject: compose.subject,
        body: compose.body,
        text: compose.body,
      },
      createdAt: new Date().toISOString(),
      status: "pending",
    });
  };

  const send = async (args: Record<string, unknown>) => {
    if (!pending) return;
    setBusy(true);
    try {
      const res = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: pending.tool, args, confirmed: true }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setPending({ ...pending, status: "done", result: "Sent." });
        setCompose({ ...compose, to: "", subject: "", body: "" });
      } else {
        setPending({ ...pending, status: "failed", error: data.error ?? "It failed." });
      }
    } finally {
      setBusy(false);
    }
  };

  const connected = apps.filter((a) => a.connected);

  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold text-ink">Inbox</h2>
        <div className="flex gap-1">
          {(["all", ...LABELS.map((l) => l.id)] as const).map((id) => (
            <button
              key={id}
              onClick={() => setFilter(id as InboxLabel | "all")}
              className={`rounded-md px-2 py-1 text-[11px] transition ${
                filter === id ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {id === "all" ? "All" : LABELS.find((l) => l.id === id)?.label}
            </button>
          ))}
        </div>
        <button className={`${btn} ml-auto`} onClick={() => void refresh()} disabled={loading || !available}>
          <Icon.Refresh width={13} height={13} /> {loading ? "Reading…" : "Refresh"}
        </button>
      </div>

      {available === false && (
        <div className="mb-3 rounded-xl border border-dashed border-line bg-panel p-3">
          <p className="text-xs text-ink">No apps are connected yet.</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{reason}</p>
          <a
            href={connectUrl}
            target="_blank"
            rel="noreferrer"
            className={`${btn} mt-2 inline-flex`}
          >
            <Icon.Link width={13} height={13} /> Connect your apps
          </a>
        </div>
      )}

      {connected.length > 0 && (
        <p className="mb-2 text-[11px] text-ink-faint">
          Reading from {connected.map((a) => a.name).join(", ")}.
        </p>
      )}
      {note && <p className="mb-2 text-[11px] text-ink-muted">{note}</p>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="rounded-xl border border-line bg-panel">
          {shown.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-muted">
              Nothing here. {available ? "Refresh to read your connected apps." : "Connect an app to fill this."}
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {shown.map((m) => (
                <li key={m.id}>
                  <button
                    onClick={() => {
                      setSelected(m.id);
                      markRead(m.id);
                    }}
                    className={`flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-panel-2 ${
                      selected === m.id ? "bg-panel-2" : ""
                    }`}
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${m.read ? "bg-transparent" : "bg-sky-400"}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-xs font-medium text-ink">{m.from}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-ink-faint">
                          {new Date(m.at).toLocaleDateString()}
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-ink-muted">{m.subject}</span>
                      <span className="mt-0.5 block text-[10px] text-ink-faint">
                        {m.app} · {LABELS.find((l) => l.id === m.label)?.label}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          {open && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <p className="text-xs font-semibold text-ink">{open.subject}</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {open.from} · {new Date(open.at).toLocaleString()} · {open.app}
              </p>
              <p className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-muted">
                {open.body}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {LABELS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLabel(open.id, l.id)}
                    className={`rounded-md border px-2 py-1 text-[11px] transition ${
                      open.label === l.id
                        ? "border-ink-faint text-ink"
                        : "border-line text-ink-muted hover:text-ink"
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
                <button className={btn} onClick={() => void draftReply(open)} disabled={busy}>
                  <Icon.Sparkles width={13} height={13} /> Draft a reply
                </button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-line bg-panel p-3">
            <h3 className="mb-2 text-xs font-semibold text-ink">Send a message</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={compose.app}
                onChange={(e) => setCompose({ ...compose, app: e.target.value })}
                className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink"
                aria-label="Send via"
              >
                {(connected.length ? connected : [{ slug: "gmail", name: "Gmail" }]).map((a) => (
                  <option key={a.slug} value={a.slug}>
                    Send via {a.name}
                  </option>
                ))}
              </select>
              <input
                value={compose.to}
                onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                placeholder="To (email address or #channel)"
                className="rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
              />
            </div>
            <input
              value={compose.subject}
              onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
              placeholder="Subject"
              className="mt-2 w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
            <textarea
              value={compose.body}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              rows={5}
              placeholder="Write, or ask Jarvis to draft a reply above."
              className="mt-2 w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
            />
            <div className="mt-2 flex items-center gap-2">
              <button className={btn} onClick={prepareSend} disabled={!compose.to.trim() || !compose.body.trim()}>
                <Icon.Send width={13} height={13} /> Review and send
              </button>
              <span className="text-[10px] text-ink-faint">You confirm before anything leaves.</span>
            </div>
          </div>

          {pending && (
            <ConfirmCard
              action={pending}
              busy={busy}
              onConfirm={(args) => void send(args)}
              onCancel={() => setPending({ ...pending, status: "cancelled" })}
            />
          )}
        </section>
      </div>
    </div>
  );
}
