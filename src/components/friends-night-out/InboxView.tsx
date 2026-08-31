"use client";

import { useRef, useState } from "react";
import { inferFormat } from "@/lib/friends-night-out/normalize";
import type { FnoEvent, OrganizerSub } from "@/lib/friends-night-out/types";
import { EventCard } from "./EventCard";

// ---------------------------------------------------------------------------
// Inbox — a link or a flyer becomes an event.
//
// This is the app's honest answer to "search Instagram, TikTok and Facebook".
// None of them has a public event-search endpoint and scraping them breaches
// their terms, so the app never crawls them — it accepts what the user already
// has instead. The flyer-photo path is also the only route in the whole app
// that can reach an event with no web footprint at all: a poster in a coffee
// shop window is sometimes the only record a backyard show has.
//
// Nothing is added without confirmation. Extraction fills a form; the user
// checks it. An auto-added wrong date is worse than a form.
// ---------------------------------------------------------------------------

interface Draft {
  title: string;
  description?: string;
  startsAt?: string;
  venueName?: string;
  address?: string;
  price: { tier: "free" | "paid" | "donation" | "unknown"; min?: number; note?: string };
  category: string;
  url?: string;
  imageUrl?: string;
  method: string;
  missing: string[];
}

export function InboxView({
  savedEvents,
  onAdd,
  onFollowOrganizer,
  organizers,
  onUnfollow,
  onSave,
  onGoing,
  savedIds,
}: {
  savedEvents: FnoEvent[];
  onAdd: (event: Omit<FnoEvent, "id" | "savedAt">) => void;
  onFollowOrganizer: (hint: Omit<OrganizerSub, "id" | "addedAt">) => void;
  organizers: OrganizerSub[];
  onUnfollow: (id: string) => void;
  onSave: (e: FnoEvent) => void;
  onGoing: (e: FnoEvent) => void;
  savedIds: Set<string>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingOrg, setPendingOrg] = useState<Omit<OrganizerSub, "id" | "addedAt"> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const inboxEvents = savedEvents.filter((e) =>
    e.sources.some((s) => s.id === "inbox"),
  );

  async function submitUrl() {
    if (!url.trim()) return;
    setBusy(true);
    setReason(null);
    setDraft(null);
    setPendingOrg(null);
    try {
      const res = await fetch("/api/fno/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.draft) setDraft(data.draft as Draft);
      if (data.reason) setReason(data.reason as string);
      if (data.organizer) {
        setPendingOrg({
          platform: data.organizer.platform,
          externalId: data.organizer.externalId,
          label: data.organizer.label,
        });
      }
      if (!data.draft && !data.reason) setReason("Nothing could be read from that link.");
    } catch {
      setReason("That request failed. Check the link and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitImage(file: File) {
    setBusy(true);
    setReason(null);
    setDraft(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const res = await fetch("/api/fno/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json();
      if (data.draft) setDraft(data.draft as Draft);
      if (data.reason) setReason(data.reason as string);
    } catch {
      setReason("That image could not be read.");
    } finally {
      setBusy(false);
    }
  }

  function commit() {
    if (!draft?.startsAt) return;
    onAdd({
      title: draft.title,
      description: draft.description,
      startsAt: draft.startsAt,
      allDay: false,
      venue: { name: draft.venueName || "Venue not listed", address: draft.address },
      category: (draft.category as FnoEvent["category"]) ?? "Other",
      format: inferFormat(draft.title, draft.description),
      price: draft.price,
      url: draft.url,
      imageUrl: draft.imageUrl,
      sources: [
        { id: "inbox", label: draft.method === "ai-image" ? "Flyer photo" : "Added by you", url: draft.url },
      ],
      // A human looked at this and confirmed it, which is stronger evidence
      // than any automated source in the app can produce.
      obscurity: 92,
      confidence: 0.85,
    });
    setDraft(null);
    setUrl("");
    setReason(null);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-[#20242f] bg-[#12141c] p-4">
        <h2 className="text-[14px] font-semibold text-[#e9ecf3]">Add what you found</h2>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[#8b93a5]">
          Paste any event link and it gets read into a draft. Instagram, TikTok and Facebook
          hide their posts behind a login, so those can&apos;t be fetched — screenshot the post
          or photograph the flyer and drop the image in instead. That path works, and it&apos;s
          the only one that reaches an event with no website at all.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitUrl()}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-lg border border-[#20242f] bg-[#0e1016] px-3 py-2 text-[13px] text-[#e9ecf3] outline-none placeholder:text-[#4d5464] focus:border-[#2f3547]"
          />
          <button
            type="button"
            onClick={submitUrl}
            disabled={busy || !url.trim()}
            className="rounded-lg bg-[#1d212d] px-3 py-2 text-[12.5px] text-[#c3cad9] disabled:opacity-40"
          >
            {busy ? "Reading…" : "Read link"}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-lg border border-[#20242f] px-3 py-2 text-[12.5px] text-[#7c839a] hover:text-[#c3cad9] disabled:opacity-40"
          >
            Flyer photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) submitImage(file);
              e.target.value = "";
            }}
          />
        </div>

        {reason ? (
          <p className="mt-3 rounded-lg border border-[#2c2418] bg-[#161208] px-3 py-2 text-[12.5px] leading-relaxed text-[#d4a15e]">
            {reason}
          </p>
        ) : null}

        {pendingOrg ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#1c3040] bg-[#0b1620] px-3 py-2.5">
            <span className="text-[12.5px] text-[#a8c5d8]">
              That link belongs to <strong>{pendingOrg.label}</strong>. Follow them and every
              future event they post shows up automatically.
            </span>
            <button
              type="button"
              onClick={() => {
                onFollowOrganizer(pendingOrg);
                setPendingOrg(null);
              }}
              className="ml-auto rounded-md bg-[#17384b] px-2.5 py-1 text-[12px] text-[#7dd3fc]"
            >
              Follow
            </button>
          </div>
        ) : null}

        {draft ? (
          <DraftForm draft={draft} setDraft={setDraft} onCommit={commit} onCancel={() => setDraft(null)} />
        ) : null}
      </section>

      {organizers.length ? (
        <section className="rounded-xl border border-[#20242f] bg-[#12141c] p-4">
          <h2 className="text-[14px] font-semibold text-[#e9ecf3]">Following</h2>
          <p className="mt-1 text-[12.5px] text-[#8b93a5]">
            Their whole future calendar is pulled in with every search.
          </p>
          <ul className="mt-3 space-y-1.5">
            {organizers.map((o) => (
              <li
                key={o.id}
                className="flex items-center gap-2 rounded-lg border border-[#1c2029] bg-[#0e1016] px-3 py-2"
              >
                <span className="text-[12.5px] text-[#c3cad9]">{o.label}</span>
                <span className="text-[11px] uppercase tracking-wide text-[#4d5464]">
                  {o.platform}
                </span>
                {o.lastError ? (
                  <span className="text-[11px] text-[#a06a3d]">{o.lastError}</span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onUnfollow(o.id)}
                  className="ml-auto text-[11.5px] text-[#5b6478] hover:text-[#9aa3b5]"
                >
                  unfollow
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {inboxEvents.length ? (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5b6478]">
            Added by you
          </h2>
          {inboxEvents.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              saved={savedIds.has(e.id)}
              onSave={onSave}
              onGoing={onGoing}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function DraftForm({
  draft,
  setDraft,
  onCommit,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const localValue = draft.startsAt ? toLocalInput(draft.startsAt) : "";

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-[#242938] bg-[#0e1016] p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-[#5b6478]">
          {methodLabel(draft.method)}
        </span>
        {draft.missing.length ? (
          <span className="text-[11.5px] text-[#a06a3d]">
            needs {draft.missing.join(" and ")}
          </span>
        ) : null}
      </div>

      <Field label="Title">
        <input
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          className="w-full rounded-md border border-[#20242f] bg-[#101219] px-2.5 py-1.5 text-[13px] text-[#e9ecf3] outline-none focus:border-[#2f3547]"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts">
          <input
            type="datetime-local"
            value={localValue}
            onChange={(e) =>
              setDraft({
                ...draft,
                startsAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
              })
            }
            className="w-full rounded-md border border-[#20242f] bg-[#101219] px-2.5 py-1.5 text-[13px] text-[#e9ecf3] outline-none focus:border-[#2f3547]"
          />
        </Field>
        <Field label="Venue">
          <input
            value={draft.venueName ?? ""}
            onChange={(e) => setDraft({ ...draft, venueName: e.target.value })}
            className="w-full rounded-md border border-[#20242f] bg-[#101219] px-2.5 py-1.5 text-[13px] text-[#e9ecf3] outline-none focus:border-[#2f3547]"
          />
        </Field>
      </div>

      <Field label="Price">
        <div className="flex flex-wrap gap-1.5">
          {(["free", "donation", "paid", "unknown"] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setDraft({ ...draft, price: { ...draft.price, tier } })}
              className="rounded-md px-2.5 py-1 text-[12px] capitalize"
              style={{
                background: draft.price.tier === tier ? "#1d212d" : "transparent",
                color: draft.price.tier === tier ? "#e9ecf3" : "#6b7385",
                boxShadow: draft.price.tier === tier ? "inset 0 0 0 1px #2f3547" : "none",
              }}
            >
              {tier === "unknown" ? "not listed" : tier}
            </button>
          ))}
        </div>
      </Field>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onCommit}
          disabled={!draft.startsAt || !draft.title.trim()}
          className="rounded-lg bg-[#1d3a2a] px-3 py-1.5 text-[12.5px] text-[#6ee7b7] disabled:opacity-40"
        >
          Add to Upcoming
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[12.5px] text-[#6b7385] hover:text-[#9aa3b5]"
        >
          discard
        </button>
        {!draft.startsAt ? (
          <span className="text-[11.5px] text-[#6b7385]">A date is required.</span>
        ) : null}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-[#5b6478]">
        {label}
      </span>
      {children}
    </label>
  );
}

function methodLabel(method: string): string {
  switch (method) {
    case "structured-data":
      return "read from the page's own event data";
    case "page-tags":
      return "read from the page's preview tags";
    case "ai-read":
      return "read from the page text";
    case "ai-image":
      return "read off the flyer";
    default:
      return "draft";
  }
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}
