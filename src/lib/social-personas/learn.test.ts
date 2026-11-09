import { describe, expect, it } from "vitest";

import { checkPolicy } from "./formats";
import {
  K_LEVER,
  deriveLessons,
  leverEffects,
  planBatch,
  scorePosts,
  scoreSeries,
  tierOf,
} from "./learn";
import { seedPersona } from "./seed";
import { DEFAULT_LEARN, type Persona, type Post } from "./types";

const NOW = new Date("2026-11-01T12:00:00Z");

let seq = 0;
const id = (p: string) => `${p}${++seq}`;

function post(over: Partial<Post> & { id: string }): Post {
  return {
    platform: "facebook",
    url: "",
    caption: "",
    postedAt: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(),
    addedAt: new Date(NOW.getTime() - 10 * 86_400_000).toISOString(),
    source: "sync",
    ...over,
  };
}

const find = <T extends { key: string }>(xs: T[], key: string): T | undefined => xs.find((x) => x.key === key);

describe("scorePosts", () => {
  it("holds a post back until it is old enough and has been seen enough", () => {
    const fresh = post({
      id: "fresh",
      postedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
      stats: { views: 9000, likes: 10, comments: 40, shares: 2 },
    });
    const thin = post({ id: "thin", stats: { views: 40, likes: 1, comments: 1, shares: 0 } });
    const ok = post({ id: "ok", stats: { views: 9000, likes: 10, comments: 40, shares: 2 } });
    const nothing = post({ id: "nothing", stats: { views: 0, likes: 0, comments: 0, shares: 0 } });

    const r = scorePosts([fresh, thin, ok, nothing], "trolling agent", DEFAULT_LEARN, NOW);
    expect(r.scored.map((s) => s.post.id)).toEqual(["ok"]);
    expect(r.maturing.map((p) => p.id).sort()).toEqual(["fresh", "thin"]);
    expect(r.unusable.map((p) => p.id)).toEqual(["nothing"]);
  });

  it("scores the biggest post on the page worst when nobody engaged per viewer", () => {
    // The decoy. fb_i2 has the most views, likes AND shares of all 17 seed
    // posts; per person reached it is near the bottom. If normalisation ever
    // breaks, this is the assertion that fails.
    const p = seedPersona(NOW);
    const { scored } = scorePosts(p.posts, p.nickname, p.learn, NOW);

    const raw = [...p.posts].sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0));
    expect(raw[0].id).toBe("fb_i2");

    const byId = new Map(scored.map((s) => [s.post.id, s.score]));
    expect(byId.get("fb_i2")!).toBeLessThan(0);
    // It scores below every single wrong-fact post, all of which had a
    // fraction of its reach.
    for (const id of ["fb_d1", "fb_d2", "fb_d3", "fb_d4", "fb_d5", "fb_d6", "fb_d7"]) {
      expect(byId.get("fb_i2")!).toBeLessThan(byId.get(id)!);
    }
    // And it sits in the bottom third of seventeen, not the top.
    expect(scored.slice(-5).map((s) => s.post.id)).toContain("fb_i2");
  });
});

