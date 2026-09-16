"use client";

// ---------------------------------------------------------------------------
// Mashup — one recording's melody, another's world.
//
// The whole tool rests on one asymmetry, so the screen states it rather than
// implying it:
//
//   A is the MELODY. SheetSage2 listens to the recording and writes down what
//   the tune does, as an ABC score. That is a transcription — notes and timing,
//   nothing else. None of the recording survives it.
//
//   B is the STYLE. A line of prose describing the sound the melody should be
//   performed in. YuE2 then realises A's notes in B's world.
//
// The consequence the UI repeats in as many words: this does NOT carry over the
// original singer, their voice, their timbre or their recording. YuE2 has no
// voice-reference input at all — there is no field this app is declining to
// fill in. A mashup is a new performance of an old tune. If you want a specific
// voice, that is the Artist Voice Studio, and it speaks rather than sings.
//
// Two implementation notes:
//
//   The audio is read to a data URL in the browser and held in React state
//   only. It is never written into `project.data` — projects sync as JSON, and
//   a few megabytes of base64 per project would either blow the row or quietly
//   stop the whole store from saving. What persists is the score, which is the
//   part worth keeping anyway.
//
//   Transcription warnings are shown verbatim, in full, next to the score. A
//   melody that SheetSage2 was unsure about produces a score that is wrong in
//   ways nothing downstream can detect: YuE2 will perform the mistake
//   confidently. Hiding or softening those lines would turn a readable warning
//   into a mystery about why the render sounds nothing like the source.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import { searchArtist } from "@/lib/music-creator/client";
import { DEFAULT_SEED } from "@/lib/music-creator/store";
import { type ToolProps, toolById } from "@/lib/music-creator/tools";
import type { ArtistTrack, Project } from "@/lib/music-creator/types";
import { Field, ServerNotice, Takes, Text, WriterNote, missingFor, useWriter } from "../parts";
import { useStudio } from "../studio";
import "./tools.css";

/**
 * Above this, the request is likely to be refused by the hosting layer before
 * it ever reaches the GPU box: the audio travels as base64 inside a JSON body,
 * and serverless request bodies are capped around 4.5 MB. Said plainly rather
 * than enforced, because a self-hosted deployment has no such cap.
 */
const BIG_FILE = 4_500_000;

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

function warningsOf(project: Project): string[] {
  const raw = project.data?.warnings;
  if (!Array.isArray(raw)) return [];
  return raw.map((w) => String(w)).filter(Boolean);
}

