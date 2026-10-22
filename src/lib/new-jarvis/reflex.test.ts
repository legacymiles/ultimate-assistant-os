import { describe, expect, it } from "vitest";
import {
  ANSWER_THRESHOLD,
  bestMatch,
  formatMicros,
  reflex,
  ROUTE_LABEL,
  savedACall,
  type ReflexInput,
} from "./reflex";

const ALL_CAPS = { browser: true, shell: true, files: true, system: true };

const input = (patch: Partial<ReflexInput> = {}): ReflexInput => ({
  text: "",
  mode: "ask",
  capabilities: ALL_CAPS,
  bridgeReady: true,
  known: [],
  ...patch,
});

const route = (patch: Partial<ReflexInput>) => reflex(input(patch)).route;

const NOTES = [
  { key: "topics/Zone Recovery.md", title: "Zone Recovery", content: "The hedging pattern: open an opposing position of a calculated size so either direction resolving closes the pair at a net profit." },
  { key: "topics/Second Brain.md", title: "Second Brain", content: "Two tiers. The vault holds markdown and relationships; the index holds embeddings." },
];

describe("waiting — not everything typed is a request", () => {
  it("waits on an empty box", () => {
    expect(route({ text: "   " })).toBe("wait");
  });

  it("waits mid-sentence, rather than sending half a thought to a model", () => {
    expect(route({ text: "remind me to call the" })).toBe("wait");
    expect(route({ text: "book the thing and" })).toBe("wait");
  });

  it("waits on a bare fragment that reads as a note to yourself", () => {
    expect(route({ text: "milk" })).toBe("wait");
  });

  it("does NOT wait on a short but complete question", () => {
    expect(route({ text: "what is zone recovery?" })).not.toBe("wait");
  });

  it("refuses to treat its own voice coming back as a request", () => {
    // Without this the assistant answers its own answer and the loop never ends.
    const said = "Your dentist appointment is in forty minutes";
    expect(route({ text: "your dentist appointment is in forty minutes", speaking: said })).toBe("wait");
  });
});

describe("PC off — never a dead end", () => {
  it("hands a PC-sounding job to the model instead of refusing it", () => {
    // The owner's rule: Jarvis works like Claude Code. "This needs your PC"
    // used to come back here before the model ever saw the request.
    const r = reflex(input({ text: "open my Vercel dashboard", mode: "browse", bridgeReady: false, capabilities: {} }));
    expect(r.route).toBe("think");
    expect(r.missing).toBe("browser");
    expect(r.because).toMatch(/from the website/);
    expect(savedACall(r.route)).toBe(false);
  });

  it("does the same when the agent is up but lacks that one ability", () => {
    const r = reflex(input({ text: "open my Vercel dashboard", mode: "browse", bridgeReady: true, capabilities: { shell: true, browser: false } }));
    expect(r.route).toBe("think");
    expect(r.missing).toBe("browser");
  });

  it("never blocks building a website or app", () => {
    for (const text of ["build me a website for my roofing client", "make an app that runs my workouts", "run npm test on my computer"]) {
      expect(route({ text, mode: "do", bridgeReady: false, capabilities: {} })).toBe("think");
    }
  });

  it("notes nothing missing when the capability is there", () => {
    const r = reflex(input({ text: "open my Vercel dashboard", mode: "browse" }));
    expect(r.route).toBe("think");
    expect(r.missing).toBeUndefined();
  });

  it("does not claim a plain question needs the PC", () => {
    const r = reflex(input({ text: "what time is my dentist appointment?", bridgeReady: false, capabilities: {} }));
    expect(r.route).toBe("think");
    expect(r.missing).toBeUndefined();
  });
});

describe("answer — the round trip that never happens", () => {
  it("answers straight from something already written down", () => {
    const r = reflex(input({ text: "zone recovery hedging pattern", known: NOTES }));
    expect(r.route).toBe("answer");
    expect(r.best?.title).toBe("Zone Recovery");
    expect(savedACall(r.route)).toBe(true);
  });

  it("does NOT answer when something is being asked FOR", () => {
    // "Open my notes on zone recovery" is not answered by zone recovery.
    expect(route({ text: "open my zone recovery note", known: NOTES })).toBe("think");
    expect(route({ text: "zone recovery", mode: "do", known: NOTES })).toBe("think");
  });

  it("goes to the model on a weak match rather than guessing", () => {
    // A reflex that answers confidently from a poor match is worse than one
    // that never answers at all.
    expect(route({ text: "what did I decide about the hub's AI provider?", known: NOTES })).toBe("think");
  });

  it("goes to the model when nothing is known at all", () => {
    expect(route({ text: "what is zone recovery?", known: [] })).toBe("think");
  });
});

