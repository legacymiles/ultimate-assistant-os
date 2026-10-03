"use client";

// ---------------------------------------------------------------------------
// Remix — find a record, say what it should become, keep going.
//
// Search for a song, pick it off the catalogue, type "NY drill remix", and get
// a version back. Then say what to change and get the next one, in the same
// session, with every version still playable and downloadable. That is the
// whole tool, and the order of those four steps is the screen.
//
// ----- what a remix is here, exactly -----------------------------------------
//
// SheetSage2 writes the chosen record's melody down as a score; YuE2 performs
// that score inside the style the prompt asks for. The TUNE survives. The
// RECORDING does not — no drum hit, no voice, no sample of the original is in
// the output. That is the opposite of what "remix" means in a DJ's mouth, so
// the banner says it in as many words, every time.
//
// What IS made of the original audio is the stem rack: the separator can hand
// back the real vocal, the real kit, the real bass and the real instruments as
// separate files, to listen to or to carry into a DAW. Those are honest about
// being the record itself; the render is honest about not being.
//
// ----- why the presets are knowledge, not chrome ------------------------------
//
// A model asked for "drill" with no numbers will write 128 BPM over a
// four-on-the-floor kick, which is not drill. lib/music-creator/remix.ts holds
// the real tempo, kit and instrumentation of each named style, so the prompt
// arrives as a production rather than a genre tag — and when the ask is one
// this app does not know, it is passed through in the user's own words instead
// of being guessed at.
//
// ----- the score editor is still here ----------------------------------------
//
// Folded under Build, where it belongs: the score is what gets performed, so
// being able to read and edit it is the white-box part of this tool. Nothing
// here parses the ABC musically — no button transposes, reharmonises or
// re-times it, because a half-correct automatic edit produces notation that
// looks right and plays wrong, and the user would blame the model. The quick
// edits are honest about what they are: they rewrite the STYLE line, which is
// prose, and tell you what the same change means in the score.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import { hasEngine } from "@/lib/music-creator/client";
import type { SongPick } from "@/lib/music-creator/mashup";
import { peaksOf } from "@/lib/music-creator/peaks";
import {
  REMIX_PRESETS,
  bpmFrom,
  describeRemix,
  matchPreset,
  offlineRemixStyle,
  remixSongName,
} from "@/lib/music-creator/remix";
import { anyStems, readStemLib, stemsFor } from "@/lib/music-creator/stems";
import { DEFAULT_SEED } from "@/lib/music-creator/store";
import { BPM_MARKS, BPM_MAX, BPM_MIN, clampBpm, tempoFeel } from "@/lib/music-creator/tempo";
import { type ToolProps, toolById } from "@/lib/music-creator/tools";
import type { PlanMode, Render } from "@/lib/music-creator/types";
import { type MashupVersion, nextVersionNumber, readVersions } from "@/lib/music-creator/versions";
import { Scanner } from "../Scanner";
import { Field, ServerNotice, TakeActions, TakePlayer, Takes, Text, WriterNote, missingFor, useWriter } from "../parts";
import { type Lane, laneSignature, sealedPlate, wavePlate } from "../plates";
import { useStudio } from "../studio";
import { type SideClip, SongPicker } from "./SongPicker";
import { StemRack, useStemSplitter } from "./StemRack";
import "./tools.css";

/**
 * The quick edits on the score.
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
      "Tempo is in two places: the Q: line in the ABC header, and the BPM in the style line. Set both, and set them " +
      "to the same thing — when they disagree the result is neither.",
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

// ----- reading the opaque `data` bag ---------------------------------------

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

interface Score {
  stripped: string;
  full: string;
  warnings: string[];
}

function readScore(value: unknown): Score | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const full = str(v.full);
  const stripped = str(v.stripped) || full;
  if (!stripped) return undefined;
  return { stripped, full, warnings: Array.isArray(v.warnings) ? v.warnings.map(String) : [] };
}

function readPick(value: unknown): SongPick | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as SongPick;
  return { query: str(v.query), track: v.track, fileName: str(v.fileName) || undefined };
}

function readWarnings(meta: Record<string, unknown> | undefined): string[] {
  const raw = meta?.warnings;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

/** A score found on some other project's take, offered for loading. */
interface ScoreSource {
  key: string;
  project: string;
  label: string;
  abc: string;
}

