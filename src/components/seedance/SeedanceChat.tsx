"use client";

// ---------------------------------------------------------------------------
// "The film" — the panel that was already there, now the one you talk to.
//
// It used to be a sentence about the film that every prompt inherited, sitting
// above a timeline you edited by hand. It is the same panel in the same place,
// and it still governs the whole reel — but the sentence is a conversation now,
// and the aspect ratio and the camera deck it always carried are still on it.
//
// There is deliberately NO second chat anywhere in this app. A director panel
// beside the timeline and a director box above it are two places to say the
// same thing, and the one that wins is whichever the owner happened to click:
// so the film's own panel is the only one, and it holds everything — the track,
// the uploads, the @-mentions, the plan.
//
// It is the same conversation Jarvis Studio has: the same route
// (/api/jarvis/chat), the same @-mentions for workflows and for people out of
// the Photos library, the same @Subject / @Audio references, the same forms,
// the same uploads, the same local renderer. Rebuilding any of that here would
// mean two versions of it drifting apart.
//
// The one thing that is new: the TRACK comes first. Drop a song and it is
// decoded and measured in this browser before a word is typed — tempo, bar
// lines, sections, drops — and those measurements travel with every message as
// the clock the director has to cut to. The song itself is never uploaded; only
// its measurements, and (if asked) 40-second clips for transcription.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { Markdown } from "../jarvis/Markdown";
import { ReferenceTile } from "../jarvis/ReferenceTile";
import { StudioFormCard, type FormSubmission } from "../jarvis/StudioFormCard";
import { FilmProgress } from "../jarvis/FilmProgress";
import { TrackStrip } from "./TrackStrip";
import {
  ACCEPT_REFERENCES,
  MAX_ATTACHMENTS,
  describedNotes,
  isDescribed,
  referenceFiles,
  toAttachment,
  type Attachment,
} from "@/lib/jarvis/chatImages";
import { answerText, type StudioForm } from "@/lib/studio/forms";
import { useCinemaOutput, useStudioModels } from "@/lib/studio/useCinema";
import { moveQueryAt, movesIn, searchMoves, type CinemaSelection } from "@/lib/studio/cinema";
import { CinemaBar } from "../jarvis/CinemaDeck";
import { ASPECT_RATIOS } from "@/lib/seedance/constants";
import { mentionQueryAt, mentionsIn } from "@/lib/studio/workflows";
import { charactersIn } from "@/lib/studio/characters";
import { useCharacters } from "@/lib/studio/useCharacters";
import { draftSource, numberReferences, type ReferenceMention } from "@/lib/studio/references";
import { atRowsFor, MentionMenu, type AtRow } from "../jarvis/MentionMenu";
import { bridgeStatus } from "@/lib/studio/render";
import { cancelFilm, startFilm, watchFilm, type FilmView } from "@/lib/studio/film";
import { cleanScore, toStoryboard, type Score } from "@/lib/seedance/score";
import type { AudioTimeline, VisualMode } from "@/lib/seedance/audio/timeline";
import type { LoadedAudio } from "@/lib/soundprint/audio-analysis";
import type { AspectRatio, Reel } from "@/lib/seedance/types";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { uid } from "@/lib/utils";

/** Conversation only. Structure, never media. */
const KEY = "seedance-chat:v1";

/** What the empty panel offers, the way Smart Shot's director does. */
const STARTERS = [
  "Cut this to the drops",
  "Put the singer on camera through the chorus",
  "Make it night-time and neon",
  "Fewer, longer cuts",
];

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: Attachment[];
  form?: StudioForm | null;
  formDone?: boolean;
  /** Set once a score came back on this turn, so the panel can say so. */
  scored?: boolean;
  error?: string;
  notices?: string[];
}

interface AgentResponse {
  text?: string;
  form?: StudioForm | null;
  score?: unknown;
  notices?: string[];
  error?: string;
}

