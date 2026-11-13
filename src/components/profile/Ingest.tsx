"use client";

import { useRef, useState } from "react";
import { Icon } from "../icons";
import { Modal } from "../Modal";
import type { Draft } from "@/lib/profile/types";

/**
 * Onboarding by ingestion, not interrogation.
 *
 * The owner already has every fact written down somewhere — a resume, a bill,
 * an offer email, years of AI chats. The source video's trick is to read those
 * instead of asking: export the chat history, drop it in, let the model write
 * the context files, and resolve what it finds contradictory.
 *
 * So the seven-question intake becomes the FALLBACK, and the first screen is a
 * drop zone. Everything extracted lands unconfirmed, which means the owner's
 * first run is reviewing their profile rather than typing it.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (drafts: Draft[]) => void;
  /** Pull the Four-Cs dashboard's seven answers in as seed facts, if any exist. */
  onImportIntake?: () => number;
  /** Fold the 47-field life record in. Returns how many facts moved across. */
  onImportRecord?: () => number;
}

type Found = { drafts: Draft[]; questions: string[]; note: string; status: string };

export function Ingest({ open, onClose, onApply, onImportIntake, onImportRecord }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [dragging, setDragging] = useState(false);
  // One line, shared by both importers, naming WHICH one ran - two buttons
  // reporting into one bare number reads as the wrong one having worked.
  const [imported, setImported] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setFound(null);
    setText("");
    setImported(null);
  };

  const run = async (body: FormData | string) => {
    setBusy(true);
    setFound(null);
    try {
      const res = await fetch("/api/profile/extract", {
        method: "POST",
        ...(typeof body === "string"
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body }) }
          : { body }),
      });
      const data = (await res.json()) as Found;
      setFound({
        drafts: data.drafts ?? [],
        questions: data.questions ?? [],
        note: data.note ?? "",
        status: data.status ?? "failed",
      });
    } catch {
      setFound({ drafts: [], questions: [], note: "That request did not go through. Try again.", status: "failed" });
    } finally {
      setBusy(false);
    }
  };

  const sendFiles = async (files: FileList | File[]) => {
    // One file per call: the route reads PDFs and chat exports differently, and
    // a 40 MB export beside a 2 KB resume should not share a timeout.
    for (const file of Array.from(files).slice(0, 4)) {
      const form = new FormData();
      form.append("file", file);
      // eslint-disable-next-line no-await-in-loop
      await run(form);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Build your profile" wide>
      <div className="space-y-4 px-5 py-4">
        <p className="text-xs leading-relaxed text-ink-muted">
          You do not have to type this out. Drop in what you already have and the facts get filed for you — every
          one of them marked unconfirmed until you agree with it.
        </p>

        {/* Door 1 — drop what you already have. */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void sendFiles(e.dataTransfer.files);
          }}
          className={`rounded-xl border border-dashed p-4 text-center transition ${
            dragging ? "border-brand bg-brand/5" : "border-line bg-panel-2/40"
          }`}
        >
          <Icon.Upload width={18} height={18} className="mx-auto mb-1.5 text-ink-faint" />
          <p className="text-xs font-medium text-ink">Drop a resume, a bill, an offer, a tax return</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            PDF, DOCX, text — or a ChatGPT / Claude data export (<span className="font-mono">Settings → Export data</span>),
            which already holds everything you have ever explained to an assistant.
          </p>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50"
          >
            <Icon.File width={12} height={12} /> Choose files
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.json,.csv"
            className="hidden"
            onChange={(e) => e.target.files && void sendFiles(e.target.files)}
          />
        </div>

        {/* Door 2 — just say it. */}
        <div>
          <label htmlFor="pf-say" className="mb-1 block text-[11px] font-medium text-ink-muted">
            Or just tell it, in your own words
          </label>
          <textarea
            id="pf-say"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="I run a DTF printing business called Honey Press. I just got an Epson F2270. My mum's birthday is 3 June."
            className="w-full resize-y rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs leading-relaxed text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void run(text)}
            disabled={busy || !text.trim()}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-2 disabled:opacity-50"
          >
            {busy ? <Icon.Refresh width={12} height={12} className="animate-spin" /> : <Icon.Sparkles width={12} height={12} />}
            File this
          </button>
        </div>

        {/* Door 3 - the life record this shell already holds. This is the big
            one for an existing owner: 47 fields they have already filled in,
            filed into folders in one click, each keeping its own provenance
            so their own answers do not land in the confirm queue. */}
        {onImportRecord && (
          <div className="rounded-lg border border-line bg-panel-2/40 px-3 py-2">
            <p className="text-[11px] text-ink-muted">
              Already filled in your life record? Those facts belong here too.
            </p>
            <button
              type="button"
              onClick={() => {
                const n = onImportRecord();
                setImported(n ? `${n} facts filed from your life record` : "your life record is empty");
              }}
              className="mt-1 text-[11px] font-medium text-accent hover:underline"
            >
              File my life record
            </button>
          </div>
        )}

        {/* Door 4 - the old seven questions, as a fallback rather than the gate. */}
        {onImportIntake && (
          <div className="rounded-lg border border-line bg-panel-2/40 px-3 py-2">
            <p className="text-[11px] text-ink-muted">
              Already answered the Four-Cs questions on the old dashboard?
            </p>
            <button
              type="button"
              onClick={() => {
                const n = onImportIntake();
                setImported(n ? `${n} answers brought in` : "nothing there to import");
              }}
              className="mt-1 text-[11px] font-medium text-accent hover:underline"
            >
              Bring those answers in
            </button>
          </div>
        )}

        {imported && <p className="font-mono text-[10px] text-ink-faint">{imported}</p>}

        {busy && <p className="text-[11px] text-ink-faint">Reading…</p>}

        {found && (
          <div className="rounded-lg border border-line bg-panel-2/60 p-3">
            {found.note && <p className="mb-2 text-[11px] text-amber-300">{found.note}</p>}

            {found.drafts.length === 0 ? (
              <p className="text-[11px] text-ink-muted">Nothing filable came out of that.</p>
            ) : (
              <>
                <p className="mb-1.5 text-[11px] font-semibold text-ink">
                  {found.drafts.length} folder{found.drafts.length === 1 ? "" : "s"} to file
                </p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {found.drafts.map((d, i) => (
                    <div key={i} className="rounded border border-line bg-panel px-2 py-1.5">
                      <div className="font-mono text-[11px] text-ink">{d.path.join(" › ")}</div>
                      <div className="mt-0.5 text-[10px] text-ink-faint">
                        {d.fields.map((f) => `${f.label}: ${f.kind === "secret" ? "••••" : f.value}`).join(" · ") || "(notes only)"}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onApply(found.drafts);
                    reset();
                    onClose();
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-2"
                >
                  <Icon.Check width={12} height={12} /> Add them, unconfirmed
                </button>
              </>
            )}

            {found.questions.length > 0 && (
              <div className="mt-2.5 border-t border-line pt-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  It could not work these out
                </p>
                <ul className="space-y-0.5 text-[11px] text-ink-muted">
                  {found.questions.map((q, i) => (
                    <li key={i}>· {q}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
