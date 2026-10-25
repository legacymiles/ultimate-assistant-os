"use client";

// ---------------------------------------------------------------------------
// One thing, up close: where it is in words, how fresh, how far and which way,
// battery — then what you can do (directions, ring, open its finder, "it's
// here", mark lost) and the ladder of ways we find it, each one set up in
// place. Nothing here sends you off to read instructions somewhere else.
// ---------------------------------------------------------------------------

import { useState } from "react";
import {
  ago,
  bearingDeg,
  bestFix,
  compass,
  distanceM,
  distanceText,
  freshness,
  shareLinkLeftMs,
  whereText,
  type Device,
  type Doc,
  type Fix,
  type PingEvent,
} from "@/lib/find-my-life/engine";
import { KIND_BY_ID, SOURCE_LABEL, SOURCE_SHORT, TAG_BY_ID, TAGS, makerFinder, type SourceKind, type TagBrand } from "@/lib/find-my-life/kinds";
import { KindIcon } from "./KindIcon";

export function directionsUrl(f: { lat: number; lng: number }): string {
  const ios = typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  return ios ? `https://maps.apple.com/?daddr=${f.lat},${f.lng}` : `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function Battery({ fix }: { fix?: Fix }) {
  if (fix?.battery === undefined) return null;
  const pct = Math.round(fix.battery * 100);
  const low = pct <= 20 && !fix.charging;
  return (
    <span className="fml-batt" data-low={low} title={`Battery ${pct}%${fix.charging ? ", charging" : ""}`}>
      <span className="fml-batt-cell">
        <i style={{ width: `calc(${Math.max(6, pct)}% - 2px)` }} />
      </span>
      {pct}%{fix.charging ? "⚡" : ""}
    </span>
  );
}

type Act = (action: string, payload?: Record<string, unknown>, label?: string) => Promise<unknown>;

export interface DetailProps {
  device: Device;
  doc: Doc;
  here: Fix | null;
  pingTemplate: string;
  car: { configured: boolean; connected: boolean };
  isThis: boolean;
  act: Act;
  busy: string | null;
  locateNow: () => Promise<Fix | null>;
  makeThisFindable: (name?: string) => Promise<void>;
  toast: (msg: string) => void;
  onClose?: () => void;
}

export function DeviceDetail(p: DetailProps) {
  const { device: d, doc, here, act, busy } = p;
  const kind = KIND_BY_ID[d.kind];
  const fix = bestFix(d);
  const now = new Date();
  const f = d.lost ? "lost" : freshness(fix, now);
  const dist = fix && here ? distanceM(here, fix) : NaN;
  const dir = fix && here && dist > 15 ? compass(bearingDeg(here, fix)) : "";
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(d.name);
  const [open, setOpen] = useState<SourceKind | null>(() => (fix ? null : kind.ladder[0]));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const finder = d.tag && d.tag !== "none" && kind.tagged ? tagOpen(d.tag, ua) : makerFinder(d.kind, ua);
  const canRing = d.fixes.some((x) => x.source === "self");

  const pinHere = async () => {
    const at = here ?? (await p.locateNow());
    if (!at) return;
    await act("fix.manual", { id: d.id, lat: at.lat, lng: at.lng }, "pin");
    p.toast(`Pinned ${d.name} where you are now.`);
  };

  return (
    <div className="fml-detail" data-f={f} data-lost={d.lost ? "true" : undefined}>
      <div className="fml-detail-top">
        <span className="fml-detail-icon">
          <KindIcon kind={d.kind} size={26} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="fml-kicker">
            {kind.label}
            {p.isThis ? " · this device" : ""}
          </p>
          {renaming ? (
            <form
              style={{ display: "flex", gap: 6, marginTop: 4 }}
              onSubmit={async (e) => {
                e.preventDefault();
                await act("device.rename", { id: d.id, name });
                setRenaming(false);
              }}
            >
              <label className="sr-only-fml" htmlFor={`fml-name-${d.id}`}>
                Name
              </label>
              <input id={`fml-name-${d.id}`} className="fml-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={48} />
              <button className="fml-btn fml-btn-hot" type="submit">
                Save
              </button>
            </form>
          ) : (
            <h3 className="fml-display" style={{ fontSize: 21, fontWeight: 700, lineHeight: 1.15, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {d.name}
              {d.lost && <span className="fml-chip fml-chip-lost">Lost</span>}
              <button type="button" className="fml-btn fml-btn-sm" onClick={() => setRenaming(true)} aria-label={`Rename ${d.name}`}>
                Rename
              </button>
            </h3>
          )}
        </div>
        {p.onClose && (
          <button type="button" className="fml-icon-btn" onClick={p.onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <p className="fml-where">{whereText(doc, fix)}</p>
      <p className="fml-where-sub">
        {fix ? (
          <>
            <span className="fml-chip" data-f={f}>
              {SOURCE_SHORT[fix.source]}
            </span>{" "}
            {SOURCE_LABEL[fix.source]} · {ago(fix, now)}
            {fix.acc ? ` · ±${fix.acc < 1000 ? `${Math.round(fix.acc * 3.28)} ft` : `${(fix.acc / 1609).toFixed(1)} mi`}` : ""}
            {fix.detail ? ` · ${fix.detail}` : ""}
          </>
        ) : (
          "Set up one of the ways below and it shows up here by itself."
        )}
      </p>

      {fix && (
        <dl className="fml-facts">
          <div className="fml-fact">
            <dt>From you</dt>
            <dd>{here ? `${distanceText(dist)}${dir ? ` ${dir}` : ""}` : "—"}</dd>
          </div>
          <div className="fml-fact">
            <dt>Seen</dt>
            <dd>{ago(fix, now)}</dd>
          </div>
          {fix.battery !== undefined && (
            <div className="fml-fact">
              <dt>Battery</dt>
              <dd>
                <Battery fix={d.fixes[0]} />
              </dd>
            </div>
          )}
        </dl>
      )}

      <div className="fml-actions">
        {fix && (
          <a className="fml-btn fml-btn-hot" href={directionsUrl(fix)} target="_blank" rel="noopener noreferrer">
            Directions
          </a>
        )}
        {canRing && !p.isThis && (
          <button
            type="button"
            className="fml-btn"
            disabled={busy === "ring"}
            onClick={async () => {
              await act("device.ring", { id: d.id }, "ring");
              p.toast(`Ringing ${d.name} — it chirps if Find My Life is open on it. If not, use ${finder.label}.`);
            }}
          >
            Ring it
          </button>
        )}
        <a className="fml-btn" href={finder.url} target="_blank" rel="noopener noreferrer">
          {finder.label}
        </a>
        <button type="button" className="fml-btn" onClick={() => void pinHere()} disabled={busy === "pin"}>
          It&apos;s here with me
        </button>
        <button
          type="button"
          className={`fml-btn ${d.lost ? "" : "fml-btn-danger"}`}
          onClick={async () => {
            await act("device.lost", { id: d.id, lost: !d.lost });
            p.toast(d.lost ? `${d.name} found. Nice.` : `${d.name} marked lost — it shows first everywhere until you find it.`);
          }}
        >
          {d.lost ? "Found it" : "Mark lost"}
        </button>
      </div>
      {d.lost && (
        <p className="fml-where-sub" style={{ marginTop: 10 }}>
          Lost a phone, iPad, Mac or AirTag? Also turn on <b>Lost Mode</b> in Find My — it locks it and shows your number to whoever finds it.
        </p>
      )}

      <section className="fml-section" aria-labelledby={`ladder-${d.id}`}>
        <p className="fml-kicker" id={`ladder-${d.id}`}>
          How we find it · best first
        </p>
        <p className="fml-where-sub">{kind.how}</p>
        <div className="fml-ladder">
          {kind.ladder.map((s, i) => {
            const on = rungOn(d, s, p.car.connected, now);
            const isOpen = open === s;
            return (
              <div key={s} className="fml-rung" data-on={on}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s)}>
                  <span className="fml-rung-n">{on ? "✓" : i + 1}</span>
                  <span>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{RUNG_TITLE[s](d)}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: "var(--fml-ink-faint)" }}>{rungStatus(d, s, on, p.car, now)}</span>
                  </span>
                  <span className="fml-mono" style={{ fontSize: 11, color: "var(--fml-ink-faint)" }}>
                    {isOpen ? "Hide" : on ? "Details" : "Set up"}
                  </span>
                </button>
                {isOpen && (
                  <div className="fml-rung-body">
                    <RungBody source={s} {...p} pinHere={pinHere} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {d.fixes.length > 0 && (
        <section className="fml-section">
          <p className="fml-kicker">Recent sightings · newest first</p>
          <ul className="fml-history" style={{ listStyle: "none", padding: 0 }}>
            {d.fixes.slice(0, 6).map((x) => (
              <li key={x.at + x.source} data-f={freshness(x, now)}>
                <i />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {whereText(doc, x)} <span style={{ color: "var(--fml-ink-faint)" }}>· {SOURCE_LABEL[x.source]}</span>
                </span>
                <span className="fml-mono" style={{ fontSize: 11 }}>
                  {ago(x, now)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="fml-section" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {confirmRemove ? (
          <>
            <span style={{ fontSize: 13, color: "var(--fml-ink-soft)", alignSelf: "center" }}>Remove {d.name} and its history?</span>
            <button
              type="button"
              className="fml-btn fml-btn-danger"
              onClick={async () => {
                await act("device.remove", { id: d.id });
                p.toast(`Removed ${d.name}.`);
                p.onClose?.();
              }}
            >
              Yes, remove
            </button>
            <button type="button" className="fml-btn" onClick={() => setConfirmRemove(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button type="button" className="fml-btn fml-btn-sm fml-btn-danger" onClick={() => setConfirmRemove(true)}>
            Remove from Find My Life
          </button>
        )}
      </section>
    </div>
  );
}

function tagOpen(tag: TagBrand, ua: string): { label: string; url: string } {
  const t = TAG_BY_ID[tag];
  const ios = /iPhone|iPad/.test(ua);
  return { label: `Open ${t.label.replace(" / Find My", "")}`, url: ios && t.open.ios ? t.open.ios : t.open.web };
}

const RUNG_TITLE: Record<SourceKind, (d: Device) => string> = {
  self: () => "It reports itself",
  shortcut: () => "Background check-ins (iPhone Shortcut)",
  car: () => "Car connection (Smartcar)",
  disconnect: (d) => (d.kind === "car" ? "Parked-here pin (CarPlay / Bluetooth)" : "Last-seen pin when it disconnects"),
  "tag-link": (d) => `Tracker tag${d.tag && d.tag !== "none" ? ` · ${TAG_BY_ID[d.tag].label}` : ""}`,
  manual: () => "Pin it yourself",
};

function lastOf(d: Device, s: SourceKind): Fix | undefined {
  return d.fixes.find((x) => x.source === s);
}

function rungOn(d: Device, s: SourceKind, carConnected: boolean, now: Date): boolean {
  if (s === "car") return Boolean(d.carId && carConnected);
  if (s === "tag-link") return shareLinkLeftMs(d, now) > 0;
  return Boolean(lastOf(d, s));
}

function rungStatus(d: Device, s: SourceKind, on: boolean, car: { configured: boolean; connected: boolean }, now: Date): string {
  const last = lastOf(d, s);
  if (s === "car") return on ? `Connected${last ? ` · last update ${ago(last, now)}` : ""}` : car.configured ? "Not connected yet" : "Needs Smartcar keys (one-time)";
  if (s === "tag-link") {
    const left = shareLinkLeftMs(d, now);
    if (left > 0) return `Share link active · ${Math.ceil(left / 86_400_000)} days left`;
    return d.tag && d.tag !== "none" ? `${TAG_BY_ID[d.tag].label} — tap to open it or add a share link` : "No tag yet";
  }
  if (last) return `Last ${ago(last, now)}`;
  return "Not set up";
}

function RungBody(props: DetailProps & { source: SourceKind; pinHere: () => Promise<void> }) {
  const { source, device: d } = props;
  if (source === "self") {
    return props.isThis ? (
      <p>This is the device you&apos;re holding. It checks in on its own whenever Find My Life or your Jarvis dashboard is open here.</p>
    ) : (
      <>
        <p>Open Jarvis on {d.name}, go to Find My Life, and tap <b>Make this device findable</b>. That&apos;s it — it checks in whenever Jarvis is open on it, and it can ring when you press Ring it.</p>
        <p>
          Holding it right now?{" "}
          <button type="button" className="fml-btn fml-btn-sm" onClick={() => void props.makeThisFindable(d.name)}>
            This is {d.name}
          </button>
        </p>
      </>
    );
  }
  if (source === "shortcut") return <ShortcutGuide {...props} event="ping" />;
  if (source === "disconnect") return <ShortcutGuide {...props} event={d.kind === "car" ? "parked" : "disconnect"} />;
  if (source === "car") return <CarRung {...props} />;
  if (source === "tag-link") return <TagRung {...props} />;
  return (
    <>
      <p>Put it down somewhere you&apos;ll forget? Pin it to where you are right now.</p>
      <button type="button" className="fml-btn fml-btn-sm" onClick={() => void props.pinHere()} style={{ marginTop: 8 }}>
        Pin {d.name} here
      </button>
    </>
  );
}

function ShortcutGuide(props: DetailProps & { event: PingEvent }) {
  const { device: d, event, pingTemplate } = props;
  const url =
    event === "ping"
      ? pingTemplate.replace("DEVICE", d.id)
      : pingTemplate.replace("DEVICE", d.id).replace("&lat=", `&e=${event}&lat=`).replace("&b=[Battery Level]", "");
  const bt = d.btName || (d.kind === "glasses" ? "Ray-Ban Meta" : d.kind === "earbuds" ? "AirPods" : d.kind === "watch" ? "Apple Watch" : "");
  const [btName, setBt] = useState(d.btName ?? "");
  if (!pingTemplate) return <p>Your Shortcut link isn&apos;t ready yet. Reload this page in a moment.</p>;
  const trigger =
    event === "ping" ? (
      <>
        <b>Charger › Is Disconnected</b>, then add more the same way: <b>Leave › Home</b>, <b>Arrive › Work</b>, or <b>Time of Day</b> a few times a day
      </>
    ) : event === "parked" ? (
      <>
        <b>CarPlay › Disconnects</b> (no CarPlay? <b>Bluetooth</b> › your car&apos;s name › <b>Is Disconnected</b>)
      </>
    ) : (
      <>
        <b>Bluetooth</b> › <b>{bt || "its name"}</b> › <b>Is Disconnected</b>
      </>
    );
  return (
    <>
      {event !== "ping" && (
        <p>
          {d.name} can&apos;t report its own location, but your iPhone knows the instant it drops off Bluetooth — so the phone drops a pin right there. That spot is almost always where you left it.
        </p>
      )}
      {event === "disconnect" && (
        <form
          style={{ display: "flex", gap: 6, marginTop: 8 }}
          onSubmit={async (e) => {
            e.preventDefault();
            await props.act("device.bt", { id: d.id, btName });
            props.toast("Saved.");
          }}
        >
          <label className="sr-only-fml" htmlFor={`bt-${d.id}`}>
            Its Bluetooth name
          </label>
          <input id={`bt-${d.id}`} className="fml-input" placeholder={`Its Bluetooth name, e.g. ${bt || "Ray-Ban Meta"}`} value={btName} onChange={(e) => setBt(e.target.value)} />
          <button type="submit" className="fml-btn">
            Save
          </button>
        </form>
      )}
      <ol className="fml-steps">
        <li>
          On your iPhone open <b>Shortcuts</b> › <b>Automation</b> › <b>+</b>, pick {trigger}, and choose <b>Run Immediately</b>.
        </li>
        <li>
          Tap <b>Create New Shortcut</b> and add <b>Get Current Location</b>
          {event === "ping" ? (
            <>
              , then <b>Get Battery Level</b>
            </>
          ) : null}
          .
        </li>
        <li>
          Add <b>Get Contents of URL</b> and paste this link:
          <span className="fml-code">
            <code>{url}</code>
            <button
              type="button"
              className="fml-btn fml-btn-sm"
              onClick={async () => props.toast((await copyText(url)) ? "Link copied — paste it into Get Contents of URL." : "Couldn't copy — press and hold the link to copy it.")}
            >
              Copy
            </button>
          </span>
        </li>
        <li>
          In the pasted link, tap <b>[Latitude]</b> and pick <b>Current Location › Latitude</b>; do the same for <b>[Longitude]</b>
          {event === "ping" ? (
            <>
              {" "}and <b>[Battery Level]</b>
            </>
          ) : null}
          .
        </li>
        <li>
          Tap <b>Done</b>, then run it once with ▶. {d.name} shows up here within seconds
          {lastOf(d, event === "ping" ? "shortcut" : "disconnect") ? " — and it already has" : ""}.
        </li>
      </ol>
      <p style={{ fontSize: 11.5, color: "var(--fml-ink-faint)" }}>This link is private to you. If it ever leaks, make a new one in Setup and the old one stops working.</p>
    </>
  );
}

function CarRung(props: DetailProps) {
  const { car, device: d } = props;
  if (!car.configured) {
    return (
      <>
        <p>Smartcar is the official way in for most car brands (Ford, GM, Toyota, Honda, Tesla, Hyundai, BMW and more): you sign in with your car-maker app login on their screen and approve location, fuel and locks. Jarvis never sees your car password.</p>
        <p>It needs a free Smartcar developer account once. Set it up from Jarvis › Profile › Connections › Cars.</p>
        <p>
          <a className="fml-btn fml-btn-sm" href="/apps/jarvis#connections/cars">
            Set up Smartcar
          </a>
        </p>
        <p>Until then, the parked-here pin below works with no account at all.</p>
      </>
    );
  }
  if (car.connected && d.carId) {
    return (
      <>
        <p>Connected. Jarvis asks the car where it is every few minutes while you&apos;re looking — live location, fuel or charge, and whether it&apos;s locked, when your car shares them.</p>
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="fml-btn fml-btn-sm" onClick={() => void props.act("car.refresh", {}, "car")} disabled={props.busy === "car"}>
            {props.busy === "car" ? "Asking the car…" : "Ask the car now"}
          </button>
        </p>
      </>
    );
  }
  return (
    <>
      <p>Sign in with your car-maker account (the one in your car&apos;s phone app) and approve location. Takes about a minute.</p>
      <p>
        <a className="fml-btn fml-btn-hot fml-btn-sm" href="/api/find-my-life/car/connect">
          Connect car
        </a>
      </p>
    </>
  );
}

function TagRung(props: DetailProps) {
  const { device: d, act } = props;
  const [link, setLink] = useState("");
  const tag = d.tag ?? "none";
  const info = TAG_BY_ID[tag];
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return (
    <>
      <label className="fml-label" htmlFor={`tag-${d.id}`}>
        Which tag is on it?
      </label>
      <select id={`tag-${d.id}`} className="fml-input" value={tag} onChange={(e) => void act("device.tag", { id: d.id, tag: e.target.value })}>
        {TAGS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      {tag === "none" ? (
        <p style={{ marginTop: 10 }}>A tag is the only way to find something with no battery or Bluetooth of its own. An AirTag (iPhone) or a Google Find Hub tag (Android) is about $25-30.</p>
      ) : (
        <p style={{ marginTop: 10 }}>
          <a className="fml-btn fml-btn-sm" href={tagOpen(tag, ua).url} target="_blank" rel="noopener noreferrer">
            {tagOpen(tag, ua).label}
          </a>{" "}
          — the tag&apos;s own app does the arrow-pointing precise finding and plays its sound.
        </p>
      )}
      {info.shareLink && (
        <>
          <p style={{ marginTop: 10 }}>
            <b>See it on this map too:</b> in Find My, open <b>Items</b> › {d.name} › <b>Share Item Location</b>, copy the link and paste it here. Apple keeps it working for 7 days.
          </p>
          <form
            style={{ display: "flex", gap: 6, marginTop: 8 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("device.share", { id: d.id, url: link })) {
                setLink("");
                props.toast("Share link saved.");
              }
            }}
          >
            <label className="sr-only-fml" htmlFor={`share-${d.id}`}>
              Share Item Location link
            </label>
            <input id={`share-${d.id}`} className="fml-input" inputMode="url" placeholder="Paste the share link" value={link} onChange={(e) => setLink(e.target.value)} />
            <button type="submit" className="fml-btn" disabled={!link.trim()}>
              Save
            </button>
          </form>
          {d.shareLink && (
            <p style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <a className="fml-btn fml-btn-sm fml-btn-hot" href={d.shareLink.url} target="_blank" rel="noopener noreferrer">
                Open live location
              </a>
              <button type="button" className="fml-btn fml-btn-sm" onClick={() => void act("device.share", { id: d.id, url: null })}>
                Remove link
              </button>
            </p>
          )}
        </>
      )}
      {tag !== "none" && (
        <p style={{ marginTop: 10, fontSize: 12 }}>
          Tip: carry it with your phone? Set up the <b>last-seen pin</b> too, or tap <b>It&apos;s here with me</b> when you put it down.
        </p>
      )}
    </>
  );
}