describe("bestMatch", () => {
  it("picks the closest note", () => {
    expect(bestMatch("second brain two tiers", NOTES)?.title).toBe("Second Brain");
  });

  it("returns nothing rather than a bad match", () => {
    expect(bestMatch("quarterly revenue in norway", NOTES)).toBeNull();
  });

  it("survives an empty query and an empty library", () => {
    expect(bestMatch("", NOTES)).toBeNull();
    expect(bestMatch("anything", [])).toBeNull();
  });

  it("carries an excerpt, so the answer can actually be shown", () => {
    const m = bestMatch("zone recovery hedging", NOTES);
    expect(m?.excerpt).toContain("hedging");
  });

  it("shows the note as the owner reads it, not as it sits on disk", () => {
    // A raw slice spends the whole excerpt on YAML and on a heading that just
    // repeats the title, so the one line meant to answer says nothing.
    const filed = [
      {
        key: "topics/Zone Recovery.md",
        title: "Zone Recovery",
        content: "---\ntitle: Zone Recovery\nstatus: filed\ntags: [trading]\n---\n\n# Zone Recovery\n\nOpen an opposing position of a calculated size. Related: [[Ultimate Assistant OS]]",
      },
    ];
    const m = bestMatch("zone recovery opposing position", filed);
    expect(m?.excerpt).not.toContain("---");
    expect(m?.excerpt).not.toContain("status: filed");
    expect(m?.excerpt).not.toContain("[[");
    expect(m?.excerpt!.startsWith("Open an opposing position")).toBe(true);
  });
});

describe("the signals — the bars", () => {
  const r = reflex(input({ text: "what is zone recovery?", known: NOTES }));

  it("reports every one, in range, with an explanation", () => {
    expect(r.signals).toHaveLength(5);
    for (const s of r.signals) {
      expect(s.value).toBeGreaterThanOrEqual(0);
      expect(s.value).toBeLessThanOrEqual(1);
      expect(s.note.length).toBeGreaterThan(10);
      expect(s.label.length).toBeGreaterThan(2);
    }
  });

  it("is confident a question is addressed to it", () => {
    expect(r.signals.find((s) => s.id === "addressed")!.value).toBeGreaterThan(0.9);
  });

  it("knows the mode is the owner saying outright what they want", () => {
    // A mode beats any guess at the text.
    const doing = reflex(input({ text: "the thing", mode: "do" }));
    expect(doing.signals.find((s) => s.id === "acts")!.value).toBeGreaterThan(0.9);
  });

  it("scores 'needs the PC' low for a question about the world", () => {
    expect(r.signals.find((s) => s.id === "machine")!.value).toBeLessThan(0.3);
  });
});

describe("it is a REFLEX, not a request", () => {
  it("decides in microseconds, because it never leaves the tab", () => {
    // The walkthrough's layer costs 200ms because it asks a small model. This
    // one reads data already in memory; copying their number would be copying
    // a limitation.
    const many = Array.from({ length: 2000 }, (_, i) => ({
      key: `n${i}`,
      title: `Note ${i}`,
      content: "some content about various things ".repeat(5),
    }));
    const started = performance.now();
    const r = reflex(input({ text: "what is note 1200 about?", known: many }));
    const ms = performance.now() - started;
    expect(ms).toBeLessThan(50);
    expect(r.micros).toBeGreaterThanOrEqual(0);
  });

  it("always reports how long it took", () => {
    expect(reflex(input({ text: "hello there" })).micros).toBeGreaterThanOrEqual(0);
  });
});

describe("every route is explained", () => {
  it("names a reason, whichever way it goes", () => {
    const cases: Partial<ReflexInput>[] = [
      { text: "" },
      { text: "milk" },
      { text: "open my Vercel dashboard", mode: "browse", bridgeReady: false, capabilities: {} },
      { text: "zone recovery hedging pattern", known: NOTES },
      { text: "what is the capital of Peru?" },
    ];
    for (const c of cases) {
      const r = reflex(input(c));
      expect(r.because.length, JSON.stringify(c)).toBeGreaterThan(10);
      expect(ROUTE_LABEL[r.route]).toBeTruthy();
    }
  });
});

describe("formatMicros", () => {
  it("shows microseconds, which milliseconds would round to zero", () => {
    expect(formatMicros(180)).toBe("180 µs");
    expect(formatMicros(2400)).toBe("2.4 ms");
  });
});

describe("savedACall", () => {
  it("counts only the routes that stopped a round trip", () => {
    expect(savedACall("answer")).toBe(true);
    expect(savedACall("cannot")).toBe(true);
    expect(savedACall("think")).toBe(false);
    expect(savedACall("wait")).toBe(false);
  });
});
