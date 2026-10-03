"use client";

// ---------------------------------------------------------------------------
// Read my screen.
//
// Point it at a form, a benefits letter, an insurance portal — anything on
// screen — and it proposes the facts worth keeping. The owner confirms, edits
// or refuses each one, and only then is anything written.
//
// What makes this bearable rather than noise is that the auditing has already
// happened before the sheet opens (see record/diff.ts): the things it already
// knew are collapsed behind a single count, the ones that DISAGREE with what
// it holds are at the top because they need a decision, and only genuinely new
// values arrive pre-ticked. A sheet that proposes the owner's own name back to
// them on every page is a sheet they stop reading.
//
// Every row carries the words it was read from. That is the whole trust model:
// the question is never "do I believe the model", it is "does that quote say
// that", which is a two-second check instead of an act of faith.
//
// Two things it deliberately does NOT do:
//
//   · It never captures a password. Not by filtering — by construction. There
//     is no password field among the Record's 47, and the extractor drops every
//     key it does not recognise, so a credential has nowhere to land. When the
//     encrypted vault exists, that is where it will go.
//   · It never fills a form from here. Reading pixels gives no way to type into
//     another application; filling is the browser extension's job, from the
//     same Record this writes to.
//
// THE PICTURE. By default the frame is read and dropped. It is offered for
// keeping only when the scan looks like a DOCUMENT — a card, a stub, a letter
// (see record/files.ts) — because then the picture is evidence worth having:
// it answers "where did this member ID come from?", and it puts the insurance
// card on the owner's phone at the clinic desk, which is the moment the whole
// Record was built for. An ordinary page is never offered, because a store of
// unreviewed screenshots of someone's screen is a liability, not a feature.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  captureScreen,
  CAPTURE_WARNING,
  CaptureError,
  screenCaptureSupported,
  type Capture,
} from "@/lib/new-jarvis/screenCapture";
import { describeReview, review, summarise, type Review } from "@/lib/jarvis/record/diff";
import { addFile, looksLikeDocument, type DocumentGuess } from "@/lib/jarvis/record/files";
import { keepPicture, newFileId } from "@/lib/jarvis/record/fileStore";
import type { Proposal } from "@/lib/jarvis/record/extract";
import { addEntry, getRecord, saveRecord, setField, updateEntry } from "@/lib/jarvis/record/store";

type Phase = "idle" | "warning" | "capturing" | "reading" | "review" | "done";

interface Row extends Review {
  /** The value as it stands, after any edit. */
  value: string;
  /** True once the owner has changed it by hand. */
  edited: boolean;
  chosen: boolean;
}

