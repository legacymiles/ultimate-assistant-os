"use client";

// ---------------------------------------------------------------------------
// Mashup — two records in, one session out.
//
// Name two songs, say how they should be combined, and get a song back. Then
// tell it what to change and get the next version back, in the same session,
// with every version still playable and downloadable. That is the whole tool.
//
// ----- the two routes, and why the screen makes you pick ---------------------
//
// There is no single operation called "mash up two songs" in this stack. There
// are two, they produce genuinely different objects, and a button that quietly
// chose between them would be lying about what the user is about to get. So
// the screen names both:
//
//   GENERATED (YuE2). SheetSage2 transcribes one song's melody into a readable
//   score; YuE2 performs that score inside a style line assembled from both
//   records. Every knob on the blend panel is live, because every knob is
//   either a clause in that style line or a decision about the score. Nothing
//   of either original RECORDING is in the output — not a drum hit, not a
//   voice. What crosses over is musical information.
//
//   LAYERED (AuK + ffmpeg). One record is split into its vocal, the other into
//   its backing, and the two are laid on top of each other. This is the literal
//   DJ mashup, made of the real audio. It is also blunt: nothing here
//   beat-matches, key-matches or time-stretches, so it lands when the two songs
//   already sit near the same tempo and key and drifts when they do not. The
//   knobs that cannot mean anything on this route are disabled, not hidden —
//   `appliesTo` in lib/music-creator/mashup.ts decides, and the disabled
//   control says why.
//
// ----- hearing the parts before deciding anything ----------------------------
//
// Every question the blend panel asks ("whose drums?") is unanswerable until
// you have heard both records' drums on their own, so the rack sits above the
// panel: stems down the side, A and B across the top, one click per cell, one
// player for the whole grid so pressing B while A plays swaps rather than
// stacks. Which stems exist is decided by the server's own /health — Demucs
// splits a record four ways, AuK two — and a stem this server cannot make is
// shown as impossible rather than filled in with something adjacent.
//
// The separations are cached per side in `data.stemLib`, and the layered route
// reads the same cache, so a mashup built after a comparison costs no GPU at
// all.
//
// ----- one session, many versions --------------------------------------------
//
// A revision never opens a new project. Rendering appends a `MashupVersion`
// holding the exact style and lyrics that produced it, so v2 does not destroy
// v1: both stay in the list, both play from the account's library, both
// download, and any of them can be sent back to the GPU unchanged. The
// alternative — overwriting the take — would make "make the chorus bigger" a
// one-way door, and the whole point of prompting for changes is that it is not.
//
// ----- what persists ----------------------------------------------------------
//
// Audio for the two sides lives in React state and never enters `project.data`.
// Projects sync as JSON rows; two songs of base64 per project would either blow
// the row or stop the store saving at all. Scores, choices, version records and
// server file ids are text, and those are what survive a reload.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import { ensureServer, hasEngine, mix, searchArtist } from "@/lib/music-creator/client";
import {
  type BlendSpec,
  ELEMENTS,
  type ElementId,
  type MashupMethod,
  type MashupVersion,
  type Side,
  type SongPick,
  appliesTo,
  blendBrief,
  chordsFromAbc,
  defaultBlend,
  describeBlend,
  describeSong,
  dominanceLine,
  nameOf,
  nextVersionNumber,
  offlineMashupStyle,
  readVersions,
  shortName,
} from "@/lib/music-creator/mashup";
import { peaksOf } from "@/lib/music-creator/peaks";
import {
  ELEMENT_STEM,
  type StemLib,
  anyStems,
  findCut,
  layeredPair,
  readStemLib,
  stemById,
  stemsFor,
} from "@/lib/music-creator/stems";
import { DEFAULT_SEED } from "@/lib/music-creator/store";
import { BPM_MARKS, BPM_MAX, BPM_MIN, clampBpm, tempoFeel } from "@/lib/music-creator/tempo";
import { type ToolProps, toolById } from "@/lib/music-creator/tools";
import type { Project, Render } from "@/lib/music-creator/types";
import { Scanner } from "../Scanner";
import { Field, ServerNotice, TakeActions, TakePlayer, Text, WriterNote, missingFor, useWriter } from "../parts";
import { type Lane, laneSignature, sealedPlate, wavePlate } from "../plates";
import { useStudio } from "../studio";
import { type SideClip, SongPicker } from "./SongPicker";
import { StemRack, useStemSplitter } from "./StemRack";
import "./tools.css";

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

function readBlend(value: unknown): BlendSpec {
  const base = defaultBlend();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<BlendSpec>;
  return {
    ...base,
    ...v,
    dominance: Math.min(100, Math.max(0, Number(v.dominance ?? base.dominance) || 0)),
  };
}