// ---------------------------------------------------------------------------

export function RemixStems({ project, update, setData, patch }: ToolProps) {
  const { render, runAndFile, running, server, projects } = useStudio();
  const writer = useWriter();
  const tool = toolById("remix-stems");

  // The record's audio: this tab only. Projects sync as JSON rows, and a few
  // megabytes of base64 per project would stop the store saving at all.
  const [clip, setClip] = useState<SideClip | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState("");
  const [intentId, setIntentId] = useState<string | null>(null);
  const [fragment, setFragment] = useState("");

  const pick = readPick(project.data?.pick);
  const prompt = str(project.data?.prompt);
  const notes = str(project.data?.notes);
  const keepLyrics = project.data?.keepLyrics !== false;
  const score = readScore(project.data?.score);
  const bpmOverride = typeof project.data?.bpm === "number" ? clampBpm(project.data.bpm as number) : undefined;
  const stemLib = useMemo(() => readStemLib(project.data?.stemLib), [project.data?.stemLib]);
  const versions = useMemo(() => readVersions(project.data), [project.data]);
  const abc = str(project.request.abc);
  const cot: PlanMode = project.request.cot === "full" ? "full" : "melody";

  const songName = remixSongName(pick);
  const preset = matchPreset(prompt);
  const blocked = tool ? missingFor(tool, server).length > 0 : false;
  const busy = !!running || writer.busy;

  const separators = useMemo(
    () => ({ demucs: hasEngine(server, "demucs"), auk: hasEngine(server, "auk") }),
    [server],
  );
  const offers = useMemo(() => stemsFor(separators), [separators]);
  const noTranscriber = !!server?.reachable && !hasEngine(server, "sheetsage");

  /** The project as it is NOW, for writes that land after an `await`. */
  const live = useRef(project);
  useEffect(() => {
    live.current = project;
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    if (!clip) {
      setPeaks([]);
      return;
    }
    void peaksOf(`${clip.name}:${clip.bytes}`, clip.dataUrl).then((measured) => {
      if (!cancelled) setPeaks(measured);
    });
    return () => {
      cancelled = true;
    };
  }, [clip]);

  const { split, splitting } = useStemSplitter({
    projectId: project.id,
    clipFor: () => clip,
    nameFor: () => songName,
    patch,
    onError: setError,
  });

  // ----- step 2: read the melody off the record ----------------------------

  const transcribe = async () => {
    if (!clip) return;
    setError(null);
    const take = await runAndFile(
      project.id,
      "transcription",
      "jobs/transcribe",
      { audio_b64: clip.dataUrl, filename: clip.name, melody_only: true },
      `Score of ${songName}`,
    );
    if (!take || take.error) {
      if (take?.error) setError(take.error);
      return;
    }
    const full = str(take.meta?.abc);
    const stripped = str(take.meta?.stripped_abc) || full;
    if (!stripped) {
      setError("The transcription finished but produced no score.");
      return;
    }
    patch((now) => ({
      // `request.abc` is what actually gets performed, so a new transcription
      // must land there too — otherwise the box below would show one thing and
      // the render would use another.
      request: { ...now.request, abc: stripped },
      data: { ...(now.data ?? {}), score: { stripped, full, warnings: readWarnings(take.meta) } },
    }));
  };

  // ----- step 3: write the remix -------------------------------------------

  const plan = async () => {
    if (!prompt.trim()) return;
    setError(null);
    const result = await writer.run("remix-plan", {
      prompt,
      track: pick ? describeTrack(pick) : songName,
      plan: describeRemix({ pick, prompt, keepLyrics, hasScore: !!score || !!abc, bpm: bpmOverride }).join("\n"),
      preset: preset ? `${preset.label}: ${preset.style}, typically ${preset.bpm} BPM` : "",
      // The offline draft has no producer in it; hand it the one style line
      // this app can honestly assemble rather than letting it answer nothing.
      style: offlineRemixStyle(prompt, bpmOverride),
      lyrics: keepLyrics ? project.request.lyrics : "",
      title: project.title === "Untitled" ? "" : project.title,
    });
    if (!result) return;
    const style = str(result.style);
    const lyrics = str(result.lyrics);
    const title = str(result.title);
    patch((now) => ({
      title: now.title && now.title !== "Untitled" ? now.title : title || now.title,
      request: { ...now.request, style: style || now.request.style, lyrics: lyrics || now.request.lyrics },
      data: { ...(now.data ?? {}), notes: str(result.notes) },
    }));
  };

  // ----- step 4: render it, and keep rendering ------------------------------

  /** Append a finished attempt to the session, newest last in storage. */
  const fileVersion = (take: Render, entry: Omit<MashupVersion, "n" | "renderId" | "at">) => {
    patch((now) => {
      const existing = readVersions(now.data);
      return {
        data: {
          ...(now.data ?? {}),
          versions: [
            ...existing,
            { ...entry, n: nextVersionNumber(existing), renderId: take.id, at: Date.now() },
          ],
        },
      };
    });
  };

  const renderVersion = async (changeNote: string, text?: { style: string; lyrics: string }) => {
    setError(null);
    const now = live.current;
    const style = text?.style ?? now.request.style;
    const lyrics = text?.lyrics ?? now.request.lyrics;
    if (!style.trim()) {
      setError("A remix needs a style line — say what it should become and press Write the remix.");
      return;
    }
    const n = nextVersionNumber(readVersions(now.data));
    const take = await render(
      project.id,
      {
        style,
        lyrics,
        cot,
        seed: now.request.seed || DEFAULT_SEED,
        // The score is what makes this a remix of that record rather than a new
        // song in that style. Sent when there is one; honestly absent when not.
        abc: now.request.abc || score?.stripped || null,
        cfg_scale: now.request.cfg_scale ?? null,
      },
      `v${n} · ${(changeNote || now.title || "Remix").slice(0, 40)}`,
    );
    if (!take || take.error) {
      if (take?.error) setError(take.error);
      return;
    }
    fileVersion(take, { title: now.title || "Remix", change: changeNote, method: "generated", style, lyrics });
  };

  /**
   * The user heard it and asked for one more change.
   *
   * The model is given the style and lyrics that actually produced the last
   * version, not whatever is in the boxes — otherwise a half-finished manual
   * edit would be revised as if it were the record they heard.
   */
  const revise = async () => {
    if (!change.trim()) return;
    setError(null);
    const last = versions[0];
    const now = live.current;
    const result = await writer.run("remix-revise", {
      change,
      style: last?.style || now.request.style,
      lyrics: last?.lyrics || now.request.lyrics,
      track: pick ? describeTrack(pick) : songName,
      prompt,
    });
    if (!result) return;
    const style = str(result.style) || now.request.style;
    const lyrics = str(result.lyrics) || now.request.lyrics;
    const changed = str(result.changed) || change.trim();
    patch((current) => ({
      request: { ...current.request, style, lyrics },
      data: { ...(current.data ?? {}), notes: changed },
    }));
    // The render reads `live.current`, which the patch above has not reached
    // yet, so hand it the fresh text directly.
    await renderVersion(changed, { style, lyrics });
    setChange("");
  };

  /**
   * Perform an old version's recipe again on a new seed.
   *
   * YuE2 is deterministic: the same style, lyrics, score and seed give back the
   * same file byte for byte, so reusing the version's seed would hand over a
   * duplicate while claiming to be another take of it.
   */
  const rerender = async (version: MashupVersion) => {
    setError(null);
    const now = live.current;
    const n = nextVersionNumber(readVersions(now.data));
    const take = await render(
      project.id,
      {
        style: version.style,
        lyrics: version.lyrics,
        cot,
        seed: Math.floor(Math.random() * 1_000_000) + 1,
        abc: now.request.abc || score?.stripped || null,
        cfg_scale: now.request.cfg_scale ?? null,
      },
      `v${n} · another take of v${version.n}`,
    );
    if (!take || take.error) {
      if (take?.error) setError(take.error);
      return;
    }
    fileVersion(take, {
      title: version.title,
      change: `another take of v${version.n}`,
      method: "generated",
      style: version.style,
      lyrics: version.lyrics,
    });
  };

  // ----- the score editor's own bits ---------------------------------------

  /** Every score this browser already has, wherever it came from. */
  const sources = useMemo<ScoreSource[]>(() => {
    const out: ScoreSource[] = [];
    for (const p of projects) {
      for (const r of p.renders) {
        const found = str(r.meta?.stripped_abc) || str(r.meta?.abc) || str(r.meta?.score);
        if (found.trim()) out.push({ key: `${p.id}:${r.id}`, project: p.title || "Untitled", label: r.label, abc: found });
      }
    }
    return out;
  }, [projects]);

  const intent = INTENTS.find((i) => i.id === intentId) ?? null;

  const applyFragment = () => {
    const text = fragment.trim();
    if (!text) return;
    const current = project.request.style.trim();
    update({ request: { ...project.request, style: current ? `${current}, ${text}` : text } });
  };

  // ----- the plate ----------------------------------------------------------

  const lanes: Lane[] = [
    {
      name: pick ? songName : "No record chosen yet",
      peaks,
      note: clip
        ? clip.preview
          ? "30-second catalogue preview"
          : `whole file · ${(clip.bytes / 1_000_000).toFixed(1)} MB`
        : "search for a record below",
    },
  ];

  const named = !!(pick?.track || pick?.fileName || pick?.query);
  const canRender = !!project.request.style.trim() && !!project.request.lyrics.trim();
  const stemTakes = project.renders.filter((r) => r.kind === "stem");

  return (
    <div className="mct">
      <Scanner
        base={sealedPlate(lanes, "DRAG ACROSS THE PLATE TO READ THE RECORD")}
        reveal={wavePlate(lanes, "MEASURED IN THIS BROWSER · RMS PER BUCKET")}
        signature={laneSignature(lanes, prompt.slice(0, 40))}
        height={192}
        rim={[0.39, 0.82, 1]}
        label="The waveform of the record being remixed, revealed by moving the pointer across the plate"
      >
        <div className="mct-plate-over">
          <strong>Remix</strong>
          <span>
            {preset ? `${preset.label} · ${preset.bpm} BPM` : "One record, one sentence, and the next version of it."}
          </span>
        </div>
      </Scanner>

      <p className="mc-note is-warn">
        <strong>This builds a new recording, not an edit of the old one.</strong> The record&apos;s melody is written
        down as a score and performed by YuE2 in the style you ask for. No original audio survives it — not the
        singers, not their voices, not a single drum hit. The <em>parts of the record</em> panel below is the one place
        the real audio shows up, as separated stems you can play and download.
      </p>

      {tool && <ServerNotice tool={tool} />}

      {/* ----- 1. the record ---------------------------------------------- */}
      <SongPicker
        side="a"
        // One record here, so no A/B letter: it would label a distinction
        // nobody on this screen is making.
        badge={null}
        empty="No record chosen yet"
        role="The record being remixed. Its melody is what survives into the new version."
        pick={pick}
        clip={clip}
        busy={busy}
        onPick={(p) => setData({ pick: p })}
        onClip={setClip}
      />

      {/* ----- 2. what it should become ----------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>What should it become?</h3>
          <p>
            Say it the way you would say it out loud — &ldquo;NY drill remix&rdquo;, &ldquo;make it a slow country
            ballad&rdquo;. The styles below are ones this app knows the real tempo and arrangement of, so tapping one
            sends a production rather than a genre tag.
          </p>
        </div>

        <div className="mct-presets">
          {REMIX_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`mct-preset ${preset?.id === p.id ? "is-on" : ""}`}
              onClick={() => setData({ prompt: p.prompt })}
              disabled={busy}
              title={`${p.style} · typically ${p.bpm} BPM`}
            >
              {p.label}
              <i>{p.bpm}</i>
            </button>
          ))}
        </div>

        <Field label="Your remix" hint="a style, plus anything else about how it should sound">
          <Text
            value={prompt}
            onChange={(v) => setData({ prompt: v })}
            placeholder="NY drill remix, keep the chorus melody but make the verses darker"
            rows={2}
          />
        </Field>
        <Field label="Name this remix" hint="the project, and the name every version is filed under">
          <Text
            value={project.title === "Untitled" ? "" : project.title}
            onChange={(v) => update({ title: v || "Untitled" })}
            placeholder="Untitled"
          />
        </Field>

        <div className="mct-opts">
          <button
            type="button"
            className={`mct-opt ${keepLyrics ? "is-on" : ""}`}
            onClick={() => setData({ keepLyrics: true })}
            disabled={busy}
          >
            <strong>Keep the words</strong>
            <span>Same subject, same voice, re-written to fit the new groove. Never the original lines verbatim.</span>
          </button>
          <button
            type="button"
            className={`mct-opt ${keepLyrics ? "" : "is-on"}`}
            onClick={() => setData({ keepLyrics: false })}
            disabled={busy}
          >
            <strong>New words</strong>
            <span>Written for this version from your prompt.</span>
          </button>
        </div>

        {/* The tempo override: the slider, with the landmarks on it. */}
        <div className="mct-bpm">
          <div className="mct-bpm-h">
            <span className="mc-field-l">Tempo</span>
            <input
              className="mc-input mct-bpm-n"
              type="number"
              min={BPM_MIN}
              max={BPM_MAX}
              value={bpmOverride ?? bpmFrom(prompt) ?? preset?.bpm ?? 120}
              onChange={(e) => setData({ bpm: clampBpm(Number(e.target.value)) })}
              aria-label="Tempo in BPM"
            />
            <em>BPM</em>
            {bpmOverride !== undefined && (
              <button type="button" className="mc-btn mc-btn-s" onClick={() => setData({ bpm: null })}>
                Use the style&apos;s own
              </button>
            )}
          </div>
          <input
            className="mct-bpm-s"
            type="range"
            min={BPM_MIN}
            max={BPM_MAX}
            step={1}
            value={bpmOverride ?? bpmFrom(prompt) ?? preset?.bpm ?? 120}
            onChange={(e) => setData({ bpm: clampBpm(Number(e.target.value)) })}
            aria-label="Tempo in BPM"
          />
          <div className="mct-bpm-marks">
            {BPM_MARKS.map((mark) => (
              <button
                key={mark.bpm}
                type="button"
                className={(bpmOverride ?? preset?.bpm) === mark.bpm ? "is-on" : ""}
                onClick={() => setData({ bpm: mark.bpm })}
                title={`${mark.label} — ${mark.bpm} BPM`}
              >
                {mark.label}
              </button>
            ))}
          </div>
          <p className="mc-note">
            {bpmOverride === undefined
              ? `Not set, so the style decides: ${tempoFeel(bpmFrom(prompt) ?? preset?.bpm ?? 120)}`
              : tempoFeel(bpmOverride)}
          </p>
        </div>

        <details className="mct-fold">
          <summary>The plan, as it will be sent</summary>
          <ul className="mct-plan">
            {describeRemix({ pick, prompt, keepLyrics, hasScore: !!score || !!abc, bpm: bpmOverride }).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>

        {error && <p className="mc-note is-bad">{error}</p>}
      </section>

      {/* ----- 3. the parts of the record --------------------------------- */}
      <section className="mc-panel" id="mct-rack">
        <div className="mc-panel-h">
          <h3>The parts of the record</h3>
          <p>
            The real audio, separated. Play the vocal on its own to hear what the melody actually does, or pull the kit
            out to carry into a DAW. This is the one panel made of the original recording rather than of a new one.
          </p>
        </div>
        {/* A server that has not answered is not a server without a separator. */}
        {!server?.reachable ? (
          <p className="mc-note">
            The GPU server has not answered yet, so which parts it can separate is not known. The rack fills in as soon
            as it does — rendering wakes it, or press <em>Wake it now</em> above.
          </p>
        ) : anyStems(separators) ? (
          <StemRack
            sides={[{ side: "a", name: songName, hasAudio: !!clip, preview: clip?.preview }]}
            lib={stemLib}
            offers={offers}
            renders={project.renders}
            busy={busy}
            splitting={splitting}
            onSplit={(side, stemId) => void split(side, stemId)}
          />
        ) : (
          <p className="mc-note is-warn">
            Separation needs a separator. The GPU server this hub points at has neither Demucs (vocals, drums, bass and
            instruments as four files) nor AuK (the voice, and everything that is not the voice). Everything else on
            this screen still works.
          </p>
        )}
        <Takes renders={stemTakes} empty="No stems split yet." />
      </section>

      {/* ----- 4. build it ------------------------------------------------ */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>Build it</h3>
          <p>Read the melody, write the remix, render. Each step remembers what it did.</p>
        </div>

        <div className="mct-step-row">
          <div className="mct-step-n">1</div>
          <div className="mct-step-b">
            <strong>Read the melody off {songName}</strong>
            <p className="mc-note">
              SheetSage2 writes the tune down as an ABC score, and that score is what gets performed. Without it this
              is not a remix of anything — YuE2 would write its own tune in the style you asked for.
            </p>
            <div className="mct-bar">
              <button
                type="button"
                className="mc-btn mc-btn-go"
                onClick={() => void transcribe()}
                disabled={!clip || busy || noTranscriber}
                title={
                  noTranscriber
                    ? "This server has no SheetSage2, so it cannot transcribe"
                    : !clip
                      ? "No audio loaded on this device"
                      : undefined
                }
              >
                <Icon.Layers width={14} height={14} /> {score ? "Transcribe again" : "Transcribe the melody"}
              </button>
              {sources.length > 0 && (
                <label className="mct-inline">
                  <span className="mc-field-l">or load a score</span>
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
            </div>
            {noTranscriber && (
              <p className="mc-note is-warn">
                The GPU server is up but has no SheetSage2 installed, so it cannot read a melody off a recording.
                Everything else still works — paste an ABC score into the box below, or load one from another project,
                and render as normal.
              </p>
            )}
            {!clip && !abc && (
              <p className="mc-note is-warn">
                No audio in this tab. Pick a record above — audio is never saved into the project, so it needs loading
                again after a reload.
              </p>
            )}
          </div>
        </div>

        {score?.warnings.length ? (
          <div className="mc-note is-warn mct-warns">
            <strong>SheetSage2 reported this about {songName}:</strong>
            <ul>
              {score.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <p>A transcription error carries straight through: YuE2 performs whatever these notes say, confidently.</p>
          </div>
        ) : null}

        <details className="mct-fold" open={!!abc && !score}>
          <summary>
            {score ? "The melody score — edit it if you want" : "The melody score — paste one in, or transcribe above"}
          </summary>
          <pre className="mc-mono mct-pre">
            <textarea
              className="mct-score"
              rows={14}
              spellCheck={false}
              value={abc}
              onChange={(e) => update({ request: { ...project.request, abc: e.target.value } })}
              placeholder={'X:1\nT:Remix\nM:4/4\nL:1/8\nQ:1/4=96\nK:Am\n"Am" | ACEA cAEC | "F" FACF …'}
              aria-label="ABC score"
            />
          </pre>
          <p className="mc-note">
            Nothing in this app reads the score musically. It is your text: no button here transposes, reharmonises or
            re-times it, because a half-correct automatic edit would produce notation that looks right and plays wrong.
          </p>

          <div className="mct-intents">
            {INTENTS.map((i) => (
              <button
                key={i.id}
                type="button"
                className={`mc-btn mc-btn-s ${i.id === intentId ? "mct-on" : ""}`}
                onClick={() => {
                  setIntentId(i.id);
                  setFragment(i.fragment);
                }}
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
        </details>

        <div className="mct-step-row">
          <div className="mct-step-n">2</div>
          <div className="mct-step-b">
            <strong>Write the remix</strong>
            <p className="mc-note">
              Your prompt and the plan above go to the writer as instructions, not suggestions. It answers with the one
              line YuE2 reads and a lyric sheet that fits the melody&apos;s phrasing.
            </p>
            <div className="mct-bar">
              <button
                type="button"
                className="mc-btn mc-btn-go"
                onClick={() => void plan()}
                disabled={!prompt.trim() || !named || busy}
              >
                <Icon.Sparkles width={14} height={14} /> {writer.busy ? "Writing…" : "Write the remix"}
              </button>
              {!named && <span className="mc-note mct-quiet">Choose a record first.</span>}
              {named && !prompt.trim() && <span className="mc-note mct-quiet">Say what it should become first.</span>}
            </div>
            <WriterNote engine={writer.engine} warning={writer.warning} error={writer.error} />
            {notes && <p className="mc-note">{notes}</p>}
          </div>
        </div>

        <Field label="Style line" hint="sent to YuE2 as-is">
          <Text
            value={project.request.style}
            onChange={(style) => update({ request: { ...project.request, style } })}
            placeholder="New York drill, sliding 808s, skeletal hats, dark minor piano loop, deadpan rap, 140 BPM"
            rows={3}
          />
        </Field>
        <Field label="Lyrics" hint="every character is sung">
          <Text
            value={project.request.lyrics}
            onChange={(lyrics) => update({ request: { ...project.request, lyrics } })}
            placeholder={"[Verse]\nwords that fit the melody's phrasing"}
            rows={8}
          />
        </Field>
        <p className="mc-note">
          The melody is fixed by the score, so lines that do not match its phrasing get stretched or crushed to fit.
          Counting syllables against the original is not fussiness here.
        </p>

        <div className="mct-step-row">
          <div className="mct-step-n">3</div>
          <div className="mct-step-b">
            <strong>Render it</strong>
            <div className="mct-bar">
              <button
                type="button"
                className="mc-btn mc-btn-go"
                onClick={() => void renderVersion(versions.length ? "another render" : "")}
                disabled={!canRender || busy || blocked}
              >
                <Icon.Note width={14} height={14} />{" "}
                {versions.length ? `Render v${nextVersionNumber(versions)}` : "Make the remix"}
              </button>
              <label className="mct-inline">
                <span className="mc-field-l">Planning</span>
                <select
                  className="mc-input mct-sel"
                  value={cot}
                  onChange={(e) => update({ request: { ...project.request, cot: e.target.value as PlanMode } })}
                >
                  <option value="melody">Melody only</option>
                  <option value="full">Score + harmony</option>
                </select>
              </label>
              <label className="mct-inline">
                <span className="mc-field-l">Seed</span>
                <input
                  className="mc-input mct-sel"
                  type="number"
                  value={project.request.seed || DEFAULT_SEED}
                  onChange={(e) =>
                    update({ request: { ...project.request, seed: Number(e.target.value) || DEFAULT_SEED } })
                  }
                />
              </label>
            </div>
            <p className="mc-note">
              Melody only follows the tune and writes its own accompaniment, which is what a remix usually wants: the
              whole point is a different backing. Score + harmony also follows the original&apos;s chord symbols, so
              use it when the harmony is the thing you want kept.
            </p>
            {!canRender && (
              <p className="mc-note">Needs a style line and lyrics. Press <em>Write the remix</em> above, or type them in.</p>
            )}
          </div>
        </div>
      </section>

      {/* ----- 5. the session --------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>This session</h3>
          <p>
            Every version stays here, plays from your account and downloads on its own. Asking for another change adds
            the next version — it never replaces the one you already have.
          </p>
        </div>

        {versions.length > 0 && (
          <div className="mct-revise">
            <Field label="Change it again" hint="say what to fix, and the next version comes back">
              <Text
                value={change}
                onChange={setChange}
                placeholder="drop it to 130, make the hook bigger, lose the second verse"
                rows={2}
              />
            </Field>
            <div className="mct-bar">
              <button
                type="button"
                className="mc-btn mc-btn-go"
                onClick={() => void revise()}
                disabled={!change.trim() || busy || blocked}
              >
                <Icon.Sparkles width={14} height={14} />{" "}
                {writer.busy ? "Rewriting…" : `Make v${nextVersionNumber(versions)}`}
              </button>
              <span className="mc-note mct-quiet">
                Revises the style line and lyrics of the version you last heard, then renders again.
              </span>
            </div>
          </div>
        )}

        <Versions
          versions={versions}
          renders={project.renders}
          projectId={project.id}
          onRerender={(v) => void rerender(v)}
          busy={busy || blocked}
        />
      </section>
    </div>
  );
}

/** Everything known about the record, for the writer's turn. */
function describeTrack(pick: SongPick): string {
  const t = pick.track;
  if (!t) return pick.fileName || pick.query;
  const bits = [`"${t.title}" by ${t.artist}`];
  if (t.album) bits.push(`from "${t.album}"`);
  if (t.releaseYear) bits.push(`(${t.releaseYear})`);
  return bits.join(" ");
}

/**
 * Every finished attempt in this session, newest first.
 *
 * Each row carries the exact text that produced it, so a version is a
 * reproducible recipe rather than just a file — which is why "another take" is
 * offered per row: going back to v2 and trying a different seed is the most
 * common thing anybody does here.
 */
function Versions({
  versions,
  renders,
  projectId,
  onRerender,
  busy,
}: {
  versions: MashupVersion[];
  renders: Render[];
  projectId: string;
  onRerender: (version: MashupVersion) => void;
  busy: boolean;
}) {
  if (!versions.length) {
    return <p className="mc-empty">No versions yet. Choose a record, say what it should become, and render.</p>;
  }

  return (
    <ul className="mct-versions">
      {versions.map((version) => {
        const render = renders.find((r) => r.id === version.renderId);
        return (
          <li key={version.renderId} className={`mct-version ${render?.error ? "is-bad" : ""}`}>
            <div className="mct-version-h">
              <span className="mct-vn">v{version.n}</span>
              <strong>{version.change || "the first version"}</strong>
              <time>{new Date(version.at).toLocaleString()}</time>
            </div>

            {!render ? (
              <p className="mc-take-err">This version&apos;s take is no longer on the project.</p>
            ) : render.error ? (
              <p className="mc-take-err">{render.error}</p>
            ) : render.fileId || render.saved ? (
              <>
                <TakePlayer render={render} />
                <div className="mc-take-f">
                  <TakeActions projectId={projectId} render={render} />
                  <button
                    type="button"
                    className="mc-btn mc-btn-s"
                    onClick={() => onRerender(version)}
                    disabled={busy}
                    title="Same words, same sound, new seed — a different performance of this version's recipe"
                  >
                    <Icon.Refresh width={12} height={12} /> Another take of this
                  </button>
                </div>
              </>
            ) : (
              <p className="mc-take-err">The job finished without producing a file.</p>
            )}

            {version.style && (
              <details className="mct-fold mct-version-r">
                <summary>What made this version</summary>
                <p className="mc-note">
                  <strong>Style:</strong> {version.style}
                </p>
                {version.lyrics && <pre className="mc-mono mct-pre mct-ro">{version.lyrics}</pre>}
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
