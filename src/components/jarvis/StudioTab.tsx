"use client";

// ---------------------------------------------------------------------------
// Studio — the video and image workflows, as a wall of cards.
//
// The composer sits on top and the wall of cards under it, because the prompt
// is the thing being made and the cards are ingredients you reach down for.
// Clicking a card mixes it in; several can be mixed. The composer is where a
// variant (E-commerce › Flat lay), style keywords and the camera deck (film
// setup, camera, style, colour, lighting, and the #camera-moves typed into the
// box) are chosen. "Start" writes the mix as @-mentions into a conversation
// that runs HERE, on this tab: the forms, the shot plan, the renders and the
// replies all belong to the thing being made, so moving the owner to the Chat
// tab to watch them was moving them away from the wall they were working from.
// The same @- and #-mentions work typed straight into chat, and the camera deck
// follows across.
//
// References — a photo, a clip, a track — are collected HERE too, next to the
// idea they belong to, and travel with it. They ARE numbered here now. The
// number used to be withheld on the grounds that only the conversation could
// know it; but the conversation is this tab's own conversation, so the count is
// knowable, and withholding it meant dropping a photo in and then having no way
// to say which one you meant. So the tiles carry their Subject / Audio badge and
// the @ menu offers them by name, with their thumbnail, above the catalog.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { bridgeStatus } from "@/lib/studio/render";
import { CinemaBar, CinemaOutputRow } from "./CinemaDeck";
import { StudioGallery } from "./StudioGallery";
import { ChatTab } from "./ChatTab";
import { KidsFlow } from "./kids-flow/KidsFlow";
import type { KidsSeed } from "@/lib/studio/kids-flow/useKidsFlow";

/** The card whose prompt opens the Kids Animation Flow screen instead of a chat. */
const KIDS_FLOW_ID = "animate-my-character";
import type { JarvisStore } from "@/lib/jarvis/types";
import type { Profile } from "@/lib/new-dashboard/types";
import { useCinemaOutput, useCinemaSelection } from "@/lib/studio/useCinema";
import { Icon } from "../icons";
import { MicButton } from "./MicButton";
import { useDictation } from "@/lib/new-jarvis/useDictation";
import { ReferenceTile } from "./ReferenceTile";
import {
  ACCEPT_REFERENCES,
  MAX_ATTACHMENTS,
  referenceFiles,
  toAttachment,
  type Attachment,
} from "@/lib/jarvis/chatImages";
import { uid } from "@/lib/jarvis/store";
import {
  CATEGORIES,
  WORKFLOWS,
  cardStill,
  mentionQueryAt,
  mentionsIn,
  type CategoryId,
  type Medium,
  type Mention,
  type Workflow,
} from "@/lib/studio/workflows";
import {
  draftSource,
  numberReferences,
  referenceToken,
  referencesIn,
  trackToken,
  tracksIn,
  turnSources,
  type ReferenceMention,
} from "@/lib/studio/references";
import { useCharacters } from "@/lib/studio/useCharacters";
import { atRowsFor, MentionMenu, type AtRow } from "./MentionMenu";

interface Picked {
  id: string;
  variant: string;
}

