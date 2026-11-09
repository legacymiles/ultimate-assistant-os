import { describe, expect, it } from "vitest";
import {
  AA_BOARDS,
  AA_SOURCE,
  aaUrl,
  applyScoreRefresh,
  boardsDue,
  countApplied,
  entriesOf,
  hasRun,
  makersAgree,
  matchEntry,
  planBoardScores,
  refreshScores,
  REFRESH_EVERY_HOURS,
  scoreNote,
  usableEntries,
  words,
} from "./scores";
import type { AaBoard, AaEntry } from "./scores";
import { EMPTY_BOARD } from "./leaderboard";
import type { Model, PublicBoard, PublicScore } from "./leaderboard";
import { SEED_MODELS } from "./seedModels";

// The shape of a free "/media/.../models/free" response, as documented and as
// the live 401-probed endpoints describe themselves: { tier, data: [...] }.
const videoBody = {
  tier: "free",
  data: [
    { id: "a1", name: "Dreamina Seedance 2.5 1080p", slug: "seedance-2-5", model_creator: { id: "c1", name: "ByteDance Seed" }, elo: 1201, ci_95: 8 },
    { id: "a2", name: "Wan 3.0", slug: "wan-3-0", model_creator: { id: "c2", name: "Alibaba" }, elo: 1180, ci_95: 9 },
    { id: "a3", name: "MiniMax H3", slug: "minimax-h3", model_creator: { id: "c3", name: "MiniMax" }, elo: 1150, ci_95: 11 },
    { id: "a4", name: "Kling 2.1 Master", slug: "kling-2-1-master", model_creator: { id: "c4", name: "Kuaishou" }, elo: 1140, ci_95: 10 },
    { id: "a5", name: "Kling 2.1 Pro", slug: "kling-2-1-pro", model_creator: { id: "c4", name: "Kuaishou" }, elo: 1120, ci_95: 12 },
    { id: "a6", name: "Veo 4.1 Fast", slug: "veo-4-1-fast", model_creator: { id: "c5", name: "Google" }, elo: 1190, ci_95: 7 },
    { id: "a7", name: "LTX-2.5", slug: "ltx-2-5", model_creator: { id: "c6", name: "Lightricks" }, elo: null },
  ] satisfies AaEntry[],
};

const t2v: AaBoard = AA_BOARDS.find((b) => b.category === "text-to-video")!;

function model(p: Partial<Model> & { id: string; name: string }): Model {
  return {
    maker: "",
    category: "text-to-video",
    url: `https://example.com/${p.id}`,
    summary: "",
    releasedAt: "2026-10-01",
    addedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    openSource: false,
    runsLocally: false,
    access: "paid",
    features: [],
    tags: [],
    ...p,
  };
}

const aaScore = (value: number, asOf = "2026-10-01"): PublicScore => ({
  value,
  kind: "elo",
  label: t2v.label,
  source: AA_SOURCE,
  url: t2v.url,
  asOf,
});

describe("reading AA's answer", () => {
  it("takes data[], a bare array, and nothing at all", () => {
    expect(entriesOf(videoBody)).toHaveLength(7);
    expect(entriesOf(videoBody.data)).toHaveLength(7);
    expect(entriesOf({ tier: "free" })).toEqual([]);
    expect(entriesOf(null)).toEqual([]);
    expect(entriesOf("nope")).toEqual([]);
  });

  it("drops entries with no name or no Elo", () => {
    const usable = usableEntries([
      ...entriesOf(videoBody),
      { name: "", elo: 1000 },
      { name: "Zero", elo: 0 },
      { name: "Text", elo: "1100" as unknown as number },
    ]);
    expect(usable.map((e) => e.name)).toEqual([
      "Dreamina Seedance 2.5 1080p",
      "Wan 3.0",
      "MiniMax H3",
      "Kling 2.1 Master",
      "Kling 2.1 Pro",
      "Veo 4.1 Fast",
    ]);
  });

  it("calls the free endpoints, which is what a free key may read", () => {
    for (const b of AA_BOARDS) {
      expect(aaUrl(b).startsWith("https://artificialanalysis.ai/api/v2/"), b.category).toBe(true);
      expect(b.path.endsWith("/models/free"), b.category).toBe(true);
    }
  });
});

