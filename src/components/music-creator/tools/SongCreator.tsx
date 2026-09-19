"use client";

// ---------------------------------------------------------------------------
// Song Creator — the user types a STYLE and LYRICS, nothing else.
//
// Two ways through, chosen per prompt:
//   · AI Producer ON  — the style (a basic idea or a full production prompt)
//     goes through the producer → prompt engineer → QC pipeline
//     (/api/music-creator/produce). The page shows the original next to the
//     optimised result, every field is editable and copyable, and THAT is what
//     gets rendered.
//   · AI Producer OFF — the style and lyrics go to the music engine exactly as
//     typed. Not a byte changed.
//
// State lives in project.data (input, useProducer, lyricsMode, useTaste,
// production). Older projects kept their text in request.style/lyrics; those
// become the input on first open, so nothing already written is lost.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";
import { Icon } from "../../icons";
import { DEFAULT_SEED } from "@/lib/music-creator/store";
import { toolById } from "@/lib/music-creator/tools";
import type { ToolProps } from "@/lib/music-creator/tools";
import type { PlanMode } from "@/lib/music-creator/types";
import {
  STYLE_LIMIT,
  charCount,
  type LyricsMode,
  type ProducerPlan,
  type Production,
  type QcCheck,
} from "@/lib/music-creator/producer";
import { ServerNotice, Takes, missingFor } from "../parts";
import { useStudio } from "../studio";
import "./tools.css";

const MODES: { id: PlanMode; label: string; note: string }[] = [
  { id: "full", label: "Melody + harmony", note: "Plans a chord-annotated score first. Editable afterwards. The default." },
  { id: "melody", label: "Melody only", note: "Plans the tune and leaves the accompaniment free." },
  { id: "off", label: "No plan", note: "Straight to audio. Fastest, but there is no score to edit later." },
];

const LYRIC_MODES: { id: LyricsMode; label: string; note: string }[] = [
  { id: "keep", label: "Keep mine exactly", note: "Your lyrics are sung word for word. The producer only shapes the sound." },
  { id: "polish", label: "Polish mine", note: "Keeps your ideas, voice and best lines; tightens the rest." },
  { id: "write", label: "Write them for me", note: "Complete lyrics written to fit the production." },
];

const PLAN_ROWS: { id: keyof ProducerPlan; label: string }[] = [
  { id: "genre", label: "Genre" },
  { id: "era", label: "Era" },
  { id: "mood", label: "Mood" },
  { id: "energy", label: "Energy" },
  { id: "tempo", label: "Tempo" },
  { id: "identity", label: "Identity" },
  { id: "hook", label: "Hook" },
  { id: "melody", label: "Melody" },
  { id: "vocalist", label: "Lead vocal" },
  { id: "behindLead", label: "Behind the lead" },
  { id: "vocalProduction", label: "Vocal production" },
  { id: "drums", label: "Drums" },
  { id: "bass", label: "Bass" },
  { id: "instruments", label: "Instruments" },
  { id: "build", label: "Build" },
  { id: "stripBack", label: "Strip back" },
  { id: "peak", label: "Biggest moment" },
  { id: "surprise", label: "Surprise" },
  { id: "remove", label: "Removed to hit harder" },
];

const QC_GROUPS: QcCheck["group"][] = ["intent", "production", "melody", "vocals", "style", "lyrics", "generation"];

interface Input {
  style: string;
  lyrics: string;
}

