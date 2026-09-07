"use client";

// The first screen: the sidebar, the composer, template cards, recent work.
// A visitor should read it in one glance as "an AI filmmaking studio".

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { ASPECTS, GENRES, REFERENCE_KINDS, TEMPLATES, genreById, templateById, type Template } from "@/lib/auteur/constants";
import { progress, totalDuration } from "@/lib/auteur/repo";
import type { AspectRatio, Project, ReferenceKind } from "@/lib/auteur/types";
import { cn, relativeTime } from "@/lib/utils";
import { Icon } from "../icons";
import { useStudio } from "./studio";
import { Btn, Chip, Field, Mono, Spinner, aspectStyle, fmtSec } from "./ui";

const EXAMPLES = [
  "A cinematic romantic short film about a couple who meet in New York.",
  "A 30-second commercial for a running shoe that makes the city feel like a playground.",
  "A horror short: a night-shift nurse hears her own voice on the hospital intercom.",
  "A music video for a synthwave track, a lone driver on a neon highway at 3am.",
  "A fashion film in Lisbon: linen, wind, tiles, golden hour.",
  "A trailer for a sci-fi thriller about the last lighthouse keeper on Mars.",
];

interface Pending {
  file: File;
  kind: ReferenceKind;
  url: string;
}

export function Home() {
  const studio = useStudio();
  const [idea, setIdea] = useState("");
  const [templateId, setTemplateId] = useState("short-film");
  const [genreIds, setGenreIds] = useState<string[]>([]);
  const [aspect, setAspect] = useState<AspectRatio | null>(null);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [creating, setCreating] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<"home" | "projects" | "cast" | "assets">("home");

  const template = templateById(templateId);
  const effectiveAspect = aspect ?? template.aspect;

  const toggleGenre = (id: string) =>
    setGenreIds((g) => (g.includes(id) ? g.filter((x) => x !== id) : g.length >= 2 ? [g[1], id] : [...g, id]));

  const addFiles = (files: FileList | File[]) => {
    const next: Pending[] = Array.from(files).map((file) => ({
      file,
      kind: file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "character",
      url: URL.createObjectURL(file),
    }));
    setPending((p) => [...p, ...next]);
  };

  const start = async () => {
    if (!idea.trim() || creating) return;
    setCreating(true);
    try {
      await studio.createProject(
        {
          idea: idea.trim(),
          templateId,
          genreIds,
          aspectRatio: effectiveAspect,
          targetDurationSec: template.targetSec,
          notes: notes.trim(),
        },
        pending.map((p) => ({ file: p.file, kind: p.kind })),
      );
      pending.forEach((p) => URL.revokeObjectURL(p.url));
      // "Start with the Director" means the Director starts: develop at once.
      await studio.runDevelop();
    } finally {
      setCreating(false);
    }
  };

  const combo = useMemo(() => {
    const g = genreIds.map((id) => genreById(id)?.name).filter(Boolean);
    return g.length ? `${template.name} + ${g.join(" + ")}` : template.name;
  }, [template, genreIds]);

  return (
    <div className="flex min-h-screen">
      {/* ----- sidebar ----- */}
      <aside className="hidden w-[232px] flex-none flex-col border-r border-[var(--au-line)] bg-[var(--au-stage)]/80 px-4 py-5 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2 text-[var(--au-ink-3)] transition hover:text-[var(--au-ink)]">
          <Icon.ArrowLeft width={13} height={13} />
          <span className="text-[11px]">Ultimate Assistant OS</span>
        </Link>
        <Brand />
        <nav className="mt-7 space-y-1">
          <NavItem on={section === "home"} onClick={() => setSection("home")} icon={<Icon.Sparkles width={14} height={14} />} label="Create" />
          <NavItem on={section === "projects"} onClick={() => setSection("projects")} icon={<Icon.Film width={14} height={14} />} label="Projects" count={studio.projects.length} />
          <NavItem on={section === "cast"} onClick={() => setSection("cast")} icon={<Icon.Users width={14} height={14} />} label="Characters & worlds" />
          <NavItem on={section === "assets"} onClick={() => setSection("assets")} icon={<Icon.Image width={14} height={14} />} label="Assets" />
        </nav>
        <div className="mt-auto space-y-3">
          <div className="rounded-xl border border-[var(--au-line)] bg-[var(--au-panel)] p-3">
            <Mono>Pipeline</Mono>
            <ol className="mt-2 space-y-1 text-[11px] text-[var(--au-ink-2)]">
              {["Idea", "References", "AI Director", "Storyboard", "H3 prompts", "Generate", "Retake", "Cut"].map((s, i) => (
                <li key={s} className="flex items-center gap-2">
                  <span className="au-mono w-4 !text-[var(--au-gold-2)]">{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>
          <p className="px-1 text-[10px] leading-relaxed text-[var(--au-ink-3)]">
            Renders with MiniMax H3. Without a key the studio still plans, boards and cuts with animatics.
          </p>
        </div>
      </aside>

      {/* ----- main ----- */}
      <main className="min-w-0 flex-1 px-5 py-6 md:px-10 md:py-8">
        <div className="mb-6 flex items-center justify-between md:hidden">
          <Brand />
          <Link href="/" className="text-[11px] text-[var(--au-ink-3)]">OS</Link>
        </div>

        {section === "home" && (
          <div className="mx-auto max-w-[1100px] au-fade-in">
            {/* hero */}
            <div className="mb-7">
              <Mono>AI film studio · MiniMax H3</Mono>
              <h1 className="mt-2 text-[34px] font-semibold leading-[1.05] tracking-tight md:text-[44px]">
                What are we <span className="au-marquee">shooting</span> today?
              </h1>
              <p className="mt-2 max-w-xl text-sm text-[var(--au-ink-2)]">
                Describe the film. Pick what kind, pick how it feels, drop in anything the Director should keep faithful to. It plans the story, the cast, the shots and every H3 prompt.
              </p>
            </div>

            {/* composer */}
            <div
              className="au-panel overflow-hidden"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
              }}
            >
              <div className="p-4 md:p-5">
                <textarea
                  className="w-full resize-none bg-transparent text-[17px] leading-relaxed text-[var(--au-ink)] outline-none placeholder:text-[var(--au-ink-3)] md:text-[19px]"
                  rows={3}
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void start();
                  }}
                  placeholder="Create a cinematic romantic short film about a couple who meet in New York…"
                />

                {pending.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {pending.map((p, i) => (
                      <PendingRef
                        key={p.url}
                        p={p}
                        onKind={(kind) => setPending((arr) => arr.map((x, j) => (j === i ? { ...x, kind } : x)))}
                        onRemove={() => {
                          URL.revokeObjectURL(p.url);
                          setPending((arr) => arr.filter((_, j) => j !== i));
                        }}
                      />
                    ))}
                  </div>
                )}

                {showNotes && (
                  <textarea
                    className="au-input mt-3"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Creative direction (optional): 'shoot it like Wong Kar-wai', 'no dialogue', 'end on the product'…"
                  />
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Btn size="sm" onClick={() => fileRef.current?.click()}>
                    <Icon.Upload width={13} height={13} /> Add references
                  </Btn>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,audio/*"
                    hidden
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <Btn size="sm" variant="ghost" onClick={() => setShowNotes((s) => !s)}>
                    <Icon.Edit width={12} height={12} /> Direction
                  </Btn>
                  <div className="ml-auto flex items-center gap-2">
                    <div className="flex overflow-hidden rounded-lg border border-[var(--au-line)]">
                      {ASPECTS.map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => setAspect(a)}
                          className={cn(
                            "px-2.5 py-1.5 text-[11px] transition",
                            effectiveAspect === a ? "bg-[var(--au-raised)] text-[var(--au-ink)]" : "text-[var(--au-ink-3)] hover:text-[var(--au-ink-2)]",
                          )}
                        >
                          {a}
                        </button>
                      ))}
                    </div>
                    <Btn variant="primary" disabled={!idea.trim() || creating} onClick={() => void start()}>
                      {creating ? <Spinner /> : <Icon.Sparkles width={14} height={14} />}
                      Start with the Director
                    </Btn>
                  </div>
                </div>
              </div>

              {/* template + genre pickers */}
              <div className="border-t border-[var(--au-line)] bg-[var(--au-stage)]/60 p-4 md:p-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <Mono>Template · what kind of film</Mono>
                  <span className="text-[11px] text-[var(--au-ink-3)]">{combo}</span>
                </div>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                  {TEMPLATES.map((t) => (
                    <TemplateCard key={t.id} t={t} on={t.id === templateId} onClick={() => { setTemplateId(t.id); setAspect(null); }} />
                  ))}
                </div>
                <div className="mt-3 mb-2">
                  <Mono>Genre · how it feels</Mono>
                  <span className="ml-2 text-[11px] text-[var(--au-ink-3)]">pick up to two</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {GENRES.map((g) => (
                    <Chip key={g.id} on={genreIds.includes(g.id)} hue={g.hue} onClick={() => toggleGenre(g.id)}>
                      {g.name}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>

            {/* examples */}
            <div className="mt-4 flex flex-wrap gap-1.5">
              <Mono className="mr-1 self-center">Try</Mono>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setIdea(ex)}
                  className="rounded-full border border-transparent px-2.5 py-1 text-left text-[11px] text-[var(--au-ink-2)] transition hover:border-[var(--au-line)] hover:text-[var(--au-ink)]"
                >
                  {ex.length > 64 ? ex.slice(0, 62) + "…" : ex}
                </button>
              ))}
            </div>

            {/* recent */}
            {studio.projects.length > 0 && (
              <div className="mt-10">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">Recent projects</h2>
                  <button type="button" className="text-[11px] text-[var(--au-ink-3)] hover:text-[var(--au-ink)]" onClick={() => setSection("projects")}>
                    See all
                  </button>
                </div>
                <ProjectGrid projects={studio.projects.slice(0, 6)} />
              </div>
            )}
          </div>
        )}

        {section === "projects" && (
          <div className="mx-auto max-w-[1100px] au-fade-in">
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 text-sm text-[var(--au-ink-2)]">Every production, with how far along it is.</p>
            <div className="mt-6">
              {studio.projects.length ? (
                <ProjectGrid projects={studio.projects} />
              ) : (
                <p className="text-sm text-[var(--au-ink-3)]">Nothing yet. Start one from Create.</p>
              )}
            </div>
          </div>
        )}

        {section === "cast" && <CastLibrary />}
        {section === "assets" && <AssetLibrary />}
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-8 w-8 place-items-center rounded-lg border border-[#b98a35]/40 bg-gradient-to-b from-[#f0c56d] to-[#c9973c] shadow-[0_6px_18px_rgba(232,185,92,.25)]">
        <Icon.Film width={15} height={15} className="text-[#1a1204]" />
      </div>
      <div>
        <div className="text-[15px] font-semibold leading-none tracking-tight">Auteur</div>
        <div className="au-mono mt-1">film studio</div>
      </div>
    </div>
  );
}

