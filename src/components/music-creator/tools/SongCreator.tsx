"use client";

// ---------------------------------------------------------------------------
// Song Creator — full-song production.
//
// The screen is laid out as the two fields YuE2 actually takes, because
// pretending otherwise is how a studio ends up with a dozen dropdowns that are
// silently concatenated into a sentence the user never sees. Here the style
// line is visible and editable at all times: the brief fields above it are a
// way to write that line, not a replacement for it.
//
// The planning mode is exposed for the same reason. "full" is the interesting
// default — it makes the melody and harmony available as a score you can read
// and edit afterwards in Remix / Stems — and a user who does not care can
// ignore it, but nobody has to guess what the app did on their behalf.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Icon } from "../../icons";
import { DEFAULT_SEED } from "@/lib/music-creator/store";
import { toolById } from "@/lib/music-creator/tools";
import type { ToolProps } from "@/lib/music-creator/tools";
import type { PlanMode } from "@/lib/music-creator/types";
import { Field, ServerNotice, Takes, Text, WriterNote, useWriter, missingFor } from "../parts";
import { useStudio } from "../studio";

interface Brief {
  brief: string;
  genre: string;
  mood: string;
  tempo: string;
  instrumentation: string;
  vocal: string;
  language: string;
  structure: string;
}

const EMPTY_BRIEF: Brief = {
  brief: "",
  genre: "",
  mood: "",
  tempo: "",
  instrumentation: "",
  vocal: "",
  language: "English",
  structure: "verse / chorus / verse / chorus / bridge / chorus",
};

const MODES: { id: PlanMode; label: string; note: string }[] = [
  { id: "full", label: "Melody + harmony", note: "Plans a chord-annotated score first. Editable afterwards. The default." },
  { id: "melody", label: "Melody only", note: "Plans the tune and leaves the accompaniment free." },
  { id: "off", label: "No plan", note: "Straight to audio. Fastest, but there is no score to edit later." },
];

