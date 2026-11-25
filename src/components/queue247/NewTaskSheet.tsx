"use client";

// Filing a task by hand, for when you know exactly what you want and would
// rather not ask Jarvis. Two forms:
//   New task              pick the app, the kind of work, how it lives, its settings
//   Recreate a video (H3) upload a clip (with progress) or paste a link, say
//                         what to change, how many variations per shot
// Both end in POST /api/queue247/tasks { action: "create" }.

import { useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import type { NewTaskInput } from "@/lib/queue247/engine";
import type { Task, TaskKind, TaskSchedule } from "@/lib/queue247/types";
import { postJson, type UseQueue247 } from "@/lib/queue247/useQueue247";
import { fieldsToConfig, type AppRef, type ExecutorRef } from "@/lib/queue247/view";
import { h3TaskInput, H3_DEFAULT_VARIATIONS } from "@/lib/queue247/h3/task";
import { MAX_VARIATIONS } from "@/lib/queue247/h3/variations";
import { uploadProblem } from "@/lib/queue247/h3/upload";
import type { Swap } from "@/lib/queue247/h3/changes";
import { Layer, Notice } from "./parts";
import { Field } from "./TaskDrawer";

const KINDS: { id: TaskKind; label: string; hint: string }[] = [
  { id: "once", label: "One-off", hint: "Runs until it is done." },
  { id: "scheduled", label: "Scheduled", hint: "Runs once, at the time you pick." },
  { id: "recurring", label: "Recurring", hint: "Runs, rests, runs again on a schedule." },
  { id: "continuous", label: "24/7", hint: "A standing workflow that picks up where it left off, round after round." },
];

export function NewTaskSheet({
  q,
  apps,
  executors,
  onClose,
  onCreated,
  initialMode = "task",
}: {
  q: UseQueue247;
  apps: AppRef[];
  executors: ExecutorRef[];
  onClose: () => void;
  onCreated: (t: Task) => void;
  initialMode?: "task" | "h3";
}) {
  const [mode, setMode] = useState<"task" | "h3">(initialMode);
  return (
    <Layer onClose={onClose} label="New task" kind="sheet">
      <div className="flex flex-none items-center gap-2 border-b border-[var(--q-line)] px-4 py-2.5">
        <h2 className="q-display text-[14px] font-semibold text-[var(--q-ink)]">New task</h2>
        <div role="tablist" aria-label="What to file" className="ml-2 flex gap-1">
          <button type="button" role="tab" aria-selected={mode === "task"} className="q-chip" onClick={() => setMode("task")}>
            Task
          </button>
          <button type="button" role="tab" aria-selected={mode === "h3"} className="q-chip" onClick={() => setMode("h3")}>
            <Icon.Film width={11} height={11} aria-hidden /> Recreate a video (H3)
          </button>
        </div>
        <span className="flex-1" />
        <button type="button" className="q-icon-btn" onClick={onClose} aria-label="Close (Esc)">
          <Icon.Close width={14} height={14} />
        </button>
      </div>
      <div className="q-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {mode === "task" ? <TaskForm q={q} apps={apps} executors={executors} onCreated={onCreated} /> : <H3Form q={q} onCreated={onCreated} />}
      </div>
    </Layer>
  );
}

function TaskForm({ q, apps, executors, onCreated }: { q: UseQueue247; apps: AppRef[]; executors: ExecutorRef[]; onCreated: (t: Task) => void }) {
  const choosable = executors.filter((e) => e.id !== "rollup");
  const [app, setApp] = useState("");
  const appRef = apps.find((a) => a.id === app);
  const suited = useMemo(() => (appRef ? choosable.filter((e) => appRef.executors.includes(e.id)) : choosable), [appRef, choosable]);
  const [executor, setExecutor] = useState(choosable[0]?.id ?? "");
  const ex = choosable.find((e) => e.id === executor) ?? null;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<TaskKind>(ex?.defaultKind ?? "once");
  const [every, setEvery] = useState("60");
  const [daily, setDaily] = useState("");
  const [at, setAt] = useState("");
  const [priority, setPriority] = useState(3);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pickExecutor = (id: string) => {
    setExecutor(id);
    const e = choosable.find((x) => x.id === id);
    if (e) setKind(e.defaultKind);
    setConfig({});
  };

  const submit = async () => {
    setErr(null);
    if (!title.trim()) return setErr("Give the task a name.");
    if (!ex) return setErr("Pick what kind of work this is.");
    const schedule: TaskSchedule = { tz: Intl.DateTimeFormat().resolvedOptions().timeZone };
    if (kind === "scheduled") {
      if (!at) return setErr("Pick when it should run.");
      schedule.at = new Date(at).toISOString();
    }
    if (kind === "recurring" || kind === "continuous") {
      if (every.trim()) schedule.everyMinutes = Number(every);
      if (kind === "recurring" && daily) schedule.dailyAt = daily;
      if (!schedule.everyMinutes && !schedule.dailyAt) return setErr("Say how often it should run.");
    }
    const input: NewTaskInput = {
      title: title.trim(),
      description: description.trim(),
      instruction: description.trim() || title.trim(),
      app,
      executor: ex.id,
      kind,
      priority,
      schedule,
      config: fieldsToConfig(Object.entries(config).map(([key, value]) => ({ key, value }))),
    };
    setSaving(true);
    try {
      onCreated(await q.create(input) as Task);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!choosable.length) {
    return <p className="text-[12.5px] text-[var(--q-muted)]">The queue has not said what kinds of work it can do yet. Wait for the board to load, then try again.</p>;
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Name">
        <input className="q-field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Research new video generation techniques" maxLength={140} autoFocus />
      </Field>
      <Field label="What it should do">
        <textarea className="q-field resize-y" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="In your own words — the agent reads this." />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="App">
          <select className="q-field" value={app} onChange={(e) => setApp(e.target.value)}>
            <option value="">Not tied to one app</option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.source === "external" ? " (outside)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kind of work" hint={ex?.describe}>
          <select className="q-field" value={executor} onChange={(e) => pickExecutor(e.target.value)}>
            {(suited.length ? suited : choosable).map((e) => (
              <option key={e.id} value={e.id}>
                {e.agent}
              </option>
            ))}
            {suited.length > 0 && suited.length < choosable.length && (
              <optgroup label="Other agents">
                {choosable
                  .filter((e) => !suited.includes(e))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.agent}
                    </option>
                  ))}
              </optgroup>
            )}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="mb-1 text-[11px] font-medium text-[var(--q-muted)]">How it lives</legend>
        <div className="flex flex-wrap gap-1" role="radiogroup">
          {KINDS.map((k) => (
            <button key={k.id} type="button" role="radio" aria-checked={kind === k.id} aria-pressed={kind === k.id} className="q-chip" onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[var(--q-faint)]">{KINDS.find((k) => k.id === kind)?.hint}</p>
        {kind === "scheduled" && (
          <div className="mt-2 max-w-xs">
            <Field label="Runs at">
              <input className="q-field" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          </div>
        )}
        {(kind === "recurring" || kind === "continuous") && (
          <div className="mt-2 grid max-w-md grid-cols-2 gap-2">
            <Field label={kind === "continuous" ? "Rest between rounds (min)" : "Every (minutes)"}>
              <input className="q-field font-mono" inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/[^\d]/g, ""))} />
            </Field>
            {kind === "recurring" && (
              <Field label="Or daily at">
                <input className="q-field font-mono" type="time" value={daily} onChange={(e) => setDaily(e.target.value)} />
              </Field>
            )}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[11px] font-medium text-[var(--q-muted)]">Priority</legend>
        <div className="flex gap-1" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={priority === n} aria-pressed={priority === n} className="q-chip min-w-[32px] justify-center" onClick={() => setPriority(n)}>
              <span data-num>{n}</span>
            </button>
          ))}
          <span className="ml-2 self-center text-[11px] text-[var(--q-faint)]">5 is urgent — claimed first</span>
        </div>
      </fieldset>

      {ex && Object.keys(ex.configHelp ?? {}).length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="q-label mb-1">Settings for {ex.agent}</legend>
          {Object.entries(ex.configHelp).map(([key, help]) => (
            <Field key={key} label={key} hint={help}>
              <input className="q-field font-mono text-[11.5px]" value={config[key] ?? ""} onChange={(e) => setConfig((c) => ({ ...c, [key]: e.target.value }))} />
            </Field>
          ))}
          <p className="text-[11px] text-[var(--q-faint)]">Leave a setting blank to use the agent&apos;s default. Lists can be written as JSON, e.g. [&quot;telegram&quot;, &quot;github&quot;].</p>
        </fieldset>
      )}

      <Notice text={err} onDismiss={() => setErr(null)} />
      <div className="flex gap-1.5 pt-1">
        <button type="submit" className="q-btn q-btn-primary" disabled={saving}>
          {saving ? "Filing…" : "Add to the queue"}
        </button>
      </div>
    </form>
  );
}