describe("words and makers", () => {
  it("keeps a version number whole, so Veo 4 is not Veo 4.1", () => {
    expect(words("Veo 4.1 Fast")).toEqual(["veo", "4.1", "fast"]);
    expect(words("Qwen-Image-2.1")).toEqual(["qwen", "image", "2.1"]);
    expect(hasRun(words("Veo 4.1 Fast"), words("Veo 4"))).toBe(false);
    expect(hasRun(words("Dreamina Seedance 2.5 1080p"), words("Seedance 2.5"))).toBe(true);
  });

  it("lets a lab be written two ways but not swapped for another", () => {
    expect(makersAgree("ByteDance Seed", "ByteDance")).toBe(true);
    expect(makersAgree("Google DeepMind", "Google")).toBe(true);
    expect(makersAgree("Alibaba Qwen", "alibaba")).toBe(true);
    expect(makersAgree("Mureka (Kunlun Tech)", "Mureka")).toBe(true);
    expect(makersAgree("", "Anyone")).toBe(true);
    expect(makersAgree("OpenAI", "Google")).toBe(false);
    expect(makersAgree("Kuaishou", "MiniMax")).toBe(false);
  });
});

describe("matching a model to an AA entry", () => {
  const entries = entriesOf(videoBody);

  it("matches on the name, ignoring case and punctuation", () => {
    expect(matchEntry({ name: "wan 3.0", maker: "Alibaba" }, entries).entry?.id).toBe("a2");
    expect(matchEntry({ name: "MiniMax-H3", maker: "MiniMax" }, entries).entry?.id).toBe("a3");
  });

  it("sees through AA's product prefix and resolution suffix", () => {
    expect(matchEntry({ name: "Seedance 2.5", maker: "ByteDance Seed" }, entries).entry?.id).toBe("a1");
  });

  it("refuses to pick between two candidates", () => {
    expect(matchEntry({ name: "Kling 2.1", maker: "Kuaishou" }, entries)).toEqual({ miss: "ambiguous" });
  });

  it("will not take a newer version's score", () => {
    expect(matchEntry({ name: "Veo 4", maker: "Google" }, entries)).toEqual({ miss: "none" });
  });

  it("will not match across makers, even on the same name", () => {
    expect(matchEntry({ name: "Wan 3.0", maker: "OpenAI" }, entries)).toEqual({ miss: "none" });
  });

  it("ignores an entry AA has no Elo for", () => {
    expect(matchEntry({ name: "LTX-2.5", maker: "Lightricks" }, entries)).toEqual({ miss: "none" });
  });

  it("says none when the board has a model AA never heard of", () => {
    expect(matchEntry({ name: "Nobody's Model", maker: "Nobody" }, entries)).toEqual({ miss: "none" });
  });
});