/** Pull the warnings a transcribe job reported, whatever shape they arrived in. */
function readWarnings(meta: Record<string, unknown> | undefined): string[] {
  const raw = meta?.warnings;
  if (Array.isArray(raw)) return raw.map((w) => String(w)).filter(Boolean);
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

export function Mashup({ project, update, setData }: ToolProps) {
  const { render, runAndFile, running, server } = useStudio();
  const writer = useWriter();
  const tool = toolById("mashup");

  // Source A's audio lives here and nowhere else — see the note at the top.
  const [clip, setClip] = useState<{ dataUrl: string; name: string; bytes: number } | null>(null);
  const [over, setOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<ArtistTrack[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetching, setFetching] = useState<string | null>(null);

  const sourceA = str(project.data?.sourceA);
  const sourceB = str(project.data?.sourceB);
  const brief = str(project.data?.brief);
  const notes = str(project.data?.notes);
  const fullAbc = str(project.data?.fullAbc);
  const warnings = warningsOf(project);
  const abc = str(project.request.abc);

  const blocked = tool ? missingFor(tool, server).length > 0 : false;
  const busy = !!running;

  /**
   * The project as it is now, not as it was when a button was pressed.
   *
   * A transcription runs for minutes and the user keeps typing during it —
   * style, lyrics, the description of B. Every write that happens after an
   * `await` merges into this instead of into the closure's copy, so finishing a
   * job cannot quietly undo edits made while it ran. Synchronous handlers use
   * the props directly, where the distinction cannot arise.
   */
  const live = useRef(project);
  useEffect(() => {
    live.current = project;
  }, [project]);

  const takeFile = async (file: File) => {
    setLocalError(null);
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|flac|ogg|aac|aiff?)$/i.test(file.name)) {
      setLocalError(`"${file.name}" does not look like an audio file.`);
      return;
    }
    try {
      const dataUrl = await readDataUrl(file);
      setClip({ dataUrl, name: file.name, bytes: file.size });
      if (!sourceA) setData({ sourceA: file.name });
    } catch (err) {
      setLocalError((err as Error).message);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setLocalError(null);
    try {
      const result = await searchArtist(query.trim());
      setTracks(result.tracks ?? []);
    } catch (err) {
      setTracks([]);
      setLocalError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  /**
   * Pull a catalogue preview through the site's proxy and treat it as a file.
   *
   * It is a 30-second clip, which is plenty for a chorus melody and nothing
   * like a whole song — the UI says so rather than letting a truncated
   * transcription look like a failure of the model.
   */
  const usePreview = async (track: ArtistTrack) => {
    if (!track.previewUrl) return;
    setFetching(track.id);
    setLocalError(null);
    try {
      const res = await fetch(`/api/music-creator/artist?preview=${encodeURIComponent(track.previewUrl)}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `The preview returned ${res.status}.`);
      }
      const blob = await res.blob();
      const dataUrl = await readDataUrl(blob);
      const name = `${track.artist} — ${track.title} (30s preview)`;
      setClip({ dataUrl, name, bytes: blob.size });
      setData({ sourceA: name });
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setFetching(null);
    }
  };

  const transcribe = async () => {
    if (!clip) return;
    const take = await runAndFile(
      project.id,
      "transcription",
      "jobs/transcribe",
      { audio_b64: clip.dataUrl, filename: clip.name, melody_only: true },
      "Melody from A",
    );
    if (!take || take.error) return;

    const meta = take.meta;
    // `stripped_abc` is the score with the chord symbols removed. That is the
    // one to hand to YuE2 here: the chords belong to source A's harmony, and
    // keeping them would drag A's world along with A's tune — the opposite of
    // what a mashup is for. The full score is kept beside it so nothing is lost.
    const stripped = str(meta?.stripped_abc);
    const whole = str(meta?.abc);
    const score = stripped || whole;
    const now = live.current;
    update({
      request: score ? { ...now.request, abc: score, cot: "melody" } : now.request,
      data: { ...(now.data ?? {}), fullAbc: whole, warnings: readWarnings(meta) },
    });
  };

  const writeStyle = async () => {
    const result = await writer.run("mashup", { sourceA, sourceB, brief });
    if (!result) return;
    const style = str(result.style);
    const lyrics = str(result.lyrics);
    const now = live.current;
    update({
      request: {
        ...now.request,
        style: style || now.request.style,
        lyrics: lyrics || now.request.lyrics,
      },
      data: { ...(now.data ?? {}), notes: str(result.notes) },
    });
  };

  const renderMashup = () =>
    void render(
      project.id,
      {
        style: project.request.style,
        lyrics: project.request.lyrics,
        // Melody mode is the documented cover/mashup path: YuE2 follows the
        // score's melody and is free to build the accompaniment around it, which
        // is exactly the freedom B's style line needs to mean anything.
        cot: "melody",
        seed: project.request.seed || DEFAULT_SEED,
        abc: project.request.abc,
        cfg_scale: project.request.cfg_scale ?? null,
      },
      `${sourceA || "A"} in the style of ${sourceB || "B"}`.slice(0, 60),
    );

  const canRender = !!abc.trim() && !!project.request.style.trim() && !!project.request.lyrics.trim();

  return (
    <div className="mct">
      <p className="mc-note is-warn">
        This carries the melody across and nothing else. The original singer, their voice and their recording do not
        come with it — YuE2 has no voice-reference input, so what you get is a new performance of the tune in the
        style you describe. To put a particular voice on something, use the Artist Voice Studio.
      </p>

      {tool && <ServerNotice tool={tool} />}

      {/* ----- A: the melody -------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>
            <span className="mct-ab">A</span> The melody
          </h3>
          <p>A recording whose tune you want. SheetSage2 writes it down as a score; the audio goes no further.</p>
        </div>

        <div
          className={`mct-drop ${over ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) void takeFile(file);
          }}
        >
          <Icon.Upload width={18} height={18} />
          <strong>Drop an audio file here</strong>
          <span>mp3, wav, m4a, flac — or pick one</span>
          <label className="mc-btn mc-btn-s mct-file">
            Choose a file
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
        </div>

        <details className="mct-fold">
          <summary>Or audition a 30-second preview from the catalogue</summary>
          <div className="mct-bar">
            <input
              className="mc-input"
              value={query}
              placeholder="artist or song"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
            />
            <button type="button" className="mc-btn" onClick={() => void search()} disabled={searching}>
              <Icon.Search width={13} height={13} /> {searching ? "Searching…" : "Search"}
            </button>
          </div>
          {tracks.length > 0 && (
            <div className="mc-tracks" style={{ marginTop: 12 }}>
              {tracks.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  className="mc-track"
                  onClick={() => void usePreview(track)}
                  disabled={!track.previewUrl || !!fetching || busy}
                >
                  {track.artwork ? <img src={track.artwork} alt="" /> : <span className="mct-art" />}
                  <span className="mc-track-m">
                    <strong>{track.title}</strong>
                    <span>
                      {track.artist}
                      {track.releaseYear ? ` · ${track.releaseYear}` : ""}
                      {!track.previewUrl ? " · no preview" : fetching === track.id ? " · fetching…" : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="mc-note">
            Picking one loads its preview as source A — you can play it back below before transcribing. Previews are 30
            seconds: that is a chorus, not a song, and the score covers only what was in the clip.
          </p>
        </details>

        <Field label="What A is" hint="for the writer, and for you in six months">
          <Text value={sourceA} onChange={(v) => setData({ sourceA: v })} placeholder="the chorus melody of a 1970s soul record" />
        </Field>

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
        {clip && clip.bytes > BIG_FILE && (
          <p className="mc-note is-warn">
            {(clip.bytes / 1_000_000).toFixed(1)} MB is large for this path. The clip travels as base64 inside a JSON
            request, and hosted deployments usually cap request bodies around 4.5 MB — if transcription comes back with
            a 413, trim the file to the section you actually want.
          </p>
        )}
        {localError && <p className="mc-note is-bad">{localError}</p>}
        <p className="mc-note">
          The audio stays in this browser tab. It is sent to the GPU server to be transcribed and is not saved into the
          project — reloading the page clears it, and the score is what survives.
        </p>

        <div className="mct-bar">
          <button
            type="button"
            className="mc-btn mc-btn-go"
            onClick={() => void transcribe()}
            disabled={!clip || blocked || busy}
            title={blocked ? "SheetSage2 is not available on the server right now" : undefined}
          >
            <Icon.Layers width={14} height={14} /> Transcribe the melody
          </button>
        </div>
      </section>

      {/* ----- the score ------------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>The score</h3>
          <p>ABC notation, chords removed. Edit it freely — this text is what gets performed, not the recording.</p>
        </div>

        {warnings.length > 0 && (
          <div className="mc-note is-warn mct-warns">
            <strong>SheetSage2 reported this about the transcription:</strong>
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <p>
              A transcription error carries straight into the mashup: YuE2 performs whatever these notes say, including
              the wrong ones.
            </p>
          </div>
        )}

        <pre className="mc-mono mct-pre">
          <textarea
            className="mct-score"
            rows={14}
            spellCheck={false}
            value={abc}
            onChange={(e) => update({ request: { ...project.request, abc: e.target.value } })}
            placeholder={"X:1\nT:Melody\nM:4/4\nL:1/8\nK:C\n| CDEF GABc |"}
            aria-label="ABC score"
          />
        </pre>

        {fullAbc && fullAbc !== abc && (
          <details className="mct-fold">
            <summary>The full transcription, with the chords SheetSage2 heard</summary>
            <pre className="mc-mono mct-pre mct-ro">{fullAbc}</pre>
            <button
              type="button"
              className="mc-btn mc-btn-s"
              onClick={() => update({ request: { ...project.request, abc: fullAbc } })}
            >
              Use this one instead
            </button>
            <p className="mc-note">
              Keeping the chords keeps A’s harmony, which pulls the result back towards A. Sometimes that is the mashup
              you want.
            </p>
          </details>
        )}
      </section>

      {/* ----- B: the style ---------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>
            <span className="mct-ab">B</span> The world it gets performed in
          </h3>
          <p>Prose, not a file. Genre, instruments, vocal character, production, tempo.</p>
        </div>

        <Field label="What B is" hint="the sound you are aiming at">
          <Text value={sourceB} onChange={(v) => setData({ sourceB: v })} placeholder="late-night drum and bass, halftime, rolling sub" />
        </Field>
        <Field label="Anything else about the mashup">
          <Text value={brief} onChange={(v) => setData({ brief: v })} placeholder="keep it wordless until the drop" rows={2} />
        </Field>

        <div className="mct-bar">
          <button type="button" className="mc-btn mc-btn-go" onClick={() => void writeStyle()} disabled={writer.busy}>
            <Icon.Sparkles width={14} height={14} /> {writer.busy ? "Writing…" : "Write the style line and lyrics"}
          </button>
        </div>
        <WriterNote engine={writer.engine} warning={writer.warning} error={writer.error} />
        {notes && <p className="mc-note">{notes}</p>}

        <Field label="Style line" hint="sent to YuE2 as-is">
          <Text
            value={project.request.style}
            onChange={(style) => update({ request: { ...project.request, style } })}
            placeholder="English drum and bass, halftime, rolling sub bass, airy male tenor, 174 BPM"
            rows={3}
          />
        </Field>
        <Field label="Lyrics" hint="every character is sung">
          <Text
            value={project.request.lyrics}
            onChange={(lyrics) => update({ request: { ...project.request, lyrics } })}
            placeholder={"[Verse]\nwords that fit A’s phrasing"}
            rows={8}
          />
        </Field>
        <p className="mc-note">
          The melody is fixed by the score, so lines that do not match its phrasing get stretched or crushed to fit.
          Counting syllables against the original is not fussiness here.
        </p>
      </section>

      {/* ----- render ----------------------------------------------------- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>Render</h3>
          <p>Melody mode: YuE2 follows the score and builds B’s accompaniment around it.</p>
        </div>
        <div className="mct-bar">
          <button
            type="button"
            className="mc-btn mc-btn-go"
            onClick={renderMashup}
            disabled={blocked || busy || !canRender}
            title={blocked ? "The GPU server cannot render this right now" : undefined}
          >
            <Icon.Note width={14} height={14} /> Perform A in the style of B
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
            Needs all three: a score, a style line and lyrics. Melody mode has nothing to follow without the score.
          </p>
        )}
        <Takes renders={project.renders} empty="No takes yet. Transcribe A, describe B, then render." />
      </section>
    </div>
  );
}
