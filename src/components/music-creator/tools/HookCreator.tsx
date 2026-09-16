"use client";

// ---------------------------------------------------------------------------
// Hook Creator — chase one earworm.
//
// A song tool and a hook tool want opposite things. A song is one long artefact
// you keep refining; a hook is a numbers game — you want eight candidates on the
// table at once, you want to edit them like sticky notes, and you want to hear
// the promising ones several times over before you commit. So this screen is a
// wall of small editable cards rather than a document, and the render control on
// each card can fire the same hook across several seeds.
//
// Two decisions are worth stating, because they are not arbitrary:
//
//   cot: "off" is the default here. A hook is eight bars. YuE2's planning modes
//   ("full" plans a score and harmony, "melody" plans a melody line) buy their
//   coherence with a whole extra pass, and over eight bars that cost is real
//   while the benefit is small. It is a default, not a rule — the control is
//   right there, and for a hook whose whole point is the chord movement, "full"
//   is the better answer.
//
//   Seeds are submitted one after another, awaited in a loop. There is exactly
//   one GPU behind this studio; firing four requests in parallel would not make
//   four takes arrive sooner, it would only queue them somewhere less visible
//   and take the progress bar away from the user. The loop keeps every take
//   watched by the shared render path, in order.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import { DEFAULT_SEED } from "@/lib/music-creator/store";
import { type ToolProps, toolById } from "@/lib/music-creator/tools";
import type { PlanMode, Project } from "@/lib/music-creator/types";
import { Field, ServerNotice, Takes, Text, WriterNote, missingFor, useWriter } from "../parts";
import { useStudio } from "../studio";
import "./tools.css";

/** One hook candidate on the wall. Lives in `project.data.hooks`. */
interface HookCandidate {
  id: string;
  label: string;
  /** The words, with a [Chorus] or [Hook] tag. Sung literally by YuE2. */
  lyrics: string;
  /** A style line suited to this particular hook, not to the project. */
  style: string;
  /** The writer's one line on why it sticks. Notes for the human only. */
  why: string;
}

interface Brief {
  idea: string;
  genre: string;
  mood: string;
  tempo: string;
  vocal: string;
}

const EMPTY_BRIEF: Brief = { idea: "", genre: "", mood: "", tempo: "", vocal: "" };

/** How many seeds one "render across N" press submits. */
const SEED_CHOICES = [1, 2, 3, 4];

