"use client";

// ---------------------------------------------------------------------------
// Talking to Jarvis.
//
// A conversation is a list of turns, each of Jarvis's carrying the memories it
// used. Three things appear under an answer when they exist, and each is the
// owner's decision to make, never Jarvis's:
//
//   citations  — what he read to answer
//   proposals  — what he thinks is worth remembering (save or discard)
//   pending    — what he wants to do in the outside world (yes or no)
// ---------------------------------------------------------------------------

import { dashboardDigest, isDashboardTool, runDashboardTool } from "@/lib/jarvis/dashboardBridge";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ConfirmCard } from "./ConfirmCard";
import { SOURCE_COLOR } from "./MemoryCore";
import { uid } from "@/lib/jarvis/store";
import { listSkills } from "@/lib/skills/store";
import {
  MENTION_PATTERN,
  mentionQueryAt,
  mentionsIn,
  resolveMention,
  searchMentions,
  type Mention,
} from "@/lib/studio/workflows";
import { Chip, CinemaBar, CinemaOutputRow } from "./CinemaDeck";
import { MoveArt } from "./CinemaArt";
import { useCinemaOutput, useCinemaSelection } from "@/lib/studio/useCinema";
import { MOVE_PATTERN, moveById, moveQueryAt, movesIn, searchMoves, type CinemaMove } from "@/lib/studio/cinema";
import {
  ACCEPT_REFERENCES,
  describedNotes,
  isDescribed,
  MAX_ATTACHMENTS,
  referenceFiles,
  toAttachment,
  type Attachment,
} from "@/lib/jarvis/chatImages";
import {
  pickTrack,
  REFERENCE_PATTERN,
  referenceToken,
  referencesIn,
  searchReferences,
  TRACK_PATTERN,
  trackToken,
  tracksIn,
  type ReferenceMention,
} from "@/lib/studio/references";
import { charactersIn, searchCharacters } from "@/lib/studio/characters";
import { useCharacters, type Character } from "@/lib/studio/useCharacters";
import { saveToGallery } from "@/lib/studio/gallery";
import { groupSummary, movesIn as movesInText, optionById, CINEMA_GROUPS } from "@/lib/studio/cinema";
import { useMemory } from "@/lib/jarvis/useMemory";
import { answerText, type StudioForm } from "@/lib/studio/forms";
import { runRender, type RenderState } from "@/lib/studio/render";
import { Markdown } from "./Markdown";
import { StudioFormCard, type FormSubmission } from "./StudioFormCard";
import { StoryboardCard } from "./StoryboardCard";
import { FilmProgress } from "./FilmProgress";
import { ReferenceTile } from "./ReferenceTile";
import { cancelFilm, startFilm, watchFilm, type FilmView } from "@/lib/studio/film";
import { boardBrief, hydrate, runtimeSec, timecode, type Storyboard } from "@/lib/studio/storyboard";
import type { PanelFace } from "@/lib/studio/panels";
import { SOURCE_LABEL, type ChatTurn, type Conversation, type JarvisStore, type PendingAction } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";

interface AgentResponse {
  text?: string;
  citations?: { memoryId: string; title: string; source: keyof typeof SOURCE_COLOR; capturedAt: string }[];
  proposals?: { title: string; content: string }[];
  pending?: { tool: string; app: string; summary: string; args: Record<string, unknown> } | null;
  notices?: string[];
  did?: string[];
  form?: StudioForm | null;
  storyboard?: Storyboard | null;
  error?: string;
}

/** What Jarvis should know about the owner without having to search for it. */
/**
 * How many tracks this conversation has already carried.
 *
 * Audio is numbered the way uploads are — "Audio 1" keeps meaning the first
 * one attached — so a later turn has to continue the count rather than start
 * a new one.
 */
function countAudio(turns: ChatTurn[]): number {
  return turns.reduce((n, t) => n + (t.audio?.length ?? 0), 0);
}

/** As far as Subject numbers reach, which is as far as referenceImages() does. */
const MAX_SUBJECTS = 24;
/** Tracks kept nameable. Nobody picks a score for a cut out of more than this. */
const MAX_TRACKS = 12;

