"use client";

// ---------------------------------------------------------------------------
// Analytics: how the persona is growing and how every video is doing.
//
// The numbers come from the stat history each sync records (no history = one
// reading, said plainly). A video's row shows its growth curve and how it's
// doing against the persona's own normal; opening it shows the full curve,
// every reading, and a "Plan a follow-up" that puts a part 2 in the plan.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import {
  byFormat,
  bestTimes,
  compact,
  dailyViews,
  engagementRate,
  followerSeries,
  gainedSince,
  growthCurve,
  historyOf,
  momentum,
  newDraft,
  personaTotals,
  reach,
  type Momentum,
} from "@/lib/social-personas/studio";
import { PLATFORM_NAME, type Post } from "@/lib/social-personas/types";
import { Btn, PlatformDot, inputCls } from "./bits";
import { DOW_NAMES, LineChart, Sparkline, TimeHeatmap, hourLabel } from "./charts";
import type { TabProps } from "./Workspace";

type Sort = "newest" | "views" | "growing" | "engagement";

const MOMENTUM: Record<Momentum, { label: string; cls: string }> = {
  breakout: { label: "breakout", cls: "ps-pulse bg-brand/20 text-brand" },
  above: { label: "above usual", cls: "bg-emerald-500/15 text-emerald-400" },
  normal: { label: "usual", cls: "bg-panel-2 text-ink-faint" },
  below: { label: "below usual", cls: "bg-panel-2 text-ink-faint" },
  new: { label: "too early", cls: "bg-panel-2 text-ink-faint" },
};

