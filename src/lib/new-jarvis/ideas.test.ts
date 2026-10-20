import { describe, expect, it } from "vitest";
import {
  auditAsIdeas,
  buildDigest,
  coerceIdea,
  coerceIdeas,
  coerceIdeasState,
  dismissIdea,
  emptyIdeasState,
  ideaId,
  markDone,
  mergeIdeas,
  reopen,
  shouldAutoRefresh,
  toggleSaved,
  visibleIdeas,
  type Idea,
} from "./ideas";

const NOW = Date.parse("2026-10-17T20:00:00Z");

const raw = (over: Record<string, unknown> = {}) => ({
  kind: "workflow",
  title: "Auto-sort receipts every Friday",
  why: "You asked Jarvis to file receipts three times this month.",
  firstStep: "Turn on a Friday reminder.",
  effort: "minutes",
  evidence: ["asked to file receipts on Oct 3, Oct 10 and Oct 15"],
  prompt: "Set up a Friday receipt sort.",
  ...over,
});

describe("ideaId", () => {
  it("ignores case and punctuation so a re-suggested idea keeps its id", () => {
    expect(ideaId("life", "Set up a budget!")).toBe(ideaId("life", "set up a  budget"));
    expect(ideaId("life", "x")).not.toBe(ideaId("app", "x"));
  });
});

describe("coerceIdea", () => {
  it("accepts a complete idea", () => {
    const idea = coerceIdea(raw(), NOW)!;
    expect(idea.kind).toBe("workflow");
    expect(idea.effort).toBe("minutes");
    expect(idea.origin).toBe("chat");
  });

  it("drops an idea with no evidence — no generic filler", () => {
    expect(coerceIdea(raw({ evidence: [] }), NOW)).toBeNull();
    expect(coerceIdea(raw({ evidence: undefined }), NOW)).toBeNull();
  });

  it("drops unknown kinds and missing titles", () => {
    expect(coerceIdea(raw({ kind: "horoscope" }), NOW)).toBeNull();
    expect(coerceIdea(raw({ title: "  " }), NOW)).toBeNull();
    expect(coerceIdea("nope", NOW)).toBeNull();
  });

  it("fills a safe default effort and prompt", () => {
    const idea = coerceIdea(raw({ effort: "forever", prompt: "" }), NOW)!;
    expect(idea.effort).toBe("hours");
    expect(idea.prompt).toContain(idea.title);
  });

  it("dedupes the same idea in one answer", () => {
    expect(coerceIdeas([raw(), raw({ title: "auto sort receipts every friday" })], NOW)).toHaveLength(1);
  });
});

describe("buildDigest", () => {
  it("lists newest first, flags failures, and caps size", () => {
    const text = buildDigest({
      said: [
        { text: "old one", at: NOW - 86_400_000 },
        { text: "new one", at: NOW, failed: "no calendar connected" },
      ],
      memories: ["Lives around Columbus"],
      audit: [],
      known: ["Old idea"],
      rejected: ["Meditate daily"],
    });
    expect(text.indexOf("new one")).toBeLessThan(text.indexOf("old one"));
    expect(text).toContain("could not do this: no calendar connected");
    expect(text).toContain("Meditate daily");

    const huge = buildDigest({
      said: Array.from({ length: 500 }, (_, i) => ({ text: "x".repeat(300), at: NOW - i })),
      memories: [],
      audit: [],
      known: [],
      rejected: [],
    });
    expect(huge.length).toBeLessThan(15_000);
  });

  it("includes what was built lately, so ideas can learn from app edits", () => {
    const text = buildDigest({
      said: [{ text: "make spades cooler", at: NOW }],
      memories: [],
      audit: [],
      known: [],
      rejected: [],
      appEdits: "- 2026-10-19 · Cook Connect: Renege rule",
    });
    expect(text).toContain("What has been built in their apps lately");
    expect(text).toContain("Cook Connect: Renege rule");
  });
});

