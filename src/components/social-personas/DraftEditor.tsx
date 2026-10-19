"use client";

// ---------------------------------------------------------------------------
// One post, end to end: the words (title, hook, caption, hashtags, outline),
// the video, which accounts it goes to, and when. Per account it shows what
// will happen — auto-post, or a reminder with "Copy caption & open the app"
// — and after posting, the link that ties the video into Analytics.
//
// Nothing is lost if the window closes: every field saves as you type (R6),
// and the schedule is pushed to the server when the time or accounts change.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { mergePosts, platformOfUrl, uid } from "@/lib/social-personas/logic";
import { captionFor, parseHashtags, withResult } from "@/lib/social-personas/studio";
import { CAPTION_LIMIT, PLATFORM_NAME, STAGES, UPLOAD_URL, type Draft, type Post } from "@/lib/social-personas/types";
import { api, type PublicJob, type Status } from "./api";
import { Btn, PlatformDot, inputCls } from "./bits";
import { blocker } from "./schedule";
import type { TabProps } from "./Workspace";

export function DraftEditor({
  persona,
  mutate,
  flash,
  status,
  draft,
  onClose,
  onCommit,
  onDelete,
  suggestSlot,
}: TabProps & {
  status: Status | null;
  applyJobs: (jobs: PublicJob[]) => void;
  draft: Draft;
  onClose: () => void;
  onCommit: (d: Draft, now?: boolean) => Promise<Draft>;
  onDelete: () => Promise<void>;
  suggestSlot: () => string;
}) {
  const [d, setD] = useState(draft);
  const [tags, setTags] = useState(draft.hashtags.map((t) => "#" + t).join(" "));
  const [uploading, setUploading] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const dirtySchedule = useRef(false);

  // Results arrive from the queue while the editor is open; show them.
  useEffect(() => setD((cur) => ({ ...cur, results: draft.results, stage: draft.stage })), [draft.results, draft.stage]);

  // Autosave the words as you type (debounced), so nothing is lost (R6).
  useEffect(() => {
    const t = window.setTimeout(() => {
      mutate(persona.id, (p) => ({ ...p, drafts: p.drafts.map((x) => (x.id === d.id ? { ...x, ...pickWords(d), updatedAt: new Date().toISOString() } : x)) }));
    }, 400);
    return () => window.clearTimeout(t);
  }, [d, mutate, persona.id]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && void close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const set = (patch: Partial<Draft>, schedule = false) => {
    if (schedule) dirtySchedule.current = true;
    setD((cur) => ({ ...cur, ...patch }));
  };

  const close = async () => {
    // Re-push the schedule once on close if the time, accounts or video changed.
    if (dirtySchedule.current) {
      dirtySchedule.current = false;
      await onCommit({ ...d, hashtags: parseHashtags(tags) });
    }
    onClose();
  };

  const upload = async (file: File) => {
    setUploading(0);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    const r = await api.upload(file, setUploading);
    setUploading(null);
    if (!r.ok) return flash(r.error, true);
    if (d.media) void api.removeMedia(d.media.key);
    set({ media: r.media, stage: d.stage === "idea" || d.stage === "script" || d.stage === "film" || d.stage === "edit" ? "ready" : d.stage }, true);
    flash("Video uploaded.");
  };

  const postNow = async () => {
    setBusy("now");
    const next = await onCommit({ ...d, hashtags: parseHashtags(tags) }, true);
    dirtySchedule.current = false;
    setD(next);
    setBusy(null);
  };

  /** Hand-posting: copy the platform's caption and open its upload page. */
  const postByHand = async (accountId: string) => {
    const a = persona.accounts.find((x) => x.id === accountId);
    if (!a) return;
    const text = captionFor({ ...d, hashtags: parseHashtags(tags) }, a.platform);
    try {
      await navigator.clipboard.writeText(text);
      flash(`Caption copied. Paste it into ${PLATFORM_NAME[a.platform]}, then press “I posted it”.`);
    } catch {
      flash("Couldn't reach the clipboard — copy the caption from the box.", true);
    }
    window.open(UPLOAD_URL[a.platform], "_blank", "noopener");
    setLinkFor(accountId);
  };

  /** Mark one account as posted; a link makes it a tracked video in Analytics. */
  const markPosted = (accountId: string) => {
    const a = persona.accounts.find((x) => x.id === accountId);
    const url = link.trim();
    const at = new Date().toISOString();
    const next = withResult({ ...d, hashtags: parseHashtags(tags) }, { accountId, status: "manual", url: url || undefined, at });
    setD(next);
    mutate(persona.id, (p) => {
      let posts = p.posts;
      if (url) {
        const post: Post = {
          id: uid("post_"),
          platform: platformOfUrl(url) === "other" && a ? a.platform : platformOfUrl(url),
          url,
          caption: captionFor(next, a?.platform ?? "tiktok"),
          title: next.title,
          hook: next.hook,
          postedAt: at,
          addedAt: at,
          source: "link",
          draftId: next.id,
        };
        posts = mergePosts(posts, [post]);
      }
      return { ...p, posts, drafts: p.drafts.map((x) => (x.id === next.id ? next : x)) };
    });
    setLinkFor(null);
    setLink("");
  };

  const local = d.scheduledAt ? toLocalInput(d.scheduledAt) : "";
  const anyAuto = d.accountIds.some((id) => !blocker(persona, d, id));

  return (
    <div className="fixed inset-0 z-[999] flex items-end justify-center sm:items-center sm:p-3" onMouseDown={() => void close()}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-label="Edit post"
        className="ps-sheet relative flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl sm:rounded-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ borderTop: `3px solid hsl(${persona.hue} 70% 55%)` }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <select
            value={d.stage}
            onChange={(e) => set({ stage: e.target.value as Draft["stage"] })}
            className="rounded-md border border-line bg-canvas px-1.5 py-1 text-xs text-ink outline-none focus:border-brand"
            aria-label="Stage"
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="truncate text-sm font-semibold text-ink">{d.title || "New post"}</span>
          <button onClick={() => void close()} className="ml-auto rounded-lg p-1 text-ink-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
            <Icon.Close width={16} height={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-auto px-4 py-3 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-2.5">
            <Field label="Title">
              <input autoFocus={!d.title} className={inputCls} value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder="What's this video?" />
            </Field>
            <Field label="Hook" hint="the first second, word for word">
              <input className={inputCls} value={d.hook} onChange={(e) => set({ hook: e.target.value })} placeholder="Nobody talks about this part of…" />
            </Field>
            <Field label="Caption">
              <textarea rows={4} className={inputCls + " resize-y"} value={d.caption} onChange={(e) => set({ caption: e.target.value })} placeholder="The words under the video" />
              <div className="mt-0.5 flex flex-wrap gap-2 text-[10px] text-ink-faint">
                {[...new Set(d.accountIds.map((id) => persona.accounts.find((a) => a.id === id)?.platform).filter(Boolean))].map((pl) => {
                  const len = captionFor({ ...d, hashtags: parseHashtags(tags) }, pl!).length;
                  const over = (d.caption.length + tags.length) > CAPTION_LIMIT[pl!];
                  return (
                    <span key={pl} className={over ? "text-amber-300" : ""}>
                      {PLATFORM_NAME[pl!]} {len}/{CAPTION_LIMIT[pl!]}
                      {over ? " (trimmed)" : ""}
                    </span>
                  );
                })}
              </div>
            </Field>
            <Field label="Hashtags">
              <input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} onBlur={() => set({ hashtags: parseHashtags(tags) })} placeholder="#rap #newmusic" />
            </Field>
            <Field label="Outline / shot list" hint="one beat per line">
              <textarea rows={4} className={inputCls + " resize-y font-mono text-xs"} value={d.outline.join("\n")} onChange={(e) => set({ outline: e.target.value.split("\n") })} />
            </Field>
            <Field label="Notes">
              <textarea rows={2} className={inputCls + " resize-y text-xs"} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />
            </Field>
          </div>

          <div className="space-y-3">
            <section>
              <Label>Video</Label>
              <label className="ps-drop flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line bg-canvas/40 px-3 py-4 text-center text-[11px] text-ink-muted transition hover:border-brand">
                {preview && d.media?.type.startsWith("video/") ? (
                  <video src={preview} className="max-h-40 rounded-lg" muted playsInline controls />
                ) : d.media ? (
                  <span className="inline-flex items-center gap-1 text-ink">
                    <Icon.Film width={14} height={14} /> {d.media.name}
                  </span>
                ) : (
                  <>
                    <Icon.Upload width={16} height={16} />
                    Add the video (MP4, under 1 GB)
                  </>
                )}
                {d.media && <span className="text-[10px] text-ink-faint">{(d.media.size / 1_048_576).toFixed(1)} MB · tap to replace</span>}
                {uploading != null && (
                  <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-panel-2" aria-label={`Uploading ${Math.round(uploading * 100)}%`}>
                    <span className="block h-full bg-brand transition-[width]" style={{ width: `${Math.round(uploading * 100)}%` }} />
                  </span>
                )}
                <input type="file" accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              </label>
              {status && !status.storage && <p className="mt-1 text-[10px] text-amber-300">This site has no video storage set up yet, so auto-post can't send videos (SUPABASE_SERVICE_ROLE_KEY).</p>}
            </section>

            <section>
              <Label>When</Label>
              <input
                type="datetime-local"
                className={inputCls + " text-xs"}
                value={local}
                onChange={(e) => set({ scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null }, true)}
              />
              <div className="mt-1 flex gap-1">
                <Btn onClick={() => set({ scheduledAt: suggestSlot() }, true)} title="The next good hour from your own stats, not clashing with other posts">
                  <Icon.Clock width={12} height={12} /> Next best slot
                </Btn>
                {d.scheduledAt && <Btn onClick={() => set({ scheduledAt: null }, true)}>Unschedule</Btn>}
              </div>
            </section>

            <section>
              <Label>Post to</Label>
              {persona.accounts.length === 0 ? (
                <p className="text-[11px] text-ink-muted">Add accounts on the Overview tab first.</p>
              ) : (
                <ul className="space-y-1">
                  {persona.accounts.map((a) => {
                    const on = d.accountIds.includes(a.id);
                    const res = d.results.find((r) => r.accountId === a.id);
                    const why = on ? blocker(persona, d, a.id) : null;
                    return (
                      <li key={a.id} className="rounded-lg border border-line bg-canvas/40 px-2 py-1.5 text-[11px]">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) => set({ accountIds: e.target.checked ? [...d.accountIds, a.id] : d.accountIds.filter((x) => x !== a.id) }, true)}
                            className="accent-[var(--color-brand)]"
                          />
                          <PlatformDot platform={a.platform} />
                          <span className="min-w-0 flex-1 truncate text-ink">
                            @{a.handle} <span className="text-ink-faint">{PLATFORM_NAME[a.platform]}</span>
                          </span>
                          {on && <StatusPill res={res?.status} why={why} />}
                        </label>
                        {on && res?.error && <p className={"mt-1 " + (res.status === "failed" ? "text-rose-300" : "text-ink-faint")}>{res.error}</p>}
                        {on && res?.url && (
                          <a href={res.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-brand hover:underline">
                            <Icon.Launch width={10} height={10} /> View post
                          </a>
                        )}
                        {on && why && res?.status !== "manual" && res?.status !== "posted" && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            <button onClick={() => void postByHand(a.id)} className="rounded px-1.5 py-0.5 text-brand hover:bg-brand/10">
                              Copy caption & open {PLATFORM_NAME[a.platform]}
                            </button>
                            <button onClick={() => setLinkFor(linkFor === a.id ? null : a.id)} className="rounded px-1.5 py-0.5 text-ink-muted hover:bg-panel-2 hover:text-ink">
                              I posted it
                            </button>
                          </div>
                        )}
                        {linkFor === a.id && (
                          <div className="mt-1 flex gap-1">
                            <input className={inputCls + " py-0.5 text-[11px]"} value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the post link (to track it)" />
                            <Btn onClick={() => markPosted(a.id)}>Done</Btn>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
          {confirmDelete ? (
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              Delete this post{d.results.some((r) => r.status === "queued") ? " and cancel its scheduled sends" : ""}?
              <Btn className="!border-rose-500/50 !text-rose-400" onClick={() => void onDelete()}>
                Delete
              </Btn>
              <Btn onClick={() => setConfirmDelete(false)}>Keep</Btn>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-[11px] text-ink-faint hover:text-rose-400">
              Delete
            </button>
          )}
          <span className="ml-auto flex gap-2">
            {anyAuto && d.stage !== "posted" && (
              <Btn disabled={busy === "now" || uploading != null} onClick={() => void postNow()} title="Send to every auto-post account right now">
                <Icon.Send width={12} height={12} /> {busy === "now" ? "Posting…" : "Post now"}
              </Btn>
            )}
            <Btn primary disabled={uploading != null} onClick={() => void close()}>
              <Icon.Check width={13} height={13} /> {d.scheduledAt && dirtySchedule.current ? "Save & schedule" : "Done"}
            </Btn>
          </span>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ res, why }: { res?: string; why: string | null }) {
  const map: Record<string, [string, string]> = {
    queued: ["scheduled", "bg-emerald-500/15 text-emerald-400"],
    publishing: ["posting…", "bg-brand/15 text-brand"],
    posted: ["posted", "bg-emerald-500/20 text-emerald-300"],
    inbox: ["in TikTok inbox", "bg-emerald-500/20 text-emerald-300"],
    manual: ["posted", "bg-emerald-500/20 text-emerald-300"],
    failed: ["failed", "bg-rose-500/15 text-rose-300"],
  };
  if (res && map[res]) return <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + map[res][1]}>{map[res][0]}</span>;
  return <span className={"rounded px-1.5 py-0.5 text-[10px] " + (why ? "bg-panel-2 text-ink-faint" : "bg-brand/15 font-semibold text-brand")}>{why ?? "auto-post"}</span>;
}

/** What autosaves locally as you type. The server queue is updated on close. */
function pickWords(d: Draft) {
  return {
    title: d.title,
    hook: d.hook,
    caption: d.caption,
    outline: d.outline,
    notes: d.notes,
    stage: d.stage,
    hashtags: d.hashtags,
    scheduledAt: d.scheduledAt,
    accountIds: d.accountIds,
    media: d.media,
  };
}

function toLocalInput(iso: string): string {
  const x = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label>
        {label}
        {hint && <span className="ml-1.5 normal-case tracking-normal text-ink-faint/70">— {hint}</span>}
      </Label>
      {children}
    </label>
  );
}
