"use client";

import { useRef, useState } from "react";
import type { ClonedVoice } from "@/lib/voice-studio/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";

interface Props {
  disabled: boolean;
  onSave: (voice: ClonedVoice) => void;
}

const MAX_SECONDS = 30;

export function ClonePanel({ disabled, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [transcript, setTranscript] = useState("");
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function reset() {
    setName("");
    setTranscript("");
    setAudioDataUrl(null);
    setDuration(null);
    setNote(null);
  }

  async function acceptBlob(blob: Blob) {
    if (blob.size > 8 * 1024 * 1024) {
      setNote("That clip is over 8MB — use a shorter or lower-quality sample.");
      return;
    }
    const dataUrl = await blobToDataUrl(blob);
    const dur = await getDuration(dataUrl);
    setAudioDataUrl(dataUrl);
    setDuration(dur);
    setNote(
      dur && (dur < 8 || dur > MAX_SECONDS)
        ? `Aim for ~10–30s of clean speech (this is ${Math.round(dur)}s).`
        : null,
    );
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await acceptBlob(file);
    e.target.value = "";
  }

  async function startRecording() {
    setNote(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => ev.data.size && chunksRef.current.push(ev.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        await acceptBlob(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          const next = s + 1;
          if (next >= MAX_SECONDS) stopRecording();
          return next;
        });
      }, 1000);
    } catch {
      setNote("Couldn't access the microphone. Upload a file instead.");
    }
  }

  function stopRecording() {
    recorderRef.current?.state === "recording" && recorderRef.current.stop();
  }

  function save() {
    if (!audioDataUrl || !name.trim()) return;
    onSave({
      id: crypto.randomUUID(),
      name: name.trim(),
      transcript: transcript.trim(),
      audioDataUrl,
      createdAt: new Date().toISOString(),
    });
    reset();
    setOpen(false);
  }

  if (disabled) {
    return (
      <div className="rounded-xl border border-dashed border-line px-3 py-3 text-[11px] text-ink-faint">
        <span className="font-medium text-ink-muted">Voice cloning</span> needs a fish.audio key.
        Add <code className="rounded bg-panel-2 px-1">FISH_API_KEY</code> to clone a voice from a
        10–30s clip.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand/40 bg-brand/10 px-3 py-2 text-xs font-semibold text-brand transition hover:bg-brand/20"
      >
        <Icon.Mic width={14} height={14} />
        Clone a voice
      </button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-brand/30 bg-brand/[0.04] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">Clone a voice</span>
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="rounded p-0.5 text-ink-faint transition hover:text-ink"
          aria-label="Close"
        >
          <Icon.Close width={13} height={13} />
        </button>
      </div>

      {/* Capture */}
      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <button
            onClick={stopRecording}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            Stop · {elapsed}s
          </button>
        ) : (
          <button
            onClick={startRecording}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Mic width={13} height={13} />
            Record
          </button>
        )}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink">
          <Icon.Upload width={13} height={13} />
          Upload
          <input type="file" accept="audio/*" onChange={onFile} className="hidden" />
        </label>
        {duration != null && (
          <span className="text-[11px] text-ink-faint">clip: {Math.round(duration)}s</span>
        )}
      </div>

      {audioDataUrl && (
        <audio controls src={audioDataUrl} className="h-8 w-full" />
      )}
      {note && <p className="text-[11px] text-amber-400">{note}</p>}

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Voice name (e.g. My voice)"
        className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
      />
      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={2}
        placeholder="Transcript of the clip (optional, but improves cloning accuracy)"
        className="w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/30"
      />

      <button
        onClick={save}
        disabled={!audioDataUrl || !name.trim()}
        className={cn(
          "inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white transition hover:bg-brand-2",
          "disabled:cursor-not-allowed disabled:opacity-40",
        )}
      >
        <Icon.Check width={14} height={14} />
        Save voice
      </button>
    </div>
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

function getDuration(dataUrl: string): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => resolve(null);
    a.src = dataUrl;
  });
}
