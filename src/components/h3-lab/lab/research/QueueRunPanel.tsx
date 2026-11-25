"use client";

// "Run in 24/7 Queue" — hand a reference video to the VPS worker instead of
// analysing it in this tab. Upload a file (straight to Storage, with
// progress) or paste a link, say what to change, pick how many variations;
// the H3 Recreation Agent finds the shots with ffmpeg, describes them, and
// writes the storyboard + per-shot H3 prompts while the page is closed.
// The task is filed with h3TaskInput(), the same shape Jarvis and the queue
// page use.

import { useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowUpRight, Link2, ListPlus, Upload, X } from "lucide-react";
import { Panel } from "../ui";
import { describeChanges, parseChangeText } from "@/lib/queue247/h3/changes";
import { h3TaskInput, H3_DEFAULT_VARIATIONS } from "@/lib/queue247/h3/task";
import { MAX_VARIATIONS } from "@/lib/queue247/h3/variations";
import { uploadProblem } from "@/lib/queue247/h3/upload";

const PLACEHOLDER = `Person A -> Maya, a grey-haired fisherwoman
outfit: red jacket -> yellow raincoat
location: diner -> a lighthouse kitchen at night
style: 16 mm film, warm grade`;

function put(url: string, file: File, type: string, onProgress: (p: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("Content-Type", type);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.min(0.99, e.loaded / e.total));
    x.onload = () => resolve(x.status >= 200 && x.status < 300);
    x.onerror = () => resolve(false);
    x.send(file);
  });
}

export function QueueRunPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [count, setCount] = useState(H3_DEFAULT_VARIATIONS);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<{ label: string; p: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const understood = useMemo(() => describeChanges(parseChangeText(text)), [text]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    const problem = uploadProblem({ filename: f.name, type: f.type, size: f.size });
    if (problem) return setError(problem);
    setError(null);
    setFile(f);
    setLink("");
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    setError(null);
    setQueued(null);
    try {
      let videoKey: string | undefined;
      if (file) {
        setBusy({ label: "Starting the upload", p: 0 });
        const res = await fetch("/api/queue247/h3/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, type: file.type, size: file.size }),
        });
        const j = (await res.json().catch(() => ({}))) as { key?: string; uploadUrl?: string; type?: string; error?: string };
        if (!res.ok || !j.key) throw new Error(j.error ?? "Couldn't start the upload. Try again in a moment.");
        const target = j.uploadUrl ?? `/api/queue247/h3/upload?key=${encodeURIComponent(j.key)}`;
        const ok = await put(target, file, j.type || file.type || "video/mp4", (p) => setBusy({ label: `Uploading ${file.name}`, p }));
        if (!ok) throw new Error("The upload didn't finish. Check your connection and try again.");
        videoKey = j.key;
      } else if (!link.trim()) {
        throw new Error("Choose a video or paste a link first.");
      }
      setBusy({ label: "Adding it to the 24/7 Queue", p: 1 });
      const task = h3TaskInput({ videoKey, url: videoKey ? undefined : link.trim(), changes: text, changeText: text, variations: count, title: title.trim() || undefined, fileName: file?.name });
      const res = await fetch("/api/queue247/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", task }),
      });
      const j = (await res.json().catch(() => ({}))) as { task?: { id: string; title: string }; error?: string };
      if (!res.ok || !j.task) throw new Error(j.error ?? `The queue didn't take it (HTTP ${res.status}).`);
      setQueued(j.task.title);
      setFile(null);
      setLink("");
      if (input.current) input.current.value = "";
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Run in 24/7 Queue" meta="ffmpeg on the server · keeps going when you close this page">
      <div className="grid" style={{ gap: 12 }}>
        <div className="rs-form">
          {file ? (
            <div className="row span" style={{ gap: 10 }}>
              <Upload size={14} />
              <b>{file.name}</b>
              <span className="mono muted">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button type="button" className="btn ghost sm" onClick={() => setFile(null)} disabled={Boolean(busy)} aria-label="Remove the file"><X size={12} /></button>
            </div>
          ) : (
            <>
              <div
                className="rs-drop"
                data-over={over}
                role="button"
                tabIndex={0}
                style={{ padding: 14 }}
                onClick={() => input.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <Upload size={14} /> <b style={{ color: "var(--ink)" }}>Upload a video</b>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>MP4, MOV, WebM, M4V or MKV · up to 500 MB</div>
              </div>
              <label className="field">
                <span><Link2 size={11} /> …or paste a link</span>
                <input className="in" value={link} onChange={(e) => setLink(e.target.value)} placeholder="YouTube, TikTok, Instagram, Facebook, X, Vimeo" inputMode="url" />
              </label>
            </>
          )}
          <input ref={input} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/x-matroska,.mkv" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <label className="field span">
            <span>What to change — characters, outfits, locations, style (one per line)</span>
            <textarea className="in" style={{ minHeight: 84 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} />
            <span className="muted" style={{ fontSize: 11.5 }}>Understood: {understood}.</span>
          </label>
          <label className="field">
            <span>Variations per shot</span>
            <input className="in" type="number" min={1} max={MAX_VARIATIONS} value={count} onChange={(e) => setCount(Math.max(1, Math.min(MAX_VARIATIONS, Number(e.target.value) || 1)))} />
          </label>
          <label className="field">
            <span>Name (optional)</span>
            <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={file?.name.replace(/\.[a-z0-9]+$/i, "") ?? "Reference video"} />
          </label>
        </div>

        {busy ? (
          <div className="grid" style={{ gap: 6 }} aria-live="polite">
            <span className="muted" style={{ fontSize: 12 }}>{busy.label}… <span className="mono">{Math.round(busy.p * 100)}%</span></span>
            <div className="rs-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.p * 100)}>
              <i style={{ width: `${busy.p * 100}%` }} />
            </div>
          </div>
        ) : null}
        {error ? <div className="notice bad">{error}</div> : null}
        {queued ? (
          <div className="notice cyan" aria-live="polite">
            <b>Queued</b> — {queued}. Close this page, it keeps running.{" "}
            <a href="/apps/jarvis#queue" style={{ color: "var(--ink)", fontWeight: 600 }}>Open 24/7 Queue <ArrowUpRight size={11} /></a>
          </div>
        ) : null}

        <div className="row">
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={Boolean(busy) || (!file && !link.trim())}>
            <ListPlus size={13} /> Run in 24/7 Queue
          </button>
          <span className="muted" style={{ fontSize: 11.5 }}>Finds the shots, describes each one, then writes a storyboard and {count} H3 prompt variation{count === 1 ? "" : "s"} per shot.</span>
        </div>
      </div>
    </Panel>
  );
}
