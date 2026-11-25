"use client";

// Video Reverse Engineering — find a reference's shots in the browser, send
// the keyframes for description, and rebuild the structure as a production
// with the owner's own cast. It never face-swaps the original footage.

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowUpRight, Clapperboard, Trash2, Upload, Wand2, X } from "lucide-react";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, when } from "../ui";
import type { Blueprint } from "@/lib/h3-lab/model";
import type { AnalyzeRequest, AnalyzeResponse } from "@/lib/h3-lab/api";
import { genreName, guessGenre } from "@/lib/h3-lab/genres";
import { ResearchStyles } from "../research/ResearchStyles";
import { GenreSelect } from "../research/ShotSpecEditor";
import { DEFAULT_CUT, detectShots, grabKeyframes, sampleDistances, sampleVideo, threshold, timecode, type SampledVideo } from "../research/shotDetect";
import { audioSummary } from "../research/audioSummary";
import { QueueRunPanel } from "../research/QueueRunPanel";

const BODY_LIMIT = 3_900_000;
const PASSES = [
  { perShot: 3, width: 320, quality: 0.7 },
  { perShot: 2, width: 256, quality: 0.7 },
  { perShot: 2, width: 256, quality: 0.55 },
  { perShot: 1, width: 256, quality: 0.5 },
];

