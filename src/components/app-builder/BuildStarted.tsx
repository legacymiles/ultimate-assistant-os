"use client";

// ---------------------------------------------------------------------------
// The moment after Build it.
//
// Pressing the button used to change a word on a button somewhere in a side
// panel, which is no way to answer "did that work?". A build is the biggest
// thing this app does and it deserves to be acknowledged: this says it has
// started, where it is happening, and — the part that actually matters — that
// the owner can walk away, because the build runs on their PC and not in this
// tab.
//
// Two ways out, because there are two reasonable things to want next: watch it,
// or go and start something else.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { landsIn } from "@/lib/app-builder/plan";
import type { BuilderProject } from "@/lib/app-builder/types";

export function BuildStarted({
  project,
  onWatch,
  onHome,
}: {
  project: BuilderProject;
  onWatch: () => void;
  onHome: () => void;
}) {
  const watchRef = useRef<HTMLButtonElement>(null);
  const name = project.understanding?.name ?? "Your app";
  const lands = landsIn(project);
  const review = project.handoff?.review;

  // Focus lands on the way out, and Escape is the same as "watch it" — the
  // build is already running either way, so no key here can lose anything.
  useEffect(() => {
    watchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onWatch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onWatch]);

  return (
    <div className="ab-started" role="dialog" aria-modal="true" aria-labelledby="ab-started-title">
      <div className="ab-started-card">
        <span className="ab-started-mark" aria-hidden>
          <i />
        </span>
        <h2 id="ab-started-title">{name} is being built</h2>
        <p className="ab-started-lede">
          It&rsquo;s running on your PC right now, in a folder and repository of its own. <b>You can close this page</b> — the build keeps going, and this
          screen comes back to it.
        </p>
        <dl className="ab-started-facts">
          <div>
            <dt>Lands in</dt>
            <dd>
              <code>{lands.where}</code>
            </dd>
          </div>
          {review && (
            <div>
              <dt>Review link</dt>
              <dd>
                It posts itself there as {review.number} when it&rsquo;s deployed{review.clientName ? `, and ${review.clientName} is told` : ""}.
              </dd>
            </div>
          )}
          <div>
            <dt>While it runs</dt>
            {/* Truthful about the actual policy: inside its own folder it works
                freely, including pushing and deploying. What still stops is
                anything destructive, and any write outside that folder. */}
            <dd>
              It works on its own inside that folder. It stops to ask only before something destructive, or a change outside the folder — and it may ask
              once to use your Jarvis tools.
            </dd>
          </div>
        </dl>
        <div className="ab-started-row">
          <button ref={watchRef} className="ab-primary" onClick={onWatch}>
            Watch it build <span aria-hidden>→</span>
          </button>
          <button className="ab-ghost" onClick={onHome}>
            Back to App Builder
          </button>
        </div>
      </div>
    </div>
  );
}