function NavItem({ on, onClick, icon, label, count }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
        on ? "bg-[var(--au-panel-2)] text-[var(--au-ink)]" : "text-[var(--au-ink-2)] hover:bg-[var(--au-panel)] hover:text-[var(--au-ink)]",
      )}
    >
      <span className={cn(on ? "text-[var(--au-gold)]" : "text-[var(--au-ink-3)]")}>{icon}</span>
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && <span className="au-mono">{count}</span>}
    </button>
  );
}

function TemplateCard({ t, on, onClick }: { t: Template; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="au-card w-[150px] flex-none overflow-hidden text-left"
      data-selected={on ? "true" : "false"}
    >
      <div
        className="relative h-[74px]"
        style={{
          background: `linear-gradient(135deg, hsl(${t.hue[0]} 45% 22%), hsl(${t.hue[1]} 50% 14%))`,
        }}
      >
        <div className="absolute inset-0 opacity-60" style={{ background: `radial-gradient(70% 60% at 70% 30%, hsl(${t.hue[0]} 70% 55% / .45), transparent)` }} />
        <div className="absolute left-2 top-2 au-mono !text-white/70">{t.aspect}</div>
        <div className="absolute bottom-2 right-2 au-mono !text-white/70">{fmtSec(t.targetSec)}</div>
      </div>
      <div className="p-2.5">
        <div className="text-[12px] font-semibold">{t.name}</div>
        <div className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-[var(--au-ink-3)]">{t.blurb}</div>
      </div>
    </button>
  );
}