export default function Reverse({ lab, go, focus }: SectionProps) {
  const state = lab.state;
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [sampled, setSampled] = useState<SampledVideo | null>(null);
  const [phase, setPhase] = useState<{ label: string; p: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sensitivity, setSensitivity] = useState(DEFAULT_CUT.sensitivity);
  const [genre, setGenre] = useState("movie-scene");
  const [genreTouched, setGenreTouched] = useState(false);
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const [result, setResult] = useState<{ engine: string; notice?: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus) setOpenId(focus);
  }, [focus]);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    if (!genreTouched && file) setGenre(guessGenre(`${file.name} ${note}`));
  }, [file, note, genreTouched]);

  const analyse = useCallback(async (f: File) => {
    if (!f.type.startsWith("video/") && !/\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)) {
      setError(`${f.name} is not a video file.`);
      return;
    }
    cancelled.current = false;
    setError(null);
    setResult(null);
    setSampled(null);
    setFile(f);
    const u = URL.createObjectURL(f);
    setUrl(u);
    setPhase({ label: "Reading frames", p: 0 });
    try {
      const s = await sampleVideo(u, (p) => setPhase({ label: "Reading frames", p }), () => cancelled.current);
      setSampled(s);
    } catch (e) {
      if (!cancelled.current) setError(e instanceof Error ? e.message : "Could not read that video.");
    } finally {
      setPhase(null);
    }
  }, []);

  const distances = useMemo(() => (sampled ? sampleDistances(sampled.samples) : []), [sampled]);
  const shots = useMemo(
    () => (sampled ? detectShots(sampled.samples.map((s) => s.t), distances, sampled.duration, { sensitivity }) : []),
    [sampled, distances, sensitivity],
  );
  const thr = useMemo(() => threshold(distances.slice(1), sensitivity, DEFAULT_CUT.floor), [distances, sensitivity]);

  const thumbAt = (t: number) => {
    if (!sampled) return undefined;
    let best = sampled.samples[0];
    for (const s of sampled.samples) if (s.t <= t + 0.13) best = s;
    return best?.thumb;
  };

  const send = async () => {
    if (!file || !url || !sampled || !shots.length) return;
    setError(null);
    try {
      let body = "";
      setPhase({ label: "Measuring the soundtrack", p: 0 });
      const audio = await audioSummary(file);
      for (const pass of PASSES) {
        setPhase({ label: `Grabbing keyframes (${pass.perShot} per shot, ${pass.width}px)`, p: 0 });
        const frames = await grabKeyframes(url, shots, pass, (p) => setPhase({ label: `Grabbing keyframes (${pass.perShot} per shot, ${pass.width}px)`, p }));
        const req: AnalyzeRequest = {
          name: file.name,
          durationSec: Math.round(sampled.duration * 100) / 100,
          width: sampled.width,
          height: sampled.height,
          genre,
          note: note.trim() || undefined,
          shots: shots.map((s, i) => ({ start: round2(s.start), end: round2(s.end), cutStrength: s.cutStrength, frames: frames[i] ?? [] })),
          audio,
        };
        body = JSON.stringify(req);
        if (body.length <= BODY_LIMIT) break;
      }
      if (body.length > BODY_LIMIT) throw new Error(`Even at the smallest keyframes the request is ${(body.length / 1e6).toFixed(1)} MB — raise the threshold to find fewer shots.`);
      setPhase({ label: "Describing the shots", p: 1 });
      const res = await fetch("/api/h3-lab/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const json = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as AnalyzeResponse | { error: string };
      if (!res.ok || "error" in json) throw new Error("error" in json ? json.error : `HTTP ${res.status}`);
      setResult({ engine: json.engine, notice: json.notice });
      setOpenId(json.blueprintId);
      await lab.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The analysis did not finish.");
    } finally {
      setPhase(null);
    }
  };

  const reset = () => {
    cancelled.current = true;
    setFile(null);
    setSampled(null);
    setResult(null);
    setError(null);
    setGenreTouched(false);
    setNote("");
    if (input.current) input.current.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void analyse(f);
  };

  return (
    <div className="grid rs-root" style={{ gap: 16 }}>
      <ResearchStyles />
      <SectionHead
        eyebrow="Research · Video Reverse Engineering"
        title="Reverse Engineering"
        lede="Drop in a reference. The shots are found here in your browser from colour changes between frames; only small keyframes are sent to be described. The result is a blueprint of the structure — shots, blocking, camera, rhythm — that you rebuild with your own cast. It never face-swaps the original footage."
      />

      <Panel title="Analyse a reference" actions={file ? <button type="button" className="btn ghost sm" onClick={reset}><X size={12} /> Clear</button> : null}>
        <div className="grid" style={{ gap: 14 }}>
          {!file ? (
            <div
              className="rs-drop"
              data-over={over}
              role="button"
              tabIndex={0}
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <Upload size={18} style={{ marginBottom: 6 }} />
              <div><b style={{ color: "var(--ink)" }}>Drop a video here</b> or click to choose one</div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>MP4 or WebM. Nothing is uploaded until you press Reverse-engineer.</div>
            </div>
          ) : (
            <div className="row" style={{ gap: 12 }}>
              <Clapperboard size={16} />
              <b>{file.name}</b>
              {sampled ? (
                <span className="mono muted">{timecode(sampled.duration)} · {sampled.width}×{sampled.height} · {sampled.samples.length} samples</span>
              ) : null}
            </div>
          )}
          <input ref={input} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && void analyse(e.target.files[0])} />

          {phase ? (
            <div className="grid" style={{ gap: 6 }} aria-live="polite">
              <span className="muted" style={{ fontSize: 12 }}>{phase.label}… <span className="mono">{Math.round(phase.p * 100)}%</span></span>
              <div className="rs-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(phase.p * 100)}>
                <i style={{ width: `${phase.p * 100}%` }} />
              </div>
            </div>
          ) : null}

          {error ? <div className="notice bad">{error}</div> : null}

          {sampled && shots.length ? (
            <>
              <div className="grid" style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="eyebrow">{shots.length} shot{shots.length === 1 ? "" : "s"} detected</span>
                  <label className="row" style={{ gap: 8, fontSize: 12 }}>
                    <span className="muted">More cuts</span>
                    <input
                      type="range"
                      min={1.5}
                      max={8}
                      step={0.5}
                      value={sensitivity}
                      onChange={(e) => setSensitivity(Number(e.target.value))}
                      aria-label="Cut threshold"
                      style={{ accentColor: "var(--amber)", width: 160 }}
                    />
                    <span className="muted">Fewer cuts</span>
                    <span className="mono dim" title="median + k × MAD of frame-to-frame colour distance, floor 0.18">k {sensitivity.toFixed(1)} · threshold {thr.toFixed(2)}</span>
                  </label>
                </div>
                <div className="rs-timeline" aria-label="Detected shots, proportional to length">
                  {shots.map((s, i) => {
                    const th = thumbAt(s.start + 0.1);
                    return (
                      <div
                        key={i}
                        title={`Shot ${i + 1}: ${timecode(s.start)}–${timecode(s.end)} · cut strength ${s.cutStrength.toFixed(2)}`}
                        style={{ flex: `${Math.max(0.01, s.end - s.start)} 0 0`, backgroundImage: th ? `url(${th})` : undefined }}
                      >
                        <span>{i + 1}</span>
                      </div>
                    );
                  })}
                </div>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  A cut is a frame-to-frame colour change above the threshold that is also a local peak; shots under 0.5 s merge, at most 40 shots.
                </span>
              </div>

              <div className="rs-form">
                <label className="field">
                  <span>Genre {genreTouched ? "" : "(guessed from the name)"}</span>
                  <GenreSelect value={genre} onChange={(v) => { setGenre(v); setGenreTouched(true); }} />
                </label>
                <label className="field span">
                  <span>Note (optional)</span>
                  <input className="in" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What it is, what to learn from it" />
                </label>
              </div>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => void send()} disabled={Boolean(phase)}>
                  <Wand2 size={13} /> Reverse-engineer {shots.length} shot{shots.length === 1 ? "" : "s"}
                </button>
                <span className="muted" style={{ fontSize: 11.5 }}>Sends up to 3 keyframes per shot (320 px), smaller if the request would pass 4 MB.</span>
              </div>
            </>
          ) : null}

          {result ? (
            <div className={`notice ${result.engine === "ai" ? "cyan" : ""}`}>
              Blueprint saved — described by <b>{result.engine === "ai" ? "the AI judge" : "the offline describer"}</b>.{result.notice ? ` ${result.notice}` : ""}
            </div>
          ) : null}
        </div>
      </Panel>

      <QueueRunPanel />

      <Blueprints state={state} lab={lab} go={go} openId={openId} setOpenId={setOpenId} />
    </div>
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ----- blueprints ------------------------------------------------------------------------

