"use client";

// The reference library for one project: what each asset is, where it
// applies, and what the Director understood it to show.

import { useRef, useState } from "react";
import { REFERENCE_KINDS } from "@/lib/auteur/constants";
import { allShots } from "@/lib/auteur/repo";
import type { Reference, ReferenceKind, ReferenceScope } from "@/lib/auteur/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { useStudio } from "./studio";
import { Btn, EmptyState, Field, Mono, Spinner } from "./ui";

export function Assets() {
  const studio = useStudio();
  const p = studio.project!;
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<ReferenceKind | "auto">("auto");
  const [filter, setFilter] = useState<ReferenceKind | "all">("all");
  const refs = p.references.filter((r) => filter === "all" || r.kind === filter);

  return (
    <div
      className="mx-auto max-w-[1100px] px-5 py-6 md:px-8"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void studio.addReferences(Array.from(e.dataTransfer.files), { level: "project" }, kind === "auto" ? undefined : kind);
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Assets</h1>
          <p className="text-[12px] text-[var(--au-ink-2)]">Images, video, audio, characters, locations, objects and looks the Director keeps faithful to. Drop files anywhere here.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="au-select" value={kind} onChange={(e) => setKind(e.target.value as ReferenceKind | "auto")} title="What the next upload is">
            <option value="auto">Detect kind</option>
            {REFERENCE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <Btn variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
            <Icon.Upload width={12} height={12} /> Add references
          </Btn>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" hidden onChange={(e) => {
            if (e.target.files?.length) void studio.addReferences(Array.from(e.target.files), { level: "project" }, kind === "auto" ? undefined : kind);
            e.target.value = "";
          }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <button type="button" className="au-chip" data-on={filter === "all" ? "true" : "false"} onClick={() => setFilter("all")}>All {p.references.length}</button>
        {REFERENCE_KINDS.map((k) => {
          const n = p.references.filter((r) => r.kind === k.id).length;
          if (!n) return null;
          return (
            <button key={k.id} type="button" className="au-chip" data-on={filter === k.id ? "true" : "false"} onClick={() => setFilter(k.id)}>
              {k.label} {n}
            </button>
          );
        })}
      </div>

      {!p.references.length ? (
        <div className="mt-6">
          <EmptyState
            title="No references yet"
            body="A character photo keeps a face and wardrobe consistent across the film. A location keeps the place. A product shot keeps the product. A style frame keeps the look. Add them at project level, or attach one to a single scene or shot."
            action={<Btn variant="primary" onClick={() => fileRef.current?.click()}><Icon.Upload width={13} height={13} /> Add references</Btn>}
          />
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {refs.map((r) => <RefCard key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}

function RefCard({ r }: { r: Reference }) {
  const studio = useStudio();
  const p = studio.project!;
  const [describing, setDescribing] = useState(false);
  const shots = allShots(p);
  const owners = [
    ...p.characters.filter((c) => c.referenceIds.includes(r.id)).map((c) => `Character: ${c.name}`),
    ...p.worlds.filter((w) => w.referenceIds.includes(r.id)).map((w) => `World: ${w.name}`),
  ];
  const scopeValue = r.scope.level === "project" ? "project" : r.scope.level === "scene" ? `scene:${r.scope.sceneId}` : `shot:${r.scope.shotId}`;
  const setScope = (v: string) => {
    let scope: ReferenceScope = { level: "project" };
    if (v.startsWith("scene:")) scope = { level: "scene", sceneId: v.slice(6) };
    if (v.startsWith("shot:")) scope = { level: "shot", shotId: v.slice(5) };
    studio.updateReference(r.id, { scope });
  };

  return (
    <div className="au-card overflow-hidden">
      <div className="relative aspect-video bg-[var(--au-panel-2)]">
        {r.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[var(--au-ink-3)]">
            {r.kind === "audio" ? <Icon.Mic width={22} height={22} /> : r.kind === "video" ? <Icon.Film width={22} height={22} /> : <Icon.Image width={22} height={22} />}
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <span className="au-mono rounded bg-black/60 px-1.5 py-0.5 !text-white/85">{r.kind}</span>
          <span className="au-mono rounded bg-black/60 px-1.5 py-0.5 !text-white/60">{r.scope.level}</span>
        </div>
        <button type="button" className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white/70 hover:text-[#ff8a78]" onClick={() => studio.removeReference(r.id)} aria-label="Delete reference">
          <Icon.Trash width={12} height={12} />
        </button>
        {!r.mediaId && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-[10px] text-[#ffc2b8]">Bytes not on this device — words only</div>
        )}
      </div>
      <div className="space-y-2.5 p-3">
        <input className="w-full bg-transparent text-[12.5px] font-medium outline-none" value={r.name} onChange={(e) => studio.updateReference(r.id, { name: e.target.value })} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Kind">
            <select className="au-select w-full" value={r.kind} onChange={(e) => studio.updateReference(r.id, { kind: e.target.value as ReferenceKind })}>
              {REFERENCE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Applies to">
            <select className="au-select w-full" value={scopeValue} onChange={(e) => setScope(e.target.value)}>
              <option value="project">Whole project</option>
              {p.scenes.map((s, i) => <option key={s.id} value={`scene:${s.id}`}>Scene {i + 1}: {s.title}</option>)}
              {shots.map(({ shot, index }) => <option key={shot.id} value={`shot:${shot.id}`}>Shot {index + 1}: {shot.title}</option>)}
            </select>
          </Field>
        </div>
        <Field label="What it shows" hint={r.described ? "read by the Director" : r.mime.startsWith("image/") ? "not read yet" : "type it"}>
          <textarea
            className={cn("au-input !text-[12px]", !r.description && "italic")}
            rows={3}
            value={r.description}
            placeholder={r.kind === "audio" ? "Tempo, instrumentation, mood — the cut plays to this" : "Describe it so the prompt can carry it: age, wardrobe with colours, materials, light…"}
            onChange={(e) => studio.updateReference(r.id, { description: e.target.value })}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-1.5">
          {r.mime.startsWith("image/") && r.mediaId && (
            <Btn size="sm" disabled={describing} onClick={async () => {
              setDescribing(true);
              await studio.describe(r.id);
              setDescribing(false);
              if (!studio.project?.references.find((x) => x.id === r.id)?.described) studio.toast("Add an AI key to have the Director read images", "info");
            }}>
              {describing ? <Spinner /> : <Icon.Eye width={12} height={12} />} Read with AI
            </Btn>
          )}
          {owners.map((o) => <span key={o} className="au-chip" data-on="true">{o}</span>)}
          {r.tags.slice(0, 4).map((t) => <span key={t} className="au-chip">{t}</span>)}
        </div>
        {(r.kind === "character" || r.kind === "location") && !owners.length && (
          <div className="flex items-center gap-2">
            <Mono>Attach to</Mono>
            <select className="au-select flex-1" value="" onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              studio.update((pp) => ({
                ...pp,
                characters: pp.characters.map((c) => (c.id === v ? { ...c, referenceIds: [...c.referenceIds, r.id], description: c.description || r.description } : c)),
                worlds: pp.worlds.map((w) => (w.id === v ? { ...w, referenceIds: [...w.referenceIds, r.id], description: w.description || r.description } : w)),
              }));
            }}>
              <option value="">…</option>
              {r.kind === "character" && p.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {r.kind === "location" && p.worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