function PendingRef({ p, onKind, onRemove }: { p: Pending; onKind: (k: ReferenceKind) => void; onRemove: () => void }) {
  const isImage = p.file.type.startsWith("image/");
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--au-line)] bg-[var(--au-stage)] p-1.5 pr-2">
      <div className="h-9 w-9 flex-none overflow-hidden rounded-md bg-[var(--au-panel-2)]">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-[var(--au-ink-3)]">
            {p.file.type.startsWith("video/") ? <Icon.Film width={14} height={14} /> : <Icon.Mic width={14} height={14} />}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="max-w-[140px] truncate text-[11px]">{p.file.name}</div>
        <select className="au-select mt-0.5 !py-0.5 !text-[10px]" value={p.kind} onChange={(e) => onKind(e.target.value as ReferenceKind)}>
          {REFERENCE_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <button type="button" onClick={onRemove} className="text-[var(--au-ink-3)] hover:text-[var(--au-ink)]" aria-label="Remove">
        <Icon.Close width={12} height={12} />
      </button>
    </div>
  );
}

function ProjectGrid({ projects }: { projects: Project[] }) {
  const studio = useStudio();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((p) => {
        const t = templateById(p.templateId);
        const genres = p.genreIds.map((id) => genreById(id)?.name).filter(Boolean);
        const pr = progress(p);
        const cover = p.references.find((r) => r.thumb)?.thumb;
        return (
          <div key={p.id} className="au-card group overflow-hidden">
            <button type="button" className="block w-full text-left" onClick={() => studio.openProject(p.id)}>
              <div className="relative" style={{ ...aspectStyle("16:9"), background: `linear-gradient(135deg, hsl(${t.hue[0]} 40% 18%), hsl(${t.hue[1]} 45% 10%))` }}>
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" className="h-full w-full object-cover opacity-80" />
                ) : (
                  <div className="au-animatic" style={{ ["--h" as string]: t.hue[0] }} />
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent p-3">
                  <div>
                    <div className="text-[13px] font-semibold text-white">{p.title || "Untitled"}</div>
                    <div className="mt-0.5 text-[10.5px] text-white/60">{t.name}{genres.length ? ` · ${genres.join(" + ")}` : ""}</div>
                  </div>
                  <div className="au-mono !text-white/70">{fmtSec(totalDuration(p) || p.targetDurationSec)}</div>
                </div>
              </div>
            </button>
            <div className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-[var(--au-ink-3)]">
                <span className="au-dot" data-s={pr.total && pr.done === pr.total ? "done" : pr.done ? "generating" : "idle"} style={{ animation: "none" }} />
                {pr.total ? `${pr.done}/${pr.total} shots` : p.status === "developed" ? "Developed" : "Draft"}
                <span>·</span>
                <span>{relativeTime(p.updatedAt)}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`Delete "${p.title}" and its media?`)) studio.deleteProject(p.id);
                }}
                className="text-[var(--au-ink-3)] opacity-0 transition hover:text-[#ff8a78] group-hover:opacity-100"
                aria-label="Delete project"
              >
                <Icon.Trash width={12} height={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Characters and worlds across every project, the reusable cast. */
function CastLibrary() {
  const studio = useStudio();
  const cast = studio.projects.flatMap((p) => p.characters.map((c) => ({ c, p })));
  const worlds = studio.projects.flatMap((p) => p.worlds.map((w) => ({ w, p })));
  return (
    <div className="mx-auto max-w-[1100px] au-fade-in">
      <h1 className="text-2xl font-semibold tracking-tight">Characters & worlds</h1>
      <p className="mt-1 text-sm text-[var(--au-ink-2)]">Everyone and everywhere the Director has cast so far. Open a project to edit them.</p>
      <h2 className="mt-7 mb-2 text-sm font-semibold">Characters</h2>
      {cast.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cast.map(({ c, p }) => {
            const thumb = p.references.find((r) => c.referenceIds.includes(r.id))?.thumb;
            return (
              <button key={c.id} type="button" onClick={() => studio.openProject(p.id)} className="au-card flex gap-3 p-3 text-left">
                <div className="h-14 w-14 flex-none overflow-hidden rounded-lg bg-[var(--au-panel-2)]">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-[var(--au-ink-3)]"><Icon.Users width={16} height={16} /></div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold">{c.name} <span className="au-mono ml-1">{c.role}</span></div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--au-ink-2)]">{c.description}</div>
                  <div className="mt-1 text-[10px] text-[var(--au-ink-3)]">{p.title}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-[var(--au-ink-3)]">No characters yet.</p>
      )}
      <h2 className="mt-7 mb-2 text-sm font-semibold">Worlds</h2>
      {worlds.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {worlds.map(({ w, p }) => (
            <button key={w.id} type="button" onClick={() => studio.openProject(p.id)} className="au-card p-3 text-left">
              <div className="text-[13px] font-semibold">{w.name}</div>
              <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--au-ink-2)]">{w.description}</div>
              <div className="mt-1 text-[10px] text-[var(--au-ink-3)]">{w.timeOfDay} · {p.title}</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[var(--au-ink-3)]">No worlds yet.</p>
      )}
    </div>
  );
}

function AssetLibrary() {
  const studio = useStudio();
  const refs = studio.projects.flatMap((p) => p.references.map((r) => ({ r, p })));
  return (
    <div className="mx-auto max-w-[1100px] au-fade-in">
      <h1 className="text-2xl font-semibold tracking-tight">Assets</h1>
      <p className="mt-1 text-sm text-[var(--au-ink-2)]">Every reference across your projects.</p>
      {refs.length ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {refs.map(({ r, p }) => (
            <button key={r.id} type="button" onClick={() => studio.openProject(p.id)} className="au-card overflow-hidden text-left">
              <div className="relative aspect-square bg-[var(--au-panel-2)]">
                {r.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-[var(--au-ink-3)]">
                    {r.kind === "audio" ? <Icon.Mic width={18} height={18} /> : <Icon.Image width={18} height={18} />}
                  </div>
                )}
                <div className="au-mono absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 !text-white/80">{r.kind}</div>
              </div>
              <div className="p-2">
                <div className="truncate text-[11px]">{r.name}</div>
                <div className="truncate text-[10px] text-[var(--au-ink-3)]">{p.title}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-6 text-sm text-[var(--au-ink-3)]">No references yet. Add some when you start a project.</p>
      )}
    </div>
  );
}