// --- H3 recreation -----------------------------------------------------------

function H3Form({ q, onCreated }: { q: UseQueue247; onCreated: (t: Task) => void }) {
  const [source, setSource] = useState<"file" | "url">("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [characters, setCharacters] = useState<Swap[]>([]);
  const [outfits, setOutfits] = useState<Swap[]>([]);
  const [locations, setLocations] = useState<Swap[]>([]);
  const [style, setStyle] = useState("");
  const [extra, setExtra] = useState("");
  const [variations, setVariations] = useState(H3_DEFAULT_VARIATIONS);
  const [progress, setProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileProblem = file ? uploadProblem({ filename: file.name, type: file.type, size: file.size }) : null;

  const upload = async (f: File): Promise<string> => {
    const { key, uploadUrl } = await postJson<{ key: string; uploadUrl: string }>("/api/queue247/h3/upload", { filename: f.name, type: f.type, size: f.size });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      if (f.type) xhr.setRequestHeader("content-type", f.type);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`The upload was refused (${xhr.status}). Try again.`)));
      xhr.onerror = () => reject(new Error("The upload stopped — check your connection and try again."));
      xhr.send(f);
    });
    return key;
  };

  const submit = async () => {
    setErr(null);
    if (source === "file" && !file) return setErr("Choose a video file first.");
    if (source === "file" && fileProblem) return setErr(fileProblem);
    if (source === "url" && !/^https?:\/\//i.test(url.trim())) return setErr("Paste the full link, starting with https://");
    setSaving(true);
    try {
      let videoKey: string | undefined;
      if (source === "file" && file) {
        setProgress(0);
        videoKey = await upload(file);
      }
      const changeText = [
        ...characters.filter((s) => s.from && s.to).map((s) => `${s.from} → ${s.to}`),
        ...outfits.filter((s) => s.from && s.to).map((s) => `outfit ${s.from} → ${s.to}`),
        ...locations.filter((s) => s.from && s.to).map((s) => `location ${s.from} → ${s.to}`),
        style && `style: ${style}`,
        extra,
      ]
        .filter(Boolean)
        .join("; ");
      const input = h3TaskInput({
        videoKey,
        url: source === "url" ? url.trim() : undefined,
        fileName: file?.name,
        changes: {
          characters: characters.filter((s) => s.from && s.to),
          outfits: outfits.filter((s) => s.from && s.to),
          locations: locations.filter((s) => s.from && s.to),
          style,
          extra,
        },
        changeText,
        variations,
        createdBy: "you",
      });
      onCreated((await q.create(input)) as Task);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-[12.5px] leading-relaxed text-[var(--q-muted)]">
        The H3 Recreation Agent finds every shot, pulls keyframes, reverse-engineers each one into a storyboard, then writes MiniMax H3 prompts with your changes — plus variations per shot.
      </p>

      <fieldset>
        <legend className="mb-1.5 text-[11px] font-medium text-[var(--q-muted)]">The reference video</legend>
        <div className="mb-2 flex gap-1" role="radiogroup">
          <button type="button" role="radio" aria-checked={source === "file"} aria-pressed={source === "file"} className="q-chip" onClick={() => setSource("file")}>
            <Icon.Upload width={11} height={11} aria-hidden /> Upload a file
          </button>
          <button type="button" role="radio" aria-checked={source === "url"} aria-pressed={source === "url"} className="q-chip" onClick={() => setSource("url")}>
            <Icon.Link width={11} height={11} aria-hidden /> Social or video link
          </button>
        </div>
        {source === "file" ? (
          <div
            className="q-inset flex flex-col items-start gap-2 border-dashed px-3 py-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
          >
            <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/x-matroska,.mkv" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="flex w-full flex-wrap items-center gap-2">
              <button type="button" className="q-btn" onClick={() => inputRef.current?.click()}>
                <Icon.Upload width={12} height={12} aria-hidden /> {file ? "Choose another" : "Choose a video"}
              </button>
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--q-muted)]">
                {file ? (
                  <>
                    {file.name} <span data-num className="text-[var(--q-faint)]">· {(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </>
                ) : (
                  "or drop it here — MP4, MOV, WebM, M4V or MKV, up to 500 MB"
                )}
              </span>
            </div>
            {fileProblem && <p className="text-[12px] text-[var(--q-fail)]">{fileProblem}</p>}
            {progress != null && (
              <div className="flex w-full items-center gap-2">
                <div className="q-progress flex-1" data-live="true" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
                  <i style={{ transform: `scaleX(${progress / 100})` }} />
                </div>
                <span className="text-[11px] text-[var(--q-ink)]" data-num>
                  {progress}%
                </span>
              </div>
            )}
          </div>
        ) : (
          <input className="q-field" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@…/video/…" />
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-0.5 text-[11px] font-medium text-[var(--q-muted)]">What to change</legend>
        <SwapList label="Characters" from="the woman in red" to="my character Ava" list={characters} onChange={setCharacters} />
        <SwapList label="Outfits" from="red dress" to="black leather jacket" list={outfits} onChange={setOutfits} />
        <SwapList label="Locations" from="the beach" to="a neon Tokyo street at night" list={locations} onChange={setLocations} />
        <Field label="Style" hint="Replaces the reference's look, if set.">
          <input className="q-field" value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Moody 35mm film, teal and orange grade" />
        </Field>
        <Field label="Anything else" hint="Added to every prompt.">
          <textarea className="q-field resize-y" rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Keep the camera handheld; no text on screen" />
        </Field>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-[11px] font-medium text-[var(--q-muted)]">Variations per shot</legend>
        <div className="flex gap-1" role="radiogroup">
          {Array.from({ length: MAX_VARIATIONS }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={variations === n} aria-pressed={variations === n} className="q-chip min-w-[32px] justify-center" onClick={() => setVariations(n)}>
              <span data-num>{n}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <Notice text={err} onDismiss={() => setErr(null)} />
      <div className="flex gap-1.5">
        <button type="submit" className="q-btn q-btn-primary" disabled={saving}>
          {saving ? (progress != null && progress < 100 ? `Uploading ${progress}%…` : "Filing…") : "Start the recreation"}
        </button>
      </div>
    </form>
  );
}

function SwapList({ label, from, to, list, onChange }: { label: string; from: string; to: string; list: Swap[]; onChange: (l: Swap[]) => void }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11.5px] text-[var(--q-ink)]">{label}</span>
        <button type="button" className="q-btn h-6 min-h-0 px-1.5 text-[11px]" onClick={() => onChange([...list, { from: "", to: "" }])}>
          <Icon.Plus width={10} height={10} aria-hidden /> Add
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-[11px] text-[var(--q-faint)]">Kept as in the reference.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {list.map((s, i) => (
            <li key={i} className="grid grid-cols-[1fr_14px_1fr_28px] items-center gap-1.5">
              <input className="q-field" value={s.from} aria-label={`${label} ${i + 1}: in the reference`} placeholder={from} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} />
              <Icon.ArrowRight width={12} height={12} className="text-[var(--q-faint)]" aria-hidden />
              <input className="q-field" value={s.to} aria-label={`${label} ${i + 1}: becomes`} placeholder={to} onChange={(e) => onChange(list.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />
              <button type="button" className="q-icon-btn" aria-label="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}>
                <Icon.Close width={11} height={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