export function ScreenScan({ onSaved }: { onSaved?: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<Row[]>([]);
  const [knownCount, setKnownCount] = useState(0);
  const [headline, setHeadline] = useState("");
  const [shot, setShot] = useState<Capture | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(0);
  /** What document this looks like, when it looks like one at all. */
  const [doc, setDoc] = useState<DocumentGuess | null>(null);
  const [keepIt, setKeepIt] = useState(false);
  const [keptNote, setKeptNote] = useState("");
  const [busy, setBusy] = useState(false);

  const supported = useMemo(() => screenCaptureSupported(), []);
  const chosen = rows.filter((r) => r.chosen).length;

  const reset = useCallback(() => {
    setPhase("idle");
    setRows([]);
    setShot(null);
    setError("");
    setHeadline("");
    setKnownCount(0);
    setDoc(null);
    setKeepIt(false);
    setKeptNote("");
  }, []);

  const run = useCallback(async () => {
    setError("");
    setPhase("capturing");
    let capture: Capture;
    try {
      capture = await captureScreen();
    } catch (e) {
      // Three different causes need three different sentences; one "capture
      // failed" sends the owner hunting for a fault that is not there.
      setError(e instanceof CaptureError ? e.message : "The screen could not be read.");
      setPhase("idle");
      return;
    }

    setShot(capture);
    setPhase("reading");
    try {
      const res = await fetch("/api/jarvis/record/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: [capture.dataUrl],
          hint: "a screenshot of a page or form on the owner's screen",
        }),
      });
      const data = (await res.json()) as { proposals?: Proposal[]; note?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Reading the screen failed (${res.status}).`);
        setShot(null);
        setPhase("idle");
        return;
      }

      const proposals = data.proposals ?? [];
      // Judged from EVERYTHING the scan read, not from what is new: a second
      // look at the same card still shows a card, even when every value on it
      // is already known.
      const guess = looksLikeDocument(
        proposals.map((p) => (p.kind === "field" ? p.key : `${p.group}.${Object.keys(p.values)[0] ?? ""}`)),
      );
      setDoc(guess);
      setKeepIt(Boolean(guess));

      const judged = review(proposals, getRecord());
      const summary = summarise(judged);
      setRows(
        summary.toShow.map((r) => ({
          ...r,
          value: r.proposal.kind === "field" ? r.proposal.value : "",
          edited: false,
        })),
      );
      setKnownCount(summary.known);
      setHeadline(data.note?.trim() ? `${describeReview(summary)} ${data.note.trim()}` : describeReview(summary));
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reading the screen failed.");
      setShot(null);
      setPhase("idle");
    }
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    let record = getRecord();
    let count = 0;
    const origin = "read off your screen";
    /** What the picture, if kept, will be the proof of. */
    const proves: string[] = [];

    for (const row of rows) {
      if (!row.chosen) continue;
      if (row.proposal.kind === "field") {
        if (!row.value.trim()) continue;
        // An edited value is the owner's, not the model's — the provenance has
        // to say so, or a typed correction reads later as something Jarvis
        // guessed.
        record = setField(record, row.proposal.key, row.value, row.edited ? "you" : "jarvis", origin);
        proves.push(row.proposal.key);
        count += 1;
      } else if (row.matchedId) {
        record = updateEntry(record, row.proposal.group, row.matchedId, row.proposal.values);
        count += 1;
      } else {
        record = addEntry(record, row.proposal.group, row.proposal.values, "jarvis", origin);
        count += 1;
      }
    }

    // The bytes go first. A record that claims to hold a picture it never
    // stored is worse than one that holds no picture: the owner stops carrying
    // the card because Jarvis says it has it.
    if (keepIt && doc && shot) {
      const id = newFileId();
      const kept = await keepPicture(id, shot.dataUrl);
      record = addFile(record, {
        id,
        label: doc.label,
        mime: "image/jpeg",
        bytes: kept.bytes,
        width: shot.width,
        height: shot.height,
        addedAt: new Date().toISOString(),
        source: "jarvis",
        origin,
        // Only what actually went into the record this time. A value that was
        // already there came from somewhere else, and claiming this card as
        // its source would be a lie the evidence link exists to prevent.
        evidenceFor: proves,
        // Sensitivity is judged from the WHOLE card, not from what was saved:
        // it shows the member ID whether or not the owner kept that field.
        sensitive: doc.sensitive,
        where: kept.where,
      });
      setKeptNote(kept.note ?? "");
      count += 1;
    }

    saveRecord(record);
    setSaved(count);
    setBusy(false);
    setShot(null);
    setPhase("done");
    onSaved?.();
  }, [doc, keepIt, onSaved, rows, shot]);

  const patch = (index: number, next: Partial<Row>) =>
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...next } : r)));

  // --- the trigger ---------------------------------------------------------

  if (phase === "idle" || phase === "warning") {
    return (
      <section className="rounded-md border border-line-soft bg-panel p-3">
        <header>
          <h3 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Read my screen</h3>
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
            Show it a form or a letter and it proposes what is worth keeping — only the things it does not already
            know. Nothing is saved until you say so.
          </p>
        </header>

        {phase === "warning" ? (
          <div className="mt-2.5 rounded-md border border-line bg-panel-2 p-2.5">
            <p className="text-[11px] leading-relaxed text-ink">{CAPTURE_WARNING}</p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => void run()}
                className="rounded border border-line bg-brand px-2 py-1 text-[11px] font-medium text-white transition hover:bg-[var(--nj-brand-press)]"
              >
                Choose a window
              </button>
              <button
                type="button"
                onClick={() => setPhase("idle")}
                className="rounded px-2 py-1 text-[11px] text-ink-muted transition hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!supported}
            onClick={() => setPhase("warning")}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-[11.5px] text-ink transition hover:border-ink-faint hover:bg-elevated disabled:opacity-50"
          >
            <Icon.Eye width={12} height={12} aria-hidden />
            Read my screen
          </button>
        )}

        {!supported && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
            This browser cannot share a screen. On a phone, photograph the document instead — the reader below takes
            pictures.
          </p>
        )}
        {error && <p className="mt-2 text-[11px] leading-relaxed text-amber-300">{error}</p>}
      </section>
    );
  }

  // --- working -------------------------------------------------------------

  if (phase === "capturing" || phase === "reading") {
    return (
      <section className="rounded-md border border-line-soft bg-panel p-3">
        <div className="flex items-center gap-2">
          <span className="nj-dot bg-support" data-live="true" aria-hidden />
          <p className="text-[11.5px] text-ink-muted" aria-live="polite">
            {phase === "capturing" ? "Waiting for you to choose what to share…" : "Reading what is on it…"}
          </p>
        </div>
        {shot && (
          <p className="mt-1.5 font-mono text-[10px] text-ink-faint" data-num>
            {shot.width}×{shot.height}
            {shot.label ? ` · ${shot.label}` : ""}
          </p>
        )}
      </section>
    );
  }

  // --- saved ---------------------------------------------------------------

  if (phase === "done") {
    return (
      <section className="rounded-md border border-line-soft bg-panel p-3">
        <p className="text-[11.5px] text-ink">
          {saved === 0 ? "Nothing was saved." : `Saved ${saved} ${saved === 1 ? "thing" : "things"} to your profile.`}
        </p>
        {/* Where the picture landed, when it did not land where it should
            have. Silence here is how an owner finds out at the clinic desk. */}
        {keptNote && <p className="mt-1 text-[11px] leading-relaxed text-amber-300">{keptNote}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-2 rounded border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          Read another
        </button>
      </section>
    );
  }

  // --- the review sheet ----------------------------------------------------

  return (
    <section className="rounded-md border border-line bg-panel">
      <header className="border-b border-line-soft px-3 py-2.5">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">What it read</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink">{headline}</p>
        {knownCount > 0 && (
          <p className="mt-1 text-[10.5px] text-ink-faint">
            {knownCount} {knownCount === 1 ? "value was" : "values were"} already in your profile and {knownCount === 1 ? "is" : "are"} not
            shown.
          </p>
        )}
      </header>

      {/* Offered only for a document, and ticked by default when it is one:
          the owner went to the trouble of showing Jarvis a card, and the card
          is the thing worth keeping. */}
      {doc && shot && (
        <label className="flex cursor-pointer items-start gap-2 border-b border-line-soft bg-panel-2 px-3 py-2.5">
          <input
            type="checkbox"
            checked={keepIt}
            onChange={(e) => setKeepIt(e.target.checked)}
            className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-brand)]"
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[11.5px] text-ink">Keep the picture</span>
              <span className="rounded border border-support/40 px-1 text-[9px] uppercase tracking-wide text-support">
                {doc.label}
              </span>
              {doc.sensitive && (
                <span className="rounded border border-amber-400/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">
                  hidden by default
                </span>
              )}
            </span>
            <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-faint">
              {doc.sensitive
                ? "So you have the card itself on your phone, and can check any value against it. It shows something your profile masks, so it stays blurred until you ask."
                : "So you have it on your phone, and can check any value against the document it came from."}
            </span>
          </span>
          <span className="shrink-0 overflow-hidden rounded border border-line" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shot.dataUrl} alt="" className="h-9 w-14 object-cover" />
          </span>
        </label>
      )}

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] leading-relaxed text-ink-muted">
          Nothing new to add. That is the answer, not a failure — it means your profile already has what was on that
          screen.{doc ? " The picture is still worth keeping." : ""}
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {rows.map((row, i) => (
            <li key={`${i}-${row.proposal.kind}`} className="px-3 py-2.5">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={row.chosen}
                  onChange={(e) => patch(i, { chosen: e.target.checked })}
                  aria-label={`Save ${row.proposal.label}`}
                  className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-brand)]"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[11px] text-ink-muted">{row.proposal.label}</span>
                    {/* Three states, three words. Calling an addition a
                        disagreement would make the owner hesitate over
                        something that destroys nothing. */}
                    {row.verdict === "conflict" ? (
                      <span className="rounded border border-amber-400/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">
                        disagrees
                      </span>
                    ) : row.verdict === "adds" ? (
                      <span className="rounded border border-support/40 px-1 text-[9px] uppercase tracking-wide text-support">
                        fills a gap
                      </span>
                    ) : (
                      <span className="rounded border border-core/40 px-1 text-[9px] uppercase tracking-wide text-core">
                        new
                      </span>
                    )}
                    {row.edited && <span className="text-[9px] uppercase tracking-wide text-ink-faint">yours</span>}
                  </div>

                  {row.proposal.kind === "field" ? (
                    <input
                      value={row.value}
                      onChange={(e) => patch(i, { value: e.target.value, edited: true, chosen: true })}
                      className="mt-1 w-full rounded border border-line bg-panel-2 px-1.5 py-1 font-mono text-[11.5px] text-ink focus:border-ink-faint focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 font-mono text-[11.5px] leading-relaxed text-ink">
                      {Object.entries(row.proposal.values)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}
                    </p>
                  )}

                  {/* What it is about to replace, struck through only once the
                      row is ticked — you see what you are destroying before
                      you destroy it, not after. */}
                  {row.current && (
                    <p className="mt-1 text-[10.5px] text-ink-faint">
                      {row.verdict === "adds" ? "adding to: " : "now: "}
                      <span
                        className={`font-mono ${
                          row.verdict === "conflict" && row.chosen ? "line-through decoration-amber-300/70" : ""
                        }`}
                      >
                        {row.current}
                      </span>
                    </p>
                  )}

                  {/* The evidence. The whole trust model of this sheet. */}
                  {row.proposal.because && (
                    <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                      read from “{row.proposal.because}”
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}
                  aria-label={`Discard ${row.proposal.label}`}
                  className="shrink-0 rounded p-1 text-ink-faint transition hover:text-ink"
                >
                  <Icon.Close width={10} height={10} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <footer className="flex items-center gap-2 border-t border-line-soft px-3 py-2.5">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || (chosen === 0 && !keepIt)}
          className="rounded-md border border-line bg-brand px-2.5 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-[var(--nj-brand-press)] disabled:opacity-50"
        >
          {busy ? "Saving…" : chosen === 0 && !keepIt ? "Nothing ticked" : `Save ${chosen + (keepIt ? 1 : 0)}`}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded px-2 py-1.5 text-[11.5px] text-ink-muted transition hover:text-ink"
        >
          Discard all
        </button>
        {/* This line used to be a flat promise. Now it is a report, because
            the answer depends on what is ticked and the owner has to be able
            to trust the sentence either way. */}
        <span className="ml-auto text-[10px] text-ink-faint">
          {keepIt ? "The picture will be kept." : "The picture will not be kept."}
        </span>
      </footer>
    </section>
  );
}
