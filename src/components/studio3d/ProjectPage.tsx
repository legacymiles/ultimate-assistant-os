"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { routeMotion } from "@/lib/studio3d/director/motion";
import { canEdit } from "@/lib/studio3d/reducer";
import { toolById } from "@/lib/studio3d/tools/registry";
import {
  ACTIVE_STATUSES,
  CAMERA_MOVES,
  styleById,
  type Action,
  type CameraMove,
  type DirectorPlan,
  type MotionTool,
  type Scene,
  type SubjectKind,
  type VideoProject,
} from "@/lib/studio3d/types";
import { Animatic, useSceneThumbs } from "./Animatic";
import { ago, builderOnline, deleteProject, fetchBuilder, fetchProject, formatSec, mediaUrl, projectAction, savePlan, type BuilderInfo } from "./api";
import { StatusPill, ToolChip } from "./StatusPill";
import { StudioSetup } from "./StudioSetup";
import { ToolPlan } from "./ToolPlan";
import "./studio3d.css";

// One video: the director's pipeline, the screening room (final render or
// animatic), the storyboard with per-action tool decisions the owner can
// override, the interpretation, cast and sets, and production (log, look-dev
// stills, render report).

const STEPS = ["Interpret", "Storyboard", "Tool plan", "Build & animate", "Render", "Preview & export"];

function stepStates(p: VideoProject): ("done" | "active" | "todo")[] {
  const idx: Record<VideoProject["status"], number> = { storyboard: 3, queued: 3, building: 3, animating: 3, rendering: 4, ready: 6, failed: 3 };
  const at = p.status === "failed" && p.video ? 6 : idx[p.status];
  return STEPS.map((_, i) => (i < at ? "done" : i === at ? "active" : "todo"));
}

const ALLOWED: Record<SubjectKind, MotionTool[]> = {
  humanoid: ["mixamo", "cascadeur", "blender"],
  creature: ["cascadeur", "blender"],
  object: ["blender"],
};

