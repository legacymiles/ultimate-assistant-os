"use client";

// ---------------------------------------------------------------------------
// Remix / Stems — the white-box side of the studio.
//
// Two unrelated jobs share this screen because they are the two ways to get
// inside music that already exists.
//
//   Score editing. YuE2 can be handed an ABC score instead of planning one, so
//   a song that has been transcribed is a text file you can rewrite: move a
//   note, change a chord, cut eight bars, render it again. That is a genuinely
//   white-box remix, and it is the reason this panel is a plain text editor
//   rather than a piano roll.
//
//   Stem separation. AuK splits a recording into the vocal and everything else.
//   Nothing else in this app touches audio you already have.
//
// What this panel deliberately does NOT do: parse the ABC. There is no JS here
// that transposes, reharmonises or re-times a score, because writing one that
// half-works would be worse than writing none — it would produce plausible
// notation that quietly ruins a bar, and the user would blame the model. The
// "quick edits" below are honest about what they are: they rewrite the STYLE
// line, which is prose YuE2 reads, and they tell you what to change in the
// score yourself. The only thing a model is asked to rewrite is the lyrics,
// which is text work it is actually good at.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import { DEFAULT_SEED } from "@/lib/music-creator/store";
import { type ToolProps, toolById } from "@/lib/music-creator/tools";
import type { PlanMode } from "@/lib/music-creator/types";
import { Field, ServerNotice, Takes, Text, WriterNote, missingFor, useWriter } from "../parts";
import { useStudio } from "../studio";
import "./tools.css";

/** A score found on some other project's take, offered for loading. */
interface ScoreSource {
  key: string;
  project: string;
  label: string;
  abc: string;
}

/**
 * The quick edits.
 *
 * `fragment` is text for the style line — prose, which is the only thing a
 * button can honestly change on its own. `note` says what the same intent means
 * in the score, which is work only the user can do. Nothing here edits ABC.
 */
const INTENTS: { id: string; label: string; fragment: string; note: string }[] = [
  {
    id: "reharm",
    label: "Reharmonise",
    fragment: "reharmonised with extended voicings and modal interchange",
    note:
      "Harmony lives in the chord symbols above the staff in the ABC (the \"C7\" and \"Am\" marks). Score + harmony " +
      "mode follows them; melody mode ignores them and writes its own accompaniment. To actually reharmonise, edit " +
      "those symbols — or delete them and render in melody mode to hear what YuE2 puts underneath instead.",
  },
  {
    id: "tempo",
    label: "Change tempo",
    fragment: "96 BPM, halftime feel",
    note:
      "Tempo is in two places: the Q: line in the ABC header, and the BPM you write in the style line. Set both, and " +
      "set them to the same thing — when they disagree the result is neither.",
  },
  {
    id: "instruments",
    label: "Swap instrumentation",
    fragment: "played by upright bass, brushed kit and Rhodes",
    note:
      "ABC carries notes, not timbres, so instrumentation is entirely the style line's job. This is the one quick " +
      "edit the style line alone can really deliver — the score does not need touching.",
  },
  {
    id: "structure",
    label: "Restructure",
    fragment: "arrangement builds from a sparse intro to a full final chorus",
    note:
      "Structure is in two places at once: the section tags in the lyrics ([Verse], [Chorus]) and the order of the " +
      "bars in the score. Moving a chorus means moving both. Nothing here rearranges the score for you.",
  },
];

const SEPARATION_MODES: { id: "vocals" | "music"; label: string; note: string }[] = [
  { id: "vocals", label: "Vocal only", note: "Keeps the voice, removes the backing." },
  { id: "music", label: "Music only", note: "Removes the voice, keeps the backing — an instrumental to write over." },
];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("That file could not be read in this browser."));
    reader.readAsDataURL(blob);
  });
}

