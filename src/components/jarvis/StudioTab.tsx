"use client";

// ---------------------------------------------------------------------------
// Studio — the video and image workflows, as a wall of cards.
//
// Clicking a card adds it to the mix at the bottom; several can be mixed. The
// mix is where a variant (E-commerce › Flat lay), style keywords and the camera
// deck (film setup, camera, colour, lighting, and the #camera-moves typed into
// the idea box) are chosen. "Start in chat" writes the mix as @-mentions into
// the chat box, where Jarvis turns it into a production prompt. The same @- and
// #-mentions work typed straight into chat, and the camera deck follows across.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { bridgeStatus } from "@/lib/studio/render";
import { CinemaBar } from "./CinemaDeck";
import { useCinemaSelection } from "@/lib/studio/useCinema";
import { Icon } from "../icons";
import {
  CATEGORIES,
  WORKFLOWS,
  type CategoryId,
  type Medium,
  type Workflow,
} from "@/lib/studio/workflows";

interface Picked {
  id: string;
  variant: string;
}

export function StudioTab({ onStartChat }: { onStartChat: (text: string) => void }) {
  const [medium, setMedium] = useState<Medium>("video");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [idea, setIdea] = useState("");
  // The look is shared with Chat, so a camera set here is still set there.
  const [cinema, setCinema] = useCinemaSelection();
  // The free local video renderer on this PC (tools/studio-bridge).
  const [local, setLocal] = useState<{ ok: boolean; wangp?: boolean; queue?: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => void bridgeStatus().then((s) => alive && setLocal(s));
    check();
    const t = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const categories = CATEGORIES.filter((c) => c.medium === medium);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WORKFLOWS.filter(
      (w) =>
        w.medium === medium &&
        (category === "all" || w.category === category) &&
        (!q ||
          `${w.name} ${w.blurb} ${(w.variants ?? []).map((v) => v.name).join(" ")}`.toLowerCase().includes(q)),
    );
  }, [medium, category, query]);

  const shelves = categories
    .map((c) => ({ category: c, items: visible.filter((w) => w.category === c.id) }))
    .filter((s) => s.items.length);

  const pickedWorkflows = picked
    .map((p) => ({ p, w: WORKFLOWS.find((w) => w.id === p.id)! }))
    .filter((x) => x.w);

  // Only workflows that take keywords offer them; duplicates collapse.
  const suggested = [...new Set(pickedWorkflows.flatMap(({ w }) => w.keywords ?? []))];
  const takesKeywords = pickedWorkflows.some(({ w }) => w.keywords?.length);

  const toggle = (w: Workflow) =>
    setPicked((list) =>
      list.some((p) => p.id === w.id) ? list.filter((p) => p.id !== w.id) : [...list, { id: w.id, variant: "" }],
    );

  const toggleKeyword = (k: string) =>
    setKeywords((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));

  const addCustom = () => {
    const k = custom.trim().toLowerCase();
    if (k && !keywords.includes(k)) setKeywords((list) => [...list, k]);
    setCustom("");
  };

  const clear = () => {
    setPicked([]);
    setKeywords([]);
    setIdea("");
  };

  const start = () => {
    if (!picked.length) return;
    const mentions = picked.map((p) => `@${p.id}${p.variant ? `:${p.variant}` : ""}`).join(" ");
    const style = keywords.length ? `\nKeywords: ${keywords.join(", ")}` : "";
    // The camera moves ride along inside `idea` as #tokens; the look travels on
    // its own, shared with Chat through localStorage.
    onStartChat(`${mentions} ${idea.trim()}${style}`.trim());
    clear();
  };

  return (
    <div className="flex h-[calc(100dvh-49px)] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">Studio</h2>
        <span className="text-[11px] text-ink-faint">
          {WORKFLOWS.filter((w) => w.medium === medium).length} {medium} workflows
        </span>
        <div role="tablist" aria-label="Medium" className="ml-2 flex rounded-lg border border-line p-0.5">
          {(["video", "image"] as Medium[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={medium === m}
              onClick={() => {
                setMedium(m);
                setCategory("all");
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs capitalize transition ${
                medium === m ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {m === "video" ? <Icon.Film width={12} height={12} /> : <Icon.Image width={12} height={12} />}
              {m}
            </button>
          ))}
        </div>
        {local && (
          <span
            className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted"
            title={
              local.ok
                ? "Videos render free on this PC with WanGP (Pinokio)."
                : "Start tools/studio-bridge/start.cmd on your PC to render videos for free."
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${local.ok ? "bg-emerald-400" : "bg-ink-faint"}`}
              aria-hidden
            />
            {local.ok
              ? `Local renderer on${local.queue ? ` · ${local.queue} in queue` : ""}`
              : "Local renderer off"}
          </span>
        )}
        <label className="ml-auto flex w-full items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1 sm:w-56">
          <Icon.Search width={12} height={12} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workflows"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-line-soft bg-canvas/90 px-3 py-2 backdrop-blur">
          {[{ id: "all" as const, label: "All" }, ...categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition ${
                category === c.id
                  ? "border-ink-faint bg-panel-2 text-ink"
                  : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="space-y-6 px-3 py-4">
          {shelves.map(({ category: c, items }) => (
            <section key={c.id}>
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink">
                {c.label}
                <span className="text-[11px] font-normal text-ink-faint">{items.length}</span>
              </h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2.5">
                {items.map((w) => (
                  <li key={w.id}>
                    <StudioCard w={w} picked={picked.some((p) => p.id === w.id)} onToggle={() => toggle(w)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!shelves.length && (
            <p className="py-12 text-center text-xs text-ink-muted">No {medium} workflow matches “{query}”.</p>
          )}
        </div>
      </div>

      <div className="border-t border-line bg-panel px-3 py-3">
        {picked.length === 0 ? (
          <p className="mx-auto max-w-4xl text-center text-xs text-ink-muted">
            Pick one or more cards to mix them into one video or image, or type <kbd className="rounded border border-line px-1 font-mono text-[10px]">@</kbd> in Chat.
          </p>
        ) : (
          <div className="mx-auto max-w-4xl space-y-2">
            <ul className="flex flex-wrap items-center gap-1.5">
              {pickedWorkflows.map(({ p, w }) => (
                <li
                  key={p.id}
                  className="st-card flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 py-1 pl-1 pr-1.5 text-xs text-ink"
                  style={{ ["--h" as string]: w.hue }}
                >
                  <span className="relative h-5 w-5 overflow-hidden rounded">
                    <span className="st-art" aria-hidden />
                  </span>
                  {w.name}
                  {w.variants && (
                    <select
                      value={p.variant}
                      onChange={(e) =>
                        setPicked((list) => list.map((x) => (x.id === p.id ? { ...x, variant: e.target.value } : x)))
                      }
                      aria-label={`${w.name} style`}
                      className="rounded border border-line bg-panel px-1 py-0.5 text-[11px] text-ink focus:outline-none"
                    >
                      <option value="">Any style</option>
                      {w.variants.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={() => toggle(w)}
                    aria-label={`Remove ${w.name}`}
                    className="text-ink-faint transition hover:text-ink"
                  >
                    <Icon.Close width={11} height={11} />
                  </button>
                </li>
              ))}
              <li>
                <button onClick={clear} className="px-1 text-[11px] text-ink-faint underline hover:text-ink">
                  Clear
                </button>
              </li>
            </ul>

            {takesKeywords && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-ink-faint">Keywords</span>
                {[...new Set([...suggested, ...keywords])].map((k) => (
                  <button
                    key={k}
                    onClick={() => toggleKeyword(k)}
                    aria-pressed={keywords.includes(k)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                      keywords.includes(k)
                        ? "border-ink-muted bg-ink text-canvas"
                        : "border-line text-ink-muted hover:text-ink"
                    }`}
                  >
                    {k}
                  </button>
                ))}
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustom();
                    }
                  }}
                  onBlur={addCustom}
                  placeholder="+ your own"
                  className="w-24 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 text-[11px] text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
                />
              </div>
            )}

            <CinemaBar selection={cinema} onSelection={setCinema} text={idea} onText={setIdea} />

            <div className="flex items-end gap-2">
              <textarea
                value={idea}
                onChange={(e) => setIdea(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    start();
                  }
                }}
                rows={2}
                placeholder="Describe your idea: whose story, which product, what happens…  (# for a camera move)"
                className="min-h-[52px] flex-1 resize-none rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
              />
              <button
                onClick={start}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-ink px-3 py-2 text-xs font-medium text-canvas transition hover:opacity-90"
              >
                <Icon.Send width={13} height={13} /> Start in chat
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StudioCard({ w, picked, onToggle }: { w: Workflow; picked: boolean; onToggle: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  return (
    <button
      onClick={onToggle}
      aria-pressed={picked}
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => video.current?.pause()}
      className={`st-card group relative block aspect-[3/4] w-full overflow-hidden rounded-xl border text-left transition duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-muted ${
        picked ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink-faint"
      }`}
      style={{ ["--h" as string]: w.hue }}
    >
      {w.preview?.video ? (
        <video ref={video} className="st-video" src={w.preview.video} poster={w.preview.poster} muted loop playsInline preload="none" />
      ) : (
        <span className={`st-art st-m-${w.motif}`} aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-2.5 pt-10">
        <span className="block text-[13px] font-semibold leading-tight text-white">{w.name}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-white/70">{w.blurb}</span>
        <span className="mt-1 hidden text-[10px] text-white/55 group-hover:block">{w.format}</span>
      </span>

      <span className="absolute left-2 top-2 flex gap-1">
        {w.isNew && (
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-black">New</span>
        )}
        {w.variants && (
          <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
            {w.variants.length} styles
          </span>
        )}
      </span>

      <span
        className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full border transition ${
          picked ? "border-white bg-white text-black" : "border-white/50 bg-black/30 text-transparent group-hover:text-white/80"
        }`}
        aria-hidden
      >
        {picked ? <Icon.Check width={11} height={11} /> : <Icon.Plus width={11} height={11} />}
      </span>
    </button>
  );
}