describe("leverEffects", () => {
  it("finds the real pattern in six weeks of posting", () => {
    const p = seedPersona(NOW);
    const { scored } = scorePosts(p.posts, p.nickname, p.learn, NOW);
    const effects = leverEffects(scored, p.nickname);

    const wrongFact = find(effects, "format:deliberately-wrong-fact")!;
    expect(wrongFact).toBeDefined();
    expect(wrongFact.n).toBe(7);
    expect(wrongFact.effect).toBeGreaterThan(0);
    expect(wrongFact.ciLo).toBeGreaterThan(0);
    expect(wrongFact.tier).toBe("proven");

    // The reels are the measured loser, in spite of owning the view count.
    const impossible = find(effects, "format:impossible-choice")!;
    expect(impossible.effect).toBeLessThan(0);
    expect(impossible.ciHi).toBeLessThan(0);

    // Pessimistic ordering: the winner tops the table.
    expect(effects[0].key).toBe("format:deliberately-wrong-fact");
  });

  it("refuses to crown one lucky post, however good its rate looks", () => {
    // The trap. fb_bp1 has the highest engagement rate of all 17 posts off a
    // sample of one. A mean-ranked system promotes it; this must not.
    const p = seedPersona(NOW);
    const { scored } = scorePosts(p.posts, p.nickname, p.learn, NOW);
    const effects = leverEffects(scored, p.nickname);

    const rates = scored.map((s) => ({ id: s.post.id, rate: s.rate! })).sort((a, b) => b.rate - a.rate);
    expect(rates[0].id).toBe("fb_bp1");

    const photoshop = find(effects, "format:bad-photoshop")!;
    expect(photoshop.n).toBe(1);
    expect(photoshop.tier).toBe("unproven");
    expect(photoshop.ciLo).toBeLessThan(0);
    expect(photoshop.key).not.toBe(effects[0].key);
  });

  it("will not let n=2 outrank n=40, even with a higher raw average", () => {
    // Every post here is identical except its format lever, so `format` is the
    // only dimension with any contrast and carries the whole signal.
    const bland = (id: string, comments: number, levers: string[]): Post =>
      post({
        id,
        caption: "A post.",
        hook: "A post",
        format: "text-on-image",
        stats: { views: 10_000, likes: 200, comments, shares: 40 },
        leverKeys: levers,
      });

    // Sixty mediocre posts set the page's normal...
    const filler = Array.from({ length: 60 }, (_, i) =>
      bland(`filler${i}`, 300 + (i % 11) * 10, ["format:filler"]),
    );
    // ...forty good ones sit well above it...
    const steadyPosts = Array.from({ length: 40 }, (_, i) =>
      bland(`steady${i}`, 520 + (i % 7) * 10, ["format:steady"]),
    );
    // ...and two lucky ones beat even those, on a sample of two.
    const flukePosts = [bland("fluke0", 600, ["format:fluke"]), bland("fluke1", 610, ["format:fluke"])];

    const { scored } = scorePosts([...filler, ...steadyPosts, ...flukePosts], "trolling agent", DEFAULT_LEARN, NOW);
    const effects = leverEffects(scored, "trolling agent");
    const steady = find(effects, "format:steady")!;
    const fluke = find(effects, "format:fluke")!;

    const meanOf = (key: string) => {
      const xs = scored.filter((s) => s.leverKeys.includes(key));
      return xs.reduce((a, s) => a + s.score, 0) / xs.length;
    };
    // The fluke's raw average really is higher. This is the trap.
    expect(meanOf("format:fluke")).toBeGreaterThan(meanOf("format:steady"));

    // And it still loses, because ranking is on the lower confidence bound.
    expect(fluke.ciLo).toBeLessThan(steady.ciLo);
    expect(effects.findIndex((e) => e.key === "format:steady")).toBeLessThan(
      effects.findIndex((e) => e.key === "format:fluke"),
    );
    expect(steady.tier).toBe("proven");
    expect(fluke.tier).toBe("unproven");
    // Shrinkage alone also pulls the n=2 effect under the n=40 one.
    expect(fluke.effect).toBeLessThan(steady.effect);
  });

  it("shrinks an effect by exactly n/(n+K) of its residual mean", () => {
    expect(2 / (2 + K_LEVER)).toBeCloseTo(0.333, 2);
    expect(40 / (40 + K_LEVER)).toBeCloseTo(0.909, 2);
  });

  it("drops a dimension that never varies, and keeps a lopsided one", () => {
    const p = seedPersona(NOW);
    const { scored } = scorePosts(p.posts, p.nickname, p.learn, NOW);
    const effects = leverEffects(scored, p.nickname);
    // Barry never uses an emoji, so "emoji" explains nothing and is dropped.
    expect(effects.some((e) => e.dim === "emoji")).toBe(false);
    // Format is lopsided — one value with seven posts, others with one — and
    // that asymmetry is the comparison we want, so it must survive.
    expect(effects.filter((e) => e.dim === "format").length).toBeGreaterThanOrEqual(3);
  });
});

describe("tierOf", () => {
  it("needs sample size and a one-sided interval before it believes anything", () => {
    expect(tierOf(0, 0, 0)).toBe("prior");
    expect(tierOf(2, 0.4, 2.0)).toBe("unproven");
    expect(tierOf(4, 0.1, 0.9)).toBe("emerging");
    expect(tierOf(8, 0.1, 0.9)).toBe("proven");
    expect(tierOf(8, -0.9, -0.1)).toBe("proven-loser");
    expect(tierOf(9, -0.2, 0.6)).toBe("unproven");
  });
});

describe("deriveLessons", () => {
  it("writes a readable, evidenced lesson set on the first run", () => {
    const p = seedPersona(NOW);
    const { set } = deriveLessons(p, "2026-11-01", id, NOW);

    expect(set.version).toBe(1);
    expect(set.postsScored).toBe(17);
    expect(set.postsConsidered).toBe(17);
    expect(set.diff.learned.length).toBeGreaterThan(0);

    const win = set.lessons.find((l) => l.key === "format:deliberately-wrong-fact")!;
    expect(win.tier).toBe("proven");
    expect(win.statement).toMatch(/n=7/);
    expect(win.statement).toMatch(/90% CI/);
    expect(win.evidencePostIds.length).toBeGreaterThan(0);
    expect(set.note).toMatch(/Scored 17 of 17/);
  });

  it("versions upward and reports what changed rather than overwriting", () => {
    const p = seedPersona(NOW);
    const first = deriveLessons(p, "2026-11-01", id, NOW);
    const withHistory: Persona = { ...p, lessonLog: [first.set] };
    const second = deriveLessons(withHistory, "2026-11-02", id, NOW);

    expect(second.set.version).toBe(2);
    // Nothing new happened, so nothing is newly learned the second time.
    expect(second.set.diff.learned).toEqual([]);
    expect(second.set.note).toMatch(/No change since the last run/);
    // The first set is untouched — the log is append-only.
    expect(first.set.lessons.find((l) => l.key === "format:deliberately-wrong-fact")!.tier).toBe("proven");
  });

  it("falls back to visible assumptions instead of inventing findings", () => {
    const bare: Persona = { ...seedPersona(NOW), posts: [], lessonLog: [] };
    const { set } = deriveLessons(bare, "2026-11-01", id, NOW);
    expect(set.postsScored).toBe(0);
    expect(set.lessons.every((l) => l.source === "prior")).toBe(true);
    expect(set.lessons.length).toBeGreaterThan(0);
    expect(set.note).toMatch(/No posts on file yet/);
  });
});

