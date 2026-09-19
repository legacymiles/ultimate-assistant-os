"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { postJson } from "./api";
import * as store from "@/lib/music-classified/store";
import { LEVELS } from "@/lib/music-classified/levels";
import {
  PLAN_FIELDS,
  STYLE_LIMIT,
  TASTE,
  charCount,
  checkStyle,
  libraryRefsFor,
  type StyleBrief,
  type StyleResponse,
} from "@/lib/music-classified/style";
import type { Library, StyleRecord } from "@/lib/music-classified/types";

const DRAFT_KEY = "music-classified:style-draft";

const EMPTY_BRIEF: StyleBrief = { describe: "", energy: null, useTaste: true };

const EXAMPLE =
  "Make me a dark but fun club song. I want the energy of Ride It, the party feeling of Back Back, emotional electronic " +
  "production like Breathe, and a crazy buried singing hook underneath the rapper. The chorus should hit hard but I " +
  "don't want the beat looping exactly the same.";

/** The optional details. Plain-language labels; the producer does the translating. */
const FIELDS: {
  id: keyof StyleBrief;
  label: string;
  placeholder: string;
  wide?: boolean;
  list?: string[];
}[] = [
  {
    id: "idea",
    label: "Song idea",
    placeholder: "What it's about or the moment it's for — e.g. last song before the club closes",
  },
  {
    id: "genre",
    label: "Genre",
    placeholder: "e.g. club rap, melodic house, R&B — or leave it to the producer",
  },
  {
    id: "era",
    label: "Era",
    placeholder: "e.g. 2007 ringtone-rap era, 2020s festival",
  },
  {
    id: "mood",
    label: "Mood / vibe",
    placeholder: "e.g. dark but fun, bittersweet, cocky",
  },
  {
    id: "refSongs",
    label: "Reference songs",
    placeholder: "One per line or comma-separated — say what you like about each",
    wide: true,
  },
  {
    id: "refArtists",
    label: "Reference artists",
    placeholder: "e.g. artists whose sound you want in the room",
  },
  {
    id: "vocal",
    label: "Vocals",
    placeholder: "e.g. male rap with a sung layer underneath",
    list: [
      "Male rap up front, melodic singer underneath",
      "Female lead, breathy and close",
      "Melodic rap with tuned vocals",
      "Duet, call and response",
      "Instrumental — vocal chops only",
    ],
  },
  {
    id: "instruments",
    label: "Instruments / sounds",
    placeholder: "e.g. 808s, plucky synth, piano, strings",
  },
  {
    id: "production",
    label: "Production ideas",
    placeholder: "e.g. crazy intro, beat drops out before the hook",
    wide: true,
  },
  {
    id: "avoid",
    label: "Avoid",
    placeholder: "e.g. trap hi-hat rolls, big-room EDM drop, autotune",
    wide: true,
  },
];

function loadDraft(): StyleBrief {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY_BRIEF, ...(JSON.parse(raw) as StyleBrief) } : EMPTY_BRIEF;
  } catch {
    return EMPTY_BRIEF;
  }
}

function saveDraft(brief: StyleBrief) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(brief));
  } catch {
    /* not remembered — fine */
  }
}

function briefTitle(b: StyleBrief): string {
  const t = (b.idea || b.describe || b.genre || "Untitled").trim().replace(/\s+/g, " ");
  return t.length > 70 ? `${t.slice(0, 68)}…` : t;
}

function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  lib: Library;
  setLib: (lib: Library) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

/**
 * Style Prompt mode: the site as the producer. Casual words and references in;
 * a ≤1000-character production/style prompt out, with the producer's
 * decisions and the quality gate's verdict shown alongside. No lyrics.
 */