export function AnalyticsTab(props: TabProps) {
  const { persona, mutate, flash } = props;
  const [sort, setSort] = useState<Sort>("newest");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState<string>("all");
  const [open, setOpen] = useState<string | null>(null);

  const t = personaTotals(persona);
  const [now] = useState(() => Date.now());
  const daily = useMemo(() => dailyViews(persona.posts, 30, now), [persona.posts, now]);
  const followers = useMemo(() => followerSeries(persona.accounts), [persona.accounts]);
  const times = useMemo(() => bestTimes(persona.posts), [persona.posts]);
  const formats = useMemo(() => byFormat(persona.posts).slice(0, 6), [persona.posts]);
  const platforms = [...new Set(persona.posts.map((p) => p.platform))];

  const rows = useMemo(() => {
    const list = persona.posts.filter(
      (p) => (platform === "all" || p.platform === platform) && (!q || `${p.title} ${p.caption} ${p.hook} ${p.format}`.toLowerCase().includes(q.toLowerCase())),
    );
    const stamp = (p: Post) => Date.parse(p.postedAt || p.addedAt) || 0;
    const by: Record<Sort, (a: Post, b: Post) => number> = {
      newest: (a, b) => stamp(b) - stamp(a),
      views: (a, b) => reach(b) - reach(a),
      growing: (a, b) => (gainedSince(b, 24, now) ?? -1) - (gainedSince(a, 24, now) ?? -1),
      engagement: (a, b) => (engagementRate(b) ?? -1) - (engagementRate(a) ?? -1),
    };
    return [...list].sort(by[sort]);
  }, [persona.posts, platform, q, sort, now]);

  const openPost = persona.posts.find((p) => p.id === open) ?? null;

  if (persona.posts.length === 0) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-dashed border-line px-4 py-12 text-center text-sm text-ink-muted">
        No videos to measure yet. Connect an account on Overview (its videos and their views sync in by themselves), or paste post links in Videos.
        Every sync after that records each video's progress.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-panel sm:grid-cols-5">
        <Kpi label="Followers" value={t.followers ? compact(t.followers) : "—"} />
        <Kpi label="Views · 7 days" value={compact(t.views7d)} />
        <Kpi label="Posted · 7 days" value={String(t.posts7d)} />
        <Kpi label="Median views" value={t.medianViews ? compact(t.medianViews) : "—"} />
        <Kpi label="Engagement" value={t.engagement != null ? `${(t.engagement * 100).toFixed(1)}%` : "—"} hint="(likes + comments + shares) ÷ views, median per video" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Views per day · last 30 days">
          <LineChart
            points={daily.map((v, i) => ({ x: i, y: v, label: new Date(now - (29 - i) * 86_400_000).toLocaleDateString([], { month: "short", day: "numeric" }) }))}
            yLabel="views"
            xTicks={[0, 10, 20, 29].map((i) => ({ x: i, label: i === 29 ? "today" : `${29 - i}d ago` }))}
            empty="Views per day appear after a couple of syncs."
          />
        </Card>
        <Card title="Followers">
          <LineChart
            points={followers.map((f, i) => ({ x: i, y: f.n, label: new Date(f.day + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }) }))}
            yLabel="followers"
            xTicks={followers.length > 1 ? [0, followers.length - 1].map((i) => ({ x: i, label: new Date(followers[i].day + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" }) })) : []}
            empty="Follower growth starts drawing after the second day a connected account syncs."
          />
        </Card>
      </div>

      <Card title="Every video">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <div className="relative min-w-40 flex-1">
            <Icon.Search width={14} height={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input className={inputCls + " py-1 pl-8 text-xs"} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search videos" aria-label="Search videos" />
          </div>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="rounded-lg border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-brand" aria-label="Platform">
            <option value="all">All platforms</option>
            {platforms.map((p) => (
              <option key={p} value={p}>
                {p === "other" ? "Other" : PLATFORM_NAME[p]}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-line p-0.5 text-xs" role="group" aria-label="Sort">
            {(
              [
                ["newest", "Newest"],
                ["views", "Most views"],
                ["growing", "Growing now"],
                ["engagement", "Engagement"],
              ] as [Sort, string][]
            ).map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)} aria-pressed={sort === k} className={"rounded-md px-2 py-0.5 " + (sort === k ? "bg-elevated text-ink" : "text-ink-muted hover:text-ink")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wider text-ink-faint">
              <tr>
                <th className="w-20 px-2 py-1.5 font-medium">Posted</th>
                <th className="px-2 py-1.5 font-medium">Video</th>
                <th className="w-24 px-2 py-1.5 font-medium">Progress</th>
                <th className="w-16 px-2 py-1.5 text-right font-medium">Views</th>
                <th className="w-16 px-2 py-1.5 text-right font-medium">+24h</th>
                <th className="w-14 px-2 py-1.5 text-right font-medium">Likes</th>
                <th className="w-14 px-2 py-1.5 text-right font-medium">Eng.</th>
                <th className="w-32 px-2 py-1.5 font-medium">vs usual</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const m = momentum(p, persona.posts, now);
                const g = gainedSince(p, 24, now);
                const er = engagementRate(p);
                const curve = historyOf(p).map((s) => s.views ?? 0);
                return (
                  <tr key={p.id} onClick={() => setOpen(p.id)} className={"cursor-pointer border-t border-line hover:bg-panel-2 " + (open === p.id ? "bg-panel-2" : "")}>
                    <td className="px-2 py-1.5 tabular-nums text-ink-faint">{(p.postedAt || p.addedAt).slice(5, 10)}</td>
                    <td className="max-w-0 px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <PlatformDot platform={p.platform} />
                        <span className="truncate font-medium text-ink">{p.title || p.caption.split("\n")[0] || "Untitled"}</span>
                        {p.draftId && <span className="shrink-0 rounded bg-panel-2 px-1 text-[10px] text-ink-faint" title="Planned in the Studio">planned</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1">
                      <Sparkline values={curve.length > 1 ? curve : [0, curve[0] ?? 0]} width={80} height={20} label="views over time" />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink">{p.stats?.views != null ? compact(p.stats.views) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{g != null ? (g > 0 ? "+" + compact(g) : "0") : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{p.stats?.likes != null ? compact(p.stats.likes) : "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-ink-muted">{er != null ? `${(er * 100).toFixed(1)}%` : "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className={"whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold " + MOMENTUM[m.kind].cls} title={m.ratio ? `${m.ratio.toFixed(1)}× this persona's median on ${p.platform}` : ""}>
                        {MOMENTUM[m.kind].label}
                        {(m.kind === "breakout" || m.kind === "above") && ` ${m.ratio.toFixed(1)}×`}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-4 text-center text-xs text-ink-muted">No videos match.</p>}
        </div>
      </Card>

      {openPost && (
        <VideoDetail
          post={openPost}
          onClose={() => setOpen(null)}
          onFollowUp={() => {
            const d = newDraft({
              title: `Part 2: ${openPost.title || openPost.caption.split("\n")[0] || "follow-up"}`.slice(0, 140),
              hook: openPost.hook ?? "",
              notes: `Follow-up to a video that did ${compact(reach(openPost))} views${openPost.url ? ` — ${openPost.url}` : ""}.`,
              stage: "script",
              accountIds: persona.accounts.filter((a) => a.platform === openPost.platform).map((a) => a.id),
            });
            mutate(persona.id, (p) => ({ ...p, drafts: [d, ...p.drafts] }));
            flash("Follow-up added to your plan (Plan & post → Not scheduled yet).");
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="When your posts do best">
          <TimeHeatmap grid={times.grid} />
          {times.top.length > 0 && (
            <p className="mt-2 text-[11px] text-ink-muted">
              Best so far:{" "}
              {times.top.map((s, i) => (
                <span key={i} className="mr-2 text-ink">
                  {DOW_NAMES[s.dow]} {hourLabel(s.hour)} <span className="text-ink-faint">({s.score.toFixed(1)}×, {s.n} post{s.n > 1 ? "s" : ""})</span>
                </span>
              ))}
              {times.top.some((s) => s.n >= 2)
                ? "— the calendar aims new posts at the best slot with 2+ posts."
                : "— one post per slot isn't proof yet; the calendar starts using a slot once 2 posts back it up."}
            </p>
          )}
        </Card>
        <Card title="What's working, by format">
          {formats.length === 0 ? (
            <p className="text-xs text-ink-muted">Formats appear once videos are read (Videos → Read unread).</p>
          ) : (
            <table className="w-full text-left text-xs">
              <tbody>
                {formats.map((f) => (
                  <tr key={f.format} className="border-t border-line first:border-t-0">
                    <td className="py-1.5 capitalize text-ink">{f.format}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink-faint">{f.posts}×</td>
                    <td className="w-24 py-1.5 pl-2">
                      <div className="h-1.5 rounded-full bg-panel-2">
                        <div className="h-full rounded-full bg-brand" style={{ width: `${(f.median / formats[0].median) * 100}%` }} />
                      </div>
                    </td>
                    <td className="py-1.5 pl-2 text-right tabular-nums text-ink">{compact(f.median)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function VideoDetail({ post, onClose, onFollowUp }: { post: Post; onClose: () => void; onFollowUp: () => void }) {
  const curve = growthCurve(post);
  const hist = historyOf(post);
  const maxH = curve.length ? curve[curve.length - 1].h : 0;
  const unit = maxH > 72 ? "d" : "h";
  const fmt = (h: number) => (unit === "d" ? `${Math.round(h / 24)}d` : `${Math.round(h)}h`);
  return (
    <section className="ps-sheet rounded-xl border border-brand/40 bg-panel p-3">
      <div className="mb-2 flex items-start gap-2">
        <PlatformDot platform={post.platform} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{post.title || post.caption.split("\n")[0] || "Untitled"}</div>
          {post.hook && <div className="truncate text-xs text-ink-muted">Hook: “{post.hook}”</div>}
        </div>
        {post.url && (
          <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted hover:text-ink">
            <Icon.Launch width={11} height={11} /> Open
          </a>
        )}
        <Btn onClick={onFollowUp}>
          <Icon.Plus width={11} height={11} /> Plan a follow-up
        </Btn>
        <button onClick={onClose} className="rounded p-1 text-ink-muted hover:bg-panel-2 hover:text-ink" aria-label="Close video">
          <Icon.Close width={14} height={14} />
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
        <LineChart
          points={curve.map((c) => ({ x: c.h, y: c.views, label: `${fmt(c.h)} after posting` }))}
          yLabel="views"
          xTicks={curve.length > 1 ? [0, maxH / 2, maxH].map((h) => ({ x: h, label: fmt(h) })) : []}
          empty="One reading so far — the curve draws after the next sync."
        />
        <div className="max-h-48 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-panel text-ink-faint">
              <tr>
                <th className="px-2 py-1 font-medium">Read at</th>
                <th className="px-2 py-1 text-right font-medium">Views</th>
                <th className="px-2 py-1 text-right font-medium">Likes</th>
              </tr>
            </thead>
            <tbody>
              {[...hist].reverse().map((s) => (
                <tr key={s.at} className="border-t border-line">
                  <td className="px-2 py-1 tabular-nums text-ink-muted">{new Date(s.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink">{s.views != null ? compact(s.views) : "—"}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-ink-muted">{s.likes != null ? compact(s.likes) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-faint">{title}</h3>
      {children}
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border-b border-r border-line px-3 py-2.5 sm:border-b-0" title={hint}>
      <div className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="text-xl font-bold tabular-nums text-ink">{value}</div>
    </div>
  );
}
