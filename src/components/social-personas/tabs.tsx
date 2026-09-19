"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { Markdown } from "../Markdown";
import { localDay, mergePosts, platformOfUrl, uid } from "@/lib/social-personas/logic";
import { PLATFORM_NAME, type Idea, type IdeaStatus, type Persona, type Post } from "@/lib/social-personas/types";
import { api } from "./api";
import { Btn, PlatformDot, inputCls } from "./bits";
import { compact } from "./PersonaGrid";
import type { TabProps } from "./Workspace";

// --- shared ------------------------------------------------------------------

/** Rebuild the brain from the latest copy of the persona. */
async function refreshBrain(getPersona: () => Persona | undefined, props: TabProps) {
  const p = getPersona();
  if (!p) return;
  const r = await api.brain(p);
  if (r.ok) props.mutate(p.id, (x) => ({ ...x, brain: r.data.brain }));
  else props.flash(r.error, true);
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">{children}</div>;
}

// --- Today's ideas -------------------------------------------------------------

const STATUS_STYLE: Record<IdeaStatus, string> = {
  new: "",
  saved: "border-l-brand",
  made: "border-l-emerald-500 opacity-70",
  skipped: "opacity-40",
};

export function TodayTab(props: TabProps & { onBrainstorm: (seed: string) => void }) {
  const { persona, mutate, flash, ai } = props;
  const today = localDay();
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [direction, setDirection] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const started = useRef(false);

  const days = useMemo(() => {
    const ds = persona.ideaDays.map((d) => d.date);
    if (!ds.includes(today)) ds.push(today);
    return [...new Set(ds)].sort().reverse();
  }, [persona.ideaDays, today]);
  const entry = persona.ideaDays.find((d) => d.date === day);
  const ideas = entry?.ideas ?? [];

  const generate = async (more: boolean) => {
    setBusy(true);
    const previous = persona.ideaDays.slice(-7).flatMap((d) => d.ideas.map((i) => i.title));
    const r = await api.ideas(persona, { day: today, count: 5, direction: more ? direction : "", previous });
    setBusy(false);
    if (!r.ok) return flash(r.error, true);
    if (r.data.warning) flash(r.data.warning, true);
    mutate(persona.id, (p) => {
      const cur = p.ideaDays.find((d) => d.date === today);
      const ideaDays = cur
        ? p.ideaDays.map((d) => (d.date === today ? { ...d, ideas: [...d.ideas, ...r.data.ideas], by: r.data.by } : d))
        : [...p.ideaDays, { date: today, ideas: r.data.ideas, by: r.data.by }];
      return { ...p, ideaDays: ideaDays.slice(-60) };
    });
    setDirection("");
    setDay(today);
  };

  // A new day brings a fresh batch without a click.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!persona.ideaDays.some((d) => d.date === today)) void generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = (id: string, status: IdeaStatus) =>
    mutate(persona.id, (p) => ({
      ...p,
      ideaDays: p.ideaDays.map((d) => (d.date === day ? { ...d, ideas: d.ideas.map((i) => (i.id === id ? { ...i, status: i.status === status ? "new" : status } : i)) } : d)),
    }));

  const copy = (i: Idea) => {
    void navigator.clipboard?.writeText(`${i.title}\nHook: ${i.hook}\nFormat: ${i.format}\n${i.outline.map((b, n) => `${n + 1}. ${b}`).join("\n")}`);
    flash("Idea copied.");
  };

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={day} onChange={(e) => setDay(e.target.value)} className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-brand">
          {days.map((d) => (
            <option key={d} value={d}>
              {d === today ? `Today · ${d}` : d}
            </option>
          ))}
        </select>
        {entry && <span className="text-[11px] text-ink-faint">{entry.by === "ai" ? "by AI, from your content" : "offline ideas — no AI key"}</span>}
        <span className="ml-auto text-[11px] text-ink-faint">
          {ideas.filter((i) => i.status === "saved").length} saved · {ideas.filter((i) => i.status === "made").length} made
        </span>
      </div>

      {ideas.length === 0 ? (
        <Empty>{busy ? "Thinking up today's ideas…" : "No ideas for this day."}</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {ideas.map((i, n) => (
            <div key={i.id} className={"border-b border-l-2 border-line border-l-transparent bg-panel last:border-b-0 " + STATUS_STYLE[i.status]}>
              <div className="flex items-start gap-2 px-3 py-2">
                <span className="mt-0.5 w-5 shrink-0 text-right text-xs tabular-nums text-ink-faint">{n + 1}</span>
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(open === i.id ? null : i.id)}>
                  <div className={"text-sm font-semibold text-ink " + (i.status === "skipped" ? "line-through" : "")}>{i.title}</div>
                  {i.hook && i.hook !== i.title && <div className="mt-0.5 text-xs text-ink-muted">“{i.hook}”</div>}
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ink-faint">
                    {i.format && <span className="rounded bg-panel-2 px-1.5">{i.format}</span>}
                    {i.platform !== "any" && (
                      <span className="inline-flex items-center gap-1">
                        <PlatformDot platform={i.platform} />
                        {PLATFORM_NAME[i.platform]}
                      </span>
                    )}
                  </div>
                </button>
                <div className="flex shrink-0 gap-0.5">
                  <IconBtn on={i.status === "saved"} title="Save" onClick={() => setStatus(i.id, "saved")}>
                    <Icon.Star width={13} height={13} />
                  </IconBtn>
                  <IconBtn on={i.status === "made"} title="Made it" onClick={() => setStatus(i.id, "made")}>
                    <Icon.Check width={13} height={13} />
                  </IconBtn>
                  <IconBtn on={i.status === "skipped"} title="Skip" onClick={() => setStatus(i.id, "skipped")}>
                    <Icon.Close width={13} height={13} />
                  </IconBtn>
                </div>
              </div>
              {open === i.id && (
                <div className="space-y-2 border-t border-line bg-canvas/40 px-3 py-2.5 pl-10 text-xs">
                  {i.outline.length > 0 && (
                    <ol className="list-decimal space-y-0.5 pl-4 text-ink-muted">
                      {i.outline.map((b, k) => (
                        <li key={k}>{b}</li>
                      ))}
                    </ol>
                  )}
                  {i.why && <p className="text-ink-faint">Why: {i.why}</p>}
                  <div className="flex gap-1.5">
                    <Btn onClick={() => props.onBrainstorm(`Let's develop this idea: "${i.title}" — hook: "${i.hook}". Write the full script/shot list, a caption and hashtags.`)}>
                      <Icon.Sparkles width={12} height={12} /> Develop in Brainstorm
                    </Btn>
                    <Btn onClick={() => copy(i)}>
                      <Icon.Copy width={12} height={12} /> Copy
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {day === today && (
        <div className="flex gap-2">
          <input
            className={inputCls}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void generate(true)}
            placeholder={ai ? "Steer the next batch (optional) — e.g. “Halloween”, “more collabs”, “quick 15s ones”" : "Steer the next batch (optional)"}
          />
          <Btn primary disabled={busy} onClick={() => void generate(true)} className="shrink-0">
            <Icon.Bulb width={13} height={13} /> {busy ? "Thinking…" : "5 more ideas"}
          </Btn>
        </div>
      )}
    </div>
  );
}

function IconBtn({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={"rounded-md p-1.5 transition " + (on ? "bg-brand/15 text-brand" : "text-ink-faint hover:bg-panel-2 hover:text-ink")}
    >
      {children}
    </button>
  );
}

// --- Brainstorm -------------------------------------------------------------------

const STARTERS = [
  "What should I post today, and why?",
  "Give me 10 scroll-stopping hooks for my niche",
  "Plan a 7-day content series",
  "Which of my posts should I remake, and how?",
  "Write captions + hashtags for my next post",
];

export function BrainstormTab(props: TabProps & { seed: string; clearSeed: () => void }) {
  const { persona, mutate, flash } = props;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const latest = useRef(persona);
  latest.current = persona;

  const { seed, clearSeed } = props;
  useEffect(() => {
    if (seed) {
      setText(seed);
      clearSeed();
    }
  }, [seed, clearSeed]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [persona.chat.length, busy]);

  const send = async (msg: string) => {
    const content = msg.trim();
    if (!content || busy) return;
    const withUser: Persona = { ...latest.current, chat: [...latest.current.chat, { role: "user" as const, content, at: new Date().toISOString() }] };
    mutate(persona.id, () => withUser);
    setText("");
    setBusy(true);
    const r = await api.chat(withUser);
    setBusy(false);
    if (!r.ok) return flash(r.error, true);
    mutate(persona.id, (p) => ({ ...p, chat: [...p.chat, { role: "assistant" as const, content: r.data.reply, at: new Date().toISOString() }].slice(-100) }));
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="min-h-0 flex-1 space-y-3 pb-3">
        {persona.chat.length === 0 && (
          <div className="space-y-2 py-4">
            <p className="text-sm text-ink-muted">
              Brainstorm with an AI that knows {persona.name}&apos;s niche, voice and every imported post. Start with one of these:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => void send(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-ink-muted hover:border-brand hover:text-ink">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {persona.chat.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                "max-w-[92%] rounded-xl px-3 py-2 text-sm leading-relaxed " +
                (m.role === "user" ? "whitespace-pre-wrap bg-brand/15 text-ink" : "border border-line bg-panel text-ink-muted")
              }
            >
              {m.role === "assistant" ? <Markdown source={m.content} className="text-sm" /> : m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-ink-faint">Thinking…</div>}
        <div ref={end} />
      </div>
      <div className="sticky bottom-0 flex gap-2 border-t border-line bg-canvas pt-3">
        {persona.chat.length > 0 && (
          <Btn title="Clear conversation" onClick={() => mutate(persona.id, (p) => ({ ...p, chat: [] }))}>
            <Icon.Trash width={13} height={13} />
          </Btn>
        )}
        <textarea
          rows={2}
          className={inputCls + " resize-none"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          placeholder="Ask anything about this account — ideas, hooks, scripts, series, captions…"
        />
        <Btn primary disabled={busy || !text.trim()} onClick={() => void send(text)} className="shrink-0 self-end">
          <Icon.Send width={13} height={13} />
        </Btn>
      </div>
    </div>
  );
}

// --- Content --------------------------------------------------------------------------

export function ContentTab(props: TabProps) {
  const { persona, mutate, flash, ai } = props;
  const [link, setLink] = useState("");
  const [caption, setCaption] = useState("");
  const [needCaption, setNeedCaption] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const latest = useRef(persona);
  latest.current = persona;
  const get = () => latest.current;

  const note = useRef("");
  const analyzeInto = async (target: { link?: string; caption?: string; existing?: Post }): Promise<boolean> => {
    const r = await api.analyze({ link: target.link, caption: target.caption, niche: persona.niche });
    if (!r.ok) {
      if (r.extra?.needsHelp) setNeedCaption(true);
      flash(r.error, true);
      return false;
    }
    const { analysis, post, watched, trail } = r.data;
    note.current = watched ? "Post added — the AI watched the video." : trail.find((t) => t.startsWith("Couldn't watch")) ?? "Post added and read from its caption.";
    const base: Post = target.existing ?? {
      id: uid("post_"),
      platform: platformOfUrl(post.url || target.link || ""),
      url: post.url || target.link || "",
      caption: post.caption,
      thumbnail: post.thumbnail,
      addedAt: new Date().toISOString(),
      source: target.link ? "link" : "manual",
    };
    const next: Post = { ...base, ...analysis, caption: base.caption || post.caption, watched, analyzedAt: new Date().toISOString() };
    mutate(persona.id, (p) => ({
      ...p,
      posts: target.existing ? p.posts.map((x) => (x.id === base.id ? next : x)) : mergePosts(p.posts, [next]),
    }));
    return true;
  };

  const add = async () => {
    if (!link.trim() && !caption.trim()) return;
    setBusy("add");
    const ok = await analyzeInto({ link: link.trim() || undefined, caption: caption.trim() || undefined });
    setBusy(null);
    if (ok) {
      setLink("");
      setCaption("");
      setNeedCaption(false);
      flash(note.current, note.current.startsWith("Couldn't"));
      void refreshBrain(get, props);
    }
  };

  const unread = persona.posts.filter((p) => !p.analyzedAt);
  const analyzeBatch = async () => {
    setBusy("batch");
    let n = 0;
    for (const p of unread.slice(0, 10)) {
      setBusy(`batch:${p.id}`);
      if (await analyzeInto({ link: p.url || undefined, caption: p.caption || undefined, existing: p })) n++;
    }
    setBusy(null);
    flash(`${n} posts read.`);
    void refreshBrain(get, props);
  };

  const rows = persona.posts.filter((p) => !q || `${p.title} ${p.caption} ${p.format} ${p.topic}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-panel p-3">
        <div className="mb-1.5 text-xs font-semibold text-ink">Add a post you made</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputCls}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
            placeholder="Paste a TikTok / Instagram / Facebook / YouTube link"
          />
          <Btn primary disabled={busy === "add" || (!link.trim() && !caption.trim())} onClick={() => void add()} className="shrink-0 justify-center">
            <Icon.Link width={13} height={13} /> {busy === "add" ? (ai ? "Watching…" : "Reading…") : "Add & read"}
          </Btn>
        </div>
        {(needCaption || caption) && (
          <textarea
            rows={2}
            className={inputCls + " mt-2"}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Instagram and Facebook hide posts from logged-out readers — paste the caption here (or Connect the account)."
          />
        )}
        <p className="mt-1.5 text-[11px] text-ink-faint">
          {ai ? "The AI watches the video (TikTok, YouTube) or reads the caption, then files the format, hook and topic." : "No AI key: posts are filed from the caption text."}{" "}
          {!needCaption && !caption && (
            <button className="underline" onClick={() => setNeedCaption(true)}>
              Paste a caption instead
            </button>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <Icon.Search width={14} height={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input className={inputCls + " py-1 pl-8 text-xs"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search posts" />
        </div>
        {unread.length > 0 && (
          <Btn disabled={!!busy} onClick={() => void analyzeBatch()}>
            <Icon.Eye width={12} height={12} /> {busy?.startsWith("batch") ? "Reading…" : `Read ${Math.min(10, unread.length)} unread`}
          </Btn>
        )}
      </div>

      {persona.posts.length === 0 ? (
        <Empty>
          No posts yet. Connect an account (left) to sync everything, or paste links to posts above. The more the AI sees, the better the ideas.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[720px] table-fixed text-left text-xs">
            <thead className="bg-panel text-[11px] uppercase tracking-wider text-ink-faint">
              <tr>
                <th className="w-20 px-2 py-2 font-medium">Posted</th>
                <th className="w-8 px-2 py-2 font-medium" />
                <th className="px-2 py-2 font-medium">Post</th>
                <th className="w-32 px-2 py-2 font-medium">Format</th>
                <th className="w-16 px-2 py-2 text-right font-medium">Views</th>
                <th className="w-14 px-2 py-2 text-right font-medium">Likes</th>
                <th className="w-14 px-2 py-2 text-right font-medium">Cmts</th>
                <th className="w-20 px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-line bg-canvas/30 align-top hover:bg-panel">
                  <td className="px-2 py-2 tabular-nums text-ink-faint">{(p.postedAt || p.addedAt).slice(0, 10)}</td>
                  <td className="px-2 py-2.5" title={p.platform}>
                    <PlatformDot platform={p.platform} />
                  </td>
                  <td className="px-2 py-2">
                    <div className="truncate font-medium text-ink">{p.title || p.caption.split("\n")[0] || "Untitled"}</div>
                    <div className="line-clamp-2 text-ink-faint">{p.summary || (p.title ? p.caption : "")}</div>
                    {p.hook && <div className="mt-0.5 truncate text-ink-muted">Hook: “{p.hook}”</div>}
                  </td>
                  <td className="px-2 py-2 text-ink-muted">
                    {p.format || "—"}
                    {p.watched && <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] text-emerald-400" title="The AI watched this video">watched</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{p.stats?.views != null ? compact(p.stats.views) : "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{p.stats?.likes != null ? compact(p.stats.likes) : "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-ink">{p.stats?.comments != null ? compact(p.stats.comments) : "—"}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end gap-0.5">
                      <button
                        title={p.analyzedAt ? "Read again" : "Read this post"}
                        disabled={!!busy}
                        onClick={async () => {
                          setBusy(`one:${p.id}`);
                          await analyzeInto({ link: p.url || undefined, caption: p.caption || undefined, existing: p });
                          setBusy(null);
                        }}
                        className={"rounded p-1 text-ink-faint hover:bg-panel-2 hover:text-ink disabled:opacity-40 " + (busy === `one:${p.id}` || busy === `batch:${p.id}` ? "animate-pulse text-brand" : "")}
                      >
                        <Icon.Eye width={12} height={12} />
                      </button>
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noreferrer" title="Open post" className="rounded p-1 text-ink-faint hover:bg-panel-2 hover:text-ink">
                          <Icon.Launch width={12} height={12} />
                        </a>
                      )}
                      <button
                        title="Remove from this persona"
                        onClick={() => mutate(persona.id, (x) => ({ ...x, posts: x.posts.filter((y) => y.id !== p.id) }))}
                        className="rounded p-1 text-ink-faint hover:bg-panel-2 hover:text-rose-400"
                      >
                        <Icon.Trash width={12} height={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- What the AI knows ------------------------------------------------------------

export function BrainTab(props: TabProps) {
  const { persona } = props;
  const [busy, setBusy] = useState(false);
  const latest = useRef(persona);
  latest.current = persona;
  const b = persona.brain;
  const stale = b && b.postCount !== persona.posts.length;

  const rebuild = async () => {
    setBusy(true);
    await refreshBrain(() => latest.current, props);
    setBusy(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-xs text-ink-faint">
          {b
            ? `Built ${new Date(b.updatedAt).toLocaleString()} from ${b.postCount} posts${b.by === "heuristic" ? " (offline summary)" : ""}.${stale ? ` ${persona.posts.length - b.postCount} new since — rebuild to include them.` : ""}`
            : "Nothing learned yet. Rebuild after adding posts, or from the profile alone."}
        </p>
        <Btn primary={!b || !!stale} disabled={busy} onClick={() => void rebuild()}>
          <Icon.Refresh width={12} height={12} /> {busy ? "Reading your content…" : "Rebuild"}
        </Btn>
      </div>
      {b && (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
          <Section title="Summary">
            <p className="text-sm leading-relaxed text-ink">{b.summary}</p>
          </Section>
          {b.voice && (
            <Section title="Voice">
              <p className="text-sm text-ink-muted">{b.voice}</p>
            </Section>
          )}
          <List title="Content pillars" items={b.pillars} />
          <List title="What works" items={b.whatWorks} />
          <List title="Untapped angles" items={b.gaps} />
        </div>
      )}
      <p className="text-[11px] text-ink-faint">
        This is the memory every idea and brainstorm reply is built on, together with the profile on the left and the posts in Content.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{title}</div>
      {children}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-muted">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </Section>
  );
}