const PLAN_MODES: { id: PlanMode; label: string; note: string }[] = [
  { id: "off", label: "No plan", note: "Straight to audio. Fastest, and usually enough for eight bars." },
  { id: "melody", label: "Melody", note: "Plans a melody line first, then performs it. Slower." },
  { id: "full", label: "Score + harmony", note: "Plans the full score. Slowest; worth it when the chords are the hook." },
];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function hid(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Read the wall out of the project's own data bag, defensively. */
function hooksOf(project: Project): HookCandidate[] {
  const raw = project.data?.hooks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
    .map((h) => ({
      id: str(h.id) || hid(),
      label: str(h.label, "Hook"),
      lyrics: str(h.lyrics),
      style: str(h.style),
      why: str(h.why),
    }));
}

function briefOf(project: Project): Brief {
  const raw = project.data?.brief;
  if (!raw || typeof raw !== "object") return EMPTY_BRIEF;
  const r = raw as Record<string, unknown>;
  return {
    idea: str(r.idea),
    genre: str(r.genre),
    mood: str(r.mood),
    tempo: str(r.tempo),
    vocal: str(r.vocal),
  };
}

export function HookCreator({ project, update, setData }: ToolProps) {
  const { render, running, server } = useStudio();
  const writer = useWriter();
  const tool = toolById("hook-creator");

  const hooks = hooksOf(project);
  const brief = briefOf(project);
  const chosenId = str(project.data?.chosenId);
  const cot = (str(project.data?.cot, "off") as PlanMode) || "off";
  const seedCount = typeof project.data?.seedCount === "number" ? (project.data.seedCount as number) : 2;

  /** Which card is mid-run. Separate from `running` so the wall can point at it. */
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * The wall as it is now, not as it was when a button was pressed. Writing a
   * set of hooks takes long enough for the user to have edited a card in the
   * meantime, and merging into the closure's copy would throw that edit away.
   */
  const live = useRef(project);
  useEffect(() => {
    live.current = project;
  }, [project]);

  const blocked = tool ? missingFor(tool, server).length > 0 : false;
  const baseSeed = project.request.seed || DEFAULT_SEED;

  const setBrief = (patch: Partial<Brief>) => setData({ brief: { ...brief, ...patch } });
  const setHooks = (next: HookCandidate[]) => setData({ hooks: next });

  const patchHook = (id: string, patch: Partial<HookCandidate>) =>
    setHooks(hooks.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const writeHooks = async () => {
    const result = await writer.run("hooks", {
      brief: brief.idea,
      genre: brief.genre,
      mood: brief.mood,
      tempo: brief.tempo,
      vocal: brief.vocal,
      count: 6,
    });
    if (!result) return;
    const raw = Array.isArray(result.hooks) ? (result.hooks as unknown[]) : [];
    const written: HookCandidate[] = raw
      .filter((h): h is Record<string, unknown> => !!h && typeof h === "object")
      .map((h) => ({
        id: hid(),
        label: str(h.label, "Hook"),
        lyrics: str(h.lyrics),
        style: str(h.style),
        why: str(h.why),
      }))
      .filter((h) => h.lyrics.trim().length > 0);
    if (!written.length) return;
    // Added in front of what is already there: a second pass at the brief is
    // meant to widen the wall, not replace work the user has been editing.
    const now = live.current;
    update({ data: { ...(now.data ?? {}), hooks: [...written, ...hooksOf(now)] } });
  };

  const addBlank = () =>
    setHooks([
      { id: hid(), label: "New hook", lyrics: "[Hook]\n", style: brief.genre || "", why: "" },
      ...hooks,
    ]);

  /**
   * Render one hook across `seedCount` seeds, strictly one at a time.
   *
   * The chosen hook is copied into `project.request` first, so the project's own
   * record of what it is says the same thing as the take that comes out of it.
   */
  const renderHook = async (hook: HookCandidate) => {
    if (!hook.lyrics.trim()) return;
    const seeds = Array.from({ length: seedCount }, (_, i) => baseSeed + i);

    update({ request: { ...project.request, style: hook.style, lyrics: hook.lyrics, cot, seed: seeds[0], abc: null } });
    setData({ chosenId: hook.id });

    setBusyId(hook.id);
    try {
      for (const seed of seeds) {
        await render(
          project.id,
          { style: hook.style, lyrics: hook.lyrics, cot, seed, abc: null, cfg_scale: project.request.cfg_scale ?? null },
          seeds.length > 1 ? `${hook.label} · seed ${seed}` : hook.label,
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mct">
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>The idea</h3>
          <p>One line is enough. Everything below it just narrows the search.</p>
        </div>
        <Field label="Hook idea" hint="what it is about">
          <Text
            value={brief.idea}
            onChange={(idea) => setBrief({ idea })}
            placeholder="the moment you realise you are the problem"
            rows={2}
          />
        </Field>
        <div className="mc-cols">
          <Field label="Genre or sound">
            <Text value={brief.genre} onChange={(genre) => setBrief({ genre })} placeholder="bedroom pop, warm tape drums" />
          </Field>
          <Field label="Mood">
            <Text value={brief.mood} onChange={(mood) => setBrief({ mood })} placeholder="bright, a little bitter" />
          </Field>
        </div>
        <div className="mc-cols">
          <Field label="Tempo" hint="BPM">
            <Text value={brief.tempo} onChange={(tempo) => setBrief({ tempo })} placeholder="102 BPM" />
          </Field>
          <Field label="Vocal">
            <Text value={brief.vocal} onChange={(vocal) => setBrief({ vocal })} placeholder="close female alto, breathy" />
          </Field>
        </div>
        <div className="mct-bar">
          <button type="button" className="mc-btn mc-btn-go" onClick={writeHooks} disabled={writer.busy}>
            <Icon.Sparkles width={14} height={14} /> {writer.busy ? "Writing…" : "Write six hooks"}
          </button>
          <button type="button" className="mc-btn" onClick={addBlank}>
            <Icon.Plus width={13} height={13} /> Blank card
          </button>
        </div>
        <WriterNote engine={writer.engine} warning={writer.warning} error={writer.error} />
      </section>

      {tool && <ServerNotice tool={tool} />}

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>How each hook gets rendered</h3>
          <p>These apply to whichever card you press. Change them between takes to compare.</p>
        </div>
        <div className="mct-bar">
          <label className="mct-inline">
            <span className="mc-field-l">Planning</span>
            <select className="mc-input mct-sel" value={cot} onChange={(e) => setData({ cot: e.target.value as PlanMode })}>
              {PLAN_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mct-inline">
            <span className="mc-field-l">Seeds per press</span>
            <select
              className="mc-input mct-sel"
              value={seedCount}
              onChange={(e) => setData({ seedCount: Number(e.target.value) })}
            >
              {SEED_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 take" : `${n} takes`}
                </option>
              ))}
            </select>
          </label>
          <label className="mct-inline">
            <span className="mc-field-l">First seed</span>
            <input
              className="mc-input mct-sel"
              type="number"
              value={baseSeed}
              onChange={(e) => update({ request: { ...project.request, seed: Number(e.target.value) || DEFAULT_SEED } })}
            />
          </label>
        </div>
        <p className="mc-note">{PLAN_MODES.find((m) => m.id === cot)?.note}</p>
        {seedCount > 1 && (
          <p className="mc-note">
            Seeds {baseSeed}–{baseSeed + seedCount - 1}, submitted one after another. There is one GPU behind this
            studio, so they queue rather than run together — expect minutes per take.
          </p>
        )}
      </section>

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>The wall</h3>
          <p>
            {hooks.length
              ? `${hooks.length} candidate${hooks.length === 1 ? "" : "s"}. Every field here is editable — the words are sung exactly as written.`
              : "Nothing on it yet."}
          </p>
        </div>

        {hooks.length === 0 ? (
          <p className="mc-empty">Write from the brief above, or start a blank card and type the hook yourself.</p>
        ) : (
          <div className="mct-wall">
            {hooks.map((hook) => (
              <article key={hook.id} className={`mct-card ${hook.id === chosenId ? "mct-on" : ""}`}>
                <div className="mct-card-h">
                  <input
                    className="mc-input mct-name"
                    value={hook.label}
                    onChange={(e) => patchHook(hook.id, { label: e.target.value })}
                    aria-label="Hook name"
                  />
                  <button
                    type="button"
                    className="mc-btn mc-btn-s"
                    onClick={() => setHooks([{ ...hook, id: hid(), label: `${hook.label} alt` }, ...hooks])}
                    title="Copy this card so you can pull it apart"
                  >
                    <Icon.Copy width={12} height={12} />
                  </button>
                  <button
                    type="button"
                    className="mc-btn mc-btn-s"
                    onClick={() => setHooks(hooks.filter((h) => h.id !== hook.id))}
                    title="Remove this card"
                  >
                    <Icon.Trash width={12} height={12} />
                  </button>
                </div>

                <label className="mc-field">
                  <span className="mc-field-l">
                    Lyrics<i>sung literally</i>
                  </span>
                  <textarea
                    className="mc-input mc-area mct-lyr"
                    rows={5}
                    value={hook.lyrics}
                    onChange={(e) => patchHook(hook.id, { lyrics: e.target.value })}
                    placeholder={"[Hook]\nfour lines, one idea"}
                  />
                </label>

                <label className="mc-field">
                  <span className="mc-field-l">
                    Style<i>genre, instruments, voice, BPM</i>
                  </span>
                  <textarea
                    className="mc-input mc-area"
                    rows={2}
                    value={hook.style}
                    onChange={(e) => patchHook(hook.id, { style: e.target.value })}
                    placeholder="English bedroom pop, tape drums, close female alto, 102 BPM"
                  />
                </label>

                {hook.why && <p className="mct-why">{hook.why}</p>}

                <div className="mct-card-f">
                  <button
                    type="button"
                    className="mc-btn mc-btn-go"
                    onClick={() => void renderHook(hook)}
                    disabled={blocked || !!running || !!busyId || !hook.lyrics.trim()}
                    title={blocked ? "The GPU server cannot render this right now" : undefined}
                  >
                    <Icon.Note width={13} height={13} />
                    {busyId === hook.id
                      ? "Rendering…"
                      : seedCount > 1
                        ? `Render across ${seedCount} seeds`
                        : "Render this hook"}
                  </button>
                  <span className="mct-seeds">
                    {Array.from({ length: seedCount }, (_, i) => (
                      <i key={i} className="mc-tag2">
                        {baseSeed + i}
                      </i>
                    ))}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>Takes</h3>
          <p>Newest first. Same hook, different seed, is the comparison worth making.</p>
        </div>
        <Takes renders={project.renders} empty="No takes yet. Render a card above." />
      </section>
    </div>
  );
}
