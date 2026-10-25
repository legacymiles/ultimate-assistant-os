"use client";

// ---------------------------------------------------------------------------
// "Set up your iPhone" — the whole Camera Autopilot phone setup, one step at a
// time, inside Jarvis.
//
// There is no App Store app and none is needed: Apple's own Shortcuts app
// sends the photos to this website, and an Automation runs that Shortcut by
// itself whenever the Camera app closes. A web page cannot do either half on
// its own, so the guide's job is to make the parts the owner does by hand
// impossible to get wrong — exact names, the link and token one tap from the
// clipboard, and a test at the end that says whether it worked.
//
// Built on the phone is far easier than built on a laptop (copy in Safari,
// paste in Shortcuts), so step one is a QR code that opens this guide there.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Icon } from "../icons";
import "./deck.css";
import { WidgetSheet } from "./Widgets";
import type { CameraWatch } from "@/lib/new-jarvis/useCameraWatch";

const SHORTCUT_NAME = "Send to Jarvis";
/**
 * Two optional shortcuts past the manual build, both set as Vercel env vars:
 *   NEXT_PUBLIC_IPHONE_SETUP_VIDEO — a screen recording of the build (an mp4
 *     URL, e.g. one uploaded to /public/videos). Shown at the top of step 3.
 *   NEXT_PUBLIC_IPHONE_SHORTCUT_URL — an iCloud link to a ready-made "Send to
 *     Jarvis" Shortcut whose import question asks for the link. With it, step 3
 *     becomes one tap and one paste.
 */
const SETUP_VIDEO = process.env.NEXT_PUBLIC_IPHONE_SETUP_VIDEO ?? "";
const SHORTCUT_LINK = process.env.NEXT_PUBLIC_IPHONE_SHORTCUT_URL ?? "";
const LIMIT = 20;

type StepId = "phone" | "token" | "build" | "auto" | "test";
const STEPS: { id: StepId; label: string }[] = [
  { id: "phone", label: "Open on iPhone" },
  { id: "token", label: "Your link" },
  { id: "build", label: "Make the Shortcut" },
  { id: "auto", label: "Run it automatically" },
  { id: "test", label: "Test" },
];

