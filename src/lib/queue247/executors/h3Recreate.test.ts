import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Blueprint } from "@/lib/h3-lab/model";
import type { Task } from "../types";
import type { NewFinding, StepContext } from "./types";

// Storage is mocked: the phases that only read the saved analysis run for real.
const files = new Map<string, Buffer>();
vi.mock("../h3/blob", () => ({
  getFile: async (k: string) => files.get(k) ?? null,
  putFile: async (k: string, b: Buffer) => (files.set(k, b), true),
  fileSize: async (k: string) => (files.has(k) ? files.get(k)!.length : null),
  downloadToFile: async () => 0,
  readyBucket: async () => true,
}));

const { h3RecreateExecutor, pickFrames } = await import("./h3Recreate");

function task(config: Record<string, unknown>, state: Record<string, unknown> = {}): Task {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    user_id: "user-1",
    title: "Recreate “diner” for H3",
    description: "",
    instruction: "",
    app: "h3-experiments",
    executor: "h3-recreate",
    agent: "H3 Recreation Agent",
    kind: "once",
    status: "running",
    priority: 3,
    progress: 0,
    current_step: "",
    steps: [],
    config,
    state,
    schedule: {},
    next_run_at: null,
    last_run_at: null,
    last_activity_at: null,
    attempts: 1,
    max_attempts: 5,
    parent_id: null,
    depends_on: [],
    needs: ["ffmpeg", "ai", "storage"],
    locked_by: null,
    lock_until: null,
    success_count: 0,
    failure_count: 0,
    last_error: null,
    result_summary: null,
    question: null,
    created_by: "you",
    created_at: "2026-11-25T00:00:00Z",
    updated_at: "2026-11-25T00:00:00Z",
  };
}

function ctxFor(t: Task) {
  const findings: NewFinding[] = [];
  const logs: string[] = [];
  const notes: string[] = [];
  const ctx: StepContext = {
    task: t,
    state: t.state,
    steps: [],
    signal: new AbortController().signal,
    now: () => new Date("2026-11-25T10:00:00Z"),
    log: async (m) => void logs.push(m),
    progress: async () => undefined,
    finding: async (f) => (findings.push(f), { id: String(findings.length), isNew: true }),
    knownKeys: async () => new Set(),
    spawn: async () => "child",
    notify: async (title, body) => void notes.push(`${title} | ${body}`),
    recentFindings: async () => [],
    meter: { aiCalls: 0, searches: 0 },
  };
  return { ctx, findings, logs, notes };
}

function blueprint(): Blueprint {
  return {
    id: "bp-1",
    sourceName: "diner.mp4",
    durationSec: 9,
    width: 1920,
    height: 1080,
    createdAt: "2026-11-25T00:00:00Z",
    detection: "ffmpeg-scdet",
    engine: "ai",
    genre: "movie-scene",
    style: "35mm film, warm grade",
    editingRhythm: "2 shots",
    sound: "diner hum",
    characters: [{ label: "Person A", description: "a man in a red jacket" }],
    environments: [{ label: "diner", description: "a narrow diner" }],
    shots: [0, 1].map((i) => ({
      index: i,
      start: i * 4,
      end: i * 4 + (i ? 5 : 4),
      keyframes: [`user-1/t/f${i + 1}-1.jpg`],
      cutStrength: i ? 0.5 : 0,
      characters: ["Person A"],
      positions: "Person A at the counter",
      actions: i ? "Person A stands up" : "Person A sips coffee",
      dialogue: "",
      emotion: "calm",
      camera: { angle: "medium shot", move: i ? ("static" as const) : ("push-in" as const), amount: "small" as const, speed: "slow" as const },
      lighting: "warm practical light",
      environment: "diner",
      props: "",
      transitionIn: "cut",
    })),
  };
}

beforeEach(() => files.clear());

describe("h3-recreate executor", () => {
  it("declares itself for the registry", () => {
    expect(h3RecreateExecutor).toMatchObject({ id: "h3-recreate", agent: "H3 Recreation Agent", needs: ["ffmpeg", "ai", "storage"], defaultKind: "once", concurrency: 1 });
    expect(h3RecreateExecutor.initialSteps?.({})).toHaveLength(7);
  });

  it("asks for a video when there is none", async () => {
    const { ctx } = ctxFor(task({ changes: {} }));
    const r = await h3RecreateExecutor.run(ctx);
    expect(r.outcome).toBe("needs_input");
    expect(ctx.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
  });

  it("refuses an upload from another account", async () => {
    const { ctx } = ctxFor(task({ videoKey: "uploads/user-2/abc.mp4" }));
    const r = await h3RecreateExecutor.run(ctx);
    expect(r).toMatchObject({ outcome: "failed", retryable: false });
  });

  it("asks again when the upload never landed, and moves on when it did", async () => {
    const t = task({ videoKey: "uploads/user-1/abc.mp4" });
    const first = ctxFor(t);
    expect((await h3RecreateExecutor.run(first.ctx)).outcome).toBe("needs_input");
    files.set("uploads/user-1/abc.mp4", Buffer.alloc(2048));
    const second = ctxFor(task({ videoKey: "uploads/user-1/abc.mp4" }));
    expect((await h3RecreateExecutor.run(second.ctx)).outcome).toBe("continue");
    expect(second.ctx.state).toMatchObject({ phase: "detect", videoKey: "uploads/user-1/abc.mp4", videoBytes: 2048 });
  });

  it("writes the storyboard, then one prompt finding per shot with variations, then notifies", async () => {
    files.set("user-1/t/blueprint.json", Buffer.from(JSON.stringify(blueprint())));
    const t = task({ changes: "Person A -> Maya, a fisherwoman\nstyle: anime", variations: 3, title: "diner" }, { phase: "storyboard", blueprintKey: "user-1/t/blueprint.json", frames: [["a"], ["b"]] });
    const c = ctxFor(t);
    expect((await h3RecreateExecutor.run(c.ctx)).outcome).toBe("continue");
    expect(c.findings[0]).toMatchObject({ kind: "h3-storyboard", key: t.id, notable: true });
    expect((c.findings[0].data as { storyboard: { shots: unknown[] } }).storyboard.shots).toHaveLength(2);

    const r = await h3RecreateExecutor.run(c.ctx);
    expect(r).toMatchObject({ outcome: "done", summary: "2 shots, 6 prompt variations." });
    const prompts = c.findings.filter((f) => f.kind === "h3-prompt");
    expect(prompts.map((f) => f.key)).toEqual([`${t.id}:shot1`, `${t.id}:shot2`]);
    const d = prompts[0].data as { prompt: string; variations: { prompt: string }[] };
    expect(d.prompt).toContain("MAYA");
    expect(d.prompt).toContain("Anime");
    expect(d.variations).toHaveLength(3);
    expect(c.notes[0]).toContain("Your recreation of diner is ready: 2 shots, 6 prompt variations.");
    expect(c.logs.some((l) => l.includes("Change applied: Person A → Maya, a fisherwoman"))).toBe(true);
  });

  it("sends all, two, or one keyframe per shot", () => {
    expect(pickFrames(["a", "b", "c"], 3)).toEqual(["a", "b", "c"]);
    expect(pickFrames(["a", "b", "c"], 2)).toEqual(["a", "c"]);
    expect(pickFrames(["a", "b", "c"], 1)).toEqual(["b"]);
  });
});