export function SongCreator({ project, update, setData, patch }: ToolProps) {
  const { render, running, server } = useStudio();
  const tool = toolById("song-creator");
  const data = project.data ?? {};
  const request = project.request;

  const input: Input = (data.input as Input | undefined) ?? { style: request.style ?? "", lyrics: request.lyrics ?? "" };
  const useProducer = data.useProducer !== false;
  const useTaste = data.useTaste !== false;
  const lyricsMode: LyricsMode = (data.lyricsMode as LyricsMode | undefined) ?? (input.lyrics.trim() ? "keep" : "write");
  const production = (data.production as Production | undefined) ?? null;

  const [stages, setStages] = useState<string[]>([]);
  const [producing, setProducing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const setInput = (p: Partial<Input>) => setData({ input: { ...input, ...p } });
  const setRequest = (p: Partial<typeof request>) => update({ request: { ...request, ...p } });
  const setProduction = (p: Partial<Production>) => production && setData({ production: { ...production, ...p } });

  const stale =
    !!production && (production.original.style !== input.style || production.original.lyrics !== input.lyrics);
  const final: Input = useProducer && production ? { style: production.style, lyrics: production.lyrics } : input;

  const blocked = tool ? missingFor(tool, server).length > 0 : false;
  const hasIdea = !!input.style.trim() || !!input.lyrics.trim();
  const readyToRender = useProducer ? !!production || hasIdea : !!input.style.trim() && !!input.lyrics.trim();
  const canRender = readyToRender && !running && !producing && !blocked;

  async function produce(): Promise<Production | null> {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setProducing(true);
    setError(null);
    setStages([]);
    try {
      const res = await fetch("/api/music-creator/produce", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, lyricsMode, useTaste, title: project.title }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `The producer answered ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: Production | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "stage") setStages((s) => [...s, event.label]);
          else if (event.type === "error") throw new Error(event.error);
          else if (event.type === "result") result = event.production as Production;
        }
      }
      if (!result) throw new Error("The producer stopped before it finished.");
      const produced = result;
      // Landed after an await: merge into the live project so nothing typed
      // meanwhile is thrown away.
      patch((p) => ({
        data: { ...(p.data ?? {}), production: produced },
        title: !p.title || p.title === "Untitled" ? produced.title || p.title : p.title,
      }));
      return produced;
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
      return null;
    } finally {
      setProducing(false);
    }
  }

  async function renderSong() {
    let use = final;
    if (useProducer && (!production || stale)) {
      const produced = await produce();
      if (!produced) return;
      use = { style: produced.style, lyrics: produced.lyrics };
    }
    if (!use.style.trim() || !use.lyrics.trim()) {
      setError("The music engine needs both a style and lyrics to sing.");
      return;
    }
    const next = { ...request, style: use.style, lyrics: use.lyrics };
    setRequest({ style: use.style, lyrics: use.lyrics });
    const how = useProducer ? "produced" : "as typed";
    void render(project.id, next, `Take ${project.renders.length + 1} · ${how} · seed ${request.seed}`);
  }

  return (
    <div>
      {tool && <ServerNotice tool={tool} />}

      {/* ----- 1 · the only two things a user has to type ----- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>1 · Your song</h3>
          <span className="mc-tag2">style + lyrics — that is all it needs</span>
        </div>

        <label className="mc-field">
          <span className="mc-field-l">
            Style
            <i>a simple idea or a full production prompt · {charCount(input.style).toLocaleString()} chars</i>
          </span>
          <textarea
            className="mc-input mc-area"
            rows={4}
            value={input.style}
            onChange={(e) => setInput({ style: e.target.value })}
            placeholder="Make me a dark party song with a crazy hook, like something people would play at a club. I want singing behind the rapper and I want the production to have surprises."
          />
        </label>

        <label className="mc-field">
          <span className="mc-field-l">
            Lyrics
            <i>{useProducer ? "optional — leave empty and the producer writes them" : "[Verse] / [Chorus] tags on their own line; every word is sung"}</i>
          </span>
          <textarea
            className="mc-input mc-area"
            rows={8}
            value={input.lyrics}
            onChange={(e) => setInput({ lyrics: e.target.value })}
            placeholder={"[Verse]\nYour words here\n\n[Chorus]\nThe part everybody sings back"}
          />
        </label>

        <div className="mct-prod-switch" role="radiogroup" aria-label="How to send this prompt">
          <button
            type="button"
            role="radio"
            aria-checked={useProducer}
            className={`mct-prod-opt ${useProducer ? "is-on" : ""}`}
            onClick={() => setData({ useProducer: true })}
          >
            <strong>
              <Icon.Sparkles width={13} height={13} /> AI Producer
            </strong>
            <span>Understands the idea, designs the record, engineers the prompt and writes what is missing.</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!useProducer}
            className={`mct-prod-opt ${!useProducer ? "is-on" : ""}`}
            onClick={() => setData({ useProducer: false })}
          >
            <strong>Exactly as typed</strong>
            <span>Your style and lyrics go to the music engine untouched.</span>
          </button>
        </div>

        {useProducer && (
          <>
            <div className="mct-bar">
              <span className="mc-field-l" style={{ margin: 0 }}>
                Lyrics
              </span>
              {LYRIC_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`mc-btn mc-btn-s ${lyricsMode === m.id ? "mct-on" : ""}`}
                  onClick={() => setData({ lyricsMode: m.id })}
                  title={m.note}
                  disabled={m.id !== "write" && !input.lyrics.trim()}
                >
                  {m.label}
                </button>
              ))}
              <label className="mct-inline mct-check">
                <input type="checkbox" checked={useTaste} onChange={(e) => setData({ useTaste: e.target.checked })} />
                <span>House taste</span>
              </label>
            </div>
            <p className="mc-note">
              {LYRIC_MODES.find((m) => m.id === lyricsMode)?.note} House taste lets the producer lean on the studio&apos;s
              reference concepts (buried sung hooks, singing under rap, evolving builds) where your idea leaves gaps — your
              idea always wins.
            </p>
            <div className="mc-row">
              <button type="button" className="mc-btn mc-btn-go" onClick={() => void produce()} disabled={producing || !hasIdea}>
                <Icon.Sparkles width={13} height={13} />{" "}
                {producing ? "Producing…" : production ? (stale ? "Re-produce (input changed)" : "Produce again") : "Produce it"}
              </button>
              {producing && (
                <button type="button" className="mc-btn mc-btn-s" onClick={() => abort.current?.abort()}>
                  Stop
                </button>
              )}
              <span className="mc-note">No GPU needed — this is the writing room.</span>
            </div>
          </>
        )}

        {(producing || stages.length > 0) && (
          <ol className="mct-stages">
            {stages.map((s, i) => (
              <li key={i} className={i === stages.length - 1 && producing ? "is-now" : "is-done"}>
                {s}
              </li>
            ))}
          </ol>
        )}
        {error && <p className="mc-note is-bad">{error}</p>}
      </section>

      {/* ----- 2 · what the producer made of it ----- */}
      {useProducer && production && (
        <ProducerDesk production={production} stale={stale} onChange={setProduction} />
      )}

      {/* ----- 3 · render ----- */}
      <section className="mc-panel">
        <div className="mc-panel-h">
          <h3>{useProducer && production ? "3" : "2"} · Render</h3>
          <span className="mc-tag2">48 kHz stereo · vocals + accompaniment</span>
        </div>

        <p className="mc-note">
          Sending{" "}
          <strong>{useProducer ? (production && !stale ? "the AI-optimized style and lyrics" : "your idea through the AI Producer first") : "your style and lyrics exactly as typed"}</strong>
          {" · "}
          style {charCount(final.style).toLocaleString()} chars · {final.lyrics.split("\n").filter((l) => l.trim()).length} lyric lines
        </p>

        <div className="mct-bar">
          <span className="mc-field-l" style={{ margin: 0 }}>
            Planning
          </span>
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
          <span className="mct-inline">
            <span className="mc-field-l">Seed</span>
            <input
              className="mc-input mct-sel"
              type="number"
              value={request.seed}
              onChange={(e) => setRequest({ seed: Number(e.target.value) || DEFAULT_SEED })}
            />
            <button type="button" className="mc-btn mc-btn-s" onClick={() => setRequest({ seed: Math.floor(Math.random() * 2 ** 31) })}>
              <Icon.Refresh width={12} height={12} /> New
            </button>
          </span>
          <span className="mct-inline">
            <span className="mc-field-l">Guidance</span>
            <input
              className="mc-input mct-sel"
              type="number"
              step="0.1"
              min={0}
              max={20}
              value={request.cfg_scale ?? ""}
              placeholder="default"
              onChange={(e) => setRequest({ cfg_scale: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </span>
        </div>

        <div className="mc-row" style={{ marginTop: 12 }}>
          <button type="button" className="mc-btn mc-btn-go" disabled={!canRender} onClick={() => void renderSong()}>
            <Icon.Sparkles width={13} height={13} />{" "}
            {running ? "Rendering…" : useProducer && (!production || stale) ? "Produce + render" : "Render the song"}
          </button>
          <span className="mc-note">
            {!useProducer && !input.lyrics.trim()
              ? "Exactly-as-typed needs lyrics — the engine sings them. Or switch on the AI Producer to have them written."
              : "One call, one candidate. A full song takes minutes on the GPU."}
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

// ----- the producer's desk -----------------------------------------------------

function ProducerDesk({
  production,
  stale,
  onChange,
}: {
  production: Production;
  stale: boolean;
  onChange: (p: Partial<Production>) => void;
}) {
  const p = production;
  const chars = charCount(p.style);
  const passed = p.checks.filter((c) => c.pass).length;
  const plan = p.plan;

  const everything = [
    `AI-OPTIMIZED SONG PROMPT\n${p.optimizedPrompt}`,
    `STYLE (${chars}/${STYLE_LIMIT})\n${p.style}`,
    `LYRICS\n${p.lyrics}`,
    `VOCAL DIRECTION\n${p.vocalDirection}`,
    `PRODUCTION DIRECTION\n${p.productionDirection}`,
    `ARRANGEMENT\n${p.arrangement.map((a) => `${a.section} (${a.energy}/10): ${a.what}`).join("\n")}`,
  ].join("\n\n");

  return (
    <section className="mc-panel mct-desk">
      <div className="mc-panel-h">
        <h3>2 · The AI Producer&apos;s version</h3>
        <span className="mc-tag2">
          {p.engine === "ai" ? "AI Producer" : "rule-based producer (no AI key)"} · {plan.mode === "advanced" ? "advanced prompt — cleaned up, not rewritten" : "basic idea — expanded"} ·
          QC {passed}/{p.checks.length}
          {p.revisions ? " after 1 revision" : ""}
        </span>
        <CopyButton text={everything} label="Copy all" />
      </div>

      {stale && <p className="mc-note is-warn">You changed the style or lyrics since this was produced. Re-produce to include it.</p>}
      {p.warnings.map((w) => (
        <p key={w} className="mc-note is-warn">
          {w}
        </p>
      ))}

      <div className="mct-compare">
        <div>
          <div className="mct-k">Original idea</div>
          <blockquote className="mct-orig">{p.original.style || "(lyrics only)"}</blockquote>
        </div>
        <div>
          <div className="mct-k">
            AI-optimized song prompt <CopyButton text={p.optimizedPrompt} label="Copy" small />
          </div>
          <textarea
            className="mc-input mc-area"
            rows={6}
            value={p.optimizedPrompt}
            onChange={(e) => onChange({ optimizedPrompt: e.target.value })}
          />
        </div>
      </div>

      <div className="mct-k">
        Style <span className={`mct-count ${chars > STYLE_LIMIT ? "is-over" : ""}`}>{chars.toLocaleString()} / {STYLE_LIMIT.toLocaleString()}</span>
        <CopyButton text={p.style} label="Copy style" small />
      </div>
      <textarea
        className="mc-input mc-area"
        rows={5}
        value={p.style}
        onChange={(e) => onChange({ style: Array.from(e.target.value).slice(0, STYLE_LIMIT).join("") })}
      />

      <div className="mct-two">
        <div>
          <div className="mct-k">
            Lyrics <CopyButton text={p.lyrics} label="Copy lyrics" small />
          </div>
          <textarea className="mc-input mc-area mct-lyrics" rows={18} value={p.lyrics} onChange={(e) => onChange({ lyrics: e.target.value })} />
        </div>
        <div>
          <div className="mct-k">
            Vocal direction <CopyButton text={p.vocalDirection} label="Copy" small />
          </div>
          <p className="mct-dir">{p.vocalDirection}</p>
          <div className="mct-k">
            Production direction <CopyButton text={p.productionDirection} label="Copy" small />
          </div>
          <p className="mct-dir">{p.productionDirection}</p>
          <div className="mct-k">Arrangement</div>
          <table className="mct-table">
            <tbody>
              {p.arrangement.map((a, i) => (
                <tr key={i}>
                  <th>{a.section}</th>
                  <td className="mct-energy" title={`energy ${a.energy}/10`}>
                    <i style={{ width: `${a.energy * 10}%` }} />
                  </td>
                  <td>{a.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="mct-more">
        <summary>What the producer heard · {plan.intent}</summary>
        <table className="mct-table">
          <tbody>
            {plan.mustKeep.length > 0 && (
              <tr>
                <th>Kept from you</th>
                <td>{plan.mustKeep.join(" · ")}</td>
              </tr>
            )}
            {PLAN_ROWS.filter((r) => plan[r.id]).map((r) => (
              <tr key={r.id}>
                <th>{r.label}</th>
                <td>{String(plan[r.id])}</td>
              </tr>
            ))}
            {plan.references.map((r) => (
              <tr key={r.name}>
                <th>Ref · {r.name}</th>
                <td>{r.takeaway}</td>
              </tr>
            ))}
            {plan.assumptions.length > 0 && (
              <tr>
                <th>Assumed</th>
                <td>{plan.assumptions.join(" · ")}</td>
              </tr>
            )}
            {plan.contradictions.length > 0 && (
              <tr>
                <th>Contradictions fixed</th>
                <td>{plan.contradictions.join(" · ")}</td>
              </tr>
            )}
            {plan.missing.length > 0 && (
              <tr>
                <th>Was missing</th>
                <td>{plan.missing.join(" · ")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </details>

      <details className="mct-more">
        <summary>
          Quality control · {passed}/{p.checks.length} passed
        </summary>
        <table className="mct-table mct-qc">
          <tbody>
            {QC_GROUPS.flatMap((g) =>
              p.checks
                .filter((c) => c.group === g)
                .map((c) => (
                  <tr key={c.id} className={c.pass ? "is-pass" : "is-fail"}>
                    <th>{g}</th>
                    <td>{c.pass ? "✓" : "✗"}</td>
                    <td>
                      {c.label}
                      {!c.pass && <em> — {c.fix}</em>}
                    </td>
                  </tr>
                )),
            )}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function CopyButton({ text, label, small }: { text: string; label: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`mc-btn mc-btn-s mct-copy ${small ? "is-small" : ""}`}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />} {done ? "Copied" : label}
    </button>
  );
}
