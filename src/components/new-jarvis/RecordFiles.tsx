"use client";

// ---------------------------------------------------------------------------
// The documents behind the profile.
//
// Not a gallery. Each row is a claim with its proof attached: the card, what
// it proves in the Record's own words, and where its bytes actually are. The
// two questions it exists to answer are "where did this member ID come from?"
// and "what does my insurance card say?", and the second one is asked standing
// at a desk with a phone, which is why `where` is printed rather than assumed.
//
// A sensitive card is BLURRED until asked for and re-blurs itself. The Record
// masks a member ID in its own field; rendering a photograph of that same ID
// openly two inches away would make the masking theatre. The reveal is timed
// for the same reason the password vault's is — the risk is not the moment you
// look, it is the tab left open afterwards.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { describeFile, provesWhat, removeFile, type RecordFile } from "@/lib/jarvis/record/files";
import { forgetPicture, pictureUrl } from "@/lib/jarvis/record/fileStore";
import { getRecord, saveRecord } from "@/lib/jarvis/record/store";

/** Matches the password vault. The tab left open is the risk, not the glance. */
const REVEAL_MS = 20_000;

export function RecordFiles({ onChanged }: { onChanged?: () => void }) {
  const [files, setFiles] = useState<RecordFile[]>(() => getRecord().files ?? []);
  const [open, setOpen] = useState<string | null>(null);

  const drop = useCallback(
    async (file: RecordFile) => {
      await forgetPicture(file.id);
      const next = removeFile(getRecord(), file.id);
      saveRecord(next);
      setFiles(next.files ?? []);
      onChanged?.();
    },
    [onChanged],
  );

  if (!files.length) {
    return (
      <section className="rounded-md border border-line-soft bg-panel p-3">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Documents</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
          Nothing kept yet. Read a card or a letter above and Jarvis offers to keep the picture, so you have the
          document itself wherever you are — not just the values off it.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-line bg-panel">
      <header className="border-b border-line-soft px-3 py-2.5">
        <h3 className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">Documents</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
          The pictures your values were read off. {files.length} kept.
        </p>
      </header>

      <ul className="divide-y divide-line-soft">
        {files.map((file) => (
          <Row
            key={file.id}
            file={file}
            open={open === file.id}
            onOpen={() => setOpen((id) => (id === file.id ? null : file.id))}
            onClose={() => setOpen(null)}
            onDrop={() => void drop(file)}
          />
        ))}
      </ul>
    </section>
  );
}

function Row({
  file,
  open,
  onOpen,
  onClose,
  onDrop,
}: {
  file: RecordFile;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDrop: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [shown, setShown] = useState(false);
  const [left, setLeft] = useState(0);
  const release = useRef<(() => void) | null>(null);

  // The bytes are fetched only when the row is opened. A profile with a dozen
  // cards should not pull a dozen pictures of government documents into the
  // page because the owner walked past the tab.
  useEffect(() => {
    if (!open) return;
    let dead = false;
    void pictureUrl(file.id, file.where).then((got) => {
      if (dead) {
        got?.release();
        return;
      }
      if (!got) {
        setMissing(true);
        return;
      }
      release.current = got.release;
      setUrl(got.url);
    });
    return () => {
      dead = true;
      release.current?.();
      release.current = null;
      setUrl(null);
      setMissing(false);
      setShown(false);
    };
  }, [file.id, file.where, open]);

  // Re-blur on a timer, and show the countdown — a reveal that ends silently
  // teaches the owner nothing about how long it was open.
  useEffect(() => {
    if (!shown || !file.sensitive) return;
    setLeft(Math.round(REVEAL_MS / 1000));
    const tick = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
    const end = setTimeout(() => setShown(false), REVEAL_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(end);
    };
  }, [file.sensitive, shown]);

  const proves = provesWhat(file);
  const blurred = file.sensitive && !shown;

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[11.5px] text-ink">{file.label}</span>
            {file.sensitive && (
              <span className="rounded border border-amber-400/40 px-1 text-[9px] uppercase tracking-wide text-amber-300">
                sensitive
              </span>
            )}
            {file.where === "device" && (
              <span className="rounded border border-line px-1 text-[9px] uppercase tracking-wide text-ink-faint">
                this device
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[10.5px] text-ink-faint">{describeFile(file)}</p>
          {proves && (
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-muted">
              Proves: <span className="text-ink-faint">{proves}</span>
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={open ? onClose : onOpen}
          aria-expanded={open}
          className="shrink-0 rounded border border-line px-2 py-0.5 text-[10.5px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
        >
          {open ? "Hide" : "Look"}
        </button>
        <button
          type="button"
          onClick={onDrop}
          aria-label={`Forget the ${file.label}`}
          className="shrink-0 rounded p-1 text-ink-faint transition hover:text-amber-300"
        >
          <Icon.Close width={10} height={10} />
        </button>
      </div>

      {open && (
        <div className="mt-2">
          {missing ? (
            <p className="text-[11px] leading-relaxed text-amber-300">
              {file.where === "device"
                ? "The picture was kept on another device. The values it proved are still in your profile."
                : "The picture could not be fetched. The values it proved are still in your profile."}
            </p>
          ) : !url ? (
            <p className="text-[11px] text-ink-faint">Fetching…</p>
          ) : (
            <>
              <div className="relative overflow-hidden rounded border border-line bg-panel-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={blurred ? "" : `${file.label}, kept ${file.origin ?? ""}`}
                  className={`block max-h-[22rem] w-full object-contain transition-[filter] duration-200 ${
                    blurred ? "blur-xl" : ""
                  }`}
                />
                {blurred && (
                  <button
                    type="button"
                    onClick={() => setShown(true)}
                    className="absolute inset-0 grid place-items-center bg-panel/40 text-[11px] text-ink transition hover:bg-panel/20"
                  >
                    <span className="rounded border border-line bg-panel px-2 py-1">Show for 20 seconds</span>
                  </button>
                )}
              </div>
              {file.sensitive && shown && (
                <p className="mt-1 text-right font-mono text-[10px] text-ink-faint" data-num>
                  hides in {left}s
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