/** A file as a data URL, which is the only shape the local bridge takes. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result));
    reader.onerror = () => fail(new Error(`Couldn't read ${file.name || "that track"}.`));
    reader.readAsDataURL(file);
  });
}

function profileContext(p: Profile | null): string {
  if (!p) return "";
  const lines = [
    `Name: ${p.name}`,
    p.intake.q1 ? `Their work: ${p.intake.q1}` : "",
    p.intake.q3.filter(Boolean).length ? `90-day priorities: ${p.intake.q3.filter(Boolean).join(" | ")}` : "",
    p.intake.q4 ? `Tools they use: ${p.intake.q4}` : "",
    p.intake.q6 ? `How they want help: ${p.intake.q6}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}

export function ChatTab({
  store,
  commit,
  profile,
  onDashboardChanged,
  draft,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
  /** A confirmed folder / calendar / list action ran; the shell re-reads. */
  onDashboardChanged?: () => void;
  /**
   * A message another tab (Studio) wants typed into the box, not sent — with
   * any references it collected, which land in the tray already attached.
   */
  draft?: { text: string; nonce: number; attachments?: Attachment[] } | null;
}) {
  const memory = useMemory(store, commit);
  const [input, setInput] = useState("");
  /** The half-typed "@…" at the caret, while the workflow menu is open. */
  const [mention, setMention] = useState<{ start: number; caret: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOptions = useMemo(() => (mention ? searchMentions(mention.query, 8) : []), [mention]);
  const used = useMemo(() => mentionsIn(input), [input]);
  /** The half-typed "#cra" at the caret, while the camera-move menu is open. */
  const [moveMenu, setMoveMenu] = useState<{ start: number; caret: number; query: string } | null>(null);
  const [moveIndex, setMoveIndex] = useState(0);
  const moveOptions = useMemo(() => (moveMenu ? searchMoves(moveMenu.query, 8) : []), [moveMenu]);
  /** The look, shared with the Studio tab; the moves live in the text. */
  const [cinema, setCinema] = useCinemaSelection();
  /** Aspect ratio and clip length, on the toolbar under the box. */
  const [output, setOutput] = useCinemaOutput();
  /** The reference token the caret is naming, lowercased, so its tile lights up. */
  const [highlight, setHighlight] = useState<string | null>(null);
  /** Everyone the Photos tab knows well enough to put in a shot. */
  const { characters } = useCharacters();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<{ title: string; content: string }[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [acting, setActing] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** What an approved studio_generate is rendering, this session. */
  const [renders, setRenders] = useState<RenderState[]>([]);
  /**
   * A film being rendered from a shot plan. There is one at a time on purpose:
   * the PC has one GPU, and two films would simply queue behind each other
   * while pretending otherwise.
   */
  const [film, setFilm] = useState<{
    turnId: string;
    id: string | null;
    view: FilmView | null;
    result: { url: string; blob: Blob } | null;
    error: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Full-size copies of pictures sent this session, by turn id. The saved turn
  // keeps only thumbnails, so this is what lets a follow-up still see them.
  const fullImages = useRef(new Map<string, string[]>());
  // Audio the owner attached, newest last, each keeping the Audio number the
  // conversation gave it — that number is how "@Audio2" finds this file again.
  // The bytes stay here for the session so a film can be scored with a track
  // they dropped in three turns ago.
  const tracks = useRef<{ n: number; name: string; file: File }[]>([]);
  // The Skills tab's list (Supabase-synced), so Jarvis knows every skill on any
  // device — not only after a master-folder sync run on the owner's PC.
  const skills = useRef<{ name: string; about: string; from: string }[]>([]);
  useEffect(() => {
    listSkills()
      .then((list) => {
        skills.current = list.map((s) => ({
          name: s.slug || s.title,
          about: s.overview.slice(0, 160),
          from: s.origin ?? s.source,
        }));
      })
      .catch(() => {});
  }, []);

  const conversation: Conversation | null = useMemo(
    () => store.conversations[0] ?? null,
    [store.conversations],
  );
  const turns = conversation?.turns ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  // The box grows with what is typed, up to a point, then scrolls.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  // Studio handed over a mix: put it in the box for the owner to read and send.
  useEffect(() => {
    if (!draft) return;
    setInput(draft.text);
    // Added to what is already in the tray rather than replacing it: coming
    // back from Studio a second time should not silently drop the first trip.
    // By id, and only what is missing — an effect that runs twice (React does,
    // in development) must not put the same photo in the tray twice.
    if (draft.attachments?.length) {
      setAttachments((list) => {
        const have = new Set(list.map((a) => a.id));
        const missing = draft.attachments!.filter((a) => !have.has(a.id));
        return missing.length ? [...list, ...missing].slice(0, MAX_ATTACHMENTS) : list;
      });
    }
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [draft]);

  const readMention = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const q = mentionQueryAt(el.value, caret);
    setMention(q ? { ...q, caret } : null);
    if (!q || q.query !== mention?.query) setMentionIndex(0);
    const h = moveQueryAt(el.value, caret);
    setMoveMenu(h ? { ...h, caret } : null);
    if (!h || h.query !== moveMenu?.query) setMoveIndex(0);
  };

  /** Swap the half-typed token at the caret for a finished one. */
  const replaceToken = (at: { start: number; caret: number }, inserted: string) => {
    const before = input.slice(0, at.start);
    const after = input.slice(at.caret).replace(/^\S*/, "");
    const next = `${before}${inserted}${after.replace(/^\s/, "")}`;
    setInput(next);
    const caret = before.length + inserted.length;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    });
  };

  /** The @ and # buttons do exactly what typing the character does. */
  const insertSigil = (sigil: "@" | "#") => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const before = input.slice(0, caret);
    const pad = before && !/\s$/.test(before) ? " " : "";
    const next = `${before}${pad}${sigil}${input.slice(caret)}`;
    setInput(next);
    const at = before.length + pad.length + sigil.length;
    requestAnimationFrame(() => {
      const box = inputRef.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(at, at);
      readMention(box);
    });
  };

  const chooseMove = (m: CinemaMove) => {
    if (!moveMenu) return;
    replaceToken(moveMenu, `#${m.id} `);
    setMoveMenu(null);
  };

  const chooseReference = (r: ReferenceMention) => {
    if (!mention) return;
    replaceToken(mention, `@${r.token} `);
    setMention(null);
  };

  const chooseCharacter = (c: Character) => {
    if (!mention) return;
    replaceToken(mention, `@${c.token} `);
    setMention(null);
  };

  const chooseMention = (m: Mention) => {
    if (!mention) return;
    replaceToken(mention, `@${m.token} `);
    setMention(null);
  };

  const attach = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setError(`Up to ${MAX_ATTACHMENTS} references per message.`);
      return;
    }
    setError(files.length > room ? `Up to ${MAX_ATTACHMENTS} references per message — I added the first ${room}.` : "");
    const added: Attachment[] = [];
    for (const f of files.slice(0, room)) {
      try {
        added.push(await toAttachment(f, uid()));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    }
    setAttachments((list) => [...list, ...added].slice(0, MAX_ATTACHMENTS));
    inputRef.current?.focus();
  };

  // The answer lands after an await; writing it onto the store captured when
  // the question was asked would drop the question. Always write onto the latest.
  const storeRef = useRef(store);
  storeRef.current = store;

  const writeTurns = (fn: (t: ChatTurn[]) => ChatTurn[]) => {
    const now = new Date().toISOString();
    const store = storeRef.current;
    const existing = store.conversations[0];
    const next: Conversation = existing
      ? { ...existing, turns: fn(existing.turns), updatedAt: now }
      : { id: uid(), title: "Conversation", startedAt: now, updatedAt: now, turns: fn([]) };
    commit({ ...store, conversations: [next, ...store.conversations.slice(existing ? 1 : 0)] });
  };

  /**
   * `brief` is context the model needs but the conversation should not have to
   * read — the shot sheet being re-planned, for instance, which lives in this
   * browser and has never travelled to the route.
   */
  const ask = async (text: string, extra: Attachment[] = [], brief = "") => {
    const question = text.trim();
    const attached = [...attachments, ...extra];
    // Sound is split off here and never again mixed in with the pictures.
    // Nothing downstream hears it, so it travels as the measured note written
    // into the message text; putting a waveform in the image array instead
    // would be handing a vision model a picture of a thing it cannot hear.
    const pictures = attached.filter((a) => !isDescribed(a));
    const heard = attached.filter(isDescribed);
    if ((!question && !attached.length) || busy) return;
    // Their numbers continue the conversation's count — the same count the notes
    // are labelled with, so "@Audio2" and "[Audio 2]" are the same track.
    const firstTrack = countAudio(turns) + 1;
    heard.forEach((a, i) => {
      if (a.file) tracks.current.push({ n: firstTrack + i, name: a.name, file: a.file });
    });
    const notes = describedNotes(heard, firstTrack);
    setInput("");
    setAttachments([]);
    setError("");
    setProposals([]);
    setPending(null);
    const asked: ChatTurn = {
      id: uid(),
      role: "you",
      text: [question, notes].filter(Boolean).join("\n\n"),
      at: new Date().toISOString(),
      ...(pictures.length
        ? {
            images: pictures.map((p) => p.thumb),
            // Kept so the @ menu can still call this one by name, and say it was
            // a clip, long after the tile it was attached from is gone.
            imageInfo: pictures.map((p) => ({
              name: p.name,
              kind: p.kind === "video" ? ("video" as const) : ("image" as const),
              ...(p.durationSec ? { durationSec: p.durationSec } : {}),
            })),
          }
        : {}),
      ...(heard.length
        ? {
            audio: heard.map((a) => ({
              thumb: a.thumb,
              name: a.name,
              ...(a.durationSec ? { durationSec: a.durationSec } : {}),
              ...(a.note ? { note: a.note } : {}),
            })),
          }
        : {}),
    };
    if (pictures.length) fullImages.current.set(asked.id, pictures.map((p) => p.full));
    writeTurns((t) => [...t, asked]);
    setBusy(true);

    try {
      const res = await fetch("/api/jarvis/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: withImageBudget([...turns, asked], fullImages.current),
          ownerName: profile?.name ?? "",
          skills: skills.current,
          // Workflows named in this message first, then earlier ones, so a
          // follow-up ("make it funnier") still has the briefs.
          workflows: [
            ...new Set(
              [asked, ...[...turns].reverse()]
                .filter((t) => t.role === "you")
                .flatMap((t) => mentionsIn(t.text).map((m) => m.token)),
            ),
          ].slice(0, 6),
          // The camera deck: the look from the chips, the moves from the text.
          // Moves named in this message first, then earlier ones, so a follow-up
          // ("make it slower") still knows how the camera was supposed to travel.
          cinema,
          output,
          moves: [
            ...new Set(
              [asked, ...[...turns].reverse()]
                .filter((t) => t.role === "you")
                .flatMap((t) => movesIn(t.text).map((m) => m.id)),
            ),
          ].slice(0, 8),
          // Who the prompt is about. The sheets live in this browser, so they
          // travel with the message; the route clamps them on arrival.
          characters: cast.map(({ images: _images, avatar: _avatar, ...c }) => c),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          extraContext: [profileContext(profile), await dashboardDigest(), brief].filter(Boolean).join("\n\n"),
        }),
      });
      const data = (await res.json()) as AgentResponse;
      if (!res.ok || data.error) {
        setError(data.error ?? `The assistant failed (${res.status}).`);
        setBusy(false);
        return;
      }
      const answer: ChatTurn = {
        id: uid(),
        role: "jarvis",
        text: data.text ?? "",
        at: new Date().toISOString(),
        citations: (data.citations ?? []).map((c) => ({ ...c, source: c.source })),
        did: (data.did ?? []).join(" · ") || undefined,
        ...(data.form ? { form: data.form } : {}),
        ...(data.storyboard ? { storyboard: data.storyboard } : {}),
      };
      writeTurns((t) => [...t, answer]);
      setProposals(data.proposals ?? []);
      if (data.pending) {
        setPending({
          id: uid(),
          tool: data.pending.tool,
          app: data.pending.app,
          summary: data.pending.summary,
          args: data.pending.args,
          createdAt: new Date().toISOString(),
          status: "pending",
        });
      }
      if (data.notices?.length) setError(data.notices.join(" "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach Jarvis.");
    } finally {
      setBusy(false);
    }
  };

  /** The owner said yes. This is the only path from chat to a real action. */
  const act = async (args: Record<string, unknown>) => {
    if (!pending) return;
    setActing(true);
    try {
      // Studio renders run from the browser, where the reference photos are.
      if (pending.tool === "studio_generate") {
        const filed = new Set<string>();
        const spec = specLine();
        const marks = [...used.map((m) => m.label), ...cast.map((c) => c.name)];
        const pool = {
          subjects: referenceImages(),
          // Their faces come out of the library, not out of an upload box.
          characters: cast.map((c) => ({ token: c.token, name: c.name, images: c.images })),
          // A composite has to lay the plate over a real video, and only this
          // session holds one: a reloaded conversation keeps a clip's poster
          // frame and not its bytes.
          clips: attachedClips(),
        };
        const result = await runRender(args, pool, (states) => {
          setRenders(states);
          // File each one the moment it lands, so closing the tab cannot lose it.
          for (const st of states) {
            if (st.status !== "done" || !st.blob || filed.has(st.id)) continue;
            filed.add(st.id);
            void saveToGallery(st.blob, {
              medium: st.medium,
              title: st.title,
              prompt: st.prompt ?? "",
              workflows: marks,
              spec,
            });
          }
        });
        setPending({ ...pending, status: "done", result });
        return;
      }
      // Folders, the owner's calendar and Lists are written from the browser.
      if (isDashboardTool(pending.tool)) {
        const result = await runDashboardTool(pending.tool, args);
        setPending({ ...pending, status: "done", result });
        onDashboardChanged?.();
        return;
      }
      const res = await fetch("/api/jarvis/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: pending.tool, args, confirmed: true }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setPending(
        data.ok
          ? { ...pending, status: "done", result: "Done." }
          : { ...pending, status: "failed", error: data.error ?? "It failed." },
      );
    } catch (e) {
      setPending({ ...pending, status: "failed", error: e instanceof Error ? e.message : "It failed." });
    } finally {
      setActing(false);
    }
  };

  /**
   * The clips this session is holding, numbered as Subjects.
   *
   * `references` counts pictures and clips together — a clip is a Subject
   * because it is something a render can be pointed at — so the numbering here
   * has to be read off that same list rather than counted separately, or a
   * composite lays the plate over the wrong attachment.
   */
  const attachedClips = (): { n: number; file: Blob }[] =>
    references
      .filter((r) => r.kind === "video" && r.id)
      .flatMap((r) => {
        const file = attachments.find((a) => a.id === r.id)?.file;
        return file ? [{ n: r.n, file }] : [];
      });

  /** Every picture the owner attached in this conversation, oldest first — Subject 1, 2, … */
  const referenceImages = (): string[] =>
    turns
      .filter((t) => t.role === "you" && (t.images?.length || fullImages.current.has(t.id)))
      .flatMap((t) => fullImages.current.get(t.id) ?? t.images ?? [])
      .slice(0, 24);

  /**
   * What "@Subject 3" and "@Audio 1" can point at.
   *
   * The numbering is the conversation's, not the composer's: references already
   * sent keep their number and anything attached to this message continues the
   * count. Pictures and tracks count separately, because they are spent
   * separately — pictures in the order render.ts hands the jobs, tracks in the
   * order the measured notes were labelled — so a token always means the one
   * thing it shows.
   */
  const references: ReferenceMention[] = useMemo(() => {
    const out: ReferenceMention[] = [];
    let seen = 0;
    let heard = 0;
    const look = (thumb: string, name: string, kind: "image" | "video", durationSec?: number, id?: string) => {
      if (seen >= MAX_SUBJECTS) return;
      seen += 1;
      out.push({
        n: seen,
        token: referenceToken(seen),
        label: `Subject ${seen}`,
        kind,
        thumb,
        name,
        ...(durationSec ? { durationSec } : {}),
        ...(id ? { id } : {}),
      });
    };
    const listen = (thumb: string, name: string, durationSec?: number, note?: string, id?: string) => {
      if (heard >= MAX_TRACKS) return;
      heard += 1;
      out.push({
        n: heard,
        token: trackToken(heard),
        label: `Audio ${heard}`,
        kind: "audio",
        thumb,
        name,
        ...(durationSec ? { durationSec } : {}),
        ...(note ? { note } : {}),
        ...(id ? { id } : {}),
      });
    };
    for (const t of turns) {
      if (t.role !== "you") continue;
      (t.images ?? []).forEach((thumb, i) => {
        // Turns saved before imageInfo existed say only that a picture was here.
        const was = t.imageInfo?.[i];
        look(thumb, was?.name ?? "from an earlier message", was?.kind ?? "image", was?.durationSec);
      });
      for (const a of t.audio ?? []) listen(a.thumb, a.name, a.durationSec, a.note);
    }
    for (const a of attachments) {
      if (a.kind === "audio") listen(a.thumb, a.name, a.durationSec, a.note, a.id);
      else look(a.thumb, a.name, a.kind === "video" ? "video" : "image", a.durationSec, a.id);
    }
    return out;
  }, [turns, attachments]);

  /** The reference tokens this draft already names, so their tiles can show it. */
  const named = useMemo(
    () =>
      new Set([
        ...referencesIn(input).map((n) => referenceToken(n).toLowerCase()),
        ...tracksIn(input).map((n) => trackToken(n).toLowerCase()),
      ]),
    [input],
  );

  /**
   * The owner's own words, newest first, with the draft at the front.
   *
   * This is what a named track is looked up in: "@Audio2" counts whether they
   * have sent it yet or are still typing it above the Make the film button.
   */
  const saidNewestFirst = useMemo(
    () => [input, ...[...turns].reverse().filter((t) => t.role === "you").map((t) => t.text)],
    [input, turns],
  );

  /** The track a film would be scored with right now: the named one, else the newest. */
  const scoringTrack = () => pickTrack(saidNewestFirst, tracks.current);

  /**
   * References win the @ menu when the half-typed word could be one, because
   * pointing at your own upload is the more common intent and the workflow
   * list is long enough to bury it.
   */
  const refOptions = useMemo(
    () => (mention ? searchReferences(mention.query, references).slice(0, 8) : []),
    [mention, references],
  );

  /**
   * The people the half-typed @ could mean. They lead the menu, above uploads
   * and workflows: naming your own sister is a more common intent than either,
   * and she is the one thing in the list that cannot be found any other way.
   */
  const castOptions = useMemo(
    () => (mention ? searchCharacters(mention.query, characters, 6) : []),
    [mention, characters],
  );

  /**
   * One menu behind the @, three kinds of thing in it.
   *
   * They used to be two mutually exclusive lists: uploads if any matched, else
   * workflows. That was already a coin toss the owner could not see, and adding
   * people would have made it a three-way one. So the rows are concatenated in
   * order of how specific they are — the people you know, then the pictures in
   * this conversation, then the catalog — under one highlight, which also gives
   * uploads the arrow-key selection they never had.
   */
  const atRows = useMemo(() => {
    if (!mention) return [];
    const rows = [
      ...castOptions.map((character) => ({ key: `cast:${character.token}`, group: "cast" as const, character })),
      // Keyed by token, not by number: Subject 1 and Audio 1 both count from one.
      ...refOptions.map((reference) => ({ key: `ref:${reference.token}`, group: "ref" as const, reference })),
    ];
    // The catalog is long; it yields space to a match the owner's own library
    // produced, and takes the menu to itself when there is none.
    const workflows = mentionOptions.slice(0, rows.length ? 4 : 8);
    return [...rows, ...workflows.map((m) => ({ key: `wf:${m.token}`, group: "wf" as const, mention: m }))];
  }, [mention, castOptions, refOptions, mentionOptions]);

  const chooseAtRow = (row: (typeof atRows)[number] | undefined) => {
    if (!row) return;
    if (row.group === "cast") chooseCharacter(row.character);
    else if (row.group === "ref") chooseReference(row.reference);
    else chooseMention(row.mention);
  };

  /** The characters this draft, or any earlier turn, has named. */
  const cast = useMemo(() => {
    const said = [input, ...turns.filter((t) => t.role === "you").map((t) => t.text)].join(" ");
    // Six is the cap the render and the prompt block both hold to; taking it
    // here as well means the owner sees exactly the cast that will be used.
    return charactersIn(said, characters).slice(0, 6);
  }, [input, turns, characters]);

  /**
   * The faces a shot plan can show and draw with — the conversation's uploads
   * under the Subject numbers the sheet refers to them by, then anyone the
   * owner @-mentioned out of the photo library, under their name.
   */
  const sheetFaces = useMemo(
    (): PanelFace[] => [
      ...referenceImages().map((dataUrl, i) => ({ label: `Subject ${i + 1}`, dataUrl })),
      ...cast.flatMap((c) => (c.images[0] ? [{ label: c.name, dataUrl: c.images[0] }] : [])),
    ],
    // referenceImages() reads the same turns this depends on; the cast is
    // derived from them too, so both move together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turns, cast],
  );

  /** A one-line read of the camera deck, filed with anything rendered. */
  const specLine = (): string =>
    CINEMA_GROUPS.map((g) => groupSummary(g, cinema))
      .filter(Boolean)
      .join(" · ");

  /** The owner edited the sheet: the film is the sheet, so the turn keeps it. */
  const editBoard = (turnId: string, board: Storyboard) =>
    writeTurns((all) => all.map((t) => (t.id === turnId ? { ...t, storyboard: board } : t)));

  /**
   * The owner wants the film a different length, and not by squeezing the cuts
   * they have: a minute of story is a different plan from thirty seconds of it.
   *
   * So the sheet goes back to Jarvis with the new running time. The board lives
   * in this browser and the route has never seen it, so it travels as context —
   * word for word, because a re-plan handed a summary comes back a different
   * film — while the turn the owner reads stays one line.
   */
  const replanBoard = (board: Storyboard, targetSec: number) =>
    void ask(
      `Re-cut “${board.title}” to ${timecode(targetSec)} — same film, re-planned so the shots add up.`,
      [],
      [
        "THE OWNER IS RE-CUTTING A SHOT PLAN THEY ALREADY HAVE.",
        `They want it ${targetSec} seconds long (${timecode(targetSec)}), and it is currently ${runtimeSec(board)}.`,
        "Call studio_storyboard again with the SAME film: keep the title, logline, world, look, aspect "
          + "ratio, lens, lighting, grade, palette, wardrobe, soundscape, music and cast VERBATIM, and keep "
          + "the story beats in their order. Re-plan only the shots, so their duration_sec values add up to "
          + `${targetSec} (each shot 4–15 s) — add, drop, split or merge cuts as the new length needs, and `
          + "rewrite each action to fit the seconds it now has. Say in one line what you changed.",
        "",
        "THE CURRENT SHEET",
        boardBrief(board),
      ].join("\n"),
    );

  /**
   * Render a whole shot plan as one film.
   *
   * Everything happens here rather than on the server because everything it
   * needs is here: the reference photos, the faces from the photo library, and
   * the track the owner dropped in. The bridge on this PC does the rest — the
   * shots in order, each continuous one chained onto the last frame of the one
   * before it, and ffmpeg to cut them together.
   */
  const runFilm = async (turnId: string, board: Storyboard) => {
    if (film && film.view && film.view.status !== "done" && film.view.status !== "error") return;
    setError("");
    setFilm({ turnId, id: null, view: null, result: null, error: "" });
    const track = scoringTrack();
    try {
      const soundtrack = track ? await fileToDataUrl(track.file) : undefined;
      const id = await startFilm({
        board,
        subjects: referenceImages(),
        characters: cast.map((c) => ({ token: c.token, name: c.name, images: c.images })),
        ...(soundtrack ? { soundtrack } : {}),
      });
      setFilm((f) => (f && f.turnId === turnId ? { ...f, id } : f));
      const result = await watchFilm(id, (view) =>
        setFilm((f) => (f && f.turnId === turnId ? { ...f, view } : f)),
      );
      setFilm((f) => (f && f.turnId === turnId ? { ...f, result } : f));
      // Filed the moment it lands, so closing the tab cannot lose three hours.
      void saveToGallery(result.blob, {
        medium: "video",
        title: board.title,
        prompt: `${board.logline}

${board.shots.length} shots, ${runtimeSec(board)}s, cut together.`,
        workflows: [...used.map((m) => m.label), ...cast.map((c) => c.name)],
        spec: specLine(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "The film failed.";
      setFilm((f) => (f && f.turnId === turnId ? { ...f, error: message } : f));
      setError(message);
    }
  };

  /** The owner answered a Studio form: mark it, then send the answers as their next turn. */
  const submitForm = (turnId: string, form: StudioForm, s: FormSubmission) => {
    writeTurns((all) => all.map((t) => (t.id === turnId ? { ...t, formDone: true } : t)));
    const counts = Object.fromEntries(Object.entries(s.images).map(([k, v]) => [k, v.length]));
    void ask(answerText(form, s.values, counts), Object.values(s.images).flat());
  };

  const saveProposal = async (p: { title: string; content: string }) => {
    await memory.save({ source: "chat", title: p.title, content: p.content, origin: "this conversation" });
    setProposals((list) => list.filter((x) => x !== p));
  };

  const clear = () => {
    if (!turns.length || !confirm("Clear this conversation? Saved memories stay.")) return;
    fullImages.current.clear();
    commit({ ...store, conversations: store.conversations.slice(1) });
  };

  return (
    <div
      className="relative flex h-[calc(100dvh-49px)] flex-col"
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
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border border-dashed border-ink-faint bg-panel/85 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-sm text-ink">
            <Icon.Image width={16} height={16} /> Drop pictures, clips or a track
          </p>
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">Chat</h2>
        <span className="text-[11px] text-ink-faint">
          {memory.remote ? `${memory.memories.length} memories, meaning search` : "local memory only"}
        </span>
        {turns.length > 0 && (
          <button onClick={clear} className="ml-auto text-[11px] text-ink-faint underline hover:text-ink">
            Clear
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {turns.length === 0 && (
          <div className="mx-auto max-w-lg py-8 text-center">
            <p className="text-sm text-ink">Ask me something.</p>
            <p className="mt-1 text-xs text-ink-muted">
              I answer from what I actually know — your memories, your master Claude folder and your
              profile — and I name my sources. If I don&apos;t know, I say so.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {["What do you know about me?", "What should I focus on this week?", "What's in my master folder?"].map(
                (q) => (
                  <button
                    key={q}
                    onClick={() => void ask(q)}
                    className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-muted transition hover:bg-panel-2 hover:text-ink"
                  >
                    {q}
                  </button>
                ),
              )}
            </div>
          </div>
        )}

        <div className="mx-auto max-w-2xl space-y-3">
          {turns.map((t) => (
            <div key={t.id} className={t.role === "you" ? "flex justify-end" : ""}>
              <div
                className={
                  t.role === "you"
                    ? "max-w-[85%] rounded-xl rounded-br-sm bg-panel-2 px-3 py-2 text-xs text-ink"
                    : "max-w-[92%] rounded-xl rounded-bl-sm border border-line bg-panel px-3 py-2"
                }
              >
                {t.role === "jarvis" && (
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                    <Icon.Bot width={11} height={11} /> Jarvis
                  </p>
                )}
                {t.images && t.images.length > 0 && (
                  <div className={`flex flex-wrap justify-end gap-1.5 ${t.text ? "mb-1.5" : ""}`}>
                    {t.images.map((src, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={i}
                        src={src}
                        alt={`Attached image ${i + 1}`}
                        className="h-24 max-w-[160px] rounded-lg border border-line object-cover"
                      />
                    ))}
                  </div>
                )}
                {t.audio && t.audio.length > 0 && (
                  <ul className={`flex flex-wrap justify-end gap-1.5 ${t.text ? "mb-1.5" : ""}`}>
                    {t.audio.map((a, i) => (
                      <li
                        key={i}
                        title={a.note}
                        className="overflow-hidden rounded-lg border border-line bg-panel"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.thumb} alt={`Waveform of ${a.name}`} className="block h-10 w-28 object-cover" />
                        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9.5px] text-ink-faint">
                          <Icon.Waveform width={9} height={9} />
                          <span className="min-w-0 flex-1 truncate">{a.name}</span>
                          {a.durationSec ? <span className="tabular-nums">{Math.round(a.durationSec)}s</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {t.text &&
                  (t.role === "you" ? (
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{withMentions(t.text)}</p>
                  ) : (
                    <Markdown text={t.text} />
                  ))}
                {t.form && (
                  <StudioFormCard
                    form={t.form}
                    done={Boolean(t.formDone) || t.id !== turns[turns.length - 1]?.id}
                    busy={busy}
                    onSubmit={(s) => submitForm(t.id, t.form!, s)}
                  />
                )}
                {t.storyboard && (
                  <StoryboardCard
                    board={hydrate(t.storyboard)}
                    faces={sheetFaces}
                    onChange={(b) => editBoard(t.id, b)}
                    onRender={(b) => void runFilm(t.id, b)}
                    onReplan={replanBoard}
                    busy={Boolean(film && film.turnId === t.id && !film.result && !film.error)}
                    done={Boolean(film && film.turnId === t.id && film.result)}
                    {...(() => {
                      // Which track, by number, so a sheet never quietly scores
                      // itself with the wrong one of two.
                      const score = scoringTrack();
                      return score ? { soundtrack: `Audio ${score.n} · ${score.name}` } : {};
                    })()}
                  />
                )}
                {film && film.turnId === t.id && (film.view || film.error) && (
                  <div className="mt-2">
                    {film.view ? (
                      <FilmProgress
                        view={film.view}
                        film={film.result}
                        onCancel={film.id ? () => void cancelFilm(film.id!) : undefined}
                        {...(film.result
                          ? {
                              onSave: () => {
                                const a = document.createElement("a");
                                a.href = film.result!.url;
                                a.download = `${t.storyboard?.title.replace(/[^\w-]+/g, "-") || "film"}.mp4`;
                                a.click();
                              },
                            }
                          : {})}
                      />
                    ) : (
                      <p className="rounded-xl border border-line bg-panel px-3 py-2 text-[11px] text-amber-400">
                        {film.error || "Starting the local renderer…"}
                      </p>
                    )}
                  </div>
                )}
                {t.did && <p className="mt-1.5 text-[10px] text-ink-faint">{t.did}</p>}
                {t.citations && t.citations.length > 0 && (
                  <ul className="mt-2 space-y-0.5 border-t border-line-soft pt-1.5">
                    {t.citations.map((c) => (
                      <li key={c.memoryId} className="flex items-center gap-1.5 text-[10px] text-ink-faint">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: SOURCE_COLOR[c.source] }}
                          aria-hidden
                        />
                        {c.title} · {SOURCE_LABEL[c.source]} ·{" "}
                        {c.capturedAt ? new Date(c.capturedAt).toLocaleDateString() : "unknown date"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <p className="text-[11px] text-ink-faint">Jarvis is reading his memory…</p>
          )}

          {pending && (
            <ConfirmCard
              action={pending}
              busy={acting}
              onConfirm={(args) => void act(args)}
              onCancel={() => setPending({ ...pending, status: "cancelled" })}
            />
          )}

          {renders.length > 0 && (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2" aria-label="Studio renders">
              {renders.map((r) => (
                <li key={r.id} className="overflow-hidden rounded-xl border border-line bg-panel">
                  <div className="grid aspect-video place-items-center bg-canvas">
                    {r.status === "done" && r.url ? (
                      r.medium === "video" ? (
                        <video src={r.url} controls loop playsInline className="h-full w-full object-contain" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.url} alt={r.title} className="h-full w-full object-contain" />
                      )
                    ) : r.status === "error" ? (
                      <p className="px-3 text-center text-[11px] text-amber-400">{r.error}</p>
                    ) : (
                      <p className="animate-pulse text-[11px] text-ink-faint">
                        {r.medium === "video" ? `Rendering${r.note ? ` · ${r.note}` : "…"}` : "Painting…"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-ink">{r.title}</span>
                    {r.status === "done" && r.url && (
                      <a
                        href={r.url}
                        download={`${r.title.replace(/[^\w-]+/g, "-")}.${r.medium === "video" ? "mp4" : "png"}`}
                        className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink"
                      >
                        <Icon.Download width={11} height={11} /> Save
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {proposals.length > 0 && (
            <div className="rounded-xl border border-line bg-panel p-3">
              <p className="mb-1.5 text-xs font-semibold text-ink">Worth remembering?</p>
              <ul className="space-y-2">
                {proposals.map((p, i) => (
                  <li key={i} className="rounded-lg border border-line-soft p-2">
                    <p className="text-xs font-medium text-ink">{p.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">{p.content}</p>
                    <div className="mt-1.5 flex gap-2">
                      <button
                        onClick={() => void saveProposal(p)}
                        className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:text-ink"
                      >
                        Remember it
                      </button>
                      <button
                        onClick={() => setProposals((list) => list.filter((x) => x !== p))}
                        className="text-[11px] text-ink-faint underline hover:text-ink"
                      >
                        No
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-[11px] text-amber-400">{error}</p>}
          <div ref={endRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="border-t border-line bg-panel px-3 py-3"
      >
        <div className="relative mx-auto max-w-4xl rounded-2xl border border-line bg-panel-2 transition focus-within:border-ink-faint">
          {moveMenu && moveOptions.length > 0 && (
            <ul
              role="listbox"
              aria-label="Camera moves"
              className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-80 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)]"
            >
              <li className="px-2 pb-1 pt-1.5 text-[10px] text-ink-faint">
                Camera moves · ↑↓ to move · Enter to add
              </li>
              {moveOptions.map((m, i) => (
                <li key={m.id} role="option" aria-selected={i === moveIndex}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      chooseMove(m);
                    }}
                    onMouseEnter={() => setMoveIndex(i)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${
                      i === moveIndex ? "bg-panel-2" : ""
                    }`}
                  >
                    <span className="h-7 w-10 shrink-0 overflow-hidden rounded bg-canvas">
                      <MoveArt glyph={m.glyph} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-ink">{m.name}</span>
                      <span className="block truncate text-[11px] text-ink-faint">{m.note}</span>
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-faint">{m.family}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mention && atRows.length > 0 && (
            <ul
              role="listbox"
              aria-label="People, references and workflows"
              className="absolute inset-x-0 bottom-full z-30 mb-2 max-h-80 overflow-y-auto rounded-xl border border-line bg-elevated p-1 shadow-[0_12px_32px_-8px_rgb(0_0_0/0.6)]"
            >
              {atRows.map((row, i) => {
                const head =
                  i === 0 || atRows[i - 1].group !== row.group ? GROUP_LABEL[row.group] : null;
                const on = i === mentionIndex;
                return (
                  <li key={row.key}>
                    {head && (
                      <p className="px-2 pb-1 pt-1.5 text-[10px] text-ink-faint">
                        {head}
                        {i === 0 ? " · ↑↓ to move · Enter to add" : ""}
                      </p>
                    )}
                    <span role="option" aria-selected={on}>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          chooseAtRow(row);
                        }}
                        onMouseEnter={() => {
                          setMentionIndex(i);
                          setHighlight(row.group === "ref" ? row.reference.token.toLowerCase() : null);
                        }}
                        onMouseLeave={() => setHighlight(null)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${
                          row.group === "wf" ? "st-card " : ""
                        }${on ? "bg-panel-2" : ""}`}
                        style={row.group === "wf" ? { ["--h" as string]: row.mention.workflow.hue } : undefined}
                      >
                        {row.group === "cast" ? (
                          <CastRow character={row.character} />
                        ) : row.group === "ref" ? (
                          <RefRow reference={row.reference} />
                        ) : (
                          <>
                            <span className="relative h-7 w-6 shrink-0 overflow-hidden rounded">
                              <span className="st-art" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs text-ink">{row.mention.label}</span>
                              <span className="block truncate text-[11px] text-ink-faint">
                                {row.mention.variant ? row.mention.variant.brief : row.mention.workflow.blurb}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-[10px] capitalize text-ink-faint">
                              {row.mention.workflow.medium === "video" ? (
                                <Icon.Film width={11} height={11} />
                              ) : (
                                <Icon.Image width={11} height={11} />
                              )}
                              {row.mention.workflow.medium}
                            </span>
                          </>
                        )}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Who is in the shot, above the workflows: the cast of a prompt is more
              interesting than the recipe, and a chip that says "no sheet" is the
              one warning worth catching before the render starts. */}
          {cast.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5" aria-label="People in this prompt">
              {cast.map((c) => (
                <li
                  key={c.token}
                  title={
                    c.appearance
                      ? `${c.name} — described from ${c.pictures} picture${c.pictures === 1 ? "" : "s"}`
                      : `${c.name} has no written description yet — press Describe on their card in Photos`
                  }
                  className={`flex items-center gap-1.5 rounded-md border bg-panel py-0.5 pl-0.5 pr-2 text-[11px] ${
                    c.appearance ? "border-line text-ink" : "border-amber-400/40 text-amber-200"
                  }`}
                >
                  {c.avatar ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={c.avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-panel-2 text-[9px] font-semibold">
                      {c.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  {c.name}
                  {!c.appearance && <span className="text-[10px] text-amber-300/80">no sheet</span>}
                </li>
              ))}
            </ul>
          )}
          {used.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 px-3 pt-2.5" aria-label="Workflows in this message">
              {used.map((m) => (
                <li
                  key={m.token}
                  className="st-card flex items-center gap-1.5 rounded-md border border-line bg-panel py-0.5 pl-0.5 pr-2 text-[11px] text-ink"
                  style={{ ["--h" as string]: m.workflow.hue }}
                >
                  <span className="relative h-4 w-4 overflow-hidden rounded-sm">
                    <span className="st-art" aria-hidden />
                  </span>
                  {m.label}
                </li>
              ))}
            </ul>
          )}
          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-2 px-3 pt-3" aria-label="References on this message">
              {attachments.map((a) => {
                // Its row in the conversation's numbering — the thing an @token
                // names. A picture is a Subject, a track is an Audio; "3" and
                // "A2" are two counters, so the badge says which it counts in.
                const row = references.find((r) => r.id === a.id);
                const token = row?.token.toLowerCase();
                return (
                  <ReferenceTile
                    key={a.id}
                    attachment={a}
                    {...(row ? { badge: row.kind === "audio" ? `A${row.n}` : String(row.n) } : {})}
                    lit={Boolean(token && (highlight === token || named.has(token)))}
                    title={
                      row
                        ? `Name this ${row.label} in the prompt${a.note ? `\n\n${a.note}` : ""}`
                        : a.note ?? a.name
                    }
                    {...(row
                      ? {
                          onName: () =>
                            setInput((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}@${row.token} `),
                          onHover: (on: boolean) => setHighlight(on && token ? token : null),
                        }
                      : {})}
                    onRemove={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                  />
                );
              })}
            </ul>
          )}
          <div className="px-2 pt-2">
            <CinemaBar
              selection={cinema}
              onSelection={setCinema}
              text={input}
              onText={setInput}
              lead={
                <Chip
                  label="References"
                  value={attachments.length ? `${attachments.length}/${MAX_ATTACHMENTS}` : ""}
                  onClick={() => fileRef.current?.click()}
                  art={null}
                >
                  {attachments[0] ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={attachments[0].thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-ink-faint">
                      <Icon.Plus width={15} height={15} />
                    </span>
                  )}
                </Chip>
              }
            />
          </div>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              readMention(e.target);
            }}
            onClick={(e) => readMention(e.currentTarget)}
            onBlur={() => {
              setMention(null);
              setMoveMenu(null);
            }}
            onKeyDown={(e) => {
              if (moveMenu && moveOptions.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setMoveIndex((i) => (i + step + moveOptions.length) % moveOptions.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  chooseMove(moveOptions[moveIndex] ?? moveOptions[0]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMoveMenu(null);
                  return;
                }
              }
              if (mention && atRows.length) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setMentionIndex((i) => (i + step + atRows.length) % atRows.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  chooseAtRow(atRows[mentionIndex] ?? atRows[0]);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            onPaste={(e) => {
              const files = referenceFiles(e.clipboardData);
              if (!files.length) return;
              e.preventDefault();
              void attach(files);
            }}
            rows={2}
            placeholder={
              attachments.length
                ? "Describe the shot — @ names a reference you attached…"
                : "Describe the shot…  @ for a person, a reference or a workflow, # for a camera move"
            }
            className="block max-h-60 min-h-[76px] w-full resize-none bg-transparent px-3.5 pt-3.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2">
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
            {/* Named, not just a glyph: this is the control that answers "how do
                I give it a photo, a clip or a song", and a bare + did not. */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={attachments.length >= MAX_ATTACHMENTS}
              title="Add pictures, clips or a track (or paste / drop them)"
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-line px-2 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink disabled:opacity-40"
            >
              <Icon.Plus width={14} height={14} />
              {attachments.length ? `${attachments.length}/${MAX_ATTACHMENTS}` : "Image, clip or audio"}
            </button>
            <button
              type="button"
              onClick={() => insertSigil("@")}
              title="Name a person, a reference or a workflow"
              aria-label="Name a person, a reference or a workflow"
              className="grid h-7 w-7 place-items-center rounded-lg border border-line font-mono text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink"
            >
              @
            </button>
            <button
              type="button"
              onClick={() => insertSigil("#")}
              title="Add a camera move"
              aria-label="Add a camera move"
              className="grid h-7 w-7 place-items-center rounded-lg border border-line font-mono text-xs text-ink-muted transition hover:border-ink-faint hover:text-ink"
            >
              #
            </button>
            <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
            <CinemaOutputRow output={output} onOutput={setOutput} />
            <span className="hidden text-[11px] text-ink-faint xl:inline">Enter to send</span>
            <button
              type="submit"
              disabled={busy || (!input.trim() && !attachments.length)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-canvas transition hover:opacity-90 disabled:opacity-40"
            >
              <Icon.Send width={13} height={13} /> {busy ? "Working…" : "Send"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/** Section headings in the @ menu, in the order the rows appear. */
const GROUP_LABEL: Record<"cast" | "ref" | "wf", string> = {
  cast: "People and characters from Photos",
  ref: "References in this conversation",
  wf: "Studio workflows",
};

/**
 * One person in the @ menu.
 *
 * The second line is the whole reason this row is useful: it says how many
 * pictures of them the library holds and whether a description has been written
 * yet. Without it "@Brandy" is a name the owner has to trust; with it they can
 * see that she is described from five photos, and see when she is not, which is
 * the moment to go and press Describe rather than the moment to wonder why the
 * clip looks like someone else.
 */
function CastRow({ character }: { character: Character }) {
  const described = Boolean(character.appearance);
  return (
    <>
      {character.avatar ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={character.avatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel-2 text-[11px] font-semibold text-ink-muted">
          {character.name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{character.name}</span>
        <span className="block truncate text-[11px] text-ink-faint">
          {[
            character.role,
            `${character.pictures} photo${character.pictures === 1 ? "" : "s"}`,
            described ? "described" : "not described yet",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      <span
        className={`flex shrink-0 items-center gap-1 text-[10px] ${
          described ? "text-emerald-300/80" : "text-amber-300/80"
        }`}
      >
        {described ? <Icon.Check width={11} height={11} /> : <Icon.Bulb width={11} height={11} />}
        {described ? "sheet" : "no sheet"}
      </span>
    </>
  );
}

/**
 * One reference in the @ menu.
 *
 * The second line is what makes the row worth reading. For a picture it is the
 * file; for a clip, its length; for a track, the facts the browser actually
 * measured and the model was actually told. A row that said only "Audio 2"
 * would leave the owner guessing which of two songs they were about to score a
 * three-hour render with.
 */
function RefRow({ reference }: { reference: ReferenceMention }) {
  const detail =
    [
      reference.name,
      reference.durationSec ? `${Math.round(reference.durationSec)}s` : "",
      measured(reference.note),
    ]
      .filter(Boolean)
      .join(" · ") || "attached to this conversation";
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={reference.thumb} alt="" className="h-8 w-10 shrink-0 rounded object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{reference.label}</span>
        <span className="block truncate text-[11px] text-ink-faint">{detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[10px] capitalize text-ink-faint">
        {reference.kind === "audio" ? (
          <Icon.Waveform width={11} height={11} />
        ) : reference.kind === "video" ? (
          <Icon.Film width={11} height={11} />
        ) : (
          <Icon.Image width={11} height={11} />
        )}
        {reference.kind === "audio" ? "track" : reference.kind}
      </span>
    </>
  );
}

/** The two lines of a measured audio note a one-line menu row has room for. */
function measured(note?: string): string {
  if (!note) return "";
  return note
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("Tempo:") || l.startsWith("Key:"))
    .map((l) => l.replace(/\s*\(confidence[^)]*\)/, ""))
    .join(" · ");
}

/** A sent message with its known @workflows and #camera moves drawn as tokens. */
function withMentions(text: string) {
  // `at` is where the token starts in the source and `len` is how much of the
  // source it consumes — they differ per kind (an @workflow's sigil is part of
  // the token, a bare "Subject 2" has none), so each match states both rather
  // than the reader guessing.
  const found = [
    ...[...text.matchAll(MENTION_PATTERN)].flatMap((m) => {
      const hit = resolveMention(m[2]);
      if (!hit) return [];
      const at = (m.index ?? 0) + m[1].length;
      return [{ at, len: m[2].length + 1, shown: `@${hit.label}`, title: hit.workflow.blurb }];
    }),
    ...[...text.matchAll(MOVE_PATTERN)].flatMap((m) => {
      const hit = moveById(m[2].toLowerCase());
      if (!hit) return [];
      const at = (m.index ?? 0) + m[1].length;
      return [{ at, len: m[2].length + 1, shown: `#${hit.name}`, title: hit.note }];
    }),
    // The sigil goes INSIDE the chip when the owner typed one, the way a
    // workflow's does: "@Subject2" is one token on screen, not an @ sitting
    // outside a box. A bare "Subject 2", which is what a skill writes, has none.
    ...[...text.matchAll(REFERENCE_PATTERN)].map((m) => {
      const lead = m[0].startsWith("@") ? "@" : "";
      return {
        at: m.index ?? 0,
        len: m[0].length,
        shown: `${lead}Subject ${m[1]}`,
        title: "One of your uploads",
      };
    }),
    // This also catches the "[Audio 2]" label on a measured note, which is the
    // point: the label and the token are the same track, and reading as the
    // same chip is how that stops being something to take on trust.
    ...[...text.matchAll(TRACK_PATTERN)].map((m) => {
      const lead = m[0].startsWith("@") ? "@" : "";
      return {
        at: m.index ?? 0,
        len: m[0].length,
        shown: `${lead}Audio ${m[1]}`,
        title: "One of the tracks you attached",
      };
    }),
  ].sort((a, b) => a.at - b.at);

  const out: React.ReactNode[] = [];
  let last = 0;
  for (const t of found) {
    if (t.at < last) continue;
    out.push(text.slice(last, t.at));
    out.push(
      <span key={t.at} className="rounded bg-ink/10 px-1 font-medium text-ink" title={t.title}>
        {t.shown}
      </span>,
    );
    last = t.at + t.len;
  }
  out.push(text.slice(last));
  return out;
}

/**
 * The conversation as the chat route receives it. Pictures are heavy and the
 * platform caps a request at 4.5 MB, so only the newest four go at full size;
 * older ones travel as thumbnails, and past eight they stay behind.
 */
function withImageBudget(turns: ChatTurn[], full: Map<string, string[]>) {
  let fullLeft = 4;
  let totalLeft = 8;
  const out = [...turns].reverse().map((t) => {
    if (t.role !== "you") return { role: "assistant", content: t.text, images: [] as string[] };
    const big = full.get(t.id) ?? [];
    const small = t.images ?? [];
    const images: string[] = [];
    for (let i = 0; i < Math.max(big.length, small.length) && totalLeft > 0; i += 1) {
      const pick = fullLeft > 0 && big[i] ? big[i] : small[i];
      if (!pick) continue;
      if (pick === big[i]) fullLeft -= 1;
      totalLeft -= 1;
      images.push(pick);
    }
    return { role: "user", content: t.text, images };
  });
  return out.reverse();
}