export function StudioTab({
  store,
  commit,
  profile,
  onDashboardChanged,
}: {
  store: JarvisStore;
  commit: (s: JarvisStore) => void;
  profile: Profile | null;
  onDashboardChanged?: () => void;
}) {
  const [medium, setMedium] = useState<Medium>("video");
  const [category, setCategory] = useState<CategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [idea, setIdea] = useState("");
  /** Pictures, clips and tracks for this shot, carried into chat with the idea. */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [problem, setProblem] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The look is shared with Chat, so a camera set here is still set there.
  const [cinema, setCinema] = useCinemaSelection();
  const [output, setOutput] = useCinemaOutput();
  /** The wall of workflows, what has been made, or the allowed add-on apps. */
  const [view, setView] = useState<"browse" | "gallery">("browse");
  // The Kids Animation Flow card opens its own screen once the prompt is sent.
  const [kids, setKids] = useState<KidsSeed | null>(null);
  /**
   * The conversation this Studio has going, if any.
   *
   * It runs HERE. Studio used to hand the mix to the Chat tab and move the
   * owner there, which meant the forms, the shot plan and the renders all
   * happened somewhere other than the tab they started on — and the wall of
   * workflows they were working from was two clicks away the whole time.
   */
  const [session, setSession] = useState<{ text: string; nonce: number; attachments?: Attachment[] } | null>(null);
  /** The half-typed "@kid" in the idea box. */
  const [mention, setMention] = useState<{ start: number; caret: number; query: string } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const ideaRef = useRef<HTMLTextAreaElement>(null);
  // Talk to type: say what you want built, the words land in the box.
  const dictation = useDictation(() => ideaRef.current?.value ?? "", setIdea);
  /** The reference token the caret is naming, lowercased, so its tile lights up. */
  const [highlight, setHighlight] = useState<string | null>(null);
  /** Everyone the Photos tab knows well enough to put in a shot. */
  const { characters } = useCharacters();

  /**
   * What "@Subject 3" and "@Audio 1" mean in this box.
   *
   * The numbering is the CONVERSATION's, not the tray's: Studio and Chat write
   * into the same conversation, so a shot started after three photos have
   * already been sent gets Subject 4 — the number the render will actually use.
   * Read off the store rather than the tray for exactly that reason.
   */
  const references: ReferenceMention[] = useMemo(
    () =>
      numberReferences([
        ...turnSources(store.conversations[0]?.turns ?? []),
        ...attachments.map(draftSource),
      ]),
    [store.conversations, attachments],
  );

  /** The reference tokens this idea already names, so their tiles can show it. */
  const named = useMemo(
    () =>
      new Set([
        ...referencesIn(idea).map((n) => referenceToken(n).toLowerCase()),
        ...tracksIn(idea).map((n) => trackToken(n).toLowerCase()),
      ]),
    [idea],
  );

  const atRows = useMemo<AtRow[]>(
    () => (mention ? atRowsFor(mention.query, characters, references) : []),
    [mention, characters, references],
  );
  // The free local video renderer on this PC (tools/studio-bridge).
  const [local, setLocal] = useState<{ ok: boolean; wangp?: boolean; queue?: number } | null>(null);
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

  const categories = CATEGORIES.filter((c) => c.medium === medium);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WORKFLOWS.filter(
      (w) =>
        w.medium === medium &&
        (category === "all" || w.category === category) &&
        (!q ||
          `${w.name} ${w.blurb} ${(w.variants ?? []).map((v) => v.name).join(" ")}`.toLowerCase().includes(q)),
    );
  }, [medium, category, query]);

  const shelves = categories
    .map((c) => ({ category: c, items: visible.filter((w) => w.category === c.id) }))
    .filter((s) => s.items.length);

  const kidsPicked = picked.some((p) => p.id === KIDS_FLOW_ID) || /@animate-my-character\b/.test(idea);

  const pickedWorkflows = picked
    .map((p) => ({ p, w: WORKFLOWS.find((w) => w.id === p.id)! }))
    .filter((x) => x.w);

  // Only workflows that take keywords offer them; duplicates collapse.
  const suggested = [...new Set(pickedWorkflows.flatMap(({ w }) => w.keywords ?? []))];
  const takesKeywords = pickedWorkflows.some(({ w }) => w.keywords?.length);

  const toggle = (w: Workflow) =>
    setPicked((list) =>
      list.some((p) => p.id === w.id) ? list.filter((p) => p.id !== w.id) : [...list, { id: w.id, variant: "" }],
    );

  const toggleKeyword = (k: string) =>
    setKeywords((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));

  const addCustom = () => {
    const k = custom.trim().toLowerCase();
    if (k && !keywords.includes(k)) setKeywords((list) => [...list, k]);
    setCustom("");
  };

  const clear = () => {
    setPicked([]);
    setKeywords([]);
    setIdea("");
    setAttachments([]);
    setProblem("");
  };

  /** Read the files into references, the same way the chat box does. */
  const attach = async (files: File[]) => {
    if (!files.length) return;
    const room = MAX_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setProblem(`Up to ${MAX_ATTACHMENTS} references per shot.`);
      return;
    }
    setProblem(files.length > room ? `Up to ${MAX_ATTACHMENTS} — I added the first ${room}.` : "");
    const added: Attachment[] = [];
    for (const f of files.slice(0, room)) {
      try {
        added.push(await toAttachment(f, uid()));
      } catch (e) {
        setProblem(e instanceof Error ? e.message : "Couldn't read that file.");
      }
    }
    setAttachments((list) => [...list, ...added].slice(0, MAX_ATTACHMENTS));
    ideaRef.current?.focus();
  };

  const readMention = (el: HTMLTextAreaElement) => {
    const caret = el.selectionStart ?? el.value.length;
    const q = mentionQueryAt(el.value, caret);
    setMention(q ? { ...q, caret } : null);
    if (!q || q.query !== mention?.query) setMentionIndex(0);
  };

  /** Swap the half-typed "@kid" at the caret for a finished token. */
  const insertMention = (token: string) => {
    if (!mention) return;
    const before = idea.slice(0, mention.start);
    const after = idea.slice(mention.caret).replace(/^\S*/, "");
    const inserted = `@${token} `;
    setIdea(`${before}${inserted}${after.replace(/^\s/, "")}`);
    setMention(null);
    const at = before.length + inserted.length;
    requestAnimationFrame(() => {
      ideaRef.current?.focus();
      ideaRef.current?.setSelectionRange(at, at);
    });
  };

  /** Picking a workflow from the @ menu types the token AND ticks the card, so
   *  the two ways of choosing one never disagree. */
  const chooseMention = (m: Mention) => {
    insertMention(m.token);
    setPicked((list) =>
      list.some((p) => p.id === m.workflow.id)
        ? list
        : [...list, { id: m.workflow.id, variant: m.variant?.id ?? "" }],
    );
  };

  /** A person and an upload only have to be named; nothing gets ticked. */
  const chooseAtRow = (row: AtRow | undefined) => {
    if (!row) return;
    if (row.group === "wf") chooseMention(row.mention);
    else insertMention(row.group === "cast" ? row.character.token : row.reference.token);
  };

  /** Type a reference's own token at the end of the idea, from its tile. */
  const nameReference = (token: string) =>
    setIdea((t) => `${t}${t && !/\s$/.test(t) ? " " : ""}@${token} `);

  const start = () => {
    dictation.stop();
    // A picked card, a typed idea or an attached reference — any one of them is
    // something to start from. It used to demand a card, so an idea with a photo
    // and no workflow pressed the button and nothing happened.
    if (!picked.length && !idea.trim() && !attachments.length) return;
    // A workflow typed straight into the box is already an @token; only add the
    // ones picked from cards, so nothing is named twice.
    const typed = new Set(mentionsIn(idea).map((m) => m.workflow.id));
    const mentions = picked
      .filter((p) => !typed.has(p.id))
      .map((p) => `@${p.id}${p.variant ? `:${p.variant}` : ""}`)
      .join(" ");
    const style = keywords.length ? `\nKeywords: ${keywords.join(", ")}` : "";
    // Kids Animation Flow: the prompt and the pictures go to its own screen,
    // which writes the storyboard from them — the chat would only ask again.
    if (picked.some((p) => p.id === KIDS_FLOW_ID) || typed.has(KIDS_FLOW_ID)) {
      setKids({
        text: idea.trim(),
        keywords,
        images: attachments.filter((a) => a.kind === "image").map((a) => a.full),
        nonce: Date.now(),
      });
      clear();
      return;
    }
    // The camera moves ride along inside `idea` as #tokens; the look travels on
    // its own, shared with Chat through localStorage.
    setSession({ text: `${mentions} ${idea.trim()}${style}`.trim(), nonce: Date.now(), attachments });
    clear();
  };

  if (kids) {
    return (
      <div className="flex h-[calc(100dvh-49px)] flex-col">
        <KidsFlow seed={kids} onClose={() => setKids(null)} />
      </div>
    );
  }

  // A session in progress takes the whole tab: the forms, the shot plan, the
  // renders and the replies all belong to the thing being made, and the wall
  // of workflows is one click behind them rather than another tab away.
  if (session) {
    return (
      <div className="flex h-[calc(100dvh-49px)] flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel px-3 py-1.5">
          <button
            type="button"
            onClick={() => setSession(null)}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            <Icon.ArrowLeft width={11} height={11} /> Workflows
          </button>
          <p className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
            {session.text || "Studio"}
          </p>
          <button
            type="button"
            onClick={() => {
              setSession(null);
              setView("gallery");
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            <Icon.Layers width={11} height={11} /> Gallery
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ChatTab
            store={store}
            commit={commit}
            profile={profile}
            embedded
            draft={session}
            onKidsFlow={(seed) => {
              setSession(null);
              setKids({ text: seed.text, keywords: [], images: seed.images, nonce: Date.now() });
            }}
            {...(onDashboardChanged ? { onDashboardChanged } : {})}
          />
        </div>
      </div>
    );
  }

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
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-xs font-semibold text-ink">Studio</h2>
        <span className="text-[11px] text-ink-faint">
          {WORKFLOWS.filter((w) => w.medium === medium).length} {medium} workflows
        </span>
        <div role="tablist" aria-label="Studio view" className="ml-2 flex rounded-lg border border-line p-0.5">
          {([
            { id: "browse", label: "Workflows", icon: <Icon.Grid width={12} height={12} /> },
            { id: "gallery", label: "Gallery", icon: <Icon.Folder width={12} height={12} /> },
          ] as const).map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition ${
                view === v.id ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
        <div role="tablist" aria-label="Medium" className="ml-1 flex rounded-lg border border-line p-0.5">
          {(["video", "image"] as Medium[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={medium === m}
              onClick={() => {
                setMedium(m);
                setCategory("all");
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs capitalize transition ${
                medium === m ? "bg-panel-2 text-ink" : "text-ink-muted hover:text-ink"
              }`}
            >
              {m === "video" ? <Icon.Film width={12} height={12} /> : <Icon.Image width={12} height={12} />}
              {m}
            </button>
          ))}
        </div>
        {local && (
          <span
            className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted"
            title={
              local.ok
                ? "Videos render free on this PC with WanGP (Pinokio)."
                : "Run tools/studio-bridge/install-autostart.cmd once on your PC and videos render here for free, from every sign-in on."
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${local.ok ? "bg-emerald-400" : "bg-ink-faint"}`}
              aria-hidden
            />
            {local.ok
              ? `Local renderer on${local.queue ? ` · ${local.queue} in queue` : ""}`
              : "Local renderer off"}
          </span>
        )}
        <label className={`ml-auto w-full items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1 sm:w-56 flex`}>
          <Icon.Search width={12} height={12} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workflows"
            className="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
      </div>

      {view === "gallery" ? (
        // Reusing a finished piece carries its prompt, not this tray.
        <StudioGallery onReuse={(prompt) => setSession({ text: prompt, nonce: Date.now() })} />
      ) : (
        <>
      {/* The composer first, the wall under it: the prompt is the thing being
          made, and the cards are the ingredients you reach down for. */}
      <div className="border-b border-line bg-panel px-3 py-3">
        <div className="mx-auto max-w-4xl rounded-2xl border border-line bg-panel-2 p-2">
          <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2 pt-1">
            {pickedWorkflows.length === 0 ? (
              <span className="text-[11px] text-ink-faint">
                Pick a card below to mix it in — or just set the camera and describe the shot.
              </span>
            ) : (
              <>
                {pickedWorkflows.map(({ p, w }) => (
                  <span
                    key={p.id}
                    className="st-card flex items-center gap-1.5 rounded-lg border border-line bg-panel py-1 pl-1 pr-1.5 text-xs text-ink"
                    style={{ ["--h" as string]: w.hue }}
                  >
                    <span className="relative h-5 w-5 overflow-hidden rounded">
                      <span className="st-art" aria-hidden />
                    </span>
                    {w.name}
                    {w.variants && (
                      <select
                        value={p.variant}
                        onChange={(e) =>
                          setPicked((list) => list.map((x) => (x.id === p.id ? { ...x, variant: e.target.value } : x)))
                        }
                        aria-label={`${w.name} style`}
                        className="rounded border border-line bg-panel-2 px-1 py-0.5 text-[11px] text-ink focus:outline-none"
                      >
                        <option value="">Any style</option>
                        {w.variants.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => toggle(w)}
                      aria-label={`Remove ${w.name}`}
                      className="text-ink-faint transition hover:text-ink"
                    >
                      <Icon.Close width={11} height={11} />
                    </button>
                  </span>
                ))}
                <button onClick={clear} className="px-1 text-[11px] text-ink-faint underline hover:text-ink">
                  Clear
                </button>
              </>
            )}
          </div>

          <CinemaBar selection={cinema} onSelection={setCinema} text={idea} onText={setIdea} />

          <div className="relative">
            {mention && (
              <MentionMenu
                rows={atRows}
                index={mentionIndex}
                onIndex={setMentionIndex}
                onChoose={chooseAtRow}
                onHighlight={setHighlight}
                placement="below"
              />
            )}
            {attachments.length > 0 && (
              <ul className="flex flex-wrap gap-2 px-2 pt-2.5" aria-label="References for this shot">
                {attachments.map((a) => {
                  // Its row in the conversation's numbering — the thing an
                  // @token names. A picture is a Subject, a track is an Audio;
                  // "3" and "A2" are two counters, so the badge says which.
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
                          ? `Name this ${row.label} in the shot${a.note ? `\n\n${a.note}` : ""}`
                          : (a.note ?? a.name)
                      }
                      {...(row
                        ? {
                            onName: () => nameReference(row.token),
                            onHover: (on: boolean) => setHighlight(on && token ? token : null),
                          }
                        : {})}
                      onRemove={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                    />
                  );
                })}
              </ul>
            )}
            {problem && <p className="px-2 pt-2 text-[11px] text-amber-400">{problem}</p>}
            {dictation.error && <p className="px-2 pt-2 text-[11px] text-amber-400">{dictation.error}</p>}
            <textarea
              ref={ideaRef}
              value={idea}
              onChange={(e) => {
                setIdea(e.target.value);
                readMention(e.target);
              }}
              onClick={(e) => readMention(e.currentTarget)}
              onBlur={() => setMention(null)}
              onKeyDown={(e) => {
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
                  start();
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
                kidsPicked
                  ? "Kids Animation Flow: attach your character's picture, then tell the story in a line — e.g. my son Milo loses his kite and chases it through town, 45 seconds"
                  : "Describe the shot: whose story, which product, what happens…  (@ for a person, an upload or a workflow, # for a camera move)"
              }
              className="mt-2 block max-h-48 min-h-[68px] w-full resize-none bg-transparent px-2 pt-1 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1">
            {/* The reference control, first on the row and named: this is how a
                photo, a clip or a song gets into the shot, and it travels with
                the idea into chat. */}
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
            <MicButton dictation={dictation} />
            <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
            <CinemaOutputRow output={output} onOutput={setOutput} />
            <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
            {takesKeywords &&
              [...new Set([...suggested, ...keywords])].slice(0, 8).map((k) => (
                <button
                  key={k}
                  onClick={() => toggleKeyword(k)}
                  aria-pressed={keywords.includes(k)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                    keywords.includes(k)
                      ? "border-ink-muted bg-ink text-canvas"
                      : "border-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {k}
                </button>
              ))}
            {takesKeywords && (
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
                onBlur={addCustom}
                placeholder="+ keyword"
                className="w-24 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 text-[11px] text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none"
              />
            )}
            <button
              onClick={start}
              disabled={!picked.length && !idea.trim() && !attachments.length}
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-semibold text-canvas transition hover:opacity-90 disabled:opacity-40"
            >
              <Icon.Send width={13} height={13} /> {kidsPicked ? "Make the storyboard" : "Start"}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex gap-1.5 overflow-x-auto border-b border-line-soft bg-canvas/90 px-3 py-2 backdrop-blur">
          {[{ id: "all" as const, label: "All" }, ...categories].map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              aria-pressed={category === c.id}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition ${
                category === c.id
                  ? "border-ink-faint bg-panel-2 text-ink"
                  : "border-line text-ink-muted hover:text-ink"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="space-y-6 px-3 py-4">
          {shelves.map(({ category: c, items }) => (
            <section key={c.id}>
              <h3 className="mb-2 flex items-baseline gap-2 text-sm font-semibold text-ink">
                {c.label}
                <span className="text-[11px] font-normal text-ink-faint">{items.length}</span>
              </h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-2.5">
                {items.map((w) => (
                  <li key={w.id}>
                    <StudioCard w={w} picked={picked.some((p) => p.id === w.id)} onToggle={() => toggle(w)} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!shelves.length && (
            <p className="py-12 text-center text-xs text-ink-muted">No {medium} workflow matches “{query}”.</p>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function StudioCard({ w, picked, onToggle }: { w: Workflow; picked: boolean; onToggle: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const still = cardStill(w.id);
  return (
    <button
      onClick={onToggle}
      aria-pressed={picked}
      onMouseEnter={() => void video.current?.play().catch(() => {})}
      onMouseLeave={() => video.current?.pause()}
      className={`st-card group relative block aspect-[3/4] w-full overflow-hidden rounded-xl border text-left transition duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-muted ${
        picked ? "border-ink ring-1 ring-ink" : "border-line hover:border-ink-faint"
      }`}
      style={{ ["--h" as string]: w.hue }}
    >
      {w.preview?.video ? (
        <video ref={video} className="st-video" src={w.preview.video} poster={w.preview.poster} muted loop playsInline preload="none" />
      ) : still ? (
        // Lazy on purpose: 123 cards is 123 requests if they all load on paint,
        // and only the first screenful is ever seen before a scroll.
        <img src={still} alt="" loading="lazy" decoding="async" className="st-still" />
      ) : (
        <span className={`st-art st-m-${w.motif}`} aria-hidden>
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      )}

      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-2.5 pt-10">
        <span className="block text-[13px] font-semibold leading-tight text-white">{w.name}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-white/70">{w.blurb}</span>
        <span className="mt-1 hidden text-[10px] text-white/55 group-hover:block">{w.format}</span>
      </span>

      <span className="absolute left-2 top-2 flex gap-1">
        {w.isNew && (
          <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-semibold text-black">New</span>
        )}
        {w.variants && (
          <span className="rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] text-white backdrop-blur-sm">
            {w.variants.length} styles
          </span>
        )}
      </span>

      <span
        className={`absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full border transition ${
          picked ? "border-white bg-white text-black" : "border-white/50 bg-black/30 text-transparent group-hover:text-white/80"
        }`}
        aria-hidden
      >
        {picked ? <Icon.Check width={11} height={11} /> : <Icon.Plus width={11} height={11} />}
      </span>
    </button>
  );
}