describe("planning one board", () => {
  const entries = entriesOf(videoBody);

  it("changes only the numbers that moved, and dates those", () => {
    const models = [
      model({ id: "m1", name: "Seedance 2.5", maker: "ByteDance Seed", publicScore: aaScore(1158) }),
      model({ id: "m2", name: "Wan 3.0", maker: "Alibaba", publicScore: aaScore(1180) }),
    ];
    const plan = planBoardScores(models, t2v, entries, "2026-11-09");
    expect(plan.unchanged).toBe(1);
    expect(plan.changes).toHaveLength(1);
    const [c] = plan.changes;
    expect(c).toMatchObject({ modelId: "m1", from: 1158, to: 1201, aaName: "Dreamina Seedance 2.5 1080p" });
    expect(c.score).toEqual({
      value: 1201,
      kind: "elo",
      label: t2v.label,
      source: AA_SOURCE,
      url: t2v.url,
      asOf: "2026-11-09",
    });
  });

  it("gives an unscored model the category's own source", () => {
    const plan = planBoardScores(
      [model({ id: "m3", name: "MiniMax H3", maker: "MiniMax" })],
      t2v,
      entries,
      "2026-11-09",
    );
    expect(plan.changes[0]).toMatchObject({ from: null, to: 1150 });
    expect(plan.changes[0].score.label).toBe(t2v.label);
  });

  it("never overwrites a score the owner sourced elsewhere", () => {
    const models = [
      model({
        id: "m4",
        name: "Wan 3.0",
        maker: "Alibaba",
        publicScore: { value: 1400, kind: "elo", label: "LMArena text Elo", source: "LMArena" },
      }),
    ];
    const plan = planBoardScores(models, t2v, entries, "2026-11-09");
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([{ modelId: "m4", name: "Wan 3.0", category: "text-to-video", why: "other-source" }]);
  });

  it("leaves other categories alone", () => {
    const models = [model({ id: "m5", name: "Wan 3.0", maker: "Alibaba", category: "image" })];
    expect(planBoardScores(models, t2v, entries, "2026-11-09")).toEqual({ changes: [], skipped: [], unchanged: 0 });
  });

  it("records why each unmatched model kept its score", () => {
    const models = [
      model({ id: "m6", name: "Kling 2.1", maker: "Kuaishou", publicScore: aaScore(1130) }),
      model({ id: "m7", name: "Nobody's Model", maker: "Nobody", publicScore: aaScore(900) }),
    ];
    const plan = planBoardScores(models, t2v, entries, "2026-11-09");
    expect(plan.changes).toEqual([]);
    expect(plan.skipped.map((s) => s.why)).toEqual(["ambiguous", "none"]);
  });
});

// ----- the whole run --------------------------------------------------------

function boardWith(models: Model[], extra: Partial<PublicBoard> = {}): PublicBoard {
  return { ...EMPTY_BOARD, models, ...extra };
}