export function SeedanceChat({
  reel,
  onScore,
  onSong,
  onCinema,
  onAspect,
}: {
  reel: Reel;
  /** A finished plan, for the timeline to lay out. */
  onScore: (score: Score) => void;
  /** The track, so the timeline's song lane gets it too. */
  onSong?: (file: File) => void;
  /** The film-wide camera deck every prompt inherits. */
  onCinema: (s: CinemaSelection) => void;
  onAspect: (a: AspectRatio) => void;
}) {
  const [timeline, setTimeline] = useState<AudioTimeline | null>(null);
  const [audio, setAudio] = useState<LoadedAudio | null>(null);
  const [songFile, setSongFile] = useState<File | null>(null);
  const [mode, setMode] = useState<VisualMode>("music-video");

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);

  const [output] = useCinemaOutput();
  const cinema = reel.cinema;
  const [modelChain] = useStudioModels();
  const { characters } = useCharacters();

  const [filmView, setFilmView] = useState<FilmView | null>(null);
  const [filmId, setFilmId] = useState<string | null>(null);
  const [film, setFilm] = useState<{ url: string } | null>(null);
  const [local, setLocal] = useState<{ ok: boolean; queue?: number } | null>(null);
  /** The last plan, kept so "Make the film" can be pressed after the fact. */
  const [score, setScore] = useState<Score | null>(null);

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ----- persistence: conversation only ------------------------------------
  useEffect(() => {
    const saved = loadLocal<{ turns?: Turn[]; mode?: VisualMode } | null>(KEY, null);
    if (saved?.turns?.length) setTurns(saved.turns);
    if (saved?.mode) setMode(saved.mode);
  }, []);

  useEffect(() => {
    if (!turns.length) return;
    saveSynced(KEY, {
      mode,
      turns: turns.map((t) => ({
        ...t,
        attachments: t.attachments?.map((a) => ({ ...a, full: a.thumb, file: undefined })),
      })),
    });
  }, [turns, mode]);

  useEffect(() => {
    let alive = true;
    const check = () => void bridgeStatus().then((s) => alive && setLocal(s));
    check();
    const t = setInterval(check, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, busy]);

  // The timeline's song lane wants the same file this panel measured.
  useEffect(() => {
    if (songFile && onSong) onSong(songFile);
    // Only when the file itself changes; onSong is the parent's stable handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songFile]);

  // ----- references, numbered across the conversation -----------------------
  const references = useMemo(
    (): ReferenceMention[] =>
      numberReferences(
        [...turns.flatMap((t) => t.attachments ?? []), ...attachments].map(draftSource),
      ),
    [turns, attachments],
  );

  const subjectUrls = useMemo(
    () =>
      [...turns.flatMap((t) => t.attachments ?? []), ...attachments]
        .filter((a) => a.kind !== "audio")
        .map((a) => a.full),
    [turns, attachments],
  );

  // ----- the @ and # menus --------------------------------------------------
  const [menu, setMenu] = useState<{ kind: "at" | "hash"; start: number; caret: number; query: string } | null>(
    null,
  );
  const [menuIndex, setMenuIndex] = useState(0);

  /**
   * The @ menu is the same one Chat and Studio show — the people, then this
   * conversation's own uploads with their thumbnails, then the workflows. It
   * used to be a flat list of names with the uploads last and no pictures,
   * which is the one group you cannot recognise by its label alone.
   */
  const atRows = useMemo<AtRow[]>(
    () => (menu?.kind === "at" ? atRowsFor(menu.query, characters, references) : []),
    [menu, characters, references],
  );

  /** The # menu stays its own thing: a camera move has nothing to picture. */
  const moveOptions = useMemo(
    () => (menu?.kind === "hash" ? searchMoves(menu.query, 6) : []),
    [menu],
  );

  const menuCount = menu?.kind === "hash" ? moveOptions.length : atRows.length;

  const chooseAtRow = (row: AtRow | undefined) => {
    if (!row) return;
    const token =
      row.group === "cast"
        ? row.character.token
        : row.group === "ref"
          ? row.reference.token
          : row.mention.token;
    choose(`@${token}`);
  };

  const chooseAt = (i: number) => {
    if (menu?.kind === "hash") {
      const move = moveOptions[i];
      if (move) choose(`#${move.id}`);
      return;
    }
    chooseAtRow(atRows[i]);
  };

  const readMenu = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const at = mentionQueryAt(el.value, caret);
    const hash = moveQueryAt(el.value, caret);
    const next = at
      ? { kind: "at" as const, start: at.start, caret, query: at.query }
      : hash
        ? { kind: "hash" as const, start: hash.start, caret, query: hash.query }
        : null;
    setMenu(next);
    if (!next || next.query !== menu?.query) setMenuIndex(0);
  };

  const choose = (insert: string) => {
    if (!menu) return;
    const before = draft.slice(0, menu.start);
    const after = draft.slice(menu.caret).replace(/^\S*/, "");
    const text = `${before}${insert} ${after.replace(/^\s/, "")}`;
    setDraft(text);
    setMenu(null);
    const at = before.length + insert.length + 1;
    requestAnimationFrame(() => {
      boxRef.current?.focus();
      boxRef.current?.setSelectionRange(at, at);
    });
  };

  // ----- attachments --------------------------------------------------------
  const attach = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setProblem(`Up to ${MAX_ATTACHMENTS} references per message.`);
      return;
    }
    setProblem(files.length > room ? `Up to ${MAX_ATTACHMENTS} — I added the first ${room}.` : "");
    const added: Attachment[] = [];
    for (const f of files.slice(0, room)) {
      try {
        const a = await toAttachment(f, uid());
        added.push(a);
        // The FIRST piece of audio is the track this film is cut to. A later one
        // is an ordinary reference — a second song must not silently replace the
        // one the plan was measured against.
        if (a.kind === "audio" && !songFile) setSongFile(f);
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    }
    setAttachments((list) => [...list, ...added].slice(0, MAX_ATTACHMENTS));
    boxRef.current?.focus();
  };

  // ----- sending ------------------------------------------------------------
  const send = async (text: string, files: Attachment[] = attachments, formTurn?: string) => {
    const body = text.trim();
    if ((!body && !files.length) || busy) return;
    setProblem("");
    setDraft("");
    setAttachments([]);
    setBusy(true);

    const firstTrack =
      references.filter((r) => r.kind === "audio").length - files.filter(isDescribed).length + 1;
    const notes = describedNotes(files, Math.max(1, firstTrack));
    const sent = notes ? `${body}\n\n${notes}` : body;

    const mine: Turn = { id: uid(), role: "user", text: sent, attachments: files };
    const next = [...turns.map((t) => (t.id === formTurn ? { ...t, formDone: true } : t)), mine];
    setTurns(next);

    try {
      const named = charactersIn(sent, characters);
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((t) => ({
            role: t.role,
            content: t.text,
            images:
              t.role === "user"
                ? (t.attachments ?? []).filter((a) => a.kind !== "audio").map((a) => a.full)
                : [],
          })),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          workflows: [...new Set(["music-video", ...mentionsIn(sent).map((m) => m.token)])],
          cinema,
          // Film setup › Models, same chain the Studio uses: one place decides
          // which model plans a film, wherever the film is being planned.
          models: modelChain,
          moves: movesIn(sent).map((m) => m.id),
          output,
          characters: named.map((c) => ({
            token: c.token,
            name: c.name,
            kind: c.kind,
            role: c.role,
            appearance: c.appearance,
            identifiers: c.identifiers,
            wardrobe: c.wardrobe,
            notes: c.notes,
            pictures: c.pictures,
          })),
          audio: timeline,
          audioMode: mode,
        }),
      });
      const data = (await res.json()) as AgentResponse;
      if (data.error) throw new Error(data.error);

      // The trust boundary for a plan is HERE: only this browser holds the
      // measured timeline its shot times mean anything against.
      const plan = data.score ? cleanScore(data.score, timeline) : null;
      if (plan) {
        setScore(plan);
        onScore(plan);
      }
      setTurns((all) => [
        ...all,
        {
          id: uid(),
          role: "assistant",
          text: data.text ?? "",
          form: data.form ?? null,
          scored: Boolean(plan),
          notices: data.notices,
        },
      ]);
    } catch (e) {
      setTurns((all) => [
        ...all,
        {
          id: uid(),
          role: "assistant",
          text: "",
          error: e instanceof Error ? e.message : "That didn't reach the model.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // ----- the film -----------------------------------------------------------
  const characterRefs = useMemo(
    () =>
      characters
        .filter((c) => c.images?.length)
        .map((c) => ({ token: c.token, name: c.name, images: c.images.slice(0, 2) })),
    [characters],
  );

  /**
   * Render the whole film.
   *
   * The plan is taken from the REEL rather than from the score this panel last
   * received, because the owner has been dragging lip-sync ranges on the
   * timeline since then and those edits are the ones that decide which cuts
   * sing. Rendering the panel's own copy would quietly render the older film.
   */
  const makeFilm = async () => {
    if (!score) return;
    if (!songFile) {
      setProblem("The song file isn't in this session any more — drop it in again to score the film.");
      return;
    }
    setProblem("");
    setFilm(null);
    setFilmView(null);
    try {
      const soundtrack = await fileToDataUrl(songFile);
      const id = await startFilm({
        board: toStoryboard({ ...score, lipsync: reel.lipsync }),
        subjects: subjectUrls,
        characters: characterRefs,
        soundtrack,
        audioMode: "master",
      });
      setFilmId(id);
      const result = await watchFilm(id, setFilmView);
      setFilm({ url: result.url });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "The film couldn't be started.");
      setFilmId(null);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-xl border border-line bg-panel p-3"
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void attach(referenceFiles(e.dataTransfer));
      }}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">The film</h2>
        <span className="truncate text-[10px] text-ink-faint">
          Drop a song, say what it is — the plan lands on the timeline
        </span>
        <div className="ml-auto flex shrink-0 overflow-hidden rounded-md border border-line">
          {ASPECT_RATIOS.map((a) => (
            <button
              key={a.value}
              onClick={() => onAspect(a.value)}
              aria-pressed={reel.aspectRatio === a.value}
              title={a.note}
              className={
                "px-2 py-1 text-[10px] font-medium tabular-nums transition " +
                (reel.aspectRatio === a.value
                  ? "bg-accent/15 text-accent"
                  : "text-ink-muted hover:bg-panel-2 hover:text-ink")
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <TrackStrip
        file={songFile}
        timeline={timeline}
        audio={audio}
        mode={mode}
        onMode={setMode}
        onTimeline={setTimeline}
        onAudio={setAudio}
        onFile={setSongFile}
        onProblem={setProblem}
        compact
      />

      <div ref={listRef} className="relative min-h-0 flex-1 space-y-2.5 overflow-y-auto">
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border border-dashed border-accent/60 bg-panel/85">
            <p className="flex items-center gap-2 text-xs text-ink">
              <Icon.Waveform width={14} height={14} /> Drop a song, clip or picture
            </p>
          </div>
        )}

        {!turns.length && (
          <div className="space-y-1.5">
            <p className="text-[11px] text-ink-faint">Try:</p>
            {STARTERS.map((t) => (
              <button
                key={t}
                onClick={() => void send(t)}
                disabled={busy}
                className="block w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-left text-[11px] text-ink-muted transition hover:border-accent hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {t}
              </button>
            ))}
            <p className="pt-1 text-[10px] leading-relaxed text-ink-faint">
              <b className="text-ink-muted">@</b> for a skill, a person from your Photos, or an
              upload · <b className="text-ink-muted">#</b> for a camera move
            </p>
          </div>
        )}

        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ml-auto max-w-[92%] rounded-xl rounded-br-sm border border-line bg-panel-2 px-2.5 py-1.5">
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink">
                {stripNotes(t.text)}
              </p>
              {!!t.attachments?.length && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.attachments.map((a) => (
                    <ReferenceTile key={a.id} attachment={a} title={a.name} onRemove={() => {}} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div key={t.id} className="space-y-1.5">
              {t.error ? (
                <p className="rounded-xl border border-[#ffb4a0]/40 bg-[#ffb4a0]/5 px-2.5 py-1.5 text-[12px] text-[#ffb4a0]">
                  {t.error}
                </p>
              ) : (
                <>
                  {t.text && (
                    <div className="text-[12px] leading-relaxed text-ink">
                      <Markdown text={t.text} />
                    </div>
                  )}
                  {t.scored && (
                    <p className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-1.5 text-[11px] text-accent">
                      <Icon.Check width={11} height={11} />
                      The plan is on the timeline and the storyboard below it.
                    </p>
                  )}
                  {t.notices?.map((n) => (
                    <p key={n} className="text-[10px] text-ink-faint">
                      {n}
                    </p>
                  ))}
                  {t.form && (
                    <StudioFormCard
                      form={t.form}
                      done={Boolean(t.formDone)}
                      busy={busy}
                      onSubmit={(s: FormSubmission) =>
                        void send(
                          answerText(
                            t.form!,
                            s.values,
                            Object.fromEntries(
                              Object.entries(s.images).map(([k, v]) => [k, v.length]),
                            ),
                          ),
                          Object.values(s.images).flat(),
                          t.id,
                        )
                      }
                    />
                  )}
                </>
              )}
            </div>
          ),
        )}

        {busy && (
          <p className="flex items-center gap-2 text-[11px] text-ink-faint">
            <Icon.Refresh width={11} height={11} className="animate-spin" />
            Reading the track and planning the cuts…
          </p>
        )}

        {filmView && (
          <FilmProgress
            view={filmView}
            film={film}
            onCancel={filmId ? () => void cancelFilm(filmId) : undefined}
            onSave={
              film
                ? () => {
                    const a = document.createElement("a");
                    a.href = film.url;
                    a.download = `${(timeline?.name ?? "film").replace(/[^\w-]+/g, "-")}.mp4`;
                    a.click();
                  }
                : undefined
            }
          />
        )}
      </div>

      {score && !filmId && (
        <div>
          <button
            onClick={() => void makeFilm()}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-[#06121a] transition hover:bg-accent-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Icon.Film width={13} height={13} /> Make the film
          </button>
          <p className="mt-1 text-center text-[10px] text-ink-faint">
            Renders every cut here, free, and lays the song over it as the master.
          </p>
        </div>
      )}

      {/* ----- composer ----- */}
      <div>
        {!!attachments.length && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {attachments.map((a) => {
              const ref = references.find((r) => r.id === a.id);
              return (
                <ReferenceTile
                  key={a.id}
                  attachment={a}
                  badge={ref ? (ref.kind === "audio" ? `A${ref.n}` : String(ref.n)) : undefined}
                  title={ref ? `${ref.label} — ${a.name}` : a.name}
                  onName={
                    ref
                      ? () => setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${ref.token} `)
                      : undefined
                  }
                  onRemove={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}
                />
              );
            })}
          </div>
        )}

        {problem && <p className="mb-1 text-[10px] text-[#ffb4a0]">{problem}</p>}

        <div className="relative">
          {menu?.kind === "at" && (
            <MentionMenu
              rows={atRows}
              index={menuIndex}
              onIndex={setMenuIndex}
              onChoose={chooseAtRow}
            />
          )}
          {menu?.kind === "hash" && moveOptions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Camera moves"
              className="absolute bottom-full left-0 z-30 mb-1 max-h-60 w-full overflow-y-auto rounded-xl border border-line bg-panel-2 py-1 shadow-lg shadow-black/50"
            >
              {moveOptions.map((m, i) => (
                <li key={m.id}>
                  <button
                    role="option"
                    aria-selected={i === menuIndex}
                    onMouseEnter={() => setMenuIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(`#${m.id}`);
                    }}
                    className={`block w-full px-2.5 py-1.5 text-left transition ${
                      i === menuIndex ? "bg-panel text-ink" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    <span className="block truncate text-[11px] font-medium">{m.name}</span>
                    <span className="block truncate text-[10px] text-ink-faint">{m.note}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-end gap-1.5">
            <button
              onClick={() => fileRef.current?.click()}
              title="Attach a song, a clip or a picture"
              aria-label="Attach a file"
              className="mb-0.5 shrink-0 rounded-lg border border-line p-1.5 text-ink-muted transition hover:border-accent hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Icon.Upload width={13} height={13} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT_REFERENCES}
              multiple
              hidden
              onChange={(e) => {
                void attach(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <textarea
              ref={boxRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                readMenu(e.target);
              }}
              onClick={(e) => readMenu(e.currentTarget)}
              onKeyDown={(e) => {
                if (menu && menuCount) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMenuIndex((i) => (i + 1) % menuCount);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMenuIndex((i) => (i - 1 + menuCount) % menuCount);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    chooseAt(menuIndex);
                    return;
                  }
                  if (e.key === "Escape") {
                    setMenu(null);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={3}
              placeholder={
                timeline
                  ? "What should the film be? @skill, @person, @Subject1, #camera-move…"
                  : "Drop a song in first — I measure it here."
              }
              className="min-h-[58px] flex-1 resize-y rounded-xl border border-line bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
            />
            <button
              onClick={() => void send(draft)}
              disabled={busy || (!draft.trim() && !attachments.length)}
              className="mb-0.5 shrink-0 rounded-lg bg-accent p-1.5 text-[#06121a] transition hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label="Send"
            >
              <Icon.Send width={13} height={13} />
            </button>
          </div>
        </div>

        <div className="mt-2">
          <CinemaBar
            selection={cinema}
            onSelection={onCinema}
            text={draft}
            onText={setDraft}
          />
        </div>

        {local && (
          <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-faint">
            <span
              className={`h-1.5 w-1.5 rounded-full ${local.ok ? "bg-emerald-400" : "bg-ink-faint"}`}
              aria-hidden
            />
            {local.ok
              ? `Local renderer on${local.queue ? ` · ${local.queue} queued` : ""}`
              : "Local renderer off"}
          </p>
        )}
      </div>
    </div>
  );
}

/** The measured audio note is for the model; the owner already saw the tile. */
function stripNotes(text: string): string {
  return text.replace(/\n*\[Audio \d+][^\n]*(\n(?![[\w])[^\n]*)*/g, "").trim();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result));
    reader.onerror = () => fail(new Error(`Couldn't read ${file.name || "that track"}.`));
    reader.readAsDataURL(file);
  });
}
