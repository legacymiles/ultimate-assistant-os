"use client";

// The board: scenes as film-strip rows, shots as cards. Drag to reorder,
// duplicate for an alternate, regenerate, delete — all without leaving it.

import { useState } from "react";
import { hueFor } from "@/lib/auteur/constants";
import { activeTake, allShots } from "@/lib/auteur/repo";
import type { Scene, Shot } from "@/lib/auteur/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { useStudio } from "./studio";
import { Btn, EmptyState, Mono, Spinner, TakeFrame, fmtSec } from "./ui";

export function Storyboard() {
  const studio = useStudio();
  const p = studio.project!;
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ sceneId: string; index: number } | null>(null);
  const numbering = new Map(allShots(p).map(({ shot, index }) => [shot.id, index + 1]));

  if (!p.scenes.length) {
    return (
      <div className="p-6">
        <EmptyState
          title="No shots yet"
          body={p.concept ? "The plan is developed. Break it down and every scene gets its shot list, camera, lighting and continuity." : "Develop the plan first, then break it down into shots."}
          action={
            <Btn variant="primary" disabled={studio.working.has("breakdown")} onClick={() => (p.concept ? void studio.runBreakdown() : studio.setTab("director"))}>
              {studio.working.has("breakdown") ? <Spinner /> : <Icon.Grid width={14} height={14} />}
              {p.concept ? "Break down into shots" : "Go to the Director"}
            </Btn>
          }
        />
      </div>
    );
  }

  const drop = (sceneId: string, index: number) => {
    if (drag) studio.moveShot(drag, sceneId, index);
    setDrag(null);
    setOver(null);
  };

  return (
    <div className="px-4 py-5 md:px-6">
      {p.scenes.map((scene, si) => (
        <section key={scene.id} className="mb-7 au-fade-in">
          <SceneHeader scene={scene} index={si} />
          <div
            className="mt-2 flex flex-wrap gap-3"
            onDragOver={(e) => {
              e.preventDefault();
              if (!over || over.sceneId !== scene.id) setOver({ sceneId: scene.id, index: scene.shots.length });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(scene.id, over?.sceneId === scene.id ? over.index : scene.shots.length);
            }}
          >
            {scene.shots.map((shot, i) => (
              <ShotCard
                key={shot.id}
                shot={shot}
                scene={scene}
                number={numbering.get(shot.id) ?? i + 1}
                dragging={drag === shot.id}
                over={over?.sceneId === scene.id && over.index === i}
                onDragStart={() => setDrag(shot.id)}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setOver({ sceneId: scene.id, index: i });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  drop(scene.id, i);
                }}
              />
            ))}
            <button
              type="button"
              onClick={() => studio.addShot(scene.id)}
              className="flex w-[232px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--au-line-strong)] text-[var(--au-ink-3)] transition hover:border-[var(--au-gold-2)] hover:text-[var(--au-gold)]"
              style={{ minHeight: 200 }}
            >
              <Icon.Plus width={16} height={16} />
              <span className="mt-1 text-[11px]">Add shot</span>
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}

function SceneHeader({ scene, index }: { scene: Scene; index: number }) {
  const studio = useStudio();
  const p = studio.project!;
  const world = p.worlds.find((w) => w.id === scene.worldId);
  const dur = scene.shots.reduce((s, x) => s + x.durationSec, 0);
  const done = scene.shots.filter((s) => activeTake(s)?.status === "done").length;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="au-mono !text-[var(--au-gold-2)]">Scene {String(index + 1).padStart(2, "0")}</span>
      <input
        className="min-w-[160px] bg-transparent text-[14px] font-semibold outline-none"
        value={scene.title}
        onChange={(e) => studio.update((pp) => ({ ...pp, scenes: pp.scenes.map((s) => (s.id === scene.id ? { ...s, title: e.target.value } : s)) }))}
      />
      <span className="text-[11px] text-[var(--au-ink-3)]">
        {world?.name ?? "no world"}{scene.timeOfDay ? ` · ${scene.timeOfDay}` : ""} · {scene.shots.length} shots · {fmtSec(dur)} · {done}/{scene.shots.length} rendered
      </span>
      <input
        className="min-w-0 flex-1 bg-transparent text-[11px] text-[var(--au-ink-2)] outline-none"
        value={scene.summary}
        onChange={(e) => studio.update((pp) => ({ ...pp, scenes: pp.scenes.map((s) => (s.id === scene.id ? { ...s, summary: e.target.value } : s)) }))}
      />
    </div>
  );
}

function ShotCard({
  shot,
  scene,
  number,
  dragging,
  over,
  ...dragProps
}: {
  shot: Shot;
  scene: Scene;
  number: number;
  dragging: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const studio = useStudio();
  const p = studio.project!;
  const take = activeTake(shot);
  const selected = studio.selectedShotId === shot.id;
  const busy = studio.busy[shot.id];
  const cast = shot.characterIds.map((id) => p.characters.find((c) => c.id === id)?.name).filter(Boolean);
  const refCount = shot.prompt.references.length + shot.referenceIds.length;
  const status = busy ? "generating" : take?.status ?? "idle";

  return (
    <div
      draggable
      className={cn("au-card w-[232px] cursor-grab select-none overflow-hidden active:cursor-grabbing")}
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      data-over={over ? "true" : "false"}
      onClick={() => {
        studio.selectShot(shot.id);
      }}
      {...dragProps}
    >
      <TakeFrame
        take={take}
        aspect={p.aspectRatio}
        hue={hueFor(p)}
        label={`SH ${String(number).padStart(2, "0")}`}
        caption={take ? undefined : shot.description}
        className="!rounded-none !border-0 !border-b !border-[var(--au-line)]"
      />
      <div className="p-2.5">
        <div className="flex items-center gap-2">
          <span className="au-dot" data-s={status} />
          <div className="min-w-0 flex-1 truncate text-[12px] font-medium">{shot.title}</div>
          <span className="au-mono">{shot.durationSec}s</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--au-ink-2)]">{shot.action || shot.description}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[var(--au-ink-3)]">
          <span className="au-mono">{shot.camera.framing}</span>
          <span>·</span>
          <span>{shot.camera.movement}</span>
          {cast.length > 0 && (
            <>
              <span>·</span>
              <span className="truncate">{cast.join(", ")}</span>
            </>
          )}
          {refCount > 0 && (
            <>
              <span>·</span>
              <span>{refCount} ref</span>
            </>
          )}
          {shot.takes.length > 1 && (
            <>
              <span>·</span>
              <span>{shot.takes.length} takes</span>
            </>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Btn size="sm" variant={take?.status === "done" ? "default" : "primary"} disabled={Boolean(busy)} onClick={() => void studio.generate(shot.id)} title={take ? "Render another take" : "Render this shot"}>
            {busy ? <Spinner /> : <Icon.Launch width={11} height={11} />}
            {busy ? busyLabel(busy) : take?.status === "done" ? "Retake" : "Generate"}
          </Btn>
          <span className="flex-1" />
          <Btn size="icon" variant="ghost" title="Duplicate as an alternate" onClick={() => studio.duplicateShot(shot.id)}>
            <Icon.Copy width={12} height={12} />
          </Btn>
          <Btn size="icon" variant="danger" title="Delete shot" onClick={() => studio.deleteShot(shot.id)}>
            <Icon.Trash width={12} height={12} />
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function busyLabel(state: string): string {
  switch (state) {
    case "uploading":
      return "Sending";
    case "queued":
      return "Queued";
    case "downloading":
      return "Fetching";
    default:
      return "Rendering";
  }
}