function fakeFetch(bodies: Partial<Record<string, unknown>>, log: string[] = []) {
  return (async (url: string | URL | Request) => {
    const u = String(url);
    log.push(u);
    const hit = AA_BOARDS.find((b) => u === aaUrl(b));
    const body = hit ? bodies[hit.category] : undefined;
    if (body === undefined) return new Response("no", { status: 500 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

const NOW = Date.parse("2026-11-09T06:00:00.000Z");

describe("refreshScores", () => {
  it("does nothing at all without a key", async () => {
    const log: string[] = [];
    const r = await refreshScores(boardWith([]), { fetcher: fakeFetch({}, log), now: NOW });
    expect(r.noKey).toBe(true);
    expect(log).toEqual([]);
    expect(scoreNote(r)).toBe("scores not refreshed (no Artificial Analysis key set)");
  });

  it("spends one call per board, and no more", async () => {
    const log: string[] = [];
    await refreshScores(boardWith([]), {
      apiKey: "k",
      fetcher: fakeFetch(Object.fromEntries(AA_BOARDS.map((b) => [b.category, videoBody])), log),
      now: NOW,
    });
    expect(log).toHaveLength(AA_BOARDS.length);
    expect(AA_BOARDS.length).toBeLessThanOrEqual(8);
    expect(new Set(log).size).toBe(log.length);
  });

  it("sends the key as x-api-key", async () => {
    let headers: Headers | undefined;
    const fetcher = (async (_u: unknown, init?: RequestInit) => {
      headers = new Headers(init?.headers);
      return new Response(JSON.stringify(videoBody), { status: 200 });
    }) as unknown as typeof fetch;
    await refreshScores(boardWith([]), { apiKey: "secret-key", fetcher, now: NOW });
    expect(headers?.get("x-api-key")).toBe("secret-key");
  });

  it("skips boards read within the day and says so", async () => {
    const log: string[] = [];
    const seen = Object.fromEntries(AA_BOARDS.map((b) => [b.category, new Date(NOW - 3600_000).toISOString()]));
    const r = await refreshScores(boardWith([], { scoreRefreshedAt: seen }), {
      apiKey: "k",
      fetcher: fakeFetch({}, log),
      now: NOW,
    });
    expect(log).toEqual([]);
    expect(r.fresh).toHaveLength(AA_BOARDS.length);
    expect(scoreNote(r)).toBe("scores checked earlier today");
  });

  it("comes back to a board once the window has passed", () => {
    const old = new Date(NOW - (REFRESH_EVERY_HOURS + 1) * 3600_000).toISOString();
    const { due, fresh } = boardsDue(boardWith([], { scoreRefreshedAt: { tts: old } }), NOW);
    expect(fresh).toEqual([]);
    expect(due).toHaveLength(AA_BOARDS.length);
  });

  it("treats a rubbish timestamp as never read", () => {
    const { due } = boardsDue(boardWith([], { scoreRefreshedAt: { tts: "whenever" } }), NOW);
    expect(due.some((b) => b.category === "tts")).toBe(true);
  });

  it("names the boards it could not read and does not mark them refreshed", async () => {
    const r = await refreshScores(boardWith([model({ id: "m1", name: "Wan 3.0", maker: "Alibaba" })]), {
      apiKey: "k",
      fetcher: fakeFetch({ "text-to-video": videoBody }),
      now: NOW,
    });
    expect(Object.keys(r.refreshedAt)).toEqual(["text-to-video"]);
    expect(r.failed.sort()).toEqual(AA_BOARDS.filter((b) => b.category !== "text-to-video").map((b) => b.short).sort());
    expect(r.changes).toHaveLength(1);
    expect(scoreNote(r)).toContain("1 score refreshed");
    expect(scoreNote(r)).toContain("couldn't read");
  });

  it("counts an empty board as a failure, not an empty arena", async () => {
    const r = await refreshScores(boardWith([]), {
      apiKey: "k",
      fetcher: fakeFetch(Object.fromEntries(AA_BOARDS.map((b) => [b.category, { tier: "free", data: [] }]))),
      now: NOW,
    });
    expect(r.refreshedAt).toEqual({});
    expect(r.failed).toHaveLength(AA_BOARDS.length);
  });

  it("says scores are current when every match already agrees", async () => {
    const r = await refreshScores(boardWith([model({ id: "m1", name: "Wan 3.0", maker: "Alibaba", publicScore: aaScore(1180) })]), {
      apiKey: "k",
      fetcher: fakeFetch(Object.fromEntries(AA_BOARDS.map((b) => [b.category, videoBody]))),
      now: NOW,
    });
    expect(r.changes).toEqual([]);
    expect(scoreNote(r)).toBe("scores already current");
  });
});

describe("applying a plan to the board as it is now", () => {
  it("writes the new score and stamps the record", async () => {
    const before = boardWith([model({ id: "m1", name: "Wan 3.0", maker: "Alibaba", publicScore: aaScore(1100) })]);
    const r = await refreshScores(before, {
      apiKey: "k",
      fetcher: fakeFetch({ "text-to-video": videoBody }),
      now: NOW,
    });
    const after = applyScoreRefresh(before, r, "2026-11-09T06:00:00.000Z");
    expect(after.models[0].publicScore?.value).toBe(1180);
    expect(after.models[0].publicScore?.asOf).toBe("2026-11-09");
    expect(after.models[0].updatedAt).toBe("2026-11-09T06:00:00.000Z");
    expect(after.scoreRefreshedAt?.["text-to-video"]).toBeTruthy();
    expect(countApplied(before, after, r)).toBe(1);
  });

  it("leaves an edit the owner made while AA was loading", async () => {
    const before = boardWith([model({ id: "m1", name: "Wan 3.0", maker: "Alibaba", publicScore: aaScore(1100) })]);
    const r = await refreshScores(before, {
      apiKey: "k",
      fetcher: fakeFetch(Object.fromEntries(AA_BOARDS.map((b) => [b.category, videoBody]))),
      now: NOW,
    });
    // The owner typed 1177 by hand between the read and the save.
    const edited = boardWith([model({ id: "m1", name: "Wan 3.0", maker: "Alibaba", publicScore: aaScore(1177) })]);
    const after = applyScoreRefresh(edited, r);
    expect(after.models[0].publicScore?.value).toBe(1177);
    expect(countApplied(edited, after, r)).toBe(0);
    expect(scoreNote(r, countApplied(edited, after, r))).toBe("scores already current");
  });

  it("ignores a model deleted while AA was loading", async () => {
    const before = boardWith([model({ id: "m1", name: "Wan 3.0", maker: "Alibaba", publicScore: aaScore(1100) })]);
    const r = await refreshScores(before, { apiKey: "k", fetcher: fakeFetch({ "text-to-video": videoBody }), now: NOW });
    const after = applyScoreRefresh(boardWith([]), r);
    expect(after.models).toEqual([]);
    expect(countApplied(before, after, r)).toBe(0);
  });
});

describe("against the seeded board", () => {
  it("writes back exactly the label each category already uses", () => {
    for (const b of AA_BOARDS) {
      const labels = new Set(
        SEED_MODELS.filter((m) => m.category === b.category && m.publicScore).map((m) => m.publicScore!.label),
      );
      expect([...labels], b.category).toEqual([b.label]);
    }
  });

  it("only touches categories whose source is Artificial Analysis", () => {
    for (const b of AA_BOARDS) {
      const sources = new Set(
        SEED_MODELS.filter((m) => m.category === b.category && m.publicScore).map((m) => m.publicScore!.source),
      );
      expect([...sources], b.category).toEqual([AA_SOURCE]);
    }
  });

  it("keeps one score source per category after a refresh", async () => {
    const before = boardWith(SEED_MODELS.map((m) => ({ ...m })));
    const bodies = Object.fromEntries(
      AA_BOARDS.map((b) => [
        b.category,
        {
          tier: "free",
          data: before.models
            .filter((m) => m.category === b.category)
            .map((m, i) => ({ id: `x${i}`, name: m.name, slug: m.name, model_creator: { name: m.maker }, elo: 1000 + i })),
        },
      ]),
    );
    const r = await refreshScores(before, { apiKey: "k", fetcher: fakeFetch(bodies), now: NOW });
    const after = applyScoreRefresh(before, r);
    const labels = new Map<string, Set<string>>();
    for (const m of after.models) {
      if (!m.publicScore) continue;
      labels.set(
        m.category,
        (labels.get(m.category) ?? new Set()).add(`${m.publicScore.kind}:${m.publicScore.label}`),
      );
    }
    for (const [cat, set] of labels) expect(set.size, cat).toBe(1);
    expect(r.changes.length).toBeGreaterThan(0);
  });

  it("never moves a score in a category it does not own", async () => {
    const before = boardWith(SEED_MODELS.map((m) => ({ ...m })));
    // AA answering every board with the same list is the worst case: a name
    // from another category must still not be scored from this board.
    const r = await refreshScores(before, {
      apiKey: "k",
      fetcher: fakeFetch(Object.fromEntries(AA_BOARDS.map((b) => [b.category, videoBody]))),
      now: NOW,
    });
    const owned = new Set(AA_BOARDS.map((b) => b.category));
    expect(r.changes.every((c) => owned.has(c.category))).toBe(true);
    const after = applyScoreRefresh(before, r);
    for (const m of after.models) {
      if (owned.has(m.category)) continue;
      const was = before.models.find((x) => x.id === m.id)!;
      expect(m.publicScore, m.name).toEqual(was.publicScore);
    }
  });
});