/** Whatever shape a transcribe job reported its warnings in. */
function readWarnings(meta: Record<string, unknown> | undefined): string[] {
  const raw = meta?.warnings;
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

/** What a side is actually holding, for the plate's second line. */
function clipNote(clip: SideClip | null): string {
  if (!clip) return "no audio loaded in this tab";
  if (clip.preview) return "30-second catalogue preview";
  return `whole file · ${(clip.bytes / 1_000_000).toFixed(1)} MB`;
}

interface Stems {
  vocalFileId?: string;
  vocalFrom?: Side;
  musicFileId?: string;
  musicFrom?: Side;
}

function readStems(value: unknown): Stems {
  return value && typeof value === "object" ? (value as Stems) : {};
}

// ---------------------------------------------------------------------------

export function Mashup({ project, update, setData, patch }: ToolProps) {
  const { render, runAndFile, addRender, running, server } = useStudio();
  const writer = useWriter();
  const tool = toolById("mashup");

  // The two sides' audio: this tab only, deliberately (see the header note).
  const [clips, setClips] = useState<{ a: SideClip | null; b: SideClip | null }>({ a: null, b: null });
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [mixing, setMixing] = useState(false);
  const [change, setChange] = useState("");
  /** Measured envelopes of the two clips, for the scanner's hidden layer. */
  const [peaks, setPeaks] = useState<Record<Side, number[]>>({ a: [], b: [] });

  const prompt = str(project.data?.prompt);
  const notes = str(project.data?.notes);
  const pickA = readPick(project.data?.pickA);
  const pickB = readPick(project.data?.pickB);
  const blend = readBlend(project.data?.blend);
  const method: MashupMethod = project.data?.method === "layered" ? "layered" : "generated";
  const scores: Record<Side, Score | undefined> = {
    a: readScore(project.data?.scoreA),
    b: readScore(project.data?.scoreB),
  };
  const stems = readStems(project.data?.stems);
  const stemLib = useMemo(() => readStemLib(project.data?.stemLib), [project.data?.stemLib]);
  const versions = useMemo(() => readVersions(project.data), [project.data]);

  /**
   * What this server can separate. Read from its own /health rather than
   * assumed: Demucs splits four ways, AuK two, and the rack shows exactly the
   * rows that are real on the box this hub points at.
   */
  const separators = useMemo(
    () => ({ demucs: hasEngine(server, "demucs"), auk: hasEngine(server, "auk") }),
    [server],
  );
  const offers = useMemo(() => stemsFor(separators), [separators]);

  const aName = nameOf(pickA, "a");
  const bName = nameOf(pickB, "b");
  const blocked = tool ? missingFor(tool, server).length > 0 : false;
  const busy = !!running || writer.busy || finding || mixing;

  /**
   * The project as it is NOW, not as it was when a button was pressed.
   *
   * Transcription and rendering run for minutes and the user keeps typing while
   * they do. Every write that lands after an `await` merges into this, so
   * finishing a job cannot silently undo edits made while it ran.
   */
  const live = useRef(project);
  useEffect(() => {
    live.current = project;
  }, [project]);

  /**
   * Measure each clip once it is loaded.
   *
   * The scanner reveals the real envelope of the real file, so this is the one
   * place the waveform comes from. It is cached by clip identity in peaks.ts,
   * so a blend change repaints the plate without decoding anything again.
   */
  useEffect(() => {
    let cancelled = false;
    for (const side of ["a", "b"] as Side[]) {
      const clip = clips[side];
      if (!clip) {
        setPeaks((prev) => (prev[side].length ? { ...prev, [side]: [] } : prev));
        continue;
      }
      void peaksOf(`${clip.name}:${clip.bytes}`, clip.dataUrl).then((measured) => {
        if (!cancelled) setPeaks((prev) => ({ ...prev, [side]: measured }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [clips]);

  // ----- step 1: find the two songs ----------------------------------------

  /**
   * Turn one sentence into two chosen records.
   *
   * The model only ever produces SEARCH QUERIES here; the catalogue decides
   * what the songs actually are. That ordering matters — a model asked to name
   * a track will occasionally invent a plausible one, and a catalogue lookup
   * cannot invent anything. What the user confirms is a real record with a real
   * artist, year and preview.
   */
  const findSongs = async () => {
    if (!prompt.trim()) return;
    setFinding(true);
    setError(null);
    try {
      const result = await writer.run("mashup-find", { prompt, brief: prompt });
      if (!result) return;
      const queries: Record<Side, string> = { a: str(result.songA), b: str(result.songB) };
      const title = str(result.title);
      const brief = str(result.brief);

      const found: Record<string, unknown> = {};
      for (const side of ["a", "b"] as Side[]) {
        const query = queries[side];
        if (!query) continue;
        const key = side === "a" ? "pickA" : "pickB";
        let pick: SongPick = { query };
        try {
          const { tracks } = await searchArtist(query);
          // The first hit with a preview, so the next step has audio to work
          // with; a hit without one is still better than nothing.
          const best = tracks.find((t) => t.previewUrl) ?? tracks[0];
          if (best) pick = { query, track: best };
        } catch {
          // A catalogue that is down must not lose the query the model read.
        }
        found[key] = pick;
      }

      const now = live.current;
      update({
        title: now.title && now.title !== "Untitled" ? now.title : title || now.title,
        data: { ...(now.data ?? {}), ...found, brief: brief || str(now.data?.brief) },
      });
      if (!queries.b) {
        setError(
          `Only one song was named in that. "${queries.a || prompt}" is set as A — name the second one, or search for it below.`,
        );
      }
    } finally {
      setFinding(false);
    }
  };

  /** Pull each chosen track's preview clip, for the sides that have none yet. */
  const loadPreviews = async () => {
    setError(null);
    for (const [side, pick] of [
      ["a", pickA],
      ["b", pickB],
    ] as [Side, SongPick | undefined][]) {
      if (clips[side] || !pick?.track?.previewUrl) continue;
      try {
        const res = await fetch(`/api/music-creator/artist?preview=${encodeURIComponent(pick.track.previewUrl)}`);
        if (!res.ok) continue;
        const blob = await res.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(String(reader.result ?? ""));
          reader.onerror = () => reject(new Error("That clip could not be read."));
          reader.readAsDataURL(blob);
        });
        const name = `${pick.track.artist} — ${pick.track.title} (30s preview)`;
        setClips((prev) => ({ ...prev, [side]: { dataUrl, name, bytes: blob.size, preview: true } }));
      } catch (err) {
        setError((err as Error).message);
      }
    }
  };

  // ----- step 2: get a score out of a record -------------------------------

  /**
   * Transcribe one side's audio into an ABC score.
   *
   * Kept per side and cached in the project, so flipping "melody from A" to
   * "melody from B" does not spend another five GPU minutes on a record that
   * has already been read. The stripped score (melody, no chord symbols) is
   * what melody mode gets; the full one is kept beside it because that is where
   * the chord progression comes from.
   */
  const transcribe = async (side: Side) => {
    const clip = clips[side];
    if (!clip) return;
    setError(null);
    const take = await runAndFile(
      project.id,
      "transcription",
      "jobs/transcribe",
      { audio_b64: clip.dataUrl, filename: clip.name, melody_only: true },
      `Score of ${side === "a" ? aName : bName}`,
    );
    if (!take || take.error) {
      if (take?.error) setError(take.error);
      return;
    }
    const meta = take.meta;
    const full = str(meta?.abc);
    const stripped = str(meta?.stripped_abc) || full;
    if (!stripped) {
      setError("The transcription finished but produced no score.");
      return;
    }
    const key = side === "a" ? "scoreA" : "scoreB";
    patch((now) => ({
      // `request.abc` is what actually gets performed, so reading a new melody
      // must load it there. Without this the score box below would show one
      // thing and the render would use another, and an edit made in it would
      // silently do nothing.
      request: side === readBlend(now.data?.blend).melody ? { ...now.request, abc: stripped } : now.request,
      data: { ...(now.data ?? {}), [key]: { stripped, full, warnings: readWarnings(meta) } },
    }));
  };

  // ----- the stem rack ------------------------------------------------------

  /**
   * One separator behind both the rack and the layered mashup, so a vocal split
   * for a comparison is the same file the mix is later built from — the GPU is
   * never asked for the same separation twice.
   */
  const { split: splitStem, splitting } = useStemSplitter({
    projectId: project.id,
    clipFor: (side) => clips[side],
    nameFor: (side) => (side === "a" ? aName : bName),
    patch,
    onError: setError,
  });

  const melodyScore = scores[blend.melody];
  const harmonyScore = blend.harmony === "model" ? undefined : scores[blend.harmony];
  const progression = useMemo(
    () => (harmonyScore ? chordsFromAbc(harmonyScore.full || harmonyScore.stripped) : []),
    [harmonyScore],
  );

  // ----- step 3: write the plan --------------------------------------------

  const plan = async () => {
    setError(null);
    const result = await writer.run("mashup-blend", {
      prompt,
      trackA: describeSong(pickA, "a"),
      trackB: describeSong(pickB, "b"),
      blend: blendBrief(blend, pickA, pickB, method),
      progression: progression.length ? `${progression.join(" – ")} (from ${nameOf(blend.harmony === "b" ? pickB : pickA, blend.harmony as Side)})` : "",
      // The offline draft has no producer in it, so hand it the plan read back
      // as a style line rather than letting it answer with nothing.
      style: offlineMashupStyle(blend, pickA, pickB),
      title: project.title === "Untitled" ? "" : project.title,
      brief: str(project.data?.brief),
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

  // ----- step 4: make a version ---------------------------------------------

  /** Append a finished attempt to the session, newest last in storage. */
  const fileVersion = (take: Render, entry: Omit<MashupVersion, "n" | "renderId" | "at">) => {
    patch((now) => {
      const existing = readVersions(now.data);
      const version: MashupVersion = {
        ...entry,
        n: nextVersionNumber(existing),
        renderId: take.id,
        at: Date.now(),
      };
      return { data: { ...(now.data ?? {}), versions: [...existing, version] } };
    });
  };

  const renderGenerated = async (changeNote = "") => {
    setError(null);
    const now = live.current;
    // Whatever is in the score box wins — it may have been pasted or edited by
    // hand rather than transcribed.
    const score = now.request.abc || melodyScore?.stripped || "";
    if (!score.trim()) {
      setError("Melody mode needs a score. Transcribe the melody above, or paste one into the score box.");
      return;
    }
    const style = now.request.style;
    const lyrics = now.request.lyrics;
    const n = nextVersionNumber(readVersions(now.data));
    const take = await render(
      project.id,
      {
        style,
        lyrics,
        // Melody mode: YuE2 follows the score and builds the accompaniment the
        // style line describes around it. That freedom is exactly what makes
        // the other record's world audible.
        cot: "melody",
        seed: now.request.seed || DEFAULT_SEED,
        abc: score,
        cfg_scale: now.request.cfg_scale ?? null,
      },
      `v${n} · ${(now.title || "Mashup").slice(0, 40)}`,
    );
    if (!take || take.error) {
      if (take?.error) setError(take.error);
      return;
    }
    fileVersion(take, { title: now.title || "Mashup", change: changeNote, method: "generated", style, lyrics });
  };

  /**
   * The layered route: two separations and a mix.
   *
   * Run one after the other rather than together, because the studio watches a
   * single job at a time — starting the second would abort the watch on the
   * first, and the progress bar would lie about what is happening.
   */
  const buildLayered = async () => {
    const vocalSide: Side = blend.vocal;
    const musicSide: Side = vocalSide === "a" ? "b" : "a";
    if (!clips[vocalSide] || !clips[musicSide]) {
      setError("Both sides need audio for this. Pick a track with a preview, or drop the files in.");
      return;
    }
    setError(null);

    // The rack and this route want the same two files, so whatever has already
    // been separated for a comparison is what gets mixed. A layered mashup
    // after a listen through the rack costs no GPU time at all.
    const vocal =
      findCut(readStemLib(live.current.data?.stemLib), vocalSide, "vocals") ?? (await splitStem(vocalSide, "vocals"));
    if (!vocal) return;
    const backing =
      findCut(readStemLib(live.current.data?.stemLib), musicSide, "backing") ??
      (await splitStem(musicSide, "backing"));
    if (!backing) return;

    // The older per-project bag, still written so a project saved by the
    // previous version of this tool keeps re-mixing without a re-split.
    patch((now) => ({
      data: {
        ...(now.data ?? {}),
        stems: {
          vocalFileId: vocal.fileId,
          vocalFrom: vocalSide,
          musicFileId: backing.fileId,
          musicFrom: musicSide,
        },
      },
    }));

    await mixStems(vocal.fileId, backing.fileId, vocalSide, "");
  };

  /**
   * Lay the vocal over the backing. Synchronous on the server (ffmpeg, no GPU),
   * so it does not go through the job queue and is filed by hand.
   */
  const mixStems = async (vocalFileId: string, musicFileId: string, vocalSide: Side, changeNote: string) => {
    setMixing(true);
    setError(null);
    try {
      await ensureServer();
      const fileId = await mix({
        musicFileId,
        vocalFileId,
        vocalGainDb: Number(project.data?.vocalGainDb ?? 0) || 0,
        musicGainDb: Number(project.data?.musicGainDb ?? -3) || -3,
        offsetS: Number(project.data?.offsetS ?? 0) || 0,
      });
      if (!fileId) throw new Error("The server mixed the two stems but returned no file.");
      const now = live.current;
      const n = nextVersionNumber(readVersions(now.data));
      const take = addRender(project.id, {
        id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        kind: "mix",
        label: `v${n} · ${(now.title || "Mashup").slice(0, 40)}`,
        fileId,
        jobId: null,
        created: Date.now(),
        meta: { mashup: "layered", vocalFrom: vocalSide },
      });
      fileVersion(take, {
        title: now.title || "Mashup",
        change: changeNote,
        method: "layered",
        style: `${vocalSide === "a" ? aName : bName}'s vocal over ${vocalSide === "a" ? bName : aName}'s backing`,
        lyrics: "",
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setMixing(false);
    }
  };

  /** Re-mix the stems already on the server with whatever the balance is now. */
  const remixLayered = async () => {
    if (!stems.vocalFileId || !stems.musicFileId || !stems.vocalFrom) {
      setError("There are no split stems yet — build the layered mashup once first.");
      return;
    }
    await mixStems(stems.vocalFileId, stems.musicFileId, stems.vocalFrom, change.trim() || "re-balanced");
    setChange("");
  };

  // ----- step 5: change it and go again -------------------------------------

  /**
   * The user heard it and asked for one change.
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
    const result = await writer.run("mashup-revise", {
      change,
      style: last?.style || now.request.style,
      lyrics: last?.lyrics || now.request.lyrics,
      blend: blendBrief(blend, pickA, pickB, method),
      trackA: describeSong(pickA, "a"),
      trackB: describeSong(pickB, "b"),
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
    const n = nextVersionNumber(readVersions(now.data));
    const take = await render(
      project.id,
      {
        style,
        lyrics,
        cot: "melody",
        seed: now.request.seed || DEFAULT_SEED,
        abc: now.request.abc || melodyScore?.stripped || null,
        cfg_scale: now.request.cfg_scale ?? null,
      },
      `v${n} · ${change.trim().slice(0, 40)}`,
    );
    if (!take || take.error) {
      if (take?.error) setError(take.error);
      return;
    }
    fileVersion(take, { title: now.title || "Mashup", change: changed, method: "generated", style, lyrics });
    setChange("");
  };

  /**
   * Perform an old version's recipe again — same words, same sound, new take.
   *
   * On a NEW seed, which is the whole point. YuE2 is deterministic: the same
   * style, lyrics, score and seed produce the same file byte for byte, so
   * reusing the version's seed would hand back a duplicate of a take the user
   * already has while claiming to be another take of it. A revision keeps the
   * seed deliberately (you want the same record with one thing changed); this
   * is the opposite request.
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
        cot: "melody",
        seed: Math.floor(Math.random() * 1_000_000) + 1,
        abc: now.request.abc || melodyScore?.stripped || null,
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

  // ----- readiness ----------------------------------------------------------

  const bothNamed = !!(pickA?.track || pickA?.fileName || pickA?.query) && !!(pickB?.track || pickB?.fileName || pickB?.query);
  const canRender =
    method === "generated"
      ? !!(project.request.abc || melodyScore)?.toString().trim() &&
        !!project.request.style.trim() &&
        !!project.request.lyrics.trim()
      : !!clips.a && !!clips.b;
  const hasVersions = versions.length > 0;

  /**
   * Turn one knob.
   *
   * Melody is the one knob that is not purely descriptive: it decides which
   * score gets performed. So pointing it at a side that has already been
   * transcribed loads that score straight away, rather than leaving the score
   * box showing one record while the render uses another.
   */
  const setBlend = (change: Partial<BlendSpec>) => {
    const next = { ...blend, ...change };
    const swapped = change.melody && change.melody !== blend.melody ? scores[change.melody] : undefined;
    patch((now) => ({
      request: swapped ? { ...now.request, abc: swapped.stripped } : now.request,
      data: { ...(now.data ?? {}), blend: next },
    }));
  };

  // ----- the plate ----------------------------------------------------------
  //
  // Both scanner layers are painted from this one description of the two
  // sides, which is what keeps them pixel-aligned: the hidden layer is not a
  // second picture, it is the same picture with the sound in it.

  /**
   * What to call a side before it has a record on it.
   *
   * `shortName` falls back to "song A", which reads as a placeholder the user
   * typed rather than as an empty slot. The plate and the rack both say what
   * the slot IS instead.
   */
  const sideName = (side: Side): string => {
    const pick = side === "a" ? pickA : pickB;
    if (pick) return shortName(pick, side);
    return side === "a" ? "First song" : "Second song";
  };

  const lanes: Lane[] = useMemo(
    () =>
      (["a", "b"] as Side[]).map((side) => ({
        side: side.toUpperCase(),
        name: sideName(side),
        peaks: peaks[side],
        note: clipNote(clips[side]),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickA, pickB, peaks, clips],
  );
  const plateSignature = laneSignature(lanes, method);

  const rackSides = [
    { side: "a" as Side, name: sideName("a"), hasAudio: !!clips.a, preview: clips.a?.preview },
    { side: "b" as Side, name: sideName("b"), hasAudio: !!clips.b, preview: clips.b?.preview },
  ];

  return (
    <div className="mct">
      <Scanner
        base={sealedPlate(lanes, "DRAG ACROSS THE PLATE TO READ BOTH RECORDS")}
        reveal={wavePlate(lanes, "MEASURED IN THIS BROWSER · RMS PER BUCKET")}
        signature={plateSignature}
        height={200}
        label="The waveforms of the two loaded records, revealed by moving the pointer across the plate"
      >
        <div className="mct-plate-over">
          <strong>Mashup</strong>
          <span>Two records in, one session out — sweep the plate to see what you are actually holding.</span>
        </div>
      </Scanner>

      <MethodNote method={method} />

      {tool && <ServerNotice tool={tool} />}

      {/* ----- 1. the idea ------------------------------------------------ */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>What do you want mashed up?</h3>
          <p>Name both songs in one line. The catalogue finds the actual records; you confirm them below.</p>
        </div>

        <Field label="Your prompt" hint="two songs, plus anything about how it should sound">
          <Text
            value={prompt}
            onChange={(v) => setData({ prompt: v })}
            placeholder="Take On Me and Blinding Lights, keep the 80s synths but make it slower and moodier"
            rows={2}
          />
        </Field>
        <Field label="Name this mashup" hint="the project, and the name every version is filed under">
          <Text value={project.title === "Untitled" ? "" : project.title} onChange={(v) => update({ title: v || "Untitled" })} placeholder="Untitled" />
        </Field>

        <div className="mct-bar">
          <button type="button" className="mc-btn mc-btn-go" onClick={() => void findSongs()} disabled={!prompt.trim() || busy}>
            <Icon.Search width={14} height={14} /> {finding ? "Finding the songs…" : "Find the songs"}
          </button>
          {(pickA?.track?.previewUrl || pickB?.track?.previewUrl) && (!clips.a || !clips.b) && (
            <button type="button" className="mc-btn" onClick={() => void loadPreviews()} disabled={busy}>
              <Icon.Download width={13} height={13} /> Load both previews
            </button>
          )}
        </div>
        <WriterNote engine={writer.engine} warning={writer.warning} error={writer.error} />
        {error && <p className="mc-note is-bad">{error}</p>}
      </section>

      {/* ----- 2. the two records ------------------------------------------ */}
      <div className="mct-sides">
        <SongPicker
          side="a"
          role={roleOf("a", blend, method)}
          pick={pickA}
          clip={clips.a}
          busy={busy}
          onPick={(p) => setData({ pickA: p })}
          onClip={(c) => setClips((prev) => ({ ...prev, a: c }))}
        />
        <SongPicker
          side="b"
          role={roleOf("b", blend, method)}
          pick={pickB}
          clip={clips.b}
          busy={busy}
          onPick={(p) => setData({ pickB: p })}
          onClip={(c) => setClips((prev) => ({ ...prev, b: c }))}
        />
      </div>

      {/* ----- 2b. the parts, side by side --------------------------------- */}
      <section className="mc-panel" id="mct-rack">
        <div className="mc-panel-h">
          <h3>Compare the parts</h3>
          <p>
            One click plays one stem of one record — A&apos;s vocal on its own, then B&apos;s, then the two kits. This
            is how you find out whether the two records will sit together before spending anything on finding out.
          </p>
        </div>
        {/*
          Three states, not two. A server that has not answered is not a server
          without a separator, and saying "neither is installed" while the pod
          is still asleep would be a confident wrong answer about a machine
          nobody has asked yet.
        */}
        {!server?.reachable ? (
          <p className="mc-note">
            The GPU server has not answered yet, so which parts it can separate is not known. The rack fills in as soon
            as it does — rendering wakes it, or press <em>Wake it now</em> above.
          </p>
        ) : anyStems(separators) ? (
          <StemRack
            sides={rackSides}
            lib={stemLib}
            offers={offers}
            renders={project.renders}
            busy={busy}
            splitting={splitting}
            onSplit={(side, stemId) => void splitStem(side, stemId)}
          />
        ) : (
          <p className="mc-note is-warn">
            Separation needs a separator. The GPU server this hub points at has neither Demucs (vocals, drums, bass and
            instruments as four files) nor AuK (the voice, and everything that is not the voice), so there is nothing
            honest to play here yet. Everything else on this screen still works — the generated route never touches a
            stem.
          </p>
        )}
      </section>

      {/* ----- 3. how it should sound -------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>How should it sound?</h3>
          <p>Decide what comes from which record. Everything here is your call — the writer follows it, it does not argue.</p>
        </div>

        <div className="mct-methods">
          {(["generated", "layered"] as MashupMethod[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`mct-method ${method === id ? "is-on" : ""}`}
              onClick={() => setData({ method: id })}
              disabled={busy}
            >
              <strong>{id === "generated" ? "Generated — a new recording" : "Layered — the two real records"}</strong>
              <span>
                {id === "generated"
                  ? "One song's melody, performed inside a style built from both. Every control below works. Nothing of either original recording is in it."
                  : "One song's vocal laid over the other's backing track. Real audio from both — but nothing here beat-matches or key-matches, so it works when the two already sit close."}
              </span>
            </button>
          ))}
        </div>

        <div className="mct-dom">
          <div className="mct-dom-h">
            <span>{aName}</span>
            <strong>Which record wins?</strong>
            <span>{bName}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={blend.dominance}
            onChange={(e) => setBlend({ dominance: Number(e.target.value) })}
            disabled={method === "layered" || busy}
            aria-label="Dominance between the two songs"
          />
          <p className="mc-note">
            {method === "layered"
              ? "On the layered route this is the mix balance instead — set the two gains down in Build."
              : dominanceLine(blend.dominance, aName, bName)}
          </p>
        </div>

        <div className="mct-elements">
          {ELEMENTS.map((element) => {
            // Not `live` — that name is the ref holding the current project.
            const active = appliesTo(element.id, method);
            const value = String(blend[element.id as keyof BlendSpec] ?? "a");
            const options: { value: string; label: string }[] = [
              { value: "a", label: `A · ${sideName("a")}` },
              { value: "b", label: `B · ${sideName("b")}` },
              ...(element.extra ? [{ value: element.extra.value, label: element.extra.label }] : []),
            ];
            return (
              <div key={element.id} className={`mct-element ${active ? "" : "is-dead"}`}>
                <div className="mct-element-l">
                  <strong>{element.label}</strong>
                  <span>
                    {!active
                      ? element.layeredNote
                      : method === "layered" && element.layeredHint
                        ? element.layeredHint
                        : element.hint}
                  </span>
                  {/*
                    Which stem answers this knob. A melody is not a file — it is
                    the line the vocal sings — so the chip names the stem that
                    carries it rather than pretending the element itself can be
                    soloed. The rack above is the one player.
                  */}
                  <button
                    type="button"
                    className="mct-hear"
                    onClick={() =>
                      document.getElementById("mct-rack")?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    title={`Hearing this means hearing ${ELEMENT_STEM[element.id].hearing}. Takes you to the rack.`}
                  >
                    <Icon.Waveform width={11} height={11} /> hear it ·{" "}
                    {stemById(ELEMENT_STEM[element.id].stem)?.label.toLowerCase()}
                  </button>
                </div>
                <div className="mct-seg">
                  {options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={value === option.value ? "is-on" : ""}
                      onClick={() => setBlend({ [element.id]: option.value } as Partial<BlendSpec>)}
                      disabled={!active || busy}
                      title={element.extra && option.value === element.extra.value ? element.extra.hint : undefined}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/*
          Set it myself, on a slider.

          A number box asks you to already know the answer; a tempo is something
          you feel your way to, and the marks are there because "90" means
          nothing until you can see that it is halftime and that drill sits at
          140. The box stays beside it for when you do know the number.
        */}
        {blend.tempo === "custom" && appliesTo("tempo", method) && (
          <div className="mct-bpm">
            <div className="mct-bpm-h">
              <span className="mc-field-l">Tempo — set it myself</span>
              <input
                className="mc-input mct-bpm-n"
                type="number"
                min={BPM_MIN}
                max={BPM_MAX}
                value={blend.bpm ?? 120}
                onChange={(e) => setBlend({ bpm: clampBpm(Number(e.target.value)) })}
                aria-label="Tempo in BPM"
              />
              <em>BPM</em>
            </div>
            <input
              className="mct-bpm-s"
              type="range"
              min={BPM_MIN}
              max={BPM_MAX}
              step={1}
              value={blend.bpm ?? 120}
              onChange={(e) => setBlend({ bpm: clampBpm(Number(e.target.value)) })}
              aria-label="Tempo in BPM"
              list="mct-bpm-marks"
            />
            <datalist id="mct-bpm-marks">
              {BPM_MARKS.map((mark) => (
                <option key={mark.bpm} value={mark.bpm} label={mark.label} />
              ))}
            </datalist>
            <div className="mct-bpm-marks">
              {BPM_MARKS.map((mark) => (
                <button
                  key={mark.bpm}
                  type="button"
                  className={(blend.bpm ?? 120) === mark.bpm ? "is-on" : ""}
                  onClick={() => setBlend({ bpm: mark.bpm })}
                  title={`${mark.label} — ${mark.bpm} BPM`}
                >
                  {mark.label}
                </button>
              ))}
            </div>
            <p className="mc-note">{tempoFeel(blend.bpm ?? 120)}</p>
          </div>
        )}

        <details className="mct-fold">
          <summary>The plan, as it will be sent</summary>
          <ul className="mct-plan">
            {describeBlend(blend, aName, bName, method).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </details>
      </section>

      {/* ----- 4. build ----------------------------------------------------- */}
      {method === "generated" ? (
        <GeneratedBuild
          project={project}
          update={update}
          blend={blend}
          scores={scores}
          clips={clips}
          aName={aName}
          bName={bName}
          progression={progression}
          notes={notes}
          writer={writer}
          busy={busy}
          blocked={blocked}
          bothNamed={bothNamed}
          canRender={canRender}
          // Transcription is the one step that needs SheetSage2; a server
          // without it can still render a score from anywhere else.
          noTranscriber={!!server?.reachable && !hasEngine(server, "sheetsage")}
          onTranscribe={(side) => void transcribe(side)}
          onPlan={() => void plan()}
          onRender={() => void renderGenerated("")}
          hasVersions={hasVersions}
        />
      ) : (
        <LayeredBuild
          project={project}
          setData={setData}
          blend={blend}
          clips={clips}
          stems={stems}
          stemLib={stemLib}
          aName={shortName(pickA, "a")}
          bName={shortName(pickB, "b")}
          busy={busy}
          mixing={mixing}
          canBuild={canRender}
          // The tool as a whole requires SheetSage2 and YuE2 — this route needs
          // neither, and needs a separator, which the shared `requires` cannot
          // express. Either separator will do: both make a vocal and a backing.
          noSeparator={!!server?.reachable && !anyStems(separators)}
          onBuild={() => void buildLayered()}
          onRemix={() => void remixLayered()}
        />
      )}

      {/* ----- 5. the session ----------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>This session</h3>
          <p>
            Every version you make stays here, plays from your account and downloads on its own. Changing something
            adds the next version — it never replaces the one you already have.
          </p>
        </div>

        {hasVersions && (
          <div className="mct-revise">
            <Field label="Change it" hint="say what to fix, and the next version comes back">
              <Text
                value={change}
                onChange={setChange}
                placeholder={
                  method === "layered"
                    ? "bring the vocal up and nudge it a bit later"
                    : "drop the tempo to 90, make the chorus bigger, lose the second verse"
                }
                rows={2}
              />
            </Field>
            <div className="mct-bar">
              <button
                type="button"
                className="mc-btn mc-btn-go"
                onClick={() => void (method === "layered" ? remixLayered() : revise())}
                disabled={!change.trim() || busy || blocked}
              >
                <Icon.Sparkles width={14} height={14} />{" "}
                {writer.busy ? "Rewriting…" : `Make v${nextVersionNumber(versions)}`}
              </button>
              <span className="mc-note mct-quiet">
                {method === "layered"
                  ? "Re-mixes the stems already split — no GPU work, so it is seconds not minutes."
                  : "Revises the style line and lyrics of the last version, then renders again."}
              </span>
            </div>
          </div>
        )}

        <Versions versions={versions} renders={project.renders} projectId={project.id} onRerender={(v) => void rerender(v)} busy={busy || blocked} method={method} />
      </section>
    </div>
  );
}

// ----- the honesty banner ---------------------------------------------------

function MethodNote({ method }: { method: MashupMethod }) {
  return (
    <p className="mc-note is-warn">
      {method === "generated" ? (
        <>
          <strong>This builds a new recording, not an edit of the old ones.</strong> One song&apos;s melody is written
          down as a score and performed by YuE2 inside a style assembled from both records. No original audio survives
          it — not the singers, not their voices, not a single drum hit. Switch to <em>Layered</em> below if you want
          the real records in the output.
        </>
      ) : (
        <>
          <strong>This is the real audio from both records.</strong> One song&apos;s vocal is separated out and laid
          over the other&apos;s backing track. Nothing in this stack beat-matches, key-matches or time-stretches, so it
          lands when the two songs already sit near the same tempo and key — and drifts when they do not. Most of the
          controls above are generated-route only and are greyed out here.
        </>
      )}
    </p>
  );
}

/** The one-line role of a side, for the top of its picker card. */
function roleOf(side: Side, blend: BlendSpec, method: MashupMethod): string {
  if (method === "layered") {
    return blend.vocal === side ? "Its vocal is lifted out and used." : "Its backing track is lifted out and used.";
  }
  const mine = (Object.keys(blend) as (keyof BlendSpec)[]).filter(
    (k) => k !== "dominance" && k !== "bpm" && blend[k] === side && appliesTo(k as ElementId, method),
  );
  if (!mine.length) return "Nothing is taken from this one yet — every control is pointed at the other record.";
  const names = mine.map((k) => ELEMENTS.find((e) => e.id === k)?.label.toLowerCase() ?? String(k));
  return `Gives the ${names.join(", ")}.`;
}

// ----- the generated route's build panel ------------------------------------

function GeneratedBuild({
  project,
  update,
  blend,
  scores,
  clips,
  aName,
  bName,
  progression,
  notes,
  writer,
  busy,
  blocked,
  bothNamed,
  canRender,
  noTranscriber,
  onTranscribe,
  onPlan,
  onRender,
  hasVersions,
}: {
  project: Project;
  update: (patch: Partial<Project>) => void;
  blend: BlendSpec;
  scores: Record<Side, Score | undefined>;
  clips: { a: SideClip | null; b: SideClip | null };
  aName: string;
  bName: string;
  progression: string[];
  notes: string;
  writer: ReturnType<typeof useWriter>;
  busy: boolean;
  blocked: boolean;
  bothNamed: boolean;
  canRender: boolean;
  noTranscriber: boolean;
  onTranscribe: (side: Side) => void;
  onPlan: () => void;
  onRender: () => void;
  hasVersions: boolean;
}) {
  const melodySide = blend.melody;
  const melodyScore = scores[melodySide];
  const melodyName = melodySide === "a" ? aName : bName;
  const harmonySide = blend.harmony === "model" ? null : blend.harmony;
  const harmonyScore = harmonySide ? scores[harmonySide] : undefined;
  const harmonyName = harmonySide === "a" ? aName : bName;
  // What will actually be performed: whatever is in the box, falling back to
  // the transcription it was seeded from.
  const score = project.request.abc || melodyScore?.stripped || "";

  return (
    <section className="mc-panel">
      <div className="mc-panel-h">
        <h3>Build it</h3>
        <p>Read the melody off one record, write the plan, render. Each step remembers what it did.</p>
      </div>

      {/* --- the melody score --- */}
      <div className="mct-step-row">
        <div className="mct-step-n">1</div>
        <div className="mct-step-b">
          <strong>Read the melody off {melodyName}</strong>
          <p className="mc-note">
            SheetSage2 writes the tune down as an ABC score. That score is what gets performed — the recording itself
            goes no further. Transcribing takes a few GPU minutes and is remembered per song, so switching the melody
            knob back and forth does not spend it twice.
          </p>
          <div className="mct-bar">
            <button
              type="button"
              className="mc-btn mc-btn-go"
              onClick={() => onTranscribe(melodySide)}
              disabled={!clips[melodySide] || busy || blocked || noTranscriber}
              title={
                noTranscriber
                  ? "This server has no SheetSage2, so it cannot transcribe"
                  : !clips[melodySide]
                    ? `${melodyName} has no audio loaded on this device`
                    : undefined
              }
            >
              <Icon.Layers width={14} height={14} />{" "}
              {melodyScore ? `Transcribe ${melodySide.toUpperCase()} again` : `Transcribe ${melodySide.toUpperCase()}`}
            </button>
            {harmonySide && harmonySide !== melodySide && (
              <button
                type="button"
                className="mc-btn"
                onClick={() => onTranscribe(harmonySide)}
                disabled={!clips[harmonySide] || busy || blocked || noTranscriber}
                title={
                  noTranscriber
                    ? "This server has no SheetSage2, so it cannot transcribe"
                    : !clips[harmonySide]
                      ? `${harmonyName} has no audio loaded on this device`
                      : undefined
                }
              >
                <Icon.Layers width={13} height={13} />{" "}
                {harmonyScore ? `Re-read ${harmonySide.toUpperCase()}'s chords` : `Read ${harmonySide.toUpperCase()}'s chords`}
              </button>
            )}
          </div>
          {noTranscriber && (
            <p className="mc-note is-warn">
              The GPU server is up but has no SheetSage2 installed, so it cannot read a melody off a recording. Every
              other part of this route still works — paste an ABC score into the box below (the Remix tool makes them,
              and so does anything else that speaks ABC) and render as normal.
            </p>
          )}
          {!noTranscriber && !clips[melodySide] && (
            <p className="mc-note is-warn">
              {melodyName} has no audio in this tab. Pick it from the catalogue (or drop its file in) above — audio is
              never saved into the project, so it needs loading again after a reload.
            </p>
          )}
        </div>
      </div>

      {melodyScore?.warnings.length ? (
        <div className="mc-note is-warn mct-warns">
          <strong>SheetSage2 reported this about {melodyName}:</strong>
          <ul>
            {melodyScore.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <p>A transcription error carries straight through: YuE2 performs whatever these notes say, confidently.</p>
        </div>
      ) : null}

      {/*
        Always open, never gated on a transcription having happened.

        Transcribing is the normal way to fill this in, but it is not the only
        source of a score: the Remix tool produces them, ABC is a text format
        people write by hand, and — the case that actually bites — a GPU server
        without SheetSage2 installed cannot transcribe at all. Hiding the box
        until a transcription succeeded made the whole generated route dead on
        such a server, with no way in even for someone holding a perfectly good
        score. `request.abc` is what gets performed either way, so the box that
        edits it is the honest thing to show.
      */}
      <details className="mct-fold" open={!!score && !melodyScore}>
        <summary>
          {melodyScore ? "The melody score, chords stripped — edit it if you want" : "The melody score — paste one in, or transcribe above"}
        </summary>
        <pre className="mc-mono mct-pre">
          <textarea
            className="mct-score"
            rows={12}
            spellCheck={false}
            value={score}
            onChange={(e) => update({ request: { ...project.request, abc: e.target.value } })}
            placeholder={"X:1\nT:Melody\nM:4/4\nL:1/8\nK:Am\n| A2 A2 c2 d2 | e4 d4 |"}
            aria-label="ABC score"
          />
        </pre>
        <p className="mc-note">
          {melodyScore ? (
            <>
              Chord symbols are removed on purpose: they are {melodyName}&apos;s harmony, and keeping them drags that
              record&apos;s world along with its tune — the opposite of what the chords knob is for.
            </>
          ) : (
            <>
              ABC notation. This text is what gets performed, so a score from anywhere — the Remix tool, another tool,
              your own typing — works here exactly as a transcription would.
            </>
          )}
        </p>
      </details>

      {harmonySide && (
        <p className={`mc-note ${progression.length ? "" : "is-warn"}`}>
          {progression.length ? (
            <>
              <strong>Chords from {harmonyName}:</strong> {progression.join(" – ")}. These travel to YuE2 as prose in
              the style line, not as notation — grafting one record&apos;s chord symbols onto another&apos;s bars needs
              the two transcriptions to agree on bar counts, and two different records never do. A progression
              described in words is approximate and visibly so; a bad graft is wrong and invisible.
            </>
          ) : harmonyScore ? (
            <>No chord symbols were found in {harmonyName}&apos;s transcription, so YuE2 writes its own harmony.</>
          ) : (
            <>
              Chords are set to come from {harmonyName}, but it has not been transcribed yet — until it is, YuE2 writes
              its own harmony.
            </>
          )}
        </p>
      )}

      {/* --- the plan --- */}
      <div className="mct-step-row">
        <div className="mct-step-n">2</div>
        <div className="mct-step-b">
          <strong>Write the style line and the words</strong>
          <p className="mc-note">
            The blend plan above goes to the writer as instructions, not suggestions. It answers with the one line YuE2
            reads and a lyric sheet that fits the melody&apos;s phrasing.
          </p>
          <div className="mct-bar">
            <button type="button" className="mc-btn mc-btn-go" onClick={onPlan} disabled={!bothNamed || busy}>
              <Icon.Sparkles width={14} height={14} /> {writer.busy ? "Writing…" : "Write the plan"}
            </button>
            {!bothNamed && <span className="mc-note mct-quiet">Name both songs first.</span>}
          </div>
          <WriterNote engine={writer.engine} warning={writer.warning} error={writer.error} />
          {notes && <p className="mc-note">{notes}</p>}
        </div>
      </div>

      <Field label="Style line" hint="sent to YuE2 as-is">
        <Text
          value={project.request.style}
          onChange={(style) => update({ request: { ...project.request, style } })}
          placeholder="English synth-pop over halftime trap drums, DX7 bells, breathy male tenor, 92 BPM"
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

      {/* --- render --- */}
      <div className="mct-step-row">
        <div className="mct-step-n">3</div>
        <div className="mct-step-b">
          <strong>Render it</strong>
          <div className="mct-bar">
            <button type="button" className="mc-btn mc-btn-go" onClick={onRender} disabled={!canRender || busy || blocked}>
              <Icon.Note width={14} height={14} /> {hasVersions ? "Render another version" : "Make the mashup"}
            </button>
            <label className="mct-inline">
              <span className="mc-field-l">Seed</span>
              <input
                className="mc-input mct-sel"
                type="number"
                value={project.request.seed || DEFAULT_SEED}
                onChange={(e) => update({ request: { ...project.request, seed: Number(e.target.value) || DEFAULT_SEED } })}
              />
            </label>
          </div>
          {!canRender && (
            <p className="mc-note">
              Needs all three: a transcribed melody, a style line and lyrics. Melody mode has nothing to follow without
              the score.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

// ----- the layered route's build panel --------------------------------------

function LayeredBuild({
  project,
  setData,
  blend,
  clips,
  stems,
  stemLib,
  aName,
  bName,
  busy,
  mixing,
  canBuild,
  noSeparator,
  onBuild,
  onRemix,
}: {
  project: Project;
  setData: (patch: Record<string, unknown>) => void;
  blend: BlendSpec;
  clips: { a: SideClip | null; b: SideClip | null };
  stems: Stems;
  stemLib: StemLib;
  aName: string;
  bName: string;
  busy: boolean;
  mixing: boolean;
  canBuild: boolean;
  noSeparator: boolean;
  onBuild: () => void;
  onRemix: () => void;
}) {
  const vocalSide = blend.vocal;
  const musicSide: Side = vocalSide === "a" ? "b" : "a";
  const vocalName = vocalSide === "a" ? aName : bName;
  const musicName = musicSide === "a" ? aName : bName;
  // Two ways to already have the files: the rack split them for a comparison,
  // or an earlier build of this project did. Either way the mix is free.
  const fromRack = layeredPair(stemLib, vocalSide);
  const ready = !!fromRack || (!!stems.vocalFileId && !!stems.musicFileId && stems.vocalFrom === vocalSide);

  return (
    <section className="mc-panel">
      <div className="mc-panel-h">
        <h3>Build it</h3>
        <p>
          {vocalName}&apos;s vocal over {musicName}&apos;s backing. Flip the <em>Vocal character</em> control above to
          swap which way round it goes.
        </p>
      </div>

      <div className="mct-step-row">
        <div className="mct-step-n">1</div>
        <div className="mct-step-b">
          <strong>Split both records</strong>
          <p className="mc-note">
            {fromRack ? (
              <>
                <strong>Already split.</strong> {vocalName}&apos;s vocal and {musicName}&apos;s backing are the files
                the rack above separated, so this mix costs no GPU time — it is ffmpeg laying one over the other.
              </>
            ) : (
              <>
                The separator lifts {vocalName}&apos;s vocal out and {musicName}&apos;s backing out. Two GPU jobs, run
                one after the other; both are kept, so re-balancing afterwards — and the rack above — cost nothing.
              </>
            )}
          </p>
          <div className="mct-bar">
            <button
              type="button"
              className="mc-btn mc-btn-go"
              onClick={onBuild}
              disabled={!canBuild || busy || noSeparator}
              title={noSeparator ? "This server has no AuK, so it cannot split a recording" : undefined}
            >
              <Icon.Layers width={14} height={14} /> {mixing ? "Mixing…" : ready ? "Split and mix again" : "Split and mix"}
            </button>
          </div>
          {noSeparator && (
            <p className="mc-note is-bad">
              The GPU server is up but has no separator installed, and separation is the whole of this route. Demucs
              gives four stems and AuK gives two; either makes this work. The generated route needs SheetSage2 and
              YuE2 instead — switch to it above.
            </p>
          )}
          {!canBuild && (
            <p className="mc-note is-warn">
              Both sides need audio in this tab. Pick tracks that have previews above, or drop the files in — audio is
              never saved into the project, so it needs loading again after a reload.
            </p>
          )}
          {(clips.a?.preview || clips.b?.preview) && (
            <p className="mc-note">
              At least one side is a 30-second preview, so the mashup will be 30 seconds long. Drop the full files in
              for a whole song.
            </p>
          )}
        </div>
      </div>

      <div className="mct-step-row">
        <div className="mct-step-n">2</div>
        <div className="mct-step-b">
          <strong>Balance</strong>
          <p className="mc-note">
            The vocal and the backing are two finished files laid on top of each other. Nothing time-aligns them, so
            the offset is how you slide the vocal onto the beat by ear.
          </p>
          <div className="mct-bar mct-gains">
            <label className="mct-inline">
              <span className="mc-field-l">Vocal dB</span>
              <input
                className="mc-input mct-sel"
                type="number"
                step={0.5}
                value={Number(project.data?.vocalGainDb ?? 0)}
                onChange={(e) => setData({ vocalGainDb: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="mct-inline">
              <span className="mc-field-l">Backing dB</span>
              <input
                className="mc-input mct-sel"
                type="number"
                step={0.5}
                value={Number(project.data?.musicGainDb ?? -3)}
                onChange={(e) => setData({ musicGainDb: Number(e.target.value) || 0 })}
              />
            </label>
            <label className="mct-inline">
              <span className="mc-field-l">Vocal offset s</span>
              <input
                className="mc-input mct-sel"
                type="number"
                step={0.1}
                value={Number(project.data?.offsetS ?? 0)}
                onChange={(e) => setData({ offsetS: Number(e.target.value) || 0 })}
              />
            </label>
            <button type="button" className="mc-btn" onClick={onRemix} disabled={!ready || busy}>
              <Icon.Refresh width={13} height={13} /> Re-mix with these
            </button>
          </div>
          {!ready && <p className="mc-note mct-quiet">Available once both stems have been split.</p>}
        </div>
      </div>
    </section>
  );
}

// ----- the version list ------------------------------------------------------

/**
 * Every finished attempt in this session, newest first.
 *
 * Each row carries the exact text that produced it, so a version is not just a
 * file — it is a reproducible recipe. That is why "another take" is offered per
 * row rather than only at the top: going back to v2 and trying a different seed
 * is the most common thing anybody does here.
 */
function Versions({
  versions,
  renders,
  projectId,
  onRerender,
  busy,
  method,
}: {
  versions: MashupVersion[];
  renders: Render[];
  projectId: string;
  onRerender: (version: MashupVersion) => void;
  busy: boolean;
  method: MashupMethod;
}) {
  if (!versions.length) {
    return (
      <p className="mc-empty">
        No versions yet. Name two songs, set the blend, and press{" "}
        {method === "layered" ? "Split and mix" : "Make the mashup"}.
      </p>
    );
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
              <span className="mc-take-kind">{version.method}</span>
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
                  {version.method === "generated" && (
                    <button
                      type="button"
                      className="mc-btn mc-btn-s"
                      onClick={() => onRerender(version)}
                      disabled={busy}
                      title="Same words, same sound, new seed — a different performance of this version's recipe"
                    >
                      <Icon.Refresh width={12} height={12} /> Another take of this
                    </button>
                  )}
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