function onIphone(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function IphoneGuide({ camera, onClose }: { camera: CameraWatch; onClose: () => void }) {
  const phone = useMemo(onIphone, []);
  const [step, setStep] = useState<StepId>(phone ? "token" : "phone");
  const [token, setToken] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [note, setNote] = useState("");
  const [qr, setQr] = useState("");
  const [testFrom, setTestFrom] = useState<number | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const pushUrl = `${origin}/api/dashboard/inbox/push`;
  // The whole Shortcut needs this one thing: the push address with the key in it.
  const myLink = token ? `${pushUrl}?key=${encodeURIComponent(token)}` : pushUrl;
  // "Where did I get up to?" — read first, so each run starts after the last photo sent.
  const cursorLink = `${origin}/api/dashboard/inbox/cursor${token ? `?key=${encodeURIComponent(token)}` : ""}`;
  // "These are still on my phone" — anything waiting that isn't was deleted there.
  const presentLink = `${origin}/api/dashboard/inbox/present${token ? `?key=${encodeURIComponent(token)}` : ""}`;
  const guideUrl = `${origin}/apps/jarvis#iphone`;
  const local = /localhost|127\.0\.0\.1/.test(origin);
  const idx = STEPS.findIndex((s) => s.id === step);

  useEffect(() => {
    void QRCode.toDataURL(guideUrl, { margin: 1, width: 220, color: { dark: "#e8f6ff", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(""));
  }, [guideUrl]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 2500);
    return () => clearTimeout(t);
  }, [note]);

  const copy = (text: string, what: string) =>
    void navigator.clipboard.writeText(text).then(
      () => setNote(`${what} copied — now paste it in Shortcuts`),
      () => setNote("Couldn't copy — press and hold the text to copy it"),
    );

  const mint = async () => {
    setMinting(true);
    try {
      const r = await fetch("/api/dashboard/inbox/token", { method: "POST" });
      const d = (await r.json()) as { token?: string; error?: string };
      if (!d.token) throw new Error(d.error ?? "Couldn't make a key.");
      setToken(d.token);
      void camera.check(false);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't make a key.");
    } finally {
      setMinting(false);
    }
  };

  // The test passes once a check after "I took a photo" has seen anything new —
  // in the inbox, or already pulled into the queue by auto-pull.
  const [queueBefore, setQueueBefore] = useState(0);
  const tested = testFrom !== null && camera.lastChecked !== null && camera.lastChecked > testFrom && !camera.busy;
  const [queueNow, setQueueNow] = useState(0);
  useEffect(() => {
    if (!tested) return;
    void import("@/lib/recall/photos/store").then((m) => setQueueNow(m.getQueue().length));
  }, [tested, camera.lastChecked]);
  const arrived = tested && (camera.inbox.length > 0 || queueNow > queueBefore);

  return (
    <WidgetSheet title="Set up your iPhone" kicker="Camera Autopilot · about 5 minutes · no app to download" onClose={onClose}>
      <div className="flex min-h-full flex-col">
        <ol className="flex shrink-0 flex-wrap gap-1 border-b border-line-soft px-4 py-2">
          {STEPS.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setStep(s.id)}
                aria-current={s.id === step ? "step" : undefined}
                className={`rounded px-2 py-1 font-mono text-[10.5px] ${s.id === step ? "bg-elevated text-ink" : i < idx ? "text-[var(--hud)]" : "text-ink-faint hover:text-ink"}`}
              >
                {String(i + 1).padStart(2, "0")} {s.label}
              </button>
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 space-y-4 p-4 text-[12.5px] leading-relaxed text-ink-muted sm:p-6">
          {local && (
            <p className="rounded-lg border border-[var(--hud-amber)] px-3 py-2 text-[11.5px] text-[var(--hud-amber)]">
              You&apos;re on a local copy ({origin}). Your phone can&apos;t reach it — open the live site to do this.
            </p>
          )}

          {step === "phone" && (
            <div className="space-y-4">
              <h3 className="text-[18px] font-semibold text-ink">Open this on your iPhone</h3>
              <p>
                You&apos;ll copy two things from Jarvis and paste them into Apple&apos;s <b className="text-ink">Shortcuts</b> app. That&apos;s
                much easier on the phone itself. Point your iPhone camera at this code — it opens this exact guide.
              </p>
              <div className="flex flex-wrap items-center gap-5">
                <div className="grid h-[220px] w-[220px] place-items-center rounded-xl border border-line bg-black/40">
                  {qr ? <img src={qr} alt="QR code that opens this guide on your phone" width={200} height={200} /> : <span className="text-[11px]">…</span>}
                </div>
                <div className="max-w-xs space-y-2 text-[11.5px]">
                  <p>Sign in with the same account if it asks, so the photos land in your Jarvis.</p>
                  <p>
                    <b className="text-ink">Tip:</b> once it opens in Safari, tap <b className="text-ink">Share → Add to Home Screen</b>. You get a Jarvis icon
                    that opens full-screen, like an app.
                  </p>
                  <button type="button" className="deck-btn" onClick={() => copy(guideUrl, "Link")}>
                    <Icon.Copy width={12} height={12} aria-hidden /> Copy the link instead
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "token" && (
            <div className="space-y-4">
              <h3 className="text-[18px] font-semibold text-ink">Get your link</h3>
              <p>
                This is the one thing you paste into the Shortcut. It&apos;s your own private link — it already has your key inside, so there&apos;s
                nothing else to copy.
              </p>
              {token ? (
                <>
                  <CopyRow label="Your link" value={myLink} onCopy={() => copy(myLink, "Your link")} secret />
                  <p className="text-[11px] text-[var(--hud-amber)]">
                    Copy it now — for safety it&apos;s only shown once. Lost it? Come back and make a new one; the old link stops working.
                  </p>
                </>
              ) : (
                <div className="rounded-lg border border-line bg-panel-2 p-3">
                  <p className="mb-2">
                    {camera.linked ? "You made a link before, but it can't be shown again. Make a new one for this setup." : "Tap to make your link:"}
                  </p>
                  <button type="button" className="deck-btn deck-btn--go" onClick={() => void mint()} disabled={minting}>
                    <Icon.Key width={12} height={12} aria-hidden /> {minting ? "Making it…" : camera.linked ? "Make a new link" : "Make my link"}
                  </button>
                  {camera.linked && <p className="mt-1.5 text-[10.5px] text-ink-faint">A Shortcut using the old link stops sending until you paste the new one in.</p>}
                </div>
              )}
              <p className="text-[11px] text-ink-faint">
                It&apos;s a different address from the Jarvis page you&apos;re looking at — that&apos;s right. You never open it in a browser; it only goes in the
                Shortcut.
              </p>
            </div>
          )}

          {step === "build" && (
            <div className="space-y-3">
              <h3 className="text-[18px] font-semibold text-ink">Make the Shortcut</h3>
              {SETUP_VIDEO && (
                <video src={SETUP_VIDEO} controls playsInline className="w-full max-w-sm rounded-xl border border-line" aria-label="Video: making the Send to Jarvis Shortcut" />
              )}
              {SHORTCUT_LINK && (
                <div className="rounded-lg border border-[var(--hud)] bg-[color-mix(in_oklab,var(--hud)_8%,transparent)] p-3">
                  <p className="mb-2 text-ink">
                    Fastest way: tap below, then <b>Add Shortcut</b>. When it asks for your link, paste it.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a href={SHORTCUT_LINK} className="deck-btn deck-btn--go">
                      Add the Shortcut
                    </a>
                    {token && (
                      <button type="button" className="deck-btn" onClick={() => copy(myLink, "Your link")}>
                        <Icon.Copy width={12} height={12} aria-hidden /> Copy your link first
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[11px] text-ink-faint">Prefer to build it yourself? The steps are below.</p>
                </div>
              )}
              <p>
                Open Apple&apos;s <b className="text-ink">Shortcuts</b> app (it&apos;s already on your iPhone — swipe down on the home screen and search
                &ldquo;Shortcuts&rdquo;). Then:
              </p>
              <Steps
                items={[
                  <>
                    Tap <b className="text-ink">+</b> (top right). Tap the name at the very top → <b className="text-ink">Rename</b> → <Code>{SHORTCUT_NAME}</Code>.
                  </>,
                  <>
                    Tap <b className="text-ink">Add Action</b>, type <Code>Find Photos</Code> in the search box, tap it. Set <b className="text-ink">Sort by</b>{" "}
                    Creation Date, <b className="text-ink">Order</b> Latest First, switch <b className="text-ink">Limit</b> on and make it{" "}
                    <b className="text-ink">{LIMIT}</b>.
                  </>,
                  <>
                    Search <Code>Repeat with Each</Code> and tap it. Every block from here goes <b className="text-ink">inside</b> the Repeat (between
                    &ldquo;Repeat with each item&rdquo; and &ldquo;End Repeat&rdquo;), so photos go up one at a time.
                    <br />
                    <span className="text-[11px] text-ink-faint">
                      One at a time is not optional: the website can take about 4 MB per send, and 20 full-size photos at once is far more — that is the
                      &ldquo;network connection was lost&rdquo; error.
                    </span>
                  </>,
                  <>
                    Search <Code>Resize Image</Code>, tap it, set the width to <b className="text-ink">1600</b> (leave height on Auto). Then search{" "}
                    <Code>Convert Image</Code>, tap it, set it to <b className="text-ink">JPEG</b> — it should say &ldquo;Convert Resized Image to JPEG&rdquo;.
                  </>,
                  <>
                    Search <Code>URL</Code>, and tap the action called just <b className="text-ink">URL</b> (the blue link
                    icon). Tap inside it and paste <b className="text-ink">your link</b>.
                    {token && <InlineCopy onClick={() => copy(myLink, "Your link")} />}
                    <br />
                    <span className="text-[11px] text-ink-faint">
                      Putting the link in its own URL action — not typed into the next block — is what avoids the &ldquo;couldn&apos;t convert from Rich Text to
                      URL&rdquo; error.
                    </span>
                  </>,
                  <>
                    Search <Code>Get Contents of URL</Code> and tap it. It picks up the blue <b className="text-ink">URL</b> from the block above by itself —
                    leave that as it is.
                  </>,
                  <>
                    Tap the small <b className="text-ink">›</b> arrow on the right of that block. Fill it in exactly like the table below. Your Shortcut
                    should read: Find Photos → Repeat with Each → Resize Image → Convert Image → URL → Get Contents of URL → End Repeat.
                  </>,
                  <>
                    Tap <b className="text-ink">▶</b> (bottom right) to try it. When your iPhone asks about photos and about sending to the site, tap{" "}
                    <b className="text-ink">Always Allow</b> both times.
                  </>,
                ]}
              />
              <FinishedExample />
              <div className="overflow-hidden rounded-lg border border-line">
                <p className="border-b border-line bg-panel-2 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-faint">
                  Get Contents of URL — what goes where
                </p>
                <table className="w-full text-[12px]">
                  <tbody className="divide-y divide-line-soft">
                    {[
                      ["URL", "the blue URL from the block above (fills in by itself)", ""],
                      ["Method", "POST", ""],
                      ["Headers", "leave empty", ""],
                      ["Request Body", "Form", ""],
                      ["Add new field", "pick File", ""],
                      ["  Key", "photos", "photos"],
                      ["  File (the value)", "tap it → Select Variable → tap the Convert Image block (Converted Image)", ""],
                    ].map(([where, what, copyValue]) => (
                      <tr key={where}>
                        <td className="w-[38%] whitespace-pre px-3 py-2 text-ink-muted">{where}</td>
                        <td className="px-3 py-2 text-ink">
                          {what}
                          {copyValue && <InlineCopy onClick={() => copy(copyValue, where.trim())} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg border border-[var(--hud)] px-3 py-3">
                <p className="mb-1 text-[13px] font-semibold text-ink">Never miss a photo (recommended)</p>
                <p className="mb-2 text-[11.5px]">
                  So each run picks up after the last photo it sent — instead of re-sending the newest {LIMIT} — add a bookmark. Jarvis remembers the
                  newest photo it got; the Shortcut asks for it first.
                </p>
                <Steps
                  items={[
                    <>
                      At the very <b className="text-ink">top</b>, above Find Photos: add a <b className="text-ink">URL</b> action with your bookmark link
                      {token && <InlineCopy onClick={() => copy(cursorLink, "Bookmark link")} />}
                      {!token && (
                        <>
                          {" "}
                          <Code>…/api/dashboard/inbox/cursor</Code> (plus the same <Code>X-Dashboard-Token</Code> header in the next block)
                        </>
                      )}
                      , then a <b className="text-ink">Get Contents of URL</b> under it (Method stays GET).
                    </>,
                    <>
                      In <b className="text-ink">Find Photos</b>: <b className="text-ink">Add Filter</b> → <b className="text-ink">Date Created</b> →{" "}
                      <b className="text-ink">is after</b> → tap the date → <b className="text-ink">Select Variable</b> → tap that top Get Contents of URL (
                      <b className="text-ink">Contents of URL</b>). Change <b className="text-ink">Order</b> to <b className="text-ink">Oldest First</b>.
                    </>,
                    <>
                      In the lower Get Contents of URL → Request Body: <b className="text-ink">Add new field → Text</b>. Key <Code>takenAt</Code>
                      <InlineCopy onClick={() => copy("takenAt", "Field name")} />. Value: <b className="text-ink">Select Variable</b> → tap{" "}
                      <b className="text-ink">Repeat Item</b>, then tap the Repeat Item bubble once more and choose <b className="text-ink">Date Created</b>.
                    </>,
                  ]}
                />
                <p className="mt-2 text-[11px] text-ink-faint">
                  First run with no bookmark yet starts from 24 hours ago, so it never uploads your whole camera roll.
                </p>
              </div>
              <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11.5px]">
                It worked if it shows something like <Code>{`{"accepted":20,"skipped":0}`}</Code>. An error that says <b className="text-ink">Unknown device token</b>{" "}
                means the link is old or cut off — go back a step, make a new link and paste it again.
              </p>
              <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11.5px]">
                <b className="text-ink">&ldquo;Trying to share … items, which is not allowed&rdquo;?</b> In the iPhone <b className="text-ink">Settings</b> app go
                to <b className="text-ink">Apps → Shortcuts → Advanced</b> and turn on <b className="text-ink">Allow Sharing Large Amounts of Data</b> — or lower the
                Find Photos limit to {LIMIT}.
              </p>
              <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11.5px]">
                <b className="text-ink">&ldquo;No photos sent&rdquo;?</b> You&apos;re connected — the picture just isn&apos;t in the request. The field under Request
                Body must be type <b className="text-ink">File</b> (not Text) with the value <b className="text-ink">Converted Image</b>.
              </p>
              <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11.5px]">
                <b className="text-ink">&ldquo;The network connection was lost&rdquo;?</b> It&apos;s sending too much at once. Even one full-size photo is over the
                site&apos;s ~4.5 MB limit. Make sure Get Contents of URL is inside the <b className="text-ink">Repeat</b>, Resize Image comes before Convert
                Image, and the photos field is <b className="text-ink">Converted Image</b> — not Photos, Repeat Item or anything full-size.
              </p>
              <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11.5px]">
                <b className="text-ink">&ldquo;Couldn&apos;t convert from Rich Text to URL&rdquo;?</b> The link went in with formatting, or the wrong thing is in
                the URL box. Tap the URL box in Get Contents of URL and clear it, add a separate <b className="text-ink">URL</b> action above it with your
                link pasted in, then tap the URL box again and pick the blue <b className="text-ink">URL</b>.
              </p>
            </div>
          )}

          {step === "auto" && (
            <div className="space-y-3">
              <h3 className="text-[18px] font-semibold text-ink">Make it run by itself</h3>
              <p>
                iPhone has no &ldquo;new photo&rdquo; trigger, so the closest is <b className="text-ink">when you close the Camera</b> — right after you take a
                picture. Still in Shortcuts:
              </p>
              <Steps
                items={[
                  <>
                    Tap the <b className="text-ink">Automation</b> tab (bottom) → <b className="text-ink">+</b> or <b className="text-ink">New Automation</b>.
                  </>,
                  <>
                    Choose <b className="text-ink">App</b> → <b className="text-ink">Choose</b> → <b className="text-ink">Camera</b> → Done.
                  </>,
                  <>
                    Tick <b className="text-ink">Is Closed</b>, untick <b className="text-ink">Is Opened</b>.
                  </>,
                  <>
                    Select <b className="text-ink">Run Immediately</b> and turn <b className="text-ink">Notify When Run</b> off. Tap <b className="text-ink">Next</b>.
                  </>,
                  <>
                    Pick <Code>{SHORTCUT_NAME}</Code>. Done.
                  </>,
                ]}
              />
              <p className="text-[11.5px]">
                <b className="text-ink">Optional extras</b> for screenshots and AirDrops: make the same automation with <b className="text-ink">Charger → Is Connected</b>,
                or a few <b className="text-ink">Time of Day</b> ones (9am, 1pm, 6pm, 10pm) — each set to Run Immediately. Running it often is fine: Jarvis
                skips photos it already has.
              </p>
              <div className="rounded-lg border border-[var(--hud)] px-3 py-3">
                <p className="mb-1 text-[13px] font-semibold text-ink">Delete on your phone → gone from Jarvis too</p>
                <p className="mb-2 text-[11.5px]">
                  A website can&apos;t see your camera roll, so the Shortcut tells Jarvis which recent photos are still there. Anything waiting in Camera
                  Autopilot that you deleted on your phone is then removed — on the phone and the laptop. Add these at the very{" "}
                  <b className="text-ink">bottom</b> of <Code>{SHORTCUT_NAME}</Code>, below End Repeat:
                </p>
                <Steps
                  items={[
                    <>
                      <b className="text-ink">Find Photos</b> → <b className="text-ink">Add Filter</b> → <b className="text-ink">Date Created</b> →{" "}
                      <b className="text-ink">is in the last</b> <b className="text-ink">30 days</b>. Turn <b className="text-ink">Limit</b> off.
                    </>,
                    <>
                      <b className="text-ink">Get Details of Images</b> → tap Detail → <b className="text-ink">Name</b>.
                    </>,
                    <>
                      <b className="text-ink">Combine Text</b> → tap the separator → <b className="text-ink">Comma</b>.
                    </>,
                    <>
                      A <b className="text-ink">URL</b> action with this link
                      {token ? <InlineCopy onClick={() => copy(presentLink, "Clean-up link")} /> : <> <Code>…/api/dashboard/inbox/present</Code></>}, then{" "}
                      <b className="text-ink">Get Contents of URL</b>: Method <b className="text-ink">POST</b>, Request Body <b className="text-ink">Form</b>,{" "}
                      <b className="text-ink">Add new field → Text</b>, key <Code>names</Code>
                      <InlineCopy onClick={() => copy("names", "Field name")} />, value <b className="text-ink">Combined Text</b>.
                    </>,
                  ]}
                />
                <p className="mt-2 text-[11px] text-ink-faint">Only photos still waiting to be sorted are removed. Anything you already filed stays filed.</p>
              </div>
            </div>
          )}

          {step === "test" && (
            <div className="space-y-3">
              <h3 className="text-[18px] font-semibold text-ink">Test it</h3>
              <Steps
                items={[
                  <>Tap <b className="text-ink">Start test</b> below.</>,
                  <>On your iPhone, open the Camera, take a photo, then swipe the Camera closed.</>,
                  <>Give it a few seconds, then tap <b className="text-ink">Check now</b>.</>,
                ]}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="deck-btn"
                  onClick={() => {
                    setTestFrom(Date.now());
                    void import("@/lib/recall/photos/store").then((m) => setQueueBefore(m.getQueue().length));
                  }}
                >
                  Start test
                </button>
                <button type="button" className="deck-btn deck-btn--go" disabled={testFrom === null || Boolean(camera.busy)} onClick={() => void camera.check()}>
                  <Icon.Refresh width={12} height={12} aria-hidden /> {camera.busy ? "Checking…" : "Check now"}
                </button>
              </div>
              {camera.busy && <p className="text-[11.5px]">{camera.busy}</p>}
              {tested &&
                (arrived ? (
                  <p className="rounded-lg border border-[var(--hud-green)] px-3 py-2 text-[12px] text-[var(--hud-green)]">
                    It works. New photos will show up in Camera Autopilot by themselves — Jarvis checks every 10 minutes while it&apos;s open.
                  </p>
                ) : (
                  <p className="rounded-lg border border-[var(--hud-amber)] px-3 py-2 text-[11.5px] text-[var(--hud-amber)]">
                    Nothing arrived yet. Open the Shortcut on your phone and tap ▶ — if it shows an error, the link or key is off (redo step 2). If it ran
                    fine, check the automation is set to <b>Run Immediately</b>. {camera.error}
                  </p>
                ))}
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex shrink-0 items-center justify-between gap-2 border-t border-line bg-[rgb(5_10_20/0.9)] px-4 py-3">
          <button type="button" className="deck-btn" disabled={idx === 0} onClick={() => setStep(STEPS[Math.max(0, idx - 1)].id)}>
            Back
          </button>
          {note && <span className="text-[11px] text-[var(--hud)]">{note}</span>}
          {idx < STEPS.length - 1 ? (
            <button type="button" className="deck-btn deck-btn--go" onClick={() => setStep(STEPS[idx + 1].id)}>
              {step === "phone" ? "I'm on my iPhone" : "Next"}
            </button>
          ) : (
            <button type="button" className="deck-btn deck-btn--go" onClick={onClose}>
              Done
            </button>
          )}
        </footer>
      </div>
    </WidgetSheet>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-ink">{children}</code>;
}

function InlineCopy({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ml-1 inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 align-middle text-[10.5px] text-[var(--hud)] hover:border-[var(--hud)]">
      <Icon.Copy width={10} height={10} aria-hidden /> copy
    </button>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-[var(--hud)] font-mono text-[10px] text-[var(--hud)]">{i + 1}</span>
          <span className="min-w-0 flex-1">{it}</span>
        </li>
      ))}
    </ol>
  );
}

function CopyRow({ label, value, onCopy, secret }: { label: string; value: string; onCopy: () => void; secret?: boolean }) {
  return (
    <div>
      <p className="mb-1 font-mono text-[10.5px] uppercase tracking-wider text-ink-faint">{label}</p>
      <div className="flex gap-1.5">
        <code className={`min-w-0 flex-1 truncate rounded-lg border border-line bg-panel-2 px-3 py-2.5 font-mono text-[12px] text-ink ${secret ? "select-all" : ""}`}>{value}</code>
        <button type="button" className="deck-btn deck-btn--go shrink-0" onClick={onCopy}>
          <Icon.Copy width={12} height={12} aria-hidden /> Copy
        </button>
      </div>
    </div>
  );
}

/**
 * The owner's own working Shortcut, top to bottom, so a new user can match
 * theirs block for block. Their key is blurred out of the URL block.
 */
const EXAMPLE_SHOTS = [
  { src: "/images/iphone-guide/1-find-photos.png", cap: "Find Photos (Latest First) → Repeat with each item → Resize to 1600" },
  { src: "/images/iphone-guide/2-convert-and-url.png", cap: "Convert to JPEG → a URL block with your link pasted in" },
  { src: "/images/iphone-guide/3-get-contents.png", cap: "Get contents of URL: POST, Form, a File field named photos → End Repeat" },
];

function FinishedExample() {
  return (
    <div className="rounded-lg border border-line">
      <p className="border-b border-line bg-panel-2 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wider text-ink-faint">
        A finished Shortcut — yours should look like this
      </p>
      <div className="flex snap-x gap-3 overflow-x-auto p-3">
        {EXAMPLE_SHOTS.map((s, i) => (
          <figure key={s.src} className="w-[min(220px,70vw)] shrink-0 snap-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots from /public */}
            <img src={s.src} alt={`Step ${i + 1}: ${s.cap}`} loading="lazy" className="w-full rounded-lg border border-line bg-white" />
            <figcaption className="mt-1.5 text-[11px] leading-snug text-ink-muted">
              <b className="text-ink">{i + 1}.</b> {s.cap}
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="border-t border-line px-3 py-2 text-[11px] text-ink-faint">
        Pasted a new link and it still says &ldquo;Unknown device token&rdquo;? In <b className="text-ink">Get contents of</b>, tap the blue{" "}
        <b className="text-ink">URL</b>, clear it, and pick the URL block right above — it can hold on to an old copy. Or tap{" "}
        <b className="text-ink">That&apos;s my iPhone — let it in</b> in Camera Autopilot.
      </p>
    </div>
  );
}