export function SongCreator({ project, update, setData, patch }: ToolProps) {
  const { render, running, server } = useStudio();
  const writer = useWriter();
  const tool = toolById("song-creator");
  const brief = { ...EMPTY_BRIEF, ...((project.data?.brief as Partial<Brief>) ?? {}) };
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const [change, setChange] = useState("");

  const request = project.request;
  const setBrief = (patch: Partial<Brief>) => setData({ brief: { ...brief, ...patch } });
  const setRequest = (patch: Partial<typeof request>) => update({ request: { ...request, ...patch } });

  const blocked = tool ? missingFor(tool, server).length > 0 : false;
  const canRender = !!request.style.trim() && !!request.lyrics.trim() && !running && !blocked;

  async function writeStyle() {
    const result = await writer.run("style", { ...brief, style: request.style });
    if (!result) return;
    // Landed after an await: merge into the live project so a lyric typed while
    // the model was writing is not thrown away by this answer.
    if (typeof result.style === "string") {
      const style = result.style;
      patch((p) => ({ request: { ...p.request, style } }));
    }
    setAlternatives(Array.isArray(result.alternatives) ? (result.alternatives as string[]) : []);
  }

  async function writeLyrics() {
    const result = await writer.run("lyrics", { ...brief, style: request.style, title: project.title });
    if (!result) return;
    if (typeof result.lyrics === "string") {
      const lyrics = result.lyrics;
      patch((p) => ({ request: { ...p.request, lyrics } }));
    }
    if (typeof result.title === "string" && (!project.title || project.title === "Untitled")) {
      update({ title: result.title });
    }
    if (typeof result.notes === "string") setData({ notes: result.notes });
  }

  async function rewriteLyrics() {
    if (!change.trim()) return;
    const result = await writer.run("rewrite", { lyrics: request.lyrics, change, style: request.style });
    if (result && typeof result.lyrics === "string") {
      const lyrics = result.lyrics;
      patch((p) => ({ request: { ...p.request, lyrics } }));
      setChange("");
    }
  }

  return (
    <div>
      {tool && <ServerNotice tool={tool} />}

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>1 · The brief</h3>
          <span className="mc-tag2">writes the style line — no GPU needed</span>
        </div>
        <Field label="What is the song" hint="one or two sentences">
          <Text
            rows={2}
            value={brief.brief}
            onChange={(v) => setBrief({ brief: v })}
            placeholder="A late-night drive song about leaving a city you loved."
          />
        </Field>
        <div className="mc-cols">
          <Field label="Genre">
            <Text value={brief.genre} onChange={(v) => setBrief({ genre: v })} placeholder="dream pop, trip-hop edges" />
          </Field>
          <Field label="Mood">
            <Text value={brief.mood} onChange={(v) => setBrief({ mood: v })} placeholder="wistful, wide, unhurried" />
          </Field>
          <Field label="Tempo">
            <Text value={brief.tempo} onChange={(v) => setBrief({ tempo: v })} placeholder="92 BPM" />
          </Field>
          <Field label="Instruments">
            <Text
              value={brief.instrumentation}
              onChange={(v) => setBrief({ instrumentation: v })}
              placeholder="Rhodes, brushed drums, upright bass"
            />
          </Field>
          <Field label="Vocal">
            <Text value={brief.vocal} onChange={(v) => setBrief({ vocal: v })} placeholder="warm female alto, breathy" />
          </Field>
          <Field label="Language">
            <Text value={brief.language} onChange={(v) => setBrief({ language: v })} />
          </Field>
        </div>
        <div className="mc-row">
          <button type="button" className="mc-btn" onClick={writeStyle} disabled={writer.busy}>
            <Icon.Sparkles width={13} height={13} /> {writer.busy ? "Writing…" : "Write the style line"}
          </button>
          <button type="button" className="mc-btn" onClick={writeLyrics} disabled={writer.busy}>
            <Icon.Note width={13} height={13} /> Write the lyrics
          </button>
        </div>
        <WriterNote engine={writer.engine} warning={writer.warning} error={writer.error} />
      </section>

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>2 · Style</h3>
          <span className="mc-tag2">genre · instruments · voice · tempo</span>
        </div>
        <Field label="Style line" hint="what the record sounds like — never words that get sung">
          <Text
            rows={3}
            value={request.style}
            onChange={(v) => setRequest({ style: v })}
            placeholder="English, warm piano pop, expressive female voice, acoustic piano, rounded bass and light drums, 88 BPM"
          />
        </Field>
        {alternatives.length > 0 && (
          <div className="mc-row">
            {alternatives.map((alt) => (
              <button key={alt} type="button" className="mc-btn mc-btn-s" onClick={() => setRequest({ style: alt })} title={alt}>
                Use alternative: {alt.slice(0, 44)}…
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>3 · Lyrics</h3>
          <span className="mc-tag2">every character here is sung</span>
        </div>
        <Field label="Lyric sheet" hint="[Verse] / [Chorus] tags on their own line">
          <Text
            rows={14}
            value={request.lyrics}
            onChange={(v) => setRequest({ lyrics: v })}
            placeholder={"[Verse]\nNeon fades along the lane\n\n[Chorus]\nLet the day come into view"}
          />
        </Field>
        <div className="mc-row">
          <input
            className="mc-input"
            style={{ flex: 1, minWidth: 220 }}
            value={change}
            onChange={(e) => setChange(e.target.value)}
            placeholder="Revise: make the second verse darker, keep the syllable count"
            onKeyDown={(e) => {
              if (e.key === "Enter") void rewriteLyrics();
            }}
          />
          <button type="button" className="mc-btn" onClick={rewriteLyrics} disabled={writer.busy || !change.trim()}>
            Revise
          </button>
        </div>
      </section>

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>4 · Render</h3>
          <span className="mc-tag2">48 kHz stereo · vocals + accompaniment</span>
        </div>

        <Field label="Planning" hint="what YuE2 works out before it plays anything">
          <div className="mc-row">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`mc-btn mc-btn-s ${request.cot === m.id ? "mc-btn-go" : ""}`}
                onClick={() => setRequest({ cot: m.id })}
                title={m.note}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Field>
        <p className="mc-note">{MODES.find((m) => m.id === request.cot)?.note}</p>

        <div className="mc-cols">
          <Field label="Seed" hint="same seed, same song">
            <div className="mc-row">
              <input
                className="mc-input"
                type="number"
                value={request.seed}
                onChange={(e) => setRequest({ seed: Number(e.target.value) || DEFAULT_SEED })}
              />
              <button
                type="button"
                className="mc-btn mc-btn-s"
                onClick={() => setRequest({ seed: Math.floor(Math.random() * 2 ** 31) })}
              >
                <Icon.Refresh width={12} height={12} /> New
              </button>
            </div>
          </Field>
          <Field label="Text guidance" hint="blank uses YuE2's own default">
            <input
              className="mc-input"
              type="number"
              step="0.1"
              min={0}
              max={20}
              value={request.cfg_scale ?? ""}
              placeholder="default"
              onChange={(e) => setRequest({ cfg_scale: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </Field>
        </div>

        <div className="mc-row">
          <button
            type="button"
            className="mc-btn mc-btn-go"
            disabled={!canRender}
            onClick={() => void render(project.id, request, `Take ${project.renders.length + 1} · seed ${request.seed}`)}
          >
            <Icon.Sparkles width={13} height={13} /> {running ? "Rendering…" : "Render the song"}
          </button>
          <span className="mc-note">
            One call, one candidate. A full song takes minutes on a 24 GB card.
          </span>
        </div>
      </section>

      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>Takes</h3>
        </div>
        <Takes renders={project.renders} empty="Nothing rendered yet. Every take is kept here with its seed." />
      </section>
    </div>
  );
}
