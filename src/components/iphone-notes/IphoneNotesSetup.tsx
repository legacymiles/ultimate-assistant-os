"use client";

// ---------------------------------------------------------------------------
// Setting up the "Notes to Jarvis" Shortcut — the exact taps, with the
// person's own link ready to copy, and a "Test my link" check.
//
// Apple Notes has no API and Shortcuts can't be installed from a website
// without an iCloud link, so these are the fewest steps that really work:
// one Shortcut (Find Notes → send each one) and one daily automation. Sending
// the same note twice is harmless (the server keeps one copy), so the
// automation can safely look back two days.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../icons";

export const SHORTCUT_NAME = "Notes to Jarvis";

export function IphoneNotesSetup({
  push,
  pushError,
  busy,
  onRotate,
  onCopied,
}: {
  push: string;
  pushError: string;
  busy: boolean;
  onRotate: () => void;
  onCopied: () => void;
}) {
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(push);
      onCopied();
    } catch {
      window.prompt("Copy your link:", push);
    }
  };

  const check = async () => {
    setTesting(true);
    try {
      const res = await fetch(push, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      setTest({ ok: res.ok, text: j.message || j.error || (res.ok ? "Link works." : "That link didn't work.") });
    } catch {
      setTest({ ok: false, text: "No connection — try again." });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="ipn-panel ipn-setup" aria-label="iPhone setup">
      <p className="ipn-kicker">Set up your iPhone · about 5 minutes · no app to install</p>

      <div className="ipn-linkbox">
        <p className="ipn-soft">Your private link (only your Shortcut uses it):</p>
        {pushError ? (
          <p className="ipn-bad">{pushError}</p>
        ) : (
          <>
            <code className="ipn-mono ipn-url">{push || "Making your link…"}</code>
            <div className="ipn-item-actions">
              <button type="button" className="ipn-btn ipn-btn--go" onClick={() => void copy()} disabled={!push}>
                <Icon.Copy width={13} height={13} aria-hidden /> Copy link
              </button>
              <button type="button" className="ipn-btn" onClick={() => void check()} disabled={!push || testing}>
                {testing ? "Checking…" : "Test my link"}
              </button>
              <button type="button" className="ipn-btn" onClick={onRotate} disabled={busy}>
                {busy ? "Making…" : "New link"}
              </button>
            </div>
            {test && <p className={test.ok ? "ipn-good" : "ipn-bad"}>{test.text}</p>}
          </>
        )}
      </div>

      <ol className="ipn-steps">
        <li>
          <b>On your iPhone, copy the link above</b> (open Jarvis on the phone and tap <i>Copy link</i>).
        </li>
        <li>
          Open the <b>Shortcuts</b> app → tap <b>+</b> (top right) → tap the name at the top and call it <b>{SHORTCUT_NAME}</b>.
        </li>
        <li>
          Tap <b>Search Actions</b>, type <b>Find Notes</b>, tap it. In that action tap <b>Add Filter</b> → set it to{" "}
          <b>Last Modified Date</b> · <b>is in the last</b> · <b>2 days</b>. Turn <b>Limit</b> off.
          <span className="ipn-faint"> First time only: make it 30 days to bring in your recent notes, then change it back to 2.</span>
        </li>
        <li>
          Search <b>Repeat with Each</b> and add it under Find Notes (it fills in <i>Notes</i> by itself).
        </li>
        <li>
          Search <b>Get Contents of URL</b> and drag it <b>inside</b> the Repeat (between <i>Repeat with Each</i> and <i>End Repeat</i>). Tap the blue <b>URL</b> and paste your link.
        </li>
        <li>
          Tap the <b>▸</b> arrow on that action. Set <b>Method</b> to <b>POST</b> and <b>Request Body</b> to <b>JSON</b>. Tap <b>Add new field → Text</b> <b>once</b>:
          <table className="ipn-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="ipn-mono">body</td>
                <td>
                  Tap the value box, then tap <b>Repeat Item</b> in the bar above the keyboard. It must be the blue <b>Repeat Item</b> bubble — not <i>Contents of URL</i>, not <i>Notes</i>, and not typed words.
                </td>
              </tr>
            </tbody>
          </table>
          <span className="ipn-faint">
            That one field is all Jarvis needs — it reads the title from the note itself. (Optional extras, each a <b>Repeat Item</b> bubble you tap to pick a property: <span className="ipn-mono">created</span> = Creation Date, <span className="ipn-mono">folder</span> = Folder.)
          </span>
        </li>
        <li>
          Tap <b>Done</b>, then tap the Shortcut once to run it. Allow it to use <b>Notes</b> and to connect to the site when it asks (<b>Always Allow</b>). Your notes show up here within a minute.
        </li>
        <li>
          <b>Make it automatic:</b> in Shortcuts tap <b>Automation</b> (bottom) → <b>+</b> → <b>Time of Day</b> → pick a time (e.g. 9:00 PM) and <b>Daily</b> → choose <b>Run Immediately</b> and turn off <b>Notify When Run</b> → <b>Next</b> → pick <b>{SHORTCUT_NAME}</b>. Add a second time (e.g. 12:00 PM) if you want notes picked up twice a day.
        </li>
      </ol>
      <p className="ipn-faint">
        Good to know: locked notes can&apos;t be read by Shortcuts. To keep a folder private, add a second filter in step 3: <b>Folder</b> · <b>is not</b> · that folder. Sending a note
        twice never makes a duplicate, and nothing happens to any note until you tap Approve here.
      </p>
    </section>
  );
}