export function ProjectPage({ id }: { id: string }) {
  const router = useRouter();
  const [project, setProject] = useState<VideoProject | null>(null);
  const [builder, setBuilder] = useState<BuilderInfo | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [screen, setScreen] = useState<"final" | "animatic">("animatic");
  const [currentScene, setCurrentScene] = useState(0);
  const [seek, setSeek] = useState<{ sec: number; nonce: number } | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"storyboard" | "production">("storyboard");
  const chosenScreen = useRef(false);

  const load = useCallback(async () => {
    try {
      const p = await fetchProject(id);
      setProject(p);
      if (!chosenScreen.current) setScreen(p.video ? "final" : "animatic");
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  const loadBuilder = useCallback(async () => {
    try {
      setBuilder(await fetchBuilder());
    } catch {
      /* the setup panel shows offline */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadBuilder();
  }, [load, loadBuilder]);

  const active = project ? ACTIVE_STATUSES.includes(project.status) : false;
  useEffect(() => {
    const t = setInterval(() => {
      if (active) void load();
      void loadBuilder();
    }, active ? 4000 : 20000);
    return () => clearInterval(t);
  }, [active, load, loadBuilder]);

  const run = async (label: string, fn: () => Promise<VideoProject | void>) => {
    setBusy(label);
    setError("");
    try {
      const next = await fn();
      if (next) setProject(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const updatePlan = (plan: DirectorPlan) => {
    if (!project) return;
    setProject({ ...project, plan });
    void run("save", () => savePlan(project.id, plan));
  };

  const remove = async () => {
    if (!window.confirm("Delete this video project, its storyboard and any rendered video? Files on your PC are kept.")) return;
    setBusy("delete");
    try {
      await deleteProject(id);
      router.push("/apps/3d-studio");
    } catch (err) {
      setError((err as Error).message);
      setBusy("");
    }
  };

  if (!project) {
    return (
      <div className="min-h-dvh">
        <TopBar title="Video" />
        {error ? (
          <div className="mx-auto max-w-3xl px-4 py-16 text-center">
            <p className="text-sm text-ink">{error}</p>
            <Link href="/apps/3d-studio" className="mt-3 inline-block text-xs text-brand hover:underline">
              Back to the studio
            </Link>
          </div>
        ) : (
          <div className="mx-auto mt-10 h-72 max-w-5xl animate-pulse rounded-3xl border border-line bg-panel" />
        )}
      </div>
    );
  }

  const { plan } = project;
  const editable = canEdit(project);
  const online = builderOnline(builder);
  const style = styleById(project.brief.style);
  const states = stepStates(project);
  const sceneStart = (i: number) => plan.scenes.slice(0, i).reduce((a, s) => a + s.durationSec, 0);

  return (
    <div className="min-h-dvh">
      <TopBar title={plan.title} status={project} />

      <main className="mx-auto flex max-w-[1400px] flex-col gap-5 px-4 py-5">
        {/* Pipeline */}
        <ol className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-panel p-2" aria-label="Production pipeline">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className="s3d-step flex min-w-[120px] flex-1 items-center gap-2 rounded-xl px-2 py-1.5"
              data-state={states[i]}
              data-pulse={ACTIVE_STATUSES.includes(project.status) && project.status !== "queued"}
              aria-current={states[i] === "active" ? "step" : undefined}
            >
              <span className="s3d-step__dot grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line text-[11px] text-ink-muted">
                {states[i] === "done" ? <Icon.Check width={12} height={12} /> : i + 1}
              </span>
              <span className={`text-xs ${states[i] === "todo" ? "text-ink-faint" : "text-ink"}`}>{s}</span>
            </li>
          ))}
        </ol>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-5">
            {/* Screening room */}
            <section className="relative overflow-hidden rounded-3xl border border-line bg-panel p-3 sm:p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">Screening room</h2>
                <div className="ml-auto inline-flex rounded-lg border border-line bg-canvas p-0.5">
                  {(["final", "animatic"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={k === "final" && !project.video}
                      onClick={() => {
                        chosenScreen.current = true;
                        setScreen(k);
                      }}
                      className={`rounded-md px-2.5 py-1 text-xs transition disabled:opacity-40 ${screen === k ? "bg-elevated font-medium text-ink" : "text-ink-muted hover:text-ink"}`}
                    >
                      {k === "final" ? "Final render" : "Animatic"}
                    </button>
                  ))}
                </div>
              </div>

              {screen === "final" && project.video ? (
                <div className="flex flex-col gap-2">
                  <video
                    key={project.video.key}
                    src={mediaUrl(project.id, "video")}
                    controls
                    playsInline
                    className={`w-full rounded-2xl bg-black ${project.brief.aspect === "16:9" ? "aspect-video" : "mx-auto max-h-[70vh]"}`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={mediaUrl(project.id, "video", true)} className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110">
                      Download video
                    </a>
                    <span className="text-[11px] text-ink-faint">
                      {[project.report?.resolution, project.report?.fps && `${project.report.fps} fps`, project.report?.engine, `${(project.video.bytes / 1e6).toFixed(1)} MB`].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                </div>
              ) : (
                <Animatic plan={plan} aspect={project.brief.aspect} title={plan.title} onScene={setCurrentScene} seekTo={seek} />
              )}
            </section>

            {/* Next action */}
            <ActionBar
              project={project}
              online={online}
              busy={busy}
              onRender={() => void run("render", () => projectAction(project.id, "render"))}
              onCancel={() => void run("cancel", () => projectAction(project.id, "cancel"))}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-1.5 border-b border-line">
              {(["storyboard", "production"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${tab === t ? "border-brand text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}
                >
                  {t === "storyboard" ? `Storyboard · ${plan.scenes.length} scenes` : `Production${project.log.length ? ` · ${project.log.length} log lines` : ""}`}
                </button>
              ))}
            </div>

            {tab === "storyboard" ? (
              <Storyboard
                project={project}
                editable={editable}
                currentScene={currentScene}
                onJump={(i) => {
                  chosenScreen.current = true;
                  setScreen("animatic");
                  setSeek({ sec: sceneStart(i), nonce: Date.now() });
                }}
                onChange={updatePlan}
              />
            ) : (
              <Production project={project} />
            )}

            {editable && (
              <section className="rounded-2xl border border-line bg-panel p-4">
                <h3 className="text-sm font-semibold text-ink">Give the director a note</h3>
                <p className="mt-0.5 text-xs text-ink-muted">Ask for another take — the whole storyboard is re-planned with your note in mind.</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={1000}
                    placeholder="e.g. make it funnier, add a chase, end at sunset"
                    className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/60"
                  />
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run("redirect", async () => {
                        const next = await projectAction(project.id, "redirect", note);
                        setNote("");
                        return next;
                      })
                    }
                    className="rounded-xl border border-brand/50 px-4 py-2 text-xs font-semibold text-ink transition hover:bg-brand/10 disabled:opacity-50"
                  >
                    {busy === "redirect" ? "Re-planning…" : "Another take"}
                  </button>
                </div>
              </section>
            )}
          </div>

          {/* Side column */}
          <aside className="flex min-w-0 flex-col gap-4">
            <section className="rounded-2xl border border-line bg-panel p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">Director&apos;s read</h3>
                <span className="text-[11px] text-ink-faint">{plan.source === "ai" ? "AI director" : "Offline director"}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink">{plan.logline}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <Fact k="Genre" v={plan.interpretation.genre} />
                <Fact k="Tone" v={plan.interpretation.tone} />
                <Fact k="Audience" v={plan.interpretation.audience} />
                <Fact k="Length" v={`${formatSec(plan.totalSec)} · ${project.brief.aspect}`} />
                <Fact k="Pacing" v={plan.interpretation.pacing} wide />
                <Fact k={`Look · ${style.label} · ${plan.style.engine}`} v={plan.style.look} wide />
                <Fact k="Music" v={plan.music} wide />
                <Fact k="Sound" v={plan.soundDesign} wide />
              </dl>
              {plan.notes.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-line pt-3">
                  {plan.notes.map((n) => (
                    <li key={n} className="text-[11px] text-ink-muted">
                      • {n}
                    </li>
                  ))}
                </ul>
              )}
              <details className="mt-3 text-xs text-ink-muted">
                <summary className="cursor-pointer text-ink-faint hover:text-ink">Original prompt</summary>
                <p className="mt-1 whitespace-pre-wrap">{project.prompt}</p>
              </details>
            </section>

            <ToolPlan plan={plan} capabilities={builder?.capabilities ?? null} />

            <section className="rounded-2xl border border-line bg-panel p-4">
              <h3 className="text-sm font-semibold text-ink">Cast</h3>
              <ul className="mt-2 space-y-2">
                {plan.characters.map((c) => (
                  <li key={c.id} className="flex gap-2.5">
                    <span className="mt-0.5 h-7 w-7 shrink-0 rounded-full border border-line" style={{ background: `linear-gradient(135deg, ${c.colors.body} 55%, ${c.colors.accent} 56%)` }} aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink">
                        {c.name} <span className="font-normal text-ink-faint">· {c.kind}</span>
                      </p>
                      <p className="text-[11px] text-ink-muted">{c.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <h3 className="mt-4 text-sm font-semibold text-ink">Sets</h3>
              <ul className="mt-2 space-y-2">
                {plan.environments.map((e) => (
                  <li key={e.id} className="flex gap-2.5">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 flex-col overflow-hidden rounded-md border border-line" aria-hidden>
                      <span className="flex-[3]" style={{ background: e.palette.sky }} />
                      <span className="flex-[2]" style={{ background: e.palette.ground }} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink">
                        {e.name} <span className="font-normal text-ink-faint">· {e.timeOfDay}</span>
                      </p>
                      <p className="text-[11px] text-ink-muted">{e.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <StudioSetup builder={builder} onLinked={() => void loadBuilder()} compact={online} />

            <button
              type="button"
              onClick={() => void remove()}
              disabled={Boolean(busy) || active}
              className="self-start rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-red-500/50 hover:text-red-400 disabled:opacity-40"
            >
              Delete project
            </button>
          </aside>
        </div>
      </main>
    </div>
  );
}

function TopBar({ title, status }: { title: string; status?: VideoProject }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
      <Link
        href="/apps/3d-studio"
        className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-elevated hover:text-ink"
      >
        <Icon.ArrowLeft width={13} height={13} />
        Studio
      </Link>
      <span className="truncate text-sm font-semibold text-ink">{title}</span>
      {status && (
        <span className="ml-auto shrink-0">
          <StatusPill status={status.status} />
        </span>
      )}
    </header>
  );
}

function Fact({ k, v, wide = false }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-[10px] uppercase tracking-wide text-ink-faint">{k}</dt>
      <dd className="mt-0.5 text-ink-muted">{v}</dd>
    </div>
  );
}

function ActionBar({ project, online, busy, onRender, onCancel }: { project: VideoProject; online: boolean; busy: string; onRender: () => void; onCancel: () => void }) {
  const s = project.status;
  const card = "flex flex-wrap items-center gap-3 rounded-2xl border p-4";

  if (s === "storyboard" || s === "ready" || s === "failed") {
    return (
      <div className={`${card} ${s === "failed" ? "border-red-500/40 bg-red-500/5" : "border-brand/30 bg-brand/5"}`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {s === "storyboard" ? (project.video ? "Storyboard changed" : "Happy with the storyboard?") : s === "ready" ? "Your video is rendered" : "The render stopped"}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-muted">
            {s === "failed"
              ? (project.error ?? "No reason was given.").split("\n\nLast output")[0]
              : s === "ready"
                ? "Watch it in the screening room and download it. Edit the storyboard and render again any time."
                : online
                  ? "Your studio PC is online — Blender starts building as soon as you send it."
                  : "Send it now; it renders as soon as your studio PC's builder is running. The animatic above works meanwhile."}
          </p>
        </div>
        <button
          type="button"
          onClick={onRender}
          disabled={Boolean(busy)}
          className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_30px_-10px] shadow-brand transition hover:brightness-110 disabled:opacity-50"
        >
          {busy === "render" ? "Sending…" : s === "storyboard" && !project.video ? "Render in Blender" : s === "failed" ? "Try again" : "Render again"}
        </button>
      </div>
    );
  }

  return (
    <div className={`${card} border-line bg-panel`}>
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{s === "queued" ? (online ? "Starting on your PC…" : "Waiting for your studio PC") : project.note ?? "Working…"}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {s === "queued"
            ? online
              ? "The builder picks it up within a few seconds."
              : "Start the studio builder on your PC (Setup, below right) and it begins automatically."
            : `Started ${ago(project.startedAt)}. The storyboard is locked while it renders.`}
        </p>
      </div>
      {s === "queued" && (
        <button type="button" onClick={onCancel} disabled={Boolean(busy)} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50">
          Take out of queue
        </button>
      )}
    </div>
  );
}

function Storyboard({
  project,
  editable,
  currentScene,
  onJump,
  onChange,
}: {
  project: VideoProject;
  editable: boolean;
  currentScene: number;
  onJump: (index: number) => void;
  onChange: (plan: DirectorPlan) => void;
}) {
  const { plan } = project;
  const thumbs = useSceneThumbs(plan, project.brief.aspect);
  const [editing, setEditing] = useState<string | null>(null);

  const setScene = (sceneId: string, patch: Partial<Scene>) =>
    onChange({ ...plan, scenes: plan.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)) });

  const cycleTool = (scene: Scene, action: Action) => {
    const kind = plan.characters.find((c) => c.id === action.characterId)?.kind ?? "humanoid";
    const allowed = ALLOWED[kind];
    const next = allowed[(allowed.indexOf(action.tool) + 1) % allowed.length];
    const routed = routeMotion(action.description, kind);
    const updated: Action = {
      ...action,
      tool: next,
      clip: next === "mixamo" ? (routed.clip ?? "Idle") : undefined,
      reason: next === routed.tool ? routed.reason : `Chosen by you — ${toolById(next)?.name} animates this.`,
      override: next !== routed.tool,
    };
    setScene(scene.id, { actions: scene.actions.map((a) => (a.id === action.id ? updated : a)) });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Timeline strip */}
      <div className="flex h-9 gap-[3px] overflow-hidden rounded-xl border border-line bg-canvas p-[3px]" aria-hidden>
        {plan.scenes.map((s, i) => {
          const env = plan.environments.find((e) => e.id === s.environmentId);
          return (
            <button
              key={s.id}
              type="button"
              tabIndex={-1}
              onClick={() => onJump(i)}
              style={{ flex: s.durationSec, background: `linear-gradient(to bottom, ${env?.palette.sky}, ${env?.palette.ground})` }}
              className={`relative min-w-0 rounded-lg text-left transition ${i === currentScene ? "ring-2 ring-brand" : "opacity-80 hover:opacity-100"}`}
            >
              <span className="absolute inset-x-1.5 bottom-0.5 truncate font-mono text-[10px] font-semibold text-white drop-shadow">
                S{i + 1} · {s.durationSec}s
              </span>
            </button>
          );
        })}
      </div>
      {editable && <p className="text-[11px] text-ink-faint">Click a tool chip to hand that motion to a different tool. Scene lengths are rebalanced to keep the video at {formatSec(project.brief.lengthSec)}.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {plan.scenes.map((s, i) => {
          const env = plan.environments.find((e) => e.id === s.environmentId);
          const isEditing = editing === s.id;
          return (
            <article
              key={s.id}
              className={`flex flex-col overflow-hidden rounded-2xl border bg-panel transition ${i === currentScene ? "border-brand/60 shadow-[0_0_0_1px] shadow-brand/30" : "border-line"}`}
            >
              <button type="button" onClick={() => onJump(i)} className="group relative aspect-video overflow-hidden bg-canvas" aria-label={`Play from scene ${i + 1}`}>
                {thumbs[i] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumbs[i]!} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
                ) : (
                  <div className="s3d-poster" style={{ ["--sky" as string]: env?.palette.sky, ["--ground" as string]: env?.palette.ground }} />
                )}
                <span className="absolute left-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                  S{i + 1} · {s.beat}
                </span>
                <span className="absolute right-2 top-2 rounded-md bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white">{s.durationSec}s</span>
              </button>

              <div className="flex flex-1 flex-col gap-2 p-3">
                {isEditing ? (
                  <SceneEditor
                    scene={s}
                    onCancel={() => setEditing(null)}
                    onSave={(patch) => {
                      setScene(s.id, patch);
                      setEditing(null);
                    }}
                  />
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <h4 className="min-w-0 flex-1 text-sm font-semibold text-ink">{s.title}</h4>
                      {editable && (
                        <button type="button" onClick={() => setEditing(s.id)} className="shrink-0 rounded-md p-1 text-ink-faint hover:bg-elevated hover:text-ink" aria-label={`Edit scene ${i + 1}`}>
                          <Icon.Edit width={13} height={13} />
                        </button>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-ink-muted">{s.summary}</p>
                    {s.narration && <p className="border-l-2 border-accent/50 pl-2 text-xs italic text-ink">“{s.narration}”</p>}
                  </>
                )}

                <div className="flex flex-wrap gap-1 text-[10px] text-ink-muted">
                  <span className="rounded-md border border-line px-1.5 py-0.5">🎥 {s.camera.move} · {s.camera.lens}mm</span>
                  <span className="rounded-md border border-line px-1.5 py-0.5">{s.camera.framing}</span>
                  {env && <span className="rounded-md border border-line px-1.5 py-0.5">📍 {env.name}</span>}
                  {s.effects.map((fx) => (
                    <span key={fx} className="rounded-md border border-line px-1.5 py-0.5">✨ {fx}</span>
                  ))}
                </div>

                <ul className="mt-1 space-y-1.5 border-t border-line pt-2">
                  {s.actions.map((a) => {
                    const who = plan.characters.find((c) => c.id === a.characterId);
                    const kind = who?.kind ?? "humanoid";
                    return (
                      <li key={a.id} className="text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <ToolChip
                            tool={a.tool}
                            label={`${toolById(a.tool)?.name}${a.clip ? ` · ${a.clip}` : ""}`}
                            title={editable && ALLOWED[kind].length > 1 ? "Click to use a different tool" : a.reason}
                            onClick={editable && ALLOWED[kind].length > 1 ? () => cycleTool(s, a) : undefined}
                          />
                          {a.override && <span className="text-[10px] text-amber-400">your pick</span>}
                          <span className="min-w-0 text-ink">
                            <span className="font-medium">{who?.name}</span> — {a.description}
                          </span>
                        </div>
                        <p className="mt-0.5 pl-1 text-[11px] text-ink-faint">{a.reason}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function SceneEditor({ scene, onSave, onCancel }: { scene: Scene; onSave: (patch: Partial<Scene>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(scene.title);
  const [summary, setSummary] = useState(scene.summary);
  const [narration, setNarration] = useState(scene.narration ?? "");
  const [move, setMove] = useState<CameraMove>(scene.camera.move);
  const [duration, setDuration] = useState(scene.durationSec);
  const field = "w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-brand/60";
  return (
    <div className="flex flex-col gap-2">
      <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} aria-label="Scene title" />
      <textarea className={field} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={600} aria-label="What happens" />
      <textarea className={field} rows={2} value={narration} onChange={(e) => setNarration(e.target.value)} maxLength={400} placeholder="Narration (optional)" aria-label="Narration" />
      <div className="flex gap-2">
        <select className={field} value={move} onChange={(e) => setMove(e.target.value as CameraMove)} aria-label="Camera move">
          {CAMERA_MOVES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[11px] text-ink-muted">
          <input className={`${field} w-16`} type="number" min={2} max={120} step={0.5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Seconds" />s
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave({ title, summary, narration: narration.trim() || undefined, camera: { ...scene.camera, move }, durationSec: duration })}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white"
        >
          Save scene
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}

function Production({ project }: { project: VideoProject }) {
  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [project.log.length]);
  const r = project.report;

  return (
    <div className="flex flex-col gap-4">
      {project.stills.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-ink">Look-dev frames from Blender</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {project.stills.map((st, i) => (
              <a key={st.key} href={mediaUrl(project.id, i)} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-xl border border-line bg-canvas">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(project.id, i)} alt={st.caption ?? ""} loading="lazy" className="aspect-video w-full object-cover transition group-hover:scale-[1.02]" />
                {st.caption && <p className="truncate px-2 py-1 text-[11px] text-ink-muted">{st.caption}</p>}
              </a>
            ))}
          </div>
        </section>
      )}

      {r && (
        <section className="rounded-2xl border border-line bg-panel p-4">
          <h3 className="text-sm font-semibold text-ink">Render report</h3>
          <p className="mt-1 text-[11px] text-ink-muted">
            {[r.engine, r.resolution, r.fps && `${r.fps} fps`, r.frames && `${r.frames} frames`, r.renderMinutes && `${r.renderMinutes.toFixed(1)} min render`].filter(Boolean).join(" · ")}
          </p>
          {r.toolsUsed.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {r.toolsUsed.map((t) => (
                <li key={t.tool} className="flex flex-wrap items-start gap-2 text-xs">
                  <ToolChip tool={t.tool} label={toolById(t.tool)?.name ?? t.tool} />
                  <span className={t.used ? "text-core" : "text-amber-400"}>{t.used ? "used" : "not used"}</span>
                  <span className="min-w-0 flex-1 text-ink-muted">{t.note}</span>
                </li>
              ))}
            </ul>
          )}
          {r.cut.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-xs font-semibold text-ink">Changed or left out</p>
              <ul className="mt-1 space-y-1">
                {r.cut.map((c) => (
                  <li key={c.item} className="text-xs text-ink-muted">
                    <span className="text-ink">{c.item}</span>
                    {c.reason && <span className="text-ink-faint"> — {c.reason}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(r.blendFile || r.outputPath) && (
            <p className="mt-3 break-all border-t border-line pt-3 font-mono text-[10px] text-ink-faint">
              {r.blendFile && <>Blend: {r.blendFile}<br /></>}
              {r.outputPath && <>Video: {r.outputPath}</>}
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-line bg-panel">
        <p className="border-b border-line px-4 py-2 text-xs font-semibold text-ink">Production log</p>
        <div className="max-h-[420px] overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed">
          {project.log.length === 0 ? (
            <p className="py-6 text-center font-sans text-xs text-ink-faint">
              {project.status === "storyboard" ? "Nothing rendered yet. Send the storyboard to your PC to start production." : "Waiting for the first update from your PC…"}
            </p>
          ) : (
            project.log.map((l, i) => (
              <p key={i} className={l.line.startsWith("→") ? "text-ink-faint" : l.line.startsWith("stderr") ? "text-amber-400/80" : "text-ink-muted"}>
                <span className="mr-2 text-ink-faint/60">{new Date(l.t).toLocaleTimeString()}</span>
                {l.line}
              </p>
            ))
          )}
          <div ref={logEnd} />
        </div>
      </section>
    </div>
  );
}