describe("shouldAutoRefresh", () => {
  it("waits for enough chat, then refreshes once a day only when there is something new", () => {
    const s = emptyIdeasState();
    expect(shouldAutoRefresh(s, 1, NOW)).toBe(false);
    expect(shouldAutoRefresh(s, 5, NOW)).toBe(true);
    const ran = { ...s, generatedAt: new Date(NOW - 25 * 3_600_000).toISOString(), seenMessages: 5 };
    expect(shouldAutoRefresh(ran, 5, NOW)).toBe(false);
    expect(shouldAutoRefresh(ran, 9, NOW)).toBe(true);
    expect(shouldAutoRefresh({ ...ran, generatedAt: new Date(NOW - 3_600_000).toISOString() }, 9, NOW)).toBe(false);
  });
});

describe("decisions", () => {
  const ideas = coerceIdeas(
    [raw(), raw({ kind: "life", title: "Plan your December time off", evidence: ["said you're off from December"] })],
    NOW,
  );
  const state = { ...emptyIdeasState(), ideas };

  it("dismissed ideas never show again, even after a refresh suggests them", () => {
    const s = dismissIdea(state, ideas[0].id);
    const merged = mergeIdeas(s, ideas, NOW, 10);
    expect(visibleIdeas(merged, [], NOW).ideas.map((i) => i.id)).not.toContain(ideas[0].id);
  });

  it("saved ideas survive a refresh that no longer suggests them, and sort first", () => {
    const s = toggleSaved(state, ideas[1].id);
    const merged = mergeIdeas(s, [ideas[0]], NOW, 10);
    const shown = visibleIdeas(merged, [], NOW).ideas;
    expect(shown[0].id).toBe(ideas[1].id);
    expect(visibleIdeas(merged, [], NOW, "saved").ideas).toHaveLength(1);
  });

  it("done moves an idea to the done view, and reopen brings it back", () => {
    const s = markDone(state, ideas[0].id);
    expect(visibleIdeas(s, [], NOW).ideas.map((i) => i.id)).not.toContain(ideas[0].id);
    expect(visibleIdeas(s, [], NOW, "done").ideas).toHaveLength(1);
    expect(visibleIdeas(reopen(s, ideas[0].id), [], NOW).ideas).toHaveLength(2);
  });

  it("filters by kind and counts each kind", () => {
    const shown = visibleIdeas(state, [], NOW, "open", "life");
    expect(shown.ideas.every((i) => i.kind === "life")).toBe(true);
    expect(shown.counts).toEqual({ life: 1, workflow: 1, app: 0, jarvis: 0 });
  });

  it("keeps the first date when an idea is suggested again", () => {
    const old: Idea = { ...ideas[0], at: "2026-10-01T00:00:00.000Z" };
    const merged = mergeIdeas({ ...state, ideas: [old] }, [ideas[0]], NOW, 10);
    expect(merged.ideas[0].at).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("audit ideas", () => {
  it("shows self-audit findings under Jarvis, after chat ideas", () => {
    const audit = auditAsIdeas(
      [{ id: "ia:stale", title: "Fold 2 unused tabs", why: "w", how: "h", effort: "minutes", evidence: ["Calls: 30 days"] }],
      NOW,
    );
    expect(audit[0].kind).toBe("jarvis");
    expect(audit[0].origin).toBe("audit");
    const state = { ...emptyIdeasState(), ideas: coerceIdeas([raw({ kind: "jarvis", title: "Remember my model pick" })], NOW) };
    const shown = visibleIdeas(state, audit, NOW).ideas;
    expect(shown.map((i) => i.origin)).toEqual(["chat", "audit"]);
  });
});

describe("coerceIdeasState", () => {
  it("repairs junk rather than throwing, and keeps audit origin", () => {
    expect(coerceIdeasState(null)).toEqual(emptyIdeasState());
    const s = coerceIdeasState({ ideas: [{ ...raw(), origin: "audit" }, "junk"], dismissed: [1, "a"], seenMessages: -3 });
    expect(s.ideas).toHaveLength(1);
    expect(s.ideas[0].origin).toBe("audit");
    expect(s.dismissed).toEqual(["a"]);
    expect(s.seenMessages).toBe(0);
  });
});
