"use client";

// ---------------------------------------------------------------------------
// The dropzone.
//
// It offers the manual path with equal weight, not as a fallback buried under
// an error. Plenty of results arrive as a text message from a clinic or a line
// in a portal with no document to export, and a person in that position should
// not have to fail an upload first to find the way in.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { parseReport, type ParseResponse } from "@/lib/stdsafe/client";
import { emptyDraft } from "@/lib/stdsafe/parse";

interface Props {
  onDraft: (response: ParseResponse) => void;
}

export function UploadFlow({ onDraft }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handle(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onDraft(await parseReport(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be read.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function manual() {
    onDraft({
      draft: emptyDraft("manual"),
      note: "",
      fileId: null,
      fileName: "",
      verification: "self",
      storageWarning: "",
    });
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handle(e.dataTransfer.files[0]);
        }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-xl border border-dashed px-6 py-10 text-center transition ${
          dragging ? "border-brand/60 bg-brand/[0.06]" : "border-line bg-panel hover:border-line/80"
        }`}
      >
        <input
          ref={input}
          type="file"
          accept=".pdf,image/*"
          className="hidden"
          onChange={(e) => void handle(e.target.files?.[0])}
        />
        <p className="text-[15px] font-medium text-ink">
          {busy ? "Reading the report…" : "Drop a lab report here"}
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">
          The PDF from STDcheck, Quest, Labcorp or MyChart — or a photo of the printout. It is read
          on the server, and you confirm every line before anything is saved.
        </p>
        <p className="mt-3 text-[11px] text-ink-faint">PDF or image · up to 20MB</p>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={manual}
        className="mt-3 w-full rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px] text-ink-muted transition hover:text-ink"
      >
        No file — enter the results by hand
        <span className="ml-2 text-ink-faint">(saved as self-reported)</span>
      </button>
    </div>
  );
}