export function RemixStems({ project, update, setData }: ToolProps) {
  const { render, runAndFile, running, server, projects } = useStudio();
  const writer = useWriter();
  const tool = toolById("remix-stems");

  const [intentId, setIntentId] = useState<string | null>(null);
  const [fragment, setFragment] = useState("");
  const [clip, setClip] = useState<{ dataUrl: string; name: string; bytes: number } | null>(null);
  const [mode, setMode] = useState<"vocals" | "music">("vocals");
  const [localError, setLocalError] = useState<string | null>(null);

  const change = str(project.data?.change);
  const abc = str(project.request.abc);
  const cot: PlanMode = project.request.cot === "melody" ? "melody" : "full";

  const blocked = tool ? missingFor(tool, server).length > 0 : false;
  const busy = !!running;

  /**
   * The project as it is now, for writes that land after an `await`. The score
   * editor is open the whole time a rewrite is running, so merging into the
   * closure's copy of the project would undo whatever was typed during it.
   */
  const live = useRef(project);
  useEffect(() => {
    live.current = project;
  }, [project]);

  /** Every score this browser already has, wherever it came from. */
  const sources = useMemo<ScoreSource[]>(() => {
    const out: ScoreSource[] = [];
    for (const p of projects) {
      for (const r of p.renders) {
        const meta = r.meta;
        const found = str(meta?.stripped_abc) || str(meta?.abc) || str(meta?.score);
        if (found.trim()) {
          out.push({ key: `${p.id}:${r.id}`, project: p.title || "Untitled", label: r.label, abc: found });
        }
      }
    }
    return out;
  }, [projects]);

  const intent = INTENTS.find((i) => i.id === intentId) ?? null;

  const pickIntent = (id: string) => {
    const next = INTENTS.find((i) => i.id === id);
    setIntentId(id);
    setFragment(next?.fragment ?? "");
  };

  const applyFragment = () => {
    const text = fragment.trim();
    if (!text) return;
    const current = project.request.style.trim();
    update({ request: { ...project.request, style: current ? `${current}, ${text}` : text } });
  };

  const rewriteLyrics = async () => {
    const result = await writer.run("rewrite", { lyrics: project.request.lyrics, change, style: project.request.style });
    if (!result) return;
    const lyrics = str(result.lyrics);
    const now = live.current;
    update({
      request: lyrics ? { ...now.request, lyrics } : now.request,
      data: { ...(now.data ?? {}), changed: str(result.changed) },
    });
  };

  const rerender = () =>
    void render(
      project.id,
      {
        style: project.request.style,
        lyrics: project.request.lyrics,
        cot,
        seed: project.request.seed || DEFAULT_SEED,
        abc,
        cfg_scale: project.request.cfg_scale ?? null,
      },
      `${cot === "melody" ? "Melody" : "Score"} · seed ${project.request.seed || DEFAULT_SEED}`,
    );

  const takeFile = async (file: File) => {
    setLocalError(null);
    try {
      setClip({ dataUrl: await readDataUrl(file), name: file.name, bytes: file.size });
    } catch (err) {
      setLocalError((err as Error).message);
    }
  };

  const separate = () => {
    if (!clip) return;
    void runAndFile(
      project.id,
      "stem",
      "jobs/separate",
      { audio_b64: clip.dataUrl, mode },
      `${mode === "vocals" ? "Vocal" : "Music"} from ${clip.name}`,
    );
  };

  const scoreTakes = project.renders.filter((r) => r.kind === "song");
  const stemTakes = project.renders.filter((r) => r.kind === "stem");
  const changedNote = str(project.data?.changed);

  return (
    <div className="mct">
      {tool && <ServerNotice tool={tool} />}

      {/* ----- score editing ------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>The score</h3>
          <p>
            ABC notation. Paste one, or load one off a take that already has it. This text is what YuE2 realises — edit
            it and the render changes.
          </p>
        </div>

        {sources.length > 0 && (
          <label className="mct-inline mct-load">
            <span className="mc-field-l">Load from a take</span>
            <select
              className="mc-input mct-sel"
              value=""
              onChange={(e) => {
                const found = sources.find((s) => s.key === e.target.value);
                if (found) update({ request: { ...project.request, abc: found.abc } });
              }}
            >
              <option value="">
                {sources.length} score{sources.length === 1 ? "" : "s"} in this studio…
              </option>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.project} — {s.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <pre className="mc-mono mct-pre">
          <textarea
            className="mct-score"
            rows={16}
            spellCheck={false}
            value={abc}
            onChange={(e) => update({ request: { ...project.request, abc: e.target.value } })}
            placeholder={"X:1\nT:Remix\nM:4/4\nL:1/8\nQ:1/4=96\nK:Am\n\"Am\" | ACEA cAEC | \"F\" FACF ..."}
            aria-label="ABC score"
          />
        </pre>
        <p className="mc-note">
          Nothing in this app reads the score musically. It is your text: no button here transposes, reharmonises or
          re-times it, because a half-correct automatic edit would produce notation that looks right and plays wrong.
        </p>

        <div className="mc-panel-h">
          <h3>Quick edits</h3>
          <p>Each one adds prose to the style line and tells you what the same change means in the score.</p>
        </div>
        <div className="mct-intents">
          {INTENTS.map((i) => (
            <button
              key={i.id}
              type="button"
              className={`mc-btn mc-btn-s ${i.id === intentId ? "mct-on" : ""}`}
              onClick={() => pickIntent(i.id)}
            >
              {i.label}
            </button>
          ))}
        </div>
        {intent && (
          <div className="mct-intent">
            <p className="mc-note">{intent.note}</p>
            <div className="mct-bar">
              <input
                className="mc-input"
                value={fragment}
                onChange={(e) => setFragment(e.target.value)}
                aria-label="Style line addition"
              />
              <button type="button" className="mc-btn" onClick={applyFragment} disabled={!fragment.trim()}>
                <Icon.Plus width={13} height={13} /> Add to the style line
              </button>
            </div>
          </div>
        )}

        <Field label="Style line" hint="genre, instruments, voice, BPM">
          <Text
            value={project.request.style}
            onChange={(style) => update({ request: { ...project.request, style } })}
            placeholder="English neo-soul, upright bass, brushed kit, Rhodes, warm male tenor, 96 BPM"
            rows={3}
          />
        </Field>

        <Field label="Lyrics" hint="every character is sung">
          <Text
            value={project.request.lyrics}
            onChange={(lyrics) => update({ request: { ...project.request, lyrics } })}
            placeholder={"[Verse]\n…"}
            rows={8}
          />
        </Field>
        <div className="mct-bar">
          <input
            className="mc-input"
            value={change}
            placeholder="what to change in the lyrics — e.g. make the chorus first person"
            onChange={(e) => setData({ change: e.target.value })}
          />
          <button
            type="button"
            className="mc-btn"
            onClick={() => void rewriteLyrics()}
            disabled={writer.busy || !project.request.lyrics.trim() || !change.trim()}
          >
            <Icon.Sparkles width={13} height={13} /> {writer.busy ? "Rewriting…" : "Rewrite the words"}
          </button>
        </div>
        <WriterNote engine={writer.engine} warning={writer.warning} error={writer.error} />
        {changedNote && <p className="mc-note">{changedNote}</p>}

        <div className="mct-bar">
          <label className="mct-inline">
            <span className="mc-field-l">Planning</span>
            <select
              className="mc-input mct-sel"
              value={cot}
              onChange={(e) => update({ request: { ...project.request, cot: e.target.value as PlanMode } })}
            >
              <option value="full">Score + harmony</option>
              <option value="melody">Melody only</option>
            </select>
          </label>
          <label className="mct-inline">
            <span className="mc-field-l">Seed</span>
            <input
              className="mc-input mct-sel"
              type="number"
              value={project.request.seed || DEFAULT_SEED}
              onChange={(e) => update({ request: { ...project.request, seed: Number(e.target.value) || DEFAULT_SEED } })}
            />
          </label>
          <button
            type="button"
            className="mc-btn mc-btn-go"
            onClick={rerender}
            disabled={blocked || busy || !abc.trim() || !project.request.style.trim()}
            title={blocked ? "The GPU server cannot render this right now" : undefined}
          >
            <Icon.Note width={14} height={14} /> Render this score
          </button>
        </div>
        <p className="mc-note">
          Score + harmony follows the chord symbols as well as the notes. Melody only follows the tune and writes its
          own accompaniment, which is what to use when the point of the remix is a different backing. A score cannot be
          rendered with planning off — there would be nothing to read it.
        </p>

        <Takes renders={scoreTakes} empty="No renders from this score yet." />
      </section>

      {/* ----- stems ----------------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>Stem separation</h3>
          <p>Split a recording into the voice and the rest. AuK does this on the GPU server.</p>
        </div>

        <div className="mct-bar">
          <label className="mc-btn mc-btn-s mct-file">
            <Icon.Upload width={13} height={13} /> Choose audio
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void takeFile(file);
                e.target.value = "";
              }}
            />
          </label>
          {SEPARATION_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`mc-btn mc-btn-s ${mode === m.id ? "mct-on" : ""}`}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </button>
          ))}
          <button
            type="button"
            className="mc-btn mc-btn-go"
            onClick={separate}
            disabled={!clip || busy}
          >
            <Icon.Target width={14} height={14} /> Separate
          </button>
        </div>

        {clip && (
          <div className="mct-clip">
            <Icon.Note width={13} height={13} />
            <strong>{clip.name}</strong>
            <span>{(clip.bytes / 1_000_000).toFixed(1)} MB</span>
            <audio controls preload="metadata" src={clip.dataUrl} />
            <button type="button" className="mc-btn mc-btn-s" onClick={() => setClip(null)}>
              Clear
            </button>
          </div>
        )}
        {localError && <p className="mc-note is-bad">{localError}</p>}
        <p className="mc-note">{SEPARATION_MODES.find((m) => m.id === mode)?.note}</p>
        <p className="mc-note">
          The file is read in this tab and sent to the server for the split; it is not saved into the project. Whatever
          the server says about the job — including that separation is not built on it — arrives as a take below.
        </p>

        <Takes renders={stemTakes} empty="No stems yet." />
      </section>
    </div>
  );
}
