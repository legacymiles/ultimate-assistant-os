"use client";

// Stage 1 — Character: the picture, his name, how he moves, and his colours
// measured from the picture (never guessed).

import { useRef, useState } from "react";
import { Icon } from "../../icons";
import type { KidsFlow } from "@/lib/studio/kids-flow/useKidsFlow";
import type { CharacterSheet } from "@/lib/studio/kids-flow/plan";
import { samplePalette } from "@/lib/studio/kids-flow/palette";
import { shrinkImage } from "@/lib/new-jarvis/useRequests";

const DETAILS: { k: keyof CharacterSheet; label: string; ph: string }[] = [
  { k: "age", label: "Age", ph: "7" },
  { k: "build", label: "Build", ph: "big round head, head:body 1:3" },
  { k: "skin", label: "Skin", ph: "warm brown #8d5a3b" },
  { k: "hair", label: "Hair", ph: "short black curls, fringe left" },
  { k: "eyes", label: "Eyes", ph: "dot eyes with a white highlight" },
  { k: "outfit", label: "Outfit, top to bottom", ph: "yellow striped tee, blue shorts, red sneakers" },
  { k: "signature", label: "Signature item", ph: "a green cap" },
  { k: "heroColor", label: "His colour", ph: "yellow #f6cf55" },
];

export function CharacterStage({ flow }: { flow: KidsFlow }) {
  const { draft, images, patch, patchSheet, setImages } = flow;
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const sheet = draft.sheet;

  const add = async (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/")).slice(0, 4 - images.length);
    if (!pics.length) return;
    setBusy(true);
    setErr(null);
    try {
      const shrunk = await Promise.all(pics.map((f) => shrinkImage(f)));
      const next = [...images, ...shrunk].slice(0, 4);
      setImages(next);
      // The first picture is the hero: measure his colours from it.
      const palette = await samplePalette(next[0]).catch(() => []);
      if (palette.length) patchSheet({ palette, ...(sheet.heroColor ? {} : { heroColor: palette[0] }) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't add that picture.");
    } finally {
      setBusy(false);
    }
  };

  const remove = (i: number) => {
    const next = images.filter((_, j) => j !== i);
    setImages(next);
    if (i === 0) {
      if (next[0]) void samplePalette(next[0]).then((palette) => patchSheet({ palette }));
      else patchSheet({ palette: [] });
    }
  };

  return (
    <section aria-labelledby="kf-char" className="grid gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div>
        <h3 id="kf-char" className="mb-2 text-[15px] font-semibold text-ink">Who is the hero?</h3>
        <div
          className={`kf-drop flex min-h-[15rem] flex-col items-center justify-center gap-3 p-4 ${over ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void add([...e.dataTransfer.files]);
          }}
          onPaste={(e) => void add([...e.clipboardData.files])}
        >
          {images.length ? (
            <div className="flex flex-wrap justify-center gap-3">
              {images.map((src, i) => (
                <figure key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL */}
                  <img
                    src={src}
                    alt={i === 0 ? `${sheet.name || "The hero"} — main picture` : `Extra angle ${i}`}
                    className={`rounded-lg border border-line bg-white object-contain ${i === 0 ? "h-48 w-40" : "h-24 w-20"}`}
                  />
                  {i === 0 && (
                    <figcaption className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9.5px] text-white">
                      Subject 1
                    </figcaption>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="absolute -right-2 -top-2 rounded-full border border-line bg-panel p-1 text-ink-muted hover:text-ink"
                    title="Remove this picture"
                  >
                    <Icon.Close width={10} height={10} />
                    <span className="sr-only">Remove picture {i + 1}</span>
                  </button>
                </figure>
              ))}
            </div>
          ) : (
            <>
              <Icon.Image width={28} height={28} className="text-ink-faint" aria-hidden />
              <p className="max-w-xs text-center text-[12px] text-ink-muted">
                Drop a picture of your character here, paste one, or pick a file. A full-body drawing on a plain background works best.
              </p>
            </>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className="kf-ghost" onClick={() => input.current?.click()} disabled={images.length >= 4 || busy}>
              <Icon.Upload width={12} height={12} aria-hidden /> {images.length ? "Add another angle" : "Choose a picture"}
            </button>
            {busy && <span className="text-[11px] text-ink-faint">Reading the picture…</span>}
          </div>
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
        {err && <p className="mt-1.5 text-[11px] text-[#f8b471]">{err}</p>}

        {sheet.palette.length > 0 && (
          <div className="mt-3">
            <span className="kf-label">His colours, measured from the picture — tap the one that means him</span>
            <div className="flex flex-wrap gap-2">
              {sheet.palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="kf-chip"
                  style={{ background: c }}
                  aria-pressed={sheet.heroColor.includes(c)}
                  onClick={() => patchSheet({ heroColor: c })}
                  title={c}
                >
                  <span className="sr-only">Use {c} as his colour</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <label className="kf-label" htmlFor="kf-name">Name</label>
          <input id="kf-name" className="kf-field" value={sheet.name} onChange={(e) => patchSheet({ name: e.target.value })} placeholder="Milo" />
        </div>

        <div>
          <span className="kf-label">How should he move?</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="kf-opt" aria-pressed={draft.mode === "rebuild"} onClick={() => patch({ mode: "rebuild" })}>
              <p className="text-[12.5px] font-semibold text-ink">Rebuild in cut paper</p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">Redrawn from your picture. Walks, blinks, talks, every expression. Best motion.</p>
            </button>
            <button type="button" className="kf-opt" aria-pressed={draft.mode === "puppet"} onClick={() => patch({ mode: "puppet" })}>
              <p className="text-[12.5px] font-semibold text-ink">Puppet my exact picture</p>
              <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">Your art, cut into parts and moved like a paper puppet. Simpler motion.</p>
            </button>
          </div>
          {draft.mode === "puppet" && (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Puppet needs your own drawing, full body, plain background. Photos of real people are always rebuilt as paper characters instead.
            </p>
          )}
        </div>

        <details className="rounded-lg border border-line bg-panel/60 p-2.5" open={Boolean(sheet.hair || sheet.outfit)}>
          <summary className="cursor-pointer text-[11.5px] text-ink-muted">
            Character sheet — Jarvis fills this from the picture when it writes the plan
          </summary>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            {DETAILS.map((d) => (
              <div key={d.k} className={d.k === "outfit" || d.k === "build" ? "sm:col-span-2" : ""}>
                <label className="kf-label" htmlFor={`kf-${d.k}`}>{d.label}</label>
                <input
                  id={`kf-${d.k}`}
                  className="kf-field"
                  value={sheet[d.k] as string}
                  onChange={(e) => patchSheet({ [d.k]: e.target.value })}
                  placeholder={d.ph}
                />
              </div>
            ))}
          </div>
        </details>

        <div className="flex justify-end">
          <button type="button" className="kf-go" onClick={() => flow.go("story")}>
            Next: the story <Icon.ArrowRight width={13} height={13} aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
