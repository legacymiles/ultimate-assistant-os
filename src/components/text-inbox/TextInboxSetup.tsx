"use client";

// ---------------------------------------------------------------------------
// Setting up the iPhone side of Text Inbox — the exact taps, with the
// person's own links ready to copy, a "Test" for each, and the owner's
// screenshots under each step (src/lib/text-inbox/tutorial.ts).
//
// Two pieces, because Apple only lets the iPhone send a text as you:
//   1. "Text to Jarvis" — an automation that sends each incoming text here.
//   2. "Jarvis Send"   — a Shortcut that picks up approved replies and sends
//      them with Messages. Jarvis runs it when you approve on the phone, and
//      your phone's notification runs it when you approve on the computer.
// ---------------------------------------------------------------------------

import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { SEND_SHORTCUT } from "@/lib/text-inbox/engine";
import { shotsFor } from "@/lib/text-inbox/tutorial";
import { installed, onIphone, pushIsOn, turnOnPush, type InboxView } from "@/lib/text-inbox/client";

function LinkBox({ label, url, onCopied }: { label: string; url: string; onCopied: () => void }) {
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      onCopied();
    } catch {
      window.prompt("Copy your link:", url);
    }
  };
  const check = async () => {
    setTesting(true);
    try {
      // The outbox check would claim waiting replies, so the test only checks the incoming door's key.
      const res = await fetch(url.replace("/outbox?", "/push?"), { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setTest({ ok: res.ok, text: res.ok ? "Link works." : j.error || "That link didn't work." });
    } catch {
      setTest({ ok: false, text: "No connection — try again." });
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="txi-linkbox">
      <p className="txi-faint">{label}</p>
      <code className="txi-mono txi-url">{url || "Making your link…"}</code>
      <div className="txi-row">
        <button type="button" className="txi-btn txi-btn--go" onClick={() => void copy()} disabled={!url}>
          <Icon.Copy width={13} height={13} aria-hidden /> Copy
        </button>
        <button type="button" className="txi-btn" onClick={() => void check()} disabled={!url || testing}>
          {testing ? "Checking…" : "Test"}
        </button>
      </div>
      {test && <p className={test.ok ? "txi-good" : "txi-bad"}>{test.text}</p>}
    </div>
  );
}

function Step({ id, n, children }: { id: string; n: number; children: ReactNode }) {
  const shots = shotsFor(id);
  return (
    <li className="txi-step">
      <span className="txi-step-n txi-mono" aria-hidden>
        {n}
      </span>
      <div className="txi-step-body">
        <div>{children}</div>
        {shots.length > 0 && (
          <div className="txi-shots">
            {shots.map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={s.src} src={s.src} alt={s.alt} loading="lazy" />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function TextInboxSetup({
  view,
  act,
  busy,
  say,
  onRotate,
}: {
  view: InboxView;
  act: (b: Record<string, unknown>) => Promise<InboxView>;
  busy: boolean;
  say: (t: string, bad?: boolean) => void;
  onRotate: () => void;
}) {
  const [pushOn, setPushOn] = useState(false);
  const [phone, setPhone] = useState(false);
  const [home, setHome] = useState(false);
  const [tone, setTone] = useState(view.tone);
  useEffect(() => {
    setPhone(onIphone());
    setHome(installed());
    void pushIsOn().then(setPushOn);
  }, []);
  useEffect(() => setTone(view.tone), [view.tone]);

  const copied = () => say("Copied — paste it into the Shortcut.");
  const linked = Boolean(view.lastPushAt);
  const sendLinked = Boolean(view.lastCheckInAt);

  const enablePush = async () => {
    try {
      await turnOnPush(view.vapid, act);
      setPushOn(true);
      say("Notifications are on for this phone.");
    } catch (e) {
      say(e instanceof Error ? e.message : "Couldn't turn notifications on.", true);
    }
  };
  const runAct = async (body: Record<string, unknown>, done: string) => {
    try {
      await act(body);
      say(done);
    } catch (e) {
      say(e instanceof Error ? e.message : "That didn't work.", true);
    }
  };

  return (
    <section className="txi-panel txi-setup" aria-label="iPhone setup">
      <p className="txi-kicker">Set up your iPhone · about 8 minutes · free, no app to install</p>
      <p className="txi-soft">
        Apple only lets your iPhone send a text as you, so there are two small pieces: one sends your texts to Jarvis, one sends the replies you approve. Do this on the iPhone —
        open this page there and tap <b>Copy</b> when a step needs a link.
      </p>

      <div className="txi-status">
        <span data-on={linked}>{linked ? "✓" : "○"} Texts reach Jarvis</span>
        <span data-on={sendLinked}>{sendLinked ? "✓" : "○"} Jarvis Send has run</span>
        <span data-on={view.pushDevices > 0}>{view.pushDevices > 0 ? "✓" : "○"} Phone notifications</span>
      </div>

      {view.linkError ? <p className="txi-bad">{view.linkError}</p> : null}

      <h3 className="txi-h3">Part 1 · “Text to Jarvis” — send incoming texts here</h3>
      <LinkBox label="Your private incoming link (only your automation uses it):" url={view.links.incoming} onCopied={copied} />
      <ol className="txi-steps">
        <Step id="in-1" n={1}>
          Open <b>Shortcuts</b> → tap <b>Automation</b> at the bottom → <b>+</b> (or <b>New Automation</b>) → scroll to <b>Message</b>.
        </Step>
        <Step id="in-2" n={2}>
          <b>Everyone:</b> leave <b>Sender</b> on <i>Any Sender</i>, tap <b>Message Contains</b> and type a single <b>space</b> (press the space bar once) — iPhone needs
          something in one box, and almost every text has a space. <b>Only some people:</b> tap <b>Sender</b> → <b>Choose</b> and pick them instead. Then choose{" "}
          <b>Run Immediately</b>, turn <b>off</b> <i>Notify When Run</i>, and tap <b>Next</b> → <b>New Blank Automation</b>.
          <span className="txi-faint">
            {" "}
            One-word texts with no space (“ok”, “lol”) are skipped. To catch most of those too, make a copy of this automation with Message Contains set to the letter{" "}
            <b>o</b> — Jarvis never shows the same text twice. Codes, bank alerts and spam get no draft.
          </span>
        </Step>
        <Step id="in-3" n={3}>
          Tap <b>Add Action</b>, search <b>Get Phone Numbers from Input</b> and add it. Tap its blue <i>Input</i> → choose <b>Shortcut Input</b>, then tap <b>Shortcut Input</b> again
          and pick <b>Sender</b>.
        </Step>
        <Step id="in-4" n={4}>
          Search <b>Get Contents of URL</b>, add it under, tap the blue <i>URL</i> and paste your incoming link. Tap the <b>▸</b> arrow: <b>Method</b> → <b>POST</b>,{" "}
          <b>Request Body</b> → <b>JSON</b>. Tap <b>Add new field → Text</b> three times:
          <table className="txi-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value (tap the box, then pick from the bar above the keyboard)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="txi-mono">text</td>
                <td>
                  <b>Shortcut Input</b> → tap it → <b>Content</b>
                </td>
              </tr>
              <tr>
                <td className="txi-mono">from</td>
                <td>
                  <b>Shortcut Input</b> → tap it → <b>Sender</b>
                </td>
              </tr>
              <tr>
                <td className="txi-mono">number</td>
                <td>
                  <b>Phone Numbers</b> (from step 3)
                </td>
              </tr>
            </tbody>
          </table>
        </Step>
        <Step id="in-5" n={5}>
          Tap <b>Done</b>. Have one of those people text you (or text yourself from another phone) — it shows up here with a reply drafted within a few seconds.
        </Step>
      </ol>

      <h3 className="txi-h3">Part 2 · “{SEND_SHORTCUT}” — send the replies you approve</h3>
      <LinkBox label="Your private outbox link (only your Jarvis Send Shortcut uses it):" url={view.links.outbox} onCopied={copied} />
      <ol className="txi-steps">
        <Step id="out-1" n={1}>
          In <b>Shortcuts</b>, on the <b>Shortcuts</b> tab tap <b>+</b>. Tap the name at the top and call it exactly <b className="txi-mono">{SEND_SHORTCUT}</b> — Jarvis opens it by
          that name.
        </Step>
        <Step id="out-2" n={2}>
          Add <b>Get Contents of URL</b> and paste your <b>outbox</b> link. (Leave it on GET — no changes under ▸.)
        </Step>
        <Step id="out-3" n={3}>
          Add <b>Get Dictionary Value</b>. Set it to Get <b>Value</b> for <b className="txi-mono">messages</b> in <b>Contents of URL</b>.
        </Step>
        <Step id="out-4" n={4}>
          Add <b>Repeat with Each</b> — it fills in <i>Dictionary Value</i> by itself.
        </Step>
        <Step id="out-5" n={5}>
          Inside the Repeat (between <i>Repeat with Each</i> and <i>End Repeat</i>) add these five actions, in this order. New actions land at the bottom — drag each one up
          so it sits above <i>End Repeat</i>.
          <br />
          <b>a.</b> <b>Get Dictionary Value</b> → tap <i>Key</i>, type <b className="txi-mono">to</b> → tap <i>Dictionary</i>, pick <b>Repeat Item</b>.
          <br />
          <b>b.</b> <b>Set Variable</b> → tap <i>Variable Name</i>, type <b>Number</b>. (Its input fills in with the Dictionary Value above by itself.)
          <br />
          <b>c.</b> <b>Get Dictionary Value</b> → <i>Key</i> <b className="txi-mono">text</b> → <i>Dictionary</i> <b>Repeat Item</b>.
          <br />
          <b>d.</b> <b>Set Variable</b> → name it <b>Words</b>.
          <br />
          <b>e.</b> <b>Send Message</b> → tap <i>Message</i>, pick <b>Words</b> → tap <i>Recipients</i>, pick <b>Number</b>. Tap <b>▸</b> and turn <b>Show When Run</b> <b>off</b>.
        </Step>
        <Step id="out-6" n={6}>
          Tap <b>Done</b>, then tap the Shortcut once to run it. When it asks to connect to the site and to send messages, choose <b>Always Allow</b> — after that it never asks.
        </Step>
      </ol>

      <h3 className="txi-h3">Part 3 · Notifications — approve on the computer, tap to send</h3>
      <ol className="txi-steps">
        <Step id="push-1" n={1}>
          On the iPhone, open this page in <b>Safari</b> → tap <b>Share</b> → <b>Add to Home Screen</b> → <b>Add</b>. A <b>Texts</b> icon appears.
        </Step>
        <Step id="push-2" n={2}>
          Open <b>Texts</b> from the Home Screen, come back to <b>Set up</b> and tap <b>Turn on notifications</b> → <b>Allow</b>.
        </Step>
        <Step id="push-3" n={3}>
          Now when you approve a reply on your computer, your phone buzzes: <i>Reply ready to send</i>. Tap it → Jarvis runs <b>{SEND_SHORTCUT}</b> → sent.
        </Step>
      </ol>
      <div className="txi-row">
        <button type="button" className="txi-btn txi-btn--go" onClick={() => void enablePush()} disabled={pushOn}>
          <Icon.Bell width={13} height={13} aria-hidden /> {pushOn ? "Notifications on for this device" : "Turn on notifications"}
        </button>
        <button type="button" className="txi-btn" onClick={() => void runAct({ action: "push.test" }, "Sent a test — check your phone.")} disabled={view.pushDevices === 0}>
          Send a test
        </button>
      </div>
      {phone && !home && !pushOn && <p className="txi-faint">You&apos;re in Safari — do step 1 first, then turn notifications on from the Home Screen icon.</p>}
      <label className="txi-check">
        <input type="checkbox" checked={view.settings.notifyNew} onChange={(e) => void runAct({ action: "settings", notifyNew: e.target.checked }, "Saved.")} />
        Buzz me when a new text has a draft ready
      </label>
      <label className="txi-check">
        <input type="checkbox" checked={view.settings.notifyReady} onChange={(e) => void runAct({ action: "settings", notifyReady: e.target.checked }, "Saved.")} />
        Buzz my phone when I approve on the computer (tap to send)
      </label>

      <h3 className="txi-h3">How you text</h3>
      <p className="txi-faint">
        Jarvis writes every draft in your voice. Say how you text in a line — it also learns from every reply you rewrite ({view.learned} so far).
      </p>
      <textarea className="txi-input" rows={2} maxLength={600} value={tone} placeholder="e.g. short and chill, lowercase, no emojis, I call my friends bro" onChange={(e) => setTone(e.target.value)} />
      <div className="txi-row">
        <button type="button" className="txi-btn" onClick={() => void runAct({ action: "tone", tone }, "Saved — new drafts will sound like this.")} disabled={tone === view.tone}>
          Save
        </button>
      </div>

      <h3 className="txi-h3">Privacy</h3>
      <p className="txi-faint">
        Only texts your Part 1 automation sends come here (everyone, or just the people you picked). Nothing is ever sent without your Approve. Finished texts are forgotten after 30 days.
      </p>
      <div className="txi-row">
        <button type="button" className="txi-btn" onClick={onRotate} disabled={busy}>
          New links (old Shortcuts stop working)
        </button>
        <button
          type="button"
          className="txi-btn txi-btn--bad"
          onClick={() => {
            if (window.confirm("Delete every text and draft in Text Inbox? This can't be undone.")) void runAct({ action: "clear" }, "Deleted everything.");
          }}
        >
          Delete all texts
        </button>
      </div>
    </section>
  );
}