function Blueprints({ state, lab, go, openId, setOpenId }: { state: SectionProps["lab"]["state"]; lab: SectionProps["lab"]; go: SectionProps["go"]; openId: string | null; setOpenId: (id: string | null) => void }) {
  const [bp, setBp] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = [...state.blueprints].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    setBp(null);
    setErr(null);
    if (!openId) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/h3-lab/blueprint?id=${encodeURIComponent(openId)}`)
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { blueprint?: Blueprint; error?: string };
        if (!r.ok || !j.blueprint) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (alive) setBp(j.blueprint);
      })
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : "Could not load that blueprint."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [openId]);

  return (
    <>
      <Panel title="Blueprints" meta={`${list.length}`} bodyClass="tbl-wrap">
        {list.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th>Source</th>
                <th>Shots</th>
                <th>Length</th>
                <th className="hide-sm">Genre</th>
                <th className="hide-sm">Style</th>
                <th className="hide-sm">Made</th>
              </tr>
            </thead>
            <tbody>
              {list.map((b) => (
                <tr key={b.id} className="clickable" aria-selected={b.id === openId} onClick={() => setOpenId(b.id)}>
                  <td>{b.cover ? <img className="rs-thumb-sm" src={b.cover} alt="" /> : <span className="rs-thumb-sm" />}</td>
                  <td>{b.sourceName}</td>
                  <td className="mono">{b.shotCount}</td>
                  <td className="mono">{timecode(b.durationSec)}</td>
                  <td className="hide-sm dim">{genreName(b.genre)}</td>
                  <td className="hide-sm dim" style={{ maxWidth: 260 }}>{b.style}</td>
                  <td className="hide-sm mono muted">{when(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="panel-body">
            <Empty title="No blueprints yet.">Analyse a reference above — its blueprint lands here.</Empty>
          </div>
        )}
      </Panel>

      {openId ? (
        loading ? (
          <p className="muted">Loading the blueprint…</p>
        ) : err ? (
          <div className="notice bad">{err}</div>
        ) : bp ? (
          <BlueprintView key={bp.id} bp={bp} lab={lab} go={go} onDeleted={() => setOpenId(null)} />
        ) : null
      ) : null}
    </>
  );
}

function BlueprintView({ bp, lab, go, onDeleted }: { bp: Blueprint; lab: SectionProps["lab"]; go: SectionProps["go"]; onDeleted: () => void }) {
  const state = lab.state;
  const [title, setTitle] = useState(`${bp.sourceName.replace(/\.[a-z0-9]+$/i, "")} — recreated`);
  const [cast, setCast] = useState<Record<string, string>>({});
  const [envs, setEnvs] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  const recreate = async () => {
    const castMap = Object.fromEntries(Object.entries(cast).filter(([, v]) => v));
    const envMap = Object.fromEntries(Object.entries(envs).filter(([, v]) => v));
    const r = await lab.act({ action: "blueprint.recreate", id: bp.id, title: title.trim() || `${bp.sourceName} — recreated`, castMap, envMap }, "Production created from the blueprint");
    if (r?.id) go("productions", r.id);
  };

  return (
    <Panel
      title={<span className="serif" style={{ fontSize: 22 }}>{bp.sourceName}</span>}
      meta={`${bp.shots.length} shots · ${timecode(bp.durationSec)} · ${bp.width}×${bp.height}`}
      actions={
        <span className="row" style={{ gap: 6 }}>
          <Chip>{bp.detection}</Chip>
          <Chip tone={bp.engine === "ai" ? "cyan" : undefined}>{bp.engine === "ai" ? "AI-described" : "offline"}</Chip>
          {confirm ? (
            <>
              <button type="button" className="btn danger sm" onClick={async () => { const r = await lab.act({ action: "blueprint.delete", id: bp.id }, "Blueprint deleted"); if (r) onDeleted(); }}>Delete for good</button>
              <button type="button" className="btn ghost sm" onClick={() => setConfirm(false)}>Keep</button>
            </>
          ) : (
            <button type="button" className="btn ghost sm" onClick={() => setConfirm(true)} aria-label="Delete blueprint"><Trash2 size={12} /></button>
          )}
        </span>
      }
    >
      <div className="grid" style={{ gap: 16 }}>
        {bp.notice ? <div className="notice">{bp.notice}</div> : null}
        <dl className="rs-kv" style={{ margin: 0 }}>
          <dt>Genre</dt><dd>{genreName(bp.genre)}</dd>
          <dt>Style</dt><dd>{bp.style || "—"}</dd>
          <dt>Editing rhythm</dt><dd>{bp.editingRhythm || "—"}</dd>
          <dt>Sound</dt><dd>{bp.sound || "—"}</dd>
          <dt>Characters</dt>
          <dd>{bp.characters.length ? bp.characters.map((c) => <div key={c.label}><b style={{ color: "var(--ink)" }}>{c.label}</b> — {c.description}</div>) : "none described"}</dd>
          <dt>Environments</dt>
          <dd>{bp.environments.length ? bp.environments.map((c) => <div key={c.label}><b style={{ color: "var(--ink)" }}>{c.label}</b> — {c.description}</div>) : "none described"}</dd>
        </dl>

        <div className="tbl-wrap rs-scroll" style={{ maxHeight: 640 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Keyframes</th>
                <th>Who · where</th>
                <th>Action</th>
                <th className="hide-sm">Dialogue · emotion</th>
                <th>Camera</th>
                <th className="hide-sm">Light · set · props</th>
                <th className="hide-sm">In</th>
              </tr>
            </thead>
            <tbody>
              {bp.shots.map((s) => (
                <tr key={s.index}>
                  <td className="mono">{s.index + 1}</td>
                  <td className="mono" style={{ whiteSpace: "nowrap", fontSize: 11.5 }}>{timecode(s.start)}<br />{timecode(s.end)}</td>
                  <td>
                    <div className="row" style={{ gap: 3, flexWrap: "nowrap" }}>
                      {s.keyframes.map((k, i) => <img key={i} className="rs-thumb-sm" style={{ width: 64 }} src={k} alt={`Shot ${s.index + 1} keyframe ${i + 1}`} loading="lazy" />)}
                    </div>
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <span className="rs-pill-list">{s.characters.map((c) => <Chip key={c}>{c}</Chip>)}</span>
                    <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{s.positions}</div>
                  </td>
                  <td style={{ minWidth: 180 }}>{s.actions}</td>
                  <td className="hide-sm dim" style={{ minWidth: 140 }}>{s.dialogue ? <>“{s.dialogue}”<br /></> : null}<span className="muted">{s.emotion}</span></td>
                  <td className="mono" style={{ fontSize: 11.5, minWidth: 120 }}>{s.camera.angle}<br />{s.camera.move} · {s.camera.amount} · {s.camera.speed}</td>
                  <td className="hide-sm dim" style={{ fontSize: 12, minWidth: 170 }}>{s.lighting}<br />{s.environment}{s.props ? <><br /><span className="muted">{s.props}</span></> : null}</td>
                  <td className="hide-sm mono muted" style={{ fontSize: 11 }}>{s.transitionIn}<br />cut {s.cutStrength.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid notice cyan" style={{ gap: 12 }}>
          <div>
            <b>Recreate with your own cast.</b> This rebuilds the structure — shots, blocking, camera, rhythm — as a production. Your characters and sets replace the reference's people and places; the original footage is never used or face-swapped.
          </div>
          <label className="field">
            <span>Production title</span>
            <input className="in" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="rs-form">
            {bp.characters.map((c) => (
              <label className="field" key={c.label}>
                <span>{c.label} →</span>
                <select className="in" value={cast[c.label] ?? ""} onChange={(e) => setCast({ ...cast, [c.label]: e.target.value })}>
                  <option value="">Leave unmapped</option>
                  {state.characters.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            ))}
            {bp.environments.map((c) => (
              <label className="field" key={c.label}>
                <span>{c.label} →</span>
                <select className="in" value={envs[c.label] ?? ""} onChange={(e) => setEnvs({ ...envs, [c.label]: e.target.value })}>
                  <option value="">Leave unmapped</option>
                  {state.environments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn primary" onClick={() => void recreate()}><Wand2 size={13} /> Recreate as a production</button>
            <button type="button" className="btn ghost sm" onClick={() => go("characters")}>+ new character <ArrowUpRight size={11} /></button>
            <button type="button" className="btn ghost sm" onClick={() => go("environments")}>+ new environment <ArrowUpRight size={11} /></button>
          </div>
        </div>
      </div>
    </Panel>
  );
}
