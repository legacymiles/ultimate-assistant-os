"use client";

import { useState } from "react";
import type { RecordView } from "./useRecord";
import type { Act } from "./Onboard";

/** Connect the recorder in four taps, plus the two switches that matter. */
export function SetupTab({ view, busy, act }: { view: RecordView; busy: boolean; act: Act }) {
  const { doc, webhook } = view;
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<"" | "ok" | "bad" | "…">("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(webhook);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the link is selectable below */
    }
  }

  async function test() {
    setCheck("…");
    try {
      const res = await fetch(webhook, { method: "HEAD" });
      setCheck(res.ok ? "ok" : "bad");
    } catch {
      setCheck("bad");
    }
  }

  return (
    <section className="cx-stack">
      <div className="cx-card">
        <p className="cx-kicker">Your recorder link</p>
        {webhook ? (
          <>
            <code className="cx-url" onClick={(e) => window.getSelection()?.selectAllChildren(e.currentTarget)}>
              {webhook}
            </code>
            <div className="cx-row">
              <button className="cx-primary small" onClick={copy}>
                {copied ? "Copied" : "Copy link"}
              </button>
              <button className="cx-ghost" onClick={test}>
                {check === "…" ? "Checking…" : check === "ok" ? "Link works ✓" : check === "bad" ? "Not reachable — try again" : "Test link"}
              </button>
              <span className="cx-spacer" />
              <button
                className="cx-ghost danger"
                disabled={busy}
                onClick={() => {
                  if (confirm("Make a new link? The old one stops working, so you'll paste the new one into Omi.")) act({ action: "key.rotate" });
                }}
              >
                New link
              </button>
            </div>
            <p className="cx-hint">Private to you. Anyone with this link could add lines to your record, so don&apos;t post it.</p>
          </>
        ) : (
          <p className="cx-muted">{view.webhookError || "Making your link…"}</p>
        )}
      </div>

      <ol className="cx-steps">
        <li>
          <b>Get the recorder.</b> The Omi pendant clips on and streams to the Omi phone app (
          <a href="https://www.omi.me/pages/product" target="_blank" rel="noreferrer">
            omi.me
          </a>
          ). No pendant yet? The Omi app records with your phone&apos;s mic, so you can start today.
        </li>
        <li>
          <b>Make the Omi app.</b> In the Omi app: <i>Explore → Create an App</i>, pick the <i>External Integration</i> capability,
          choose <i>Real-time transcript</i>, and paste your link. Add the same link for <i>Conversation created</i> too — that brings
          Omi&apos;s summary and key points into each conversation here.
        </li>
        <li>
          <b>Install it</b> on your Omi and start talking. Lines show up in Record within seconds. Real-time transcripts use Omi&apos;s
          cloud minutes (a free allowance, then their Unlimited plan) —{" "}
          <a href="https://www.omi.me/pages/pricing" target="_blank" rel="noreferrer">
            check Omi&apos;s pricing
          </a>
          .
        </li>
        <li>
          <b>Voices.</b> Your voice comes through as you. With one other person set up, every other voice is them automatically. With
          more people, tap <i>Who&apos;s this?</i> in Record once per conversation. If Omi recognises someone by name, they&apos;re
          matched by themselves.
        </li>
      </ol>

      <div className="cx-card">
        <p className="cx-kicker">Switches</p>
        <label className="cx-switch">
          <input type="checkbox" checked={doc.settings.liveNotify} onChange={(e) => act({ action: "settings", liveNotify: e.target.checked })} />
          <span>
            <b>Receipts on my phone, live</b> — Omi pops up &ldquo;Actually, at 3:47 PM…&rdquo; the moment it happens.
          </span>
        </label>
        <label className="cx-switch">
          <input type="checkbox" checked={doc.settings.autoPartner} onChange={(e) => act({ action: "settings", autoPartner: e.target.checked })} />
          <span>
            <b>Auto-match the other voice</b> when only one other person is set up.
          </span>
        </label>
        <p className="cx-hint">Times are shown for {doc.settings.tz.replace(/_/g, " ")}.</p>
      </div>

      <div className="cx-card subtle">
        <p className="cx-kicker">Ground rules</p>
        <p className="cx-muted">
          Everyone on the record agreed to it. Voices nobody named are deleted after 2 days. Withdrawing consent deletes everything that
          person said. Recording laws differ by state — in some, everyone in the conversation must agree, so keep it to people who did.
        </p>
        <button
          className="cx-ghost danger"
          onClick={() => {
            if (confirm("Delete every line and receipt? People and settings stay.")) act({ action: "all.clear" });
          }}
        >
          Delete the whole record
        </button>
      </div>
    </section>
  );
}