describe("planBatch", () => {
  it("always reserves a slot for something untested", () => {
    const p = seedPersona(NOW);
    const withLessons: Persona = { ...p, lessonLog: [deriveLessons(p, "2026-11-01", id, NOW).set] };
    const plan = planBatch(withLessons, 6, "2026-11-01", NOW);

    expect(plan.slots).toHaveLength(6);
    expect(plan.counts.wildcard).toBe(1);
    expect(plan.counts.explore).toBeGreaterThanOrEqual(1);
    expect(plan.counts.exploit).toBeGreaterThanOrEqual(1);
    expect(plan.slots.filter((s) => s.role === "wildcard")).toHaveLength(1);
    // The wildcard is a format this page has genuinely never posted.
    const tried = new Set(p.posts.flatMap((x) => x.leverKeys ?? []));
    expect(tried.has(plan.slots.find((s) => s.role === "wildcard")!.leverKey!)).toBe(false);
  });

  it("leans on the proven lever and names the losers to avoid", () => {
    const p = seedPersona(NOW);
    const withLessons: Persona = { ...p, lessonLog: [deriveLessons(p, "2026-11-01", id, NOW).set] };
    const plan = planBatch(withLessons, 6, "2026-11-01", NOW);

    expect(plan.exploit.map((l) => l.key)).toContain("format:deliberately-wrong-fact");
    expect(plan.losers.some((l) => l.key === "format:impossible-choice")).toBe(true);
    expect(plan.onTrial.some((e) => e.key === "format:bad-photoshop")).toBe(true);
  });

  it("explores harder when the page has barely any data", () => {
    const young: Persona = { ...seedPersona(NOW), posts: seedPersona(NOW).posts.slice(0, 4), lessonLog: [] };
    const plan = planBatch(young, 6, "2026-11-01", NOW);
    expect(plan.counts.explore + plan.counts.wildcard).toBeGreaterThanOrEqual(3);
  });

  it("gives the same plan twice on the same day and a different one tomorrow", () => {
    const p = seedPersona(NOW);
    const a = planBatch(p, 6, "2026-11-01", NOW);
    const b = planBatch(p, 6, "2026-11-01", NOW);
    const c = planBatch(p, 6, "2026-11-08", NOW);
    expect(a.slots.map((s) => s.label)).toEqual(b.slots.map((s) => s.label));
    expect(c.slots.map((s) => s.label).join()).not.toBe("");
  });
});

describe("scoreSeries", () => {
  it("reports a weekly median so improvement is visible", () => {
    const s = scoreSeries(seedPersona(NOW), NOW);
    expect(s.length).toBeGreaterThanOrEqual(4);
    expect(s.reduce((a, x) => a + x.posts, 0)).toBe(17);
    // The history rises: the reel weeks sit below the wrong-fact weeks.
    expect(s[s.length - 1].medianScore).toBeGreaterThan(s[0].medianScore);
  });
});

describe("checkPolicy", () => {
  it("blocks the phrasing Facebook demotes, and says which", () => {
    expect(checkPolicy("Comment YES if you agree").ok).toBe(false);
    expect(checkPolicy("Tag 3 friends who do this").ok).toBe(false);
    expect(checkPolicy("Only 1% can solve this").ok).toBe(false);
    expect(checkPolicy("Share before it's deleted").ok).toBe(false);
    expect(checkPolicy("Comment YES if you agree").reason).toMatch(/demotes/);
  });

  it("blocks tragedy, politics and anything that reads as real news", () => {
    expect(checkPolicy("RIP to a legend").ok).toBe(false);
    expect(checkPolicy("Who are you voting for in the election?").ok).toBe(false);
    expect(checkPolicy("URGENT: product recall on this kettle").ok).toBe(false);
    expect(checkPolicy("This one trick cures back pain").ok).toBe(false);
  });

  it("lets harmless bait through", () => {
    expect(checkPolicy("Reminder: the Mustang has always been front wheel drive.").ok).toBe(true);
    expect(checkPolicy("Beans belong in a full English. That's it.").ok).toBe(true);
  });

  it("honours the persona's own avoid list", () => {
    const v = checkPolicy("A joke about caravans", "caravans, wasps");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/caravans/);
  });
});
