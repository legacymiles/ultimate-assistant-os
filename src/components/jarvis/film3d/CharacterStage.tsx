"use client";

// Stage 1 — Character: the picture becomes a 3D toy figure. Jarvis reads the
// picture into the hero (hair, colours, clothes, the one signature item); the
// owner can change any of it, and the turntable on the right is the real 3D
// hero, updating the moment anything changes.

import { useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import { FilmStage } from "./FilmStage";
import type { Film3DFlow } from "@/lib/studio/film3d/useFilm3D";
import {
  ACCESSORIES,
  BOTTOM_KINDS,
  BUILDS,
  HAIR_STYLES,
  PATTERNS,
  TOP_KINDS,
  type Beat3D,
  type Film3D,
  type Hero3D,
} from "@/lib/studio/film3d/plan";

const COLOURS: { k: keyof Hero3D; label: string }[] = [
  { k: "skin", label: "Skin" },
  { k: "hair", label: "Hair" },
  { k: "eyes", label: "Eyes" },
  { k: "top", label: "Top" },
  { k: "bottom", label: "Bottom" },
  { k: "shoes", label: "Shoes" },
  { k: "accent", label: "Their colour" },
];

const nice = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function turntable(hero: Hero3D, look: Film3D["look"]): Film3D {
  const beat = (id: string, start: number, end: number, move: Beat3D["move"], shot: Beat3D["shot"], expression: Beat3D["expression"]): Beat3D => ({
    id, start, end, role: "hook", world: "park", time: "day", move, shot, expression, prop: "none", caption: "", action: "",
  });
  return {
    title: "",
    aspect: "1:1",
    look,
    captions: false,
    moods: [],
    hero,
    seed: 7,
    bare: true,
    beats: [beat("a", 0, 3.5, "wave", "medium", "smile"), beat("b", 3.5, 7.5, "dance", "orbit", "delight"), beat("c", 7.5, 10, "idle", "close", "wow")],
  };
}

export function CharacterStage({ flow }: { flow: Film3DFlow }) {
  const { draft, images, palette, patchHero, addPictures, readPicture, planning } = flow;
  const hero = draft.hero;
  const [over, setOver] = useState(false);
  const [target, setTarget] = useState<keyof Hero3D>("top");
  const input = useRef<HTMLInputElement>(null);
  const film = useMemo(() => turntable(hero, draft.look), [hero, draft.look]);

  const take = (files: FileList | File[] | null) => {
    const pics = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (pics.length) void addPictures(pics);
  };

  return (
    <section aria-labelledby="f3-char" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="space-y-4">
        <div>
          <h3 id="f3-char" className="text-[15px] font-semibold text-ink">Your character</h3>
          <p className="text-[11.5px] text-ink-muted">Add a picture and Jarvis builds them as a 3D toy figure. Change anything below — the figure on the right updates as you go.</p>
        </div>

        <div
          className={`f3-drop flex items-center gap-3 p-3 ${over ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            take(e.dataTransfer.files);
          }}
        >
          {images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local data URL
            <img src={images[0]} alt="Your character" className="h-24 w-20 shrink-0 rounded-md border border-line bg-white object-contain" />
          ) : (
            <div className="grid h-24 w-20 shrink-0 place-items-center rounded-md border border-dashed border-line text-ink-faint">
              <Icon.Image width={18} height={18} aria-hidden />
            </div>
          )}
          <div className="min-w-0 space-y-1.5">
            <p className="text-[12px] text-ink">{images[0] ? "Your character's picture" : "Drop a picture of your character"}</p>
            <p className="text-[11px] text-ink-faint">A drawing or a photo. Full body on a plain background reads best.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="f3-ghost" onClick={() => input.current?.click()}>
                <Icon.Upload width={11} height={11} aria-hidden /> {images[0] ? "Change picture" : "Add picture"}
              </button>
              {images[0] && (
                <button type="button" className="f3-ghost" disabled={planning === "hero"} onClick={() => void readPicture()}>
                  {planning === "hero" ? <span className="f3-busy" aria-hidden /> : <Icon.Sparkles width={11} height={11} aria-hidden />}
                  {planning === "hero" ? "Reading…" : "Read it again"}
                </button>
              )}
            </div>
          </div>
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => take(e.target.files)} />
        </div>
        {flow.planNote && <p className="text-[11.5px] text-ink-muted">{flow.planNote}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="f3-label">Name</span>
            <input className="f3-field" value={hero.name} onChange={(e) => patchHero({ name: e.target.value.slice(0, 40) })} placeholder="Milo" />
          </label>
          <div>
            <span className="f3-label">Size</span>
            <div className="f3-seg" role="group" aria-label="Size">
              {BUILDS.map((b) => (
                <button key={b} type="button" aria-pressed={hero.build === b} onClick={() => patchHero({ build: b })}>{nice(b)}</button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <span className="f3-label">Colours</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {COLOURS.map((c) => (
              <label key={c.k} className="f3-swatch" onFocus={() => setTarget(c.k)} onClick={() => setTarget(c.k)}>
                <input type="color" value={String(hero[c.k])} onChange={(e) => patchHero({ [c.k]: e.target.value } as Partial<Hero3D>)} aria-label={c.label} />
                <span className={target === c.k ? "text-ink" : ""}>{c.label}</span>
              </label>
            ))}
          </div>
          {palette.length > 0 && (
            <div className="mt-2 flex items-center gap-1.5">
              <span className="text-[10.5px] text-ink-faint">From the picture → {COLOURS.find((c) => c.k === target)?.label.toLowerCase()}:</span>
              {palette.map((hex) => (
                <button key={hex} type="button" className="f3-dot" style={{ background: hex }} title={hex} aria-label={`Use ${hex}`} onClick={() => patchHero({ [target]: hex } as Partial<Hero3D>)} />
              ))}
            </div>
          )}
        </div>

        {(
          [
            ["Hair", "hairStyle", HAIR_STYLES],
            ["Top", "topKind", TOP_KINDS],
            ["Pattern", "pattern", PATTERNS],
            ["Bottom", "bottomKind", BOTTOM_KINDS],
            ["Signature item", "accessory", ACCESSORIES],
          ] as const
        ).map(([label, key, list]) => (
          <div key={key}>
            <span className="f3-label">{label}</span>
            <div className="f3-chips">
              {list.map((v) => (
                <button key={v} type="button" className="f3-chip" aria-pressed={hero[key] === v} onClick={() => patchHero({ [key]: v } as Partial<Hero3D>)}>
                  {nice(v)}
                </button>
              ))}
            </div>
          </div>
        ))}

        <label className="block">
          <span className="f3-label">Anything else about them (for the HD render)</span>
          <input className="f3-field" value={hero.notes} onChange={(e) => patchHero({ notes: e.target.value.slice(0, 400) })} placeholder="freckles, a gap-toothed grin, always has a scraped knee" />
        </label>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" className="f3-go" onClick={() => flow.go("story")}>
            Next: the story <Icon.ArrowRight width={12} height={12} aria-hidden />
          </button>
          <span className="text-[11px] text-ink-faint">Same figure in every shot — that&apos;s the point of making it in code.</span>
        </div>
      </div>

      <div className="lg:sticky lg:top-2 lg:self-start">
        <FilmStage film={film} loop autoPlay silent controls={false} label={`${hero.name || "Your character"} — 3D turntable`} className="mx-auto max-w-md" />
        <p className="mt-2 text-center text-[11px] text-ink-faint">The real 3D {hero.name || "hero"} — this is exactly who stars in the film.</p>
      </div>
    </section>
  );
}