export function StyleStudio({ lib, setLib, navOpen, setNavOpen }: Props) {
  const [brief, setBrief] = useState<StyleBrief>(EMPTY_BRIEF);
  const [showDetails, setShowDetails] = useState(false);
  const [record, setRecord] = useState<StyleRecord | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const outBox = useRef<HTMLTextAreaElement>(null);
  const started = useRef(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const d = loadDraft();
    setBrief(d);
    if (FIELDS.some((f) => typeof d[f.id] === "string" && (d[f.id] as string).trim()) || d.energy) setShowDetails(true);
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const patch = (p: Partial<StyleBrief>) => {
    setBrief((b) => {
      const next = { ...b, ...p };
      saveDraft(next);
      return next;
    });
  };

  const refSongs = useMemo(() => lib.songs.filter((s) => s.kind !== "own"), [lib.songs]);
  const matched = useMemo(() => libraryRefsFor(brief, refSongs), [brief, refSongs]);
  const ready = [brief.describe, ...FIELDS.map((f) => brief[f.id])].some((v) => typeof v === "string" && v.trim());

  const chars = charCount(text);
  const over = chars > STYLE_LIMIT;
  // Checks follow the text, so a hand edit is judged by the same gate.
  const checks = useMemo(
    () => (record && text ? checkStyle(text, record.brief, record.plan.identity) : []),
    [text, record],
  );
  const passed = checks.filter((c) => c.pass).length;

  const generate = async () => {
    if (busy || !ready) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    started.current = Date.now();
    setElapsed(0);
    setBusy(true);
    setError("");
    setWarning("");
    try {
      const res = await postJson<StyleResponse>(
        "/api/music-classified/style",
        { brief, libraryRefs: matched },
        ctrl.signal,
      );
      const rec: StyleRecord = {
        id: `style-${Date.now().toString(36)}`,
        brief,
        prompt: res.prompt,
        plan: res.plan,
        checks: res.checks.map(({ id, label, pass }) => ({ id, label, pass })),
        source: res.source,
        revisions: res.revisions,
        trimmed: res.trimmed,
        at: new Date().toISOString(),
      };
      setLib(store.saveStyle(rec));
      setRecord(rec);
      setText(rec.prompt);
      setWarning(res.warning ?? "");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  };

  const open = (r: StyleRecord) => {
    setRecord(r);
    setText(r.prompt);
    setBrief({ ...EMPTY_BRIEF, ...r.brief });
    saveDraft({ ...EMPTY_BRIEF, ...r.brief });
    setWarning("");
    setError("");
    setNavOpen(false);
  };

  const copy = async () => {
    if (over || !text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Clipboard API refused (unfocused frame, older browser) — copy the old way from the box itself.
      const box = outBox.current;
      if (box) {
        box.focus();
        box.select();
        ok = document.execCommand("copy");
      }
    }
    if (!ok) return setError("The browser blocked the clipboard — the text is selected, press Ctrl+C.");
    setError("");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const saveEdit = () => {
    if (!record || over || text === record.prompt) return;
    const next = {
      ...record,
      prompt: text,
      checks: checks.map(({ id, label, pass }) => ({ id, label, pass })),
    };
    setLib(store.saveStyle(next));
    setRecord(next);
  };

  const pct = Math.min(100, (chars / STYLE_LIMIT) * 100);

  return (
    <div className="mcl-body">
      <div className={"mcl-rail__scrim" + (navOpen ? " is-on" : "")} onClick={() => setNavOpen(false)} aria-hidden />

      <div className={"mcl-rail mcl-scroll" + (navOpen ? " is-open" : "")}>
        <p className="mcl-rail__label">Saved style prompts</p>
        {lib.styles.length ? (
          <ul className="mcl-shist">
            {lib.styles.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => open(r)}
                  className={"mcl-shist__item" + (record?.id === r.id ? " is-on" : "")}
                  title={r.prompt}
                >
                  <span className="mcl-shist__title">{briefTitle(r.brief)}</span>
                  <span className="mcl-shist__meta">
                    {charCount(r.prompt)} ch · {r.source === "offline" ? "offline draft · " : ""}
                    {ago(r.at)}
                  </span>
                </button>
                <button
                  className="mcl-shist__del"
                  aria-label="Delete this style prompt"
                  title="Delete"
                  onClick={() => {
                    setLib(store.deleteStyle(r.id));
                    if (record?.id === r.id) {
                      setRecord(null);
                      setText("");
                    }
                  }}
                >
                  <Icon.Trash width={12} height={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mcl-rail__hint">Every style prompt you generate is kept here, synced across your devices.</p>
        )}
      </div>

      <main className="mcl-stage">
        <div className="mcl-style mcl-scroll">
          {/* ---- the brief ---- */}
          <section className="mcl-style__brief" aria-label="Describe the song">
            <div className="mcl-style__head">
              <h2>Describe the song</h2>
              <p>
                Talk like a fan, not an engineer. The producer makes the production decisions — no lyrics in this mode.
              </p>
            </div>

            <textarea
              className="mcl-style__describe"
              value={brief.describe}
              onChange={(e) => patch({ describe: e.target.value })}
              placeholder={EXAMPLE}
              rows={6}
              disabled={busy}
              aria-label="Describe the song"
            />
            {!brief.describe && (
              <button className="mcl-style__example" onClick={() => patch({ describe: EXAMPLE })}>
                Use this example
              </button>
            )}

            <div className="mcl-style__energy">
              <span className="mcl-style__label">Energy</span>
              <div className="mcl-spectrum">
                <button
                  onClick={() => patch({ energy: null })}
                  className={"mcl-stop is-all" + (!brief.energy ? " is-on" : "")}
                  title="Let the producer decide"
                >
                  <b>Auto</b>
                </button>
                {LEVELS.map((l) => (
                  <button
                    key={l.n}
                    onClick={() => patch({ energy: brief.energy === l.n ? null : l.n })}
                    className={"mcl-stop" + (brief.energy === l.n ? " is-on" : "")}
                    style={{ "--h": l.hue } as React.CSSProperties}
                    title={`${l.n} · ${l.name} — ${l.feel}. Typically ${l.bpm} BPM.`}
                  >
                    <b>{l.n}</b>
                  </button>
                ))}
              </div>
              {brief.energy ? (
                <span className="mcl-style__hint">
                  {LEVELS[brief.energy - 1].name} — {LEVELS[brief.energy - 1].feel}
                </span>
              ) : null}
            </div>

            <button className="mcl-style__toggle" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
              <Icon.Chevron width={12} height={12} style={{ transform: showDetails ? "rotate(90deg)" : undefined }} />
              {showDetails ? "Hide details" : "Add details"}
              <span className="mcl-muted">
                {" "}
                — genre, era, references, vocals, instruments, things to avoid (all optional)
              </span>
            </button>

            {showDetails && (
              <div className="mcl-style__grid">
                {FIELDS.map((f) => (
                  <label key={f.id} className={"mcl-style__field" + (f.wide ? " is-wide" : "")}>
                    <span className="mcl-style__label">{f.label}</span>
                    {f.id === "refSongs" ? (
                      <textarea
                        rows={2}
                        value={(brief[f.id] as string) ?? ""}
                        onChange={(e) => patch({ [f.id]: e.target.value })}
                        placeholder={f.placeholder}
                        disabled={busy}
                      />
                    ) : (
                      <input
                        value={(brief[f.id] as string) ?? ""}
                        onChange={(e) => patch({ [f.id]: e.target.value })}
                        placeholder={f.placeholder}
                        list={f.list ? `mcl-style-${f.id}` : undefined}
                        disabled={busy}
                      />
                    )}
                    {f.list && (
                      <datalist id={`mcl-style-${f.id}`}>
                        {f.list.map((o) => (
                          <option key={o} value={o} />
                        ))}
                      </datalist>
                    )}
                  </label>
                ))}
              </div>
            )}

            <label className="mcl-style__taste">
              <input
                type="checkbox"
                checked={brief.useTaste !== false}
                onChange={(e) => patch({ useTaste: e.target.checked })}
                disabled={busy}
              />
              <span>
                <b>Lean on my taste</b>
                <span className="mcl-muted">
                  {" "}
                  — the producer knows what you respond to ({TASTE.references.map((r) => r.song).join(", ")}; the buried
                  “barely-hear-it” hook; rap over a sung layer) and borrows the ideas, never the songs.
                </span>
              </span>
            </label>

            {matched.length > 0 && (
              <p className="mcl-style__matched">
                <Icon.Database width={12} height={12} />
                From your library: {matched.map((m) => `${m.title} (${m.subgenre})`).join(", ")} — their sound profiles
                go to the producer too.
              </p>
            )}

            <div className="mcl-style__go">
              {busy ? (
                <>
                  <button className="mcl-btn" onClick={() => abort.current?.abort()}>
                    Cancel
                  </button>
                  <span className="mcl-console__note is-busy" style={{ marginTop: 0 }}>
                    {elapsed < 25
                      ? "Producer is making the calls — groove, hook, vocal, arrangement…"
                      : elapsed < 60
                        ? "Compressing the decisions into 1,000 characters…"
                        : "Running the quality check and rewriting what failed…"}{" "}
                    {elapsed}s
                  </span>
                </>
              ) : (
                <button className="mcl-btn mcl-btn--primary" onClick={generate} disabled={!ready}>
                  <Icon.Sparkles width={13} height={13} />
                  {record ? "Generate another" : "Generate style prompt"}
                </button>
              )}
            </div>
            {error && <p className="mcl-error">{error}</p>}
          </section>

          {/* ---- the output ---- */}
          <section className="mcl-style__out" aria-label="Style prompt">
            {record ? (
              <>
                <div className="mcl-sp">
                  <div className="mcl-sp__head">
                    <span className="mcl-sp__title">Style prompt</span>
                    {record.source === "offline" && <span className="mcl-sp__badge">offline draft</span>}
                    <span className={"mcl-sp__count" + (over ? " is-over" : "")}>
                      <b>{chars.toLocaleString()}</b> / {STYLE_LIMIT.toLocaleString()} characters
                    </span>
                  </div>
                  <div className="mcl-sp__meter" aria-hidden>
                    <span style={{ width: `${pct}%` }} className={over ? "is-over" : ""} />
                  </div>
                  <textarea
                    ref={outBox}
                    className="mcl-sp__text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onBlur={saveEdit}
                    rows={9}
                    aria-label="Style prompt (editable)"
                  />
                  <div className="mcl-sp__actions">
                    <button
                      className="mcl-btn mcl-btn--primary"
                      onClick={copy}
                      disabled={over || !text}
                      title={over ? `Over ${STYLE_LIMIT} characters — trim it first` : undefined}
                    >
                      {copied ? <Icon.Check width={13} height={13} /> : <Icon.Copy width={13} height={13} />}
                      {copied ? "Copied" : "Copy Style"}
                    </button>
                    {text !== record.prompt && (
                      <button className="mcl-btn mcl-btn--sm" onClick={() => setText(record.prompt)}>
                        Undo edits
                      </button>
                    )}
                    <span className="mcl-muted mcl-sp__note">
                      {over
                        ? `Over the limit by ${chars - STYLE_LIMIT} — trim it before copying.`
                        : record.revisions
                          ? `Quality gate sent it back ${record.revisions}× before it passed.`
                          : "Editable — your changes are checked live."}
                    </span>
                  </div>
                  {(warning || record.trimmed) && (
                    <p className="mcl-sp__warn">
                      {warning || "Ended at the last full clause to stay under the limit."}
                    </p>
                  )}
                </div>

                <div className="mcl-qc">
                  <p className="mcl-qc__head">
                    Quality check{" "}
                    <b>
                      {passed}/{checks.length}
                    </b>
                  </p>
                  <ul>
                    {checks.map((c) => (
                      <li key={c.id} className={c.pass ? "is-pass" : "is-fail"} title={c.pass ? undefined : c.fix}>
                        <span aria-hidden>{c.pass ? "✓" : "✕"}</span>
                        {c.label}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mcl-plan">
                  <button className="mcl-style__toggle" onClick={() => setShowPlan((v) => !v)} aria-expanded={showPlan}>
                    <Icon.Chevron
                      width={12}
                      height={12}
                      style={{
                        transform: showPlan ? "rotate(90deg)" : undefined,
                      }}
                    />
                    Producer notes
                    <span className="mcl-muted"> — the decisions behind the prompt</span>
                  </button>
                  {record.plan.identity && (
                    <p className="mcl-plan__identity">
                      <span>Sonic identity</span>
                      {record.plan.identity}
                    </p>
                  )}
                  {showPlan && (
                    <dl className="mcl-plan__grid">
                      {PLAN_FIELDS.filter((f) => f.id !== "identity" && record.plan[f.id]).map((f) => (
                        <div key={f.id}>
                          <dt>{f.label}</dt>
                          <dd>{record.plan[f.id]}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </>
            ) : (
              <div className="mcl-style__empty">
                <p className="mcl-sp__title">Style prompt</p>
                <p>
                  Up to 1,000 characters of production decisions — groove, drums, bass, melody, vocal behaviour, the
                  buried layers, where it strips down, where it builds, what changes when the chorus comes back — ready
                  to paste into your music generator.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
