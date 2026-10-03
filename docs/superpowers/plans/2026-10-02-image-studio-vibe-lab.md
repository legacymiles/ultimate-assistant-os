# Image Studio Vibe Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Image Studio into three studios behind one switcher — Generate, Vibe Lab, Vibe Library — around a shared Supabase registry of named looks that the AI proposes, matches and argues about.

**Architecture:** A shell owning only which studio is mounted (copied from Jarvis Audio Studio). Today's single screen becomes the Generate studio unchanged. Vibe Lab sends an image to a vision model that returns a complete verdict object every turn — a three-rung ladder, rivals, evidence, a match or a proposal, a LoRA judgement — which a pure validator in `vibes.ts` polices before any of it reaches the UI. Two Supabase tables hold the shared taxonomy and the per-vibe dataset. One shared WebGL context paints the trail reveal into whichever card is hovered.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind v4, Supabase (`@supabase/ssr`), vitest, raw WebGL 1 (no R3F — see Task 10), OpenRouter via `src/lib/ai/provider.ts`.

**Spec:** `docs/superpowers/specs/2026-10-02-image-studio-vibe-lab-design.md`

---

## Read this before Task 1

**Design skills govern every UI task.** Before writing any JSX in Tasks 9–14, invoke
`interactive-web-studio` (shell, pages, motion) and `webgl-trail-reveal` (the reveal mechanic).
This is the owner's standing rule in `CLAUDE.md`, not optional, and the look must be announced.

**Three repo rules that will bite:**

1. **Never `git add -A`.** Several Claude sessions run on this one folder and a blanket add sweeps
   their uncommitted work into your commit. Every commit step below names its files explicitly.
2. **Never run a second dev server on the default `.next`.** Use
   `node scripts/dev-preview.mjs <port> --no-auth`, which sets its own `NEXT_DIST_DIR`.
3. **Missing keys degrade visibly, never 500.** Every route below has a keyless path and a
   Supabase-less path, and each says so on screen.

**One deviation from the spec, decided while planning.** The spec's contract had the model return
`lora.needed`. It does not: a model should not be doing arithmetic we can do exactly. The contract
is `lora: { verdict, why }` and the shortfall comes from `datasetProgress(datasetCount)`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/image-studio/vibes.ts` | Types, slugify, the verdict validator, dataset math, vibe→agent. Pure. No network, storage or DOM. |
| `src/lib/image-studio/vibes.test.ts` | Tests for the above. |
| `src/lib/image-studio/vibes-seed.ts` | The five built-in agents as seed `Vibe` rows. Pure. |
| `src/lib/image-studio/vibe-prompt.ts` | The system prompt and user content for a read/argue turn. Pure. |
| `src/lib/image-studio/vibe-store.ts` | `server-only`. Reads/writes the two tables; falls back to the seed when Supabase is absent. |
| `src/lib/image-studio/zip.ts` | Store-only ZIP writer + CRC32, for the captioned dataset export. Pure. |
| `src/lib/image-studio/zip.test.ts` | Tests for the above. |
| `src/lib/image-studio/sections.ts` | The three tab definitions. No `"use client"` — the server page reads it. |
| `src/app/api/image-studio/vibe/route.ts` | One read or one argument turn. |
| `src/app/api/image-studio/vibes/route.ts` | List the registry, commit a save, export a dataset. |
| `src/components/image-studio/ImageStudioShell.tsx` | Which studio is mounted. Nothing else. |
| `src/components/image-studio/image-studio.css` | Shell + studio tokens, in one place. |
| `src/components/image-studio/trail-reveal.ts` | One shared WebGL context, attached to the hovered element. |
| `src/components/image-studio/vibe-lab/VibeLab.tsx` | The Vibe Lab studio: upload, verdict, argument. |
| `src/components/image-studio/vibe-lab/LadderCard.tsx` | The three rungs, rivals, evidence drawer, verdict. |
| `src/components/image-studio/vibe-lab/ArgumentChat.tsx` | The transcript and the composer beside the card. |
| `src/components/image-studio/vibe-lab/evidence-layer.ts` | Draws the evidence canvas at the photo's exact size. |
| `src/components/image-studio/vibe-library/VibeLibrary.tsx` | The dense sortable table. |
| `src/components/image-studio/vibe-library/VibeRow.tsx` | One row, its expansion, its cover reveal. |
| `src/components/image-studio/vibeApi.ts` | `"use client"` fetch wrappers, mirroring `api.ts`. |

**Modified:** `ImageStudio.tsx` (takes `embedded`, drops its header), `AgentPicker.tsx` (reads the
registry, gains a family filter), `src/app/apps/image-studio/page.tsx` (validates `?section=`),
`src/lib/catalog.ts` (overview).

---

## Task 1: Vibe types and slugs

**Files:**
- Create: `src/lib/image-studio/vibes.ts`
- Test: `src/lib/image-studio/vibes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/image-studio/vibes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug, wordCount } from "./vibes";

describe("slugify", () => {
  it("lowercases and hyphenates a display name", () => {
    expect(slugify("Ghibli-esque Pastoral")).toBe("ghibli-esque-pastoral");
  });

  it("drops apostrophes and punctuation rather than encoding them", () => {
    expect(slugify("90's Nostalgia!")).toBe("90s-nostalgia");
  });

  it("strips accents instead of dropping the word", () => {
    expect(slugify("Cinéma Vérité")).toBe("cinema-verite");
  });

  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("vibe");
  });
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", () => {
    expect(uniqueSlug("spy-glasses-pov", ["nostalgia"])).toBe("spy-glasses-pov");
  });

  it("suffixes a number when the base is taken", () => {
    expect(uniqueSlug("nostalgia", ["nostalgia"])).toBe("nostalgia-2");
  });

  it("keeps counting past the first collision", () => {
    expect(uniqueSlug("nostalgia", ["nostalgia", "nostalgia-2"])).toBe("nostalgia-3");
  });
});

describe("wordCount", () => {
  it("counts words, not characters", () => {
    expect(wordCount("soft gouache skies over a hand-painted valley")).toBe(7);
  });

  it("ignores runs of whitespace", () => {
    expect(wordCount("  cartoon   ")).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: FAIL — `Failed to resolve import "./vibes"`.

- [ ] **Step 3: Write the module**

Create `src/lib/image-studio/vibes.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — the vibe registry's types and pure logic.
//
// A vibe is one named look. The five hand-written agents are vibes flagged
// `builtin`; everything the Vibe Lab names is a vibe flagged `community`, and
// they are the same shape on purpose — the matcher has one list to check
// against, and the Generate picker draws both from one array.
//
// Nothing here touches the network, storage or the DOM, so the rules that
// matter can be tested: that a model cannot invent a category, and that it
// cannot answer "cartoon".
// ---------------------------------------------------------------------------

import type { Aspect, ImageAgent } from "./agents";

export type VibeKind = "builtin" | "community";

/** Samples needed before a vibe's dataset is worth training on. */
export const TRAINABLE_AT = 20;

/** The shortest the deepest rung may be. Below this it is a label, not a read. */
export const MIN_VIBE_WORDS = 6;

export interface Vibe {
  id: string;
  name: string;
  /** Coarsest rung — "photography", "animation", "illustration". */
  family: string;
  /** Middle rung — "cel anime", "vintage film". */
  style: string;
  /** Deepest rung. A sentence, never a noun. */
  vibe: string;
  /** System prompt that rewrites a request in this look. */
  brief: string;
  /** Style suffix used when nothing rewrote the prompt. */
  styleBlock: string;
  aspect: Aspect;
  model: string;
  hue: [number, number];
  icon: string;
  kind: VibeKind;
  uses: number;
  datasetCount: number;
  coverPath: string | null;
  createdBy: string | null;
  createdAt: number;
}

/** The compact form handed to the model so it can match instead of invent. */
export interface VibeCandidate {
  id: string;
  name: string;
  family: string;
  style: string;
  vibe: string;
}

export function toCandidate(v: Vibe): VibeCandidate {
  return { id: v.id, name: v.name, family: v.family, style: v.style, vibe: v.vibe };
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || "vibe";
}

/**
 * A free slug near `base`.
 *
 * Collisions are expected rather than exceptional: two people photographing
 * the same decade will land on the same name, and the second one must still
 * get a row.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const next = `${base}-${n}`;
    if (!used.has(next)) return next;
  }
  return `${base}-${Date.now()}`;
}

export function datasetProgress(datasetCount: number): { count: number; needed: number; trainable: boolean } {
  const count = Math.max(0, Math.floor(datasetCount || 0));
  return { count, needed: Math.max(0, TRAINABLE_AT - count), trainable: count >= TRAINABLE_AT };
}

/** A vibe, in the shape the composer and both existing routes already read. */
export function vibeToAgent(v: Vibe): ImageAgent {
  return {
    id: v.id,
    name: v.name,
    icon: v.icon,
    pitch: v.vibe,
    examples: [],
    brief: v.brief,
    styleBlock: v.styleBlock,
    model: v.model,
    aspect: v.aspect,
    hue: v.hue,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-studio/vibes.ts src/lib/image-studio/vibes.test.ts
git commit -m "Vibe registry: the types, and slugs that survive a collision"
```

---

## Task 2: The verdict validator

This is where the two rules that carry the design live. Both are enforced here rather than asked
for in a prompt, because a prompt instruction regresses silently and a gate does not.

**Files:**
- Modify: `src/lib/image-studio/vibes.ts` (append)
- Test: `src/lib/image-studio/vibes.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/image-studio/vibes.test.ts`:

```ts
import { validateVerdict, MIN_VIBE_WORDS } from "./vibes";

/** A verdict the model got right, used as the base for each case below. */
function goodRaw() {
  return {
    ladder: {
      family: "animation",
      style: "cel anime",
      vibe: "soft gouache skies over a hand-painted pastoral valley",
    },
    confidence: { family: 0.95, style: 0.8, vibe: 0.62 },
    rivals: [
      { label: "generic 2010s anime", depth: "style", confidence: 0.3, why: "linework is too clean for this" },
    ],
    evidence: {
      palette: ["#8fc0e8", "#e8dfc0", "not-a-hex"],
      grain: "none, flat digital paint",
      lighting: "high key, soft ambient",
      era: "no era cues",
      framing: "wide establishing",
      subject: "landscape, no figures",
    },
    match: null,
    proposal: {
      name: "Ghibli-esque Pastoral",
      slug: "Ghibli-esque Pastoral",
      icon: "🌾",
      brief: "You paint soft hand-made pastoral landscapes...",
      styleBlock: "hand-painted gouache skies, soft ambient light",
      aspect: "landscape",
      hue: [95, 200],
    },
    lora: { verdict: "distinctive", why: "the sky treatment alone is identifiable" },
  };
}

describe("validateVerdict", () => {
  it("accepts a well-formed verdict with no problems", () => {
    const out = validateVerdict(goodRaw(), ["nostalgia"]);
    if (typeof out === "string") throw new Error(out);
    expect(out.problems).toEqual([]);
    expect(out.verdict.ladder.style).toBe("cel anime");
    expect(out.verdict.proposal?.slug).toBe("ghibli-esque-pastoral");
  });

  it("drops a vibeId that was not in the catalog we sent", () => {
    const raw = goodRaw();
    raw.match = { vibeId: "invented-vibe", confidence: 0.9, why: "looks like it" };
    raw.proposal = null;
    const out = validateVerdict(raw, ["nostalgia", "glamour"]);
    expect(typeof out).toBe("string");
  });

  it("keeps a vibeId that was in the catalog", () => {
    const raw = goodRaw();
    raw.match = { vibeId: "nostalgia", confidence: 0.94, why: "1990s disposable flash" };
    raw.proposal = null;
    const out = validateVerdict(raw, ["nostalgia", "glamour"]);
    if (typeof out === "string") throw new Error(out);
    expect(out.verdict.match?.vibeId).toBe("nostalgia");
    expect(out.problems).toEqual([]);
  });

  it("records a problem when an invented id had a proposal to fall back on", () => {
    const raw = goodRaw();
    raw.match = { vibeId: "invented-vibe", confidence: 0.9, why: "looks like it" };
    const out = validateVerdict(raw, ["nostalgia"]);
    if (typeof out === "string") throw new Error(out);
    expect(out.verdict.match).toBeNull();
    expect(out.verdict.proposal).not.toBeNull();
    expect(out.problems.map((p) => p.field)).toContain("match.vibeId");
  });

  it("flags a one-word deepest rung as a problem", () => {
    const raw = goodRaw();
    raw.ladder.vibe = "cartoon";
    const out = validateVerdict(raw, []);
    if (typeof out === "string") throw new Error(out);
    expect(out.problems.map((p) => p.field)).toContain("ladder.vibe");
  });

  it(`accepts a deepest rung of exactly ${MIN_VIBE_WORDS} words`, () => {
    const raw = goodRaw();
    raw.ladder.vibe = "soft gouache skies over painted valleys";
    const out = validateVerdict(raw, []);
    if (typeof out === "string") throw new Error(out);
    expect(out.problems).toEqual([]);
  });

  it("reads a confidence given as a percentage", () => {
    const raw = goodRaw();
    raw.confidence = { family: 95, style: 80, vibe: 62 } as never;
    const out = validateVerdict(raw, []);
    if (typeof out === "string") throw new Error(out);
    expect(out.verdict.confidence.family).toBeCloseTo(0.95);
  });

  it("keeps only real hex colours out of the palette", () => {
    const out = validateVerdict(goodRaw(), []);
    if (typeof out === "string") throw new Error(out);
    expect(out.verdict.evidence.palette).toEqual(["#8fc0e8", "#e8dfc0"]);
  });

  it("prefers a match over a proposal when the model sent both", () => {
    const raw = goodRaw();
    raw.match = { vibeId: "nostalgia", confidence: 0.7, why: "close enough" };
    const out = validateVerdict(raw, ["nostalgia"]);
    if (typeof out === "string") throw new Error(out);
    expect(out.verdict.match?.vibeId).toBe("nostalgia");
    expect(out.verdict.proposal).toBeNull();
  });

  it("fails when the model sent neither a match nor a proposal", () => {
    const raw = goodRaw();
    raw.match = null;
    raw.proposal = null;
    expect(typeof validateVerdict(raw, [])).toBe("string");
  });

  it("fails when a rung is missing entirely", () => {
    const raw = goodRaw();
    raw.ladder.style = "";
    expect(typeof validateVerdict(raw, [])).toBe("string");
  });

  it("notes a proposal that cannot become an agent", () => {
    const raw = goodRaw();
    raw.proposal!.brief = "";
    const out = validateVerdict(raw, []);
    if (typeof out === "string") throw new Error(out);
    expect(out.problems.map((p) => p.field)).toContain("proposal");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: FAIL — `validateVerdict` is not exported.

- [ ] **Step 3: Append the validator**

Append to `src/lib/image-studio/vibes.ts`:

```ts
// ---------------------------------------------------------------------------
// The verdict contract, and the gate on it.
// ---------------------------------------------------------------------------

export interface VibeLadder {
  family: string;
  style: string;
  vibe: string;
}

export interface VibeRival {
  label: string;
  depth: "family" | "style" | "vibe";
  confidence: number;
  why: string;
}

export interface VibeEvidence {
  /** Hex colours, already filtered to the ones that parse. */
  palette: string[];
  grain: string;
  lighting: string;
  era: string;
  framing: string;
  subject: string;
}

export interface VibeMatch {
  vibeId: string;
  confidence: number;
  why: string;
}

export interface VibeProposal {
  name: string;
  slug: string;
  icon: string;
  brief: string;
  styleBlock: string;
  aspect: Aspect;
  hue: [number, number];
}

export type LoraVerdictKind = "distinctive" | "borderline" | "generic";

export interface LoraVerdict {
  verdict: LoraVerdictKind;
  why: string;
}

export interface VibeVerdict {
  ladder: VibeLadder;
  confidence: { family: number; style: number; vibe: number };
  rivals: VibeRival[];
  evidence: VibeEvidence;
  match: VibeMatch | null;
  proposal: VibeProposal | null;
  lora: LoraVerdict;
}

/** Something survivable the model got wrong. Shown, not thrown. */
export interface VerdictProblem {
  field: string;
  message: string;
}

const ASPECTS: Aspect[] = ["portrait", "square", "landscape"];
const DEPTHS = ["family", "style", "vibe"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * A confidence, however the model expressed it. Models answer 0.94 and 94 with
 * equal conviction, and a 94 read as a probability pins every bar to full.
 */
function num01(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n > 1 ? n / 100 : n));
}

function hueNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? ((Math.round(n) % 360) + 360) % 360 : fallback;
}

/**
 * Turns whatever the model returned into a verdict, or says why it could not.
 *
 * A string back is a hard failure and the turn is retried or surfaced. An
 * object back is usable, with `problems` listing what was corrected on the
 * way — the UI shows those rather than hiding them, because a silently
 * downgraded answer is how "cartoon" gets back in.
 *
 * @param candidateIds Every vibe id we showed the model. An id outside this
 *   list is dropped: the model may reuse a category, never invent one, and
 *   this is the only thing keeping the shared taxonomy from filling with six
 *   spellings of the same decade.
 */
export function validateVerdict(
  raw: unknown,
  candidateIds: string[],
): { verdict: VibeVerdict; problems: VerdictProblem[] } | string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const problems: VerdictProblem[] = [];

  const ladderRaw = (r.ladder ?? {}) as Record<string, unknown>;
  const ladder: VibeLadder = {
    family: str(ladderRaw.family, 60),
    style: str(ladderRaw.style, 120),
    vibe: str(ladderRaw.vibe, 400),
  };
  if (!ladder.family || !ladder.style || !ladder.vibe) {
    return "The model didn't return all three rungs of the ladder.";
  }
  if (wordCount(ladder.vibe) < MIN_VIBE_WORDS) {
    problems.push({
      field: "ladder.vibe",
      message: `The deepest rung came back as "${ladder.vibe}" — that is a label, not a read.`,
    });
  }

  const confRaw = (r.confidence ?? {}) as Record<string, unknown>;
  const confidence = {
    family: num01(confRaw.family, 0.6),
    style: num01(confRaw.style, 0.5),
    vibe: num01(confRaw.vibe, 0.4),
  };

  const rivals: VibeRival[] = (Array.isArray(r.rivals) ? r.rivals : [])
    .slice(0, 4)
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        label: str(o.label, 120),
        depth: DEPTHS.find((d) => d === o.depth) ?? "style",
        confidence: num01(o.confidence, 0.3),
        why: str(o.why, 300),
      };
    })
    .filter((x) => x.label.length > 0);

  const evRaw = (r.evidence ?? {}) as Record<string, unknown>;
  const evidence: VibeEvidence = {
    palette: (Array.isArray(evRaw.palette) ? evRaw.palette : [])
      .map((h) => str(h, 9))
      .filter((h) => HEX.test(h))
      .slice(0, 8),
    grain: str(evRaw.grain, 200),
    lighting: str(evRaw.lighting, 200),
    era: str(evRaw.era, 200),
    framing: str(evRaw.framing, 200),
    subject: str(evRaw.subject, 200),
  };

  const allowed = new Set(candidateIds);
  let match: VibeMatch | null = null;
  const matchRaw = (r.match ?? null) as Record<string, unknown> | null;
  const claimedId = matchRaw ? str(matchRaw.vibeId, 80) : "";
  if (claimedId) {
    if (allowed.has(claimedId)) {
      match = {
        vibeId: claimedId,
        confidence: num01(matchRaw?.confidence, 0.6),
        why: str(matchRaw?.why, 300),
      };
    } else {
      problems.push({
        field: "match.vibeId",
        message: `The model matched "${claimedId}", which is not a vibe that exists. Treated as a new vibe instead.`,
      });
    }
  }

  let proposal: VibeProposal | null = null;
  const propRaw = (r.proposal ?? null) as Record<string, unknown> | null;
  const proposedName = propRaw ? str(propRaw.name, 80) : "";
  if (proposedName) {
    const hueRaw = Array.isArray(propRaw?.hue) ? (propRaw!.hue as unknown[]) : [];
    proposal = {
      name: proposedName,
      slug: slugify(str(propRaw?.slug, 80) || proposedName),
      icon: str(propRaw?.icon, 8) || "✦",
      brief: str(propRaw?.brief, 4000),
      styleBlock: str(propRaw?.styleBlock, 800),
      aspect: ASPECTS.find((a) => a === propRaw?.aspect) ?? "portrait",
      hue: [hueNum(hueRaw[0], 210), hueNum(hueRaw[1], 280)],
    };
    if (!proposal.brief || !proposal.styleBlock) {
      problems.push({
        field: "proposal",
        message: "The proposed vibe came back without a brief, so it cannot become an agent until it is read again.",
      });
    }
  }

  // Reusing a vibe always beats minting a near-duplicate of it, so when the
  // model hedged by sending both, the match wins.
  if (match && proposal) proposal = null;
  if (!match && !proposal) {
    return "The model neither matched an existing vibe nor proposed a new one.";
  }

  const loraRaw = (r.lora ?? {}) as Record<string, unknown>;
  const lora: LoraVerdict = {
    verdict:
      loraRaw.verdict === "distinctive" || loraRaw.verdict === "generic"
        ? loraRaw.verdict
        : "borderline",
    why: str(loraRaw.why, 400),
  };

  return { verdict: { ladder, confidence, rivals, evidence, match, proposal, lora }, problems };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: PASS — 21 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-studio/vibes.ts src/lib/image-studio/vibes.test.ts
git commit -m "The gate: a model may reuse a category, never invent one, and never answer 'cartoon'"
```

---

## Task 3: The five agents as seed vibes

**Files:**
- Create: `src/lib/image-studio/vibes-seed.ts`
- Test: `src/lib/image-studio/vibes.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/image-studio/vibes.test.ts`:

```ts
import { AGENTS } from "./agents";
import { seedVibes } from "./vibes-seed";
import { MIN_VIBE_WORDS as MIN_WORDS, vibeToAgent } from "./vibes";

describe("seedVibes", () => {
  const seed = seedVibes();

  it("produces one vibe per built-in agent, keeping its id", () => {
    expect(seed.map((v) => v.id)).toEqual(AGENTS.map((a) => a.id));
  });

  it("marks every seed row builtin with an empty dataset", () => {
    for (const v of seed) {
      expect(v.kind).toBe("builtin");
      expect(v.datasetCount).toBe(0);
    }
  });

  it("carries each brief over untouched", () => {
    for (const agent of AGENTS) {
      const vibe = seed.find((v) => v.id === agent.id)!;
      expect(vibe.brief).toBe(agent.brief);
      expect(vibe.styleBlock).toBe(agent.styleBlock);
      expect(vibe.aspect).toBe(agent.aspect);
      expect(vibe.model).toBe(agent.model);
    }
  });

  it("gives every seed row a deepest rung that passes our own gate", () => {
    for (const v of seed) {
      expect(wordCount(v.vibe)).toBeGreaterThanOrEqual(MIN_WORDS);
    }
  });

  it("round-trips back into the agent the composer reads", () => {
    const nostalgia = AGENTS.find((a) => a.id === "nostalgia")!;
    const back = vibeToAgent(seed.find((v) => v.id === "nostalgia")!);
    expect(back.brief).toBe(nostalgia.brief);
    expect(back.hue).toEqual(nostalgia.hue);
    expect(back.icon).toBe(nostalgia.icon);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: FAIL — `Failed to resolve import "./vibes-seed"`.

- [ ] **Step 3: Write the seed**

Create `src/lib/image-studio/vibes-seed.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — the five hand-written agents, as rows of the vibe registry.
//
// This is what makes one registry possible rather than two. The agents keep
// every word of their briefs; all they gain is a place on the ladder, so the
// matcher can answer "this is basically your Nostalgia agent" through exactly
// the same code path it uses for a vibe someone named last week.
//
// It is also the keyless library: with no Supabase configured, this is what
// the Vibe Library shows and what the matcher matches against.
// ---------------------------------------------------------------------------

import { AGENTS } from "./agents";
import type { Vibe } from "./vibes";

/**
 * Where each built-in sits on the ladder.
 *
 * Hand-written rather than derived from the pitch: the pitch is marketing copy
 * aimed at the owner, and the rungs are what a vision model is asked to
 * compare an image against. Each `vibe` is a sentence for the same reason the
 * validator insists on one.
 */
const RUNGS: Record<string, { family: string; style: string; vibe: string }> = {
  nostalgia: {
    family: "photography",
    style: "vintage consumer film",
    vibe: "an amateur snapshot on period consumer film, grain and colour shift intact, nothing modern in frame",
  },
  glamour: {
    family: "photography",
    style: "editorial portrait",
    vibe: "sultry magazine-grade portrait lighting with deliberate shadow and styled wardrobe, suggestive but never explicit",
  },
  "family-portrait": {
    family: "photography",
    style: "formal group portrait",
    vibe: "everyone arranged and lit for the photograph you would actually frame and hang",
  },
  "cartoon-real": {
    family: "photography",
    style: "photoreal character translation",
    vibe: "a drawn character rendered as a real person photographed on location, keeping their silhouette and palette",
  },
  "gta-life": {
    family: "illustration",
    style: "satirical game-cover art",
    vibe: "an unhinged action set-piece in saturated satirical cover art with hard outlines and heavy contrast",
  },
};

export function seedVibes(): Vibe[] {
  return AGENTS.map((a) => {
    const rung = RUNGS[a.id] ?? {
      family: "photography",
      style: a.name.toLowerCase(),
      // Only reached if an agent is added without a rung. Still a sentence.
      vibe: `${a.pitch} rendered as its own distinct look`,
    };
    return {
      id: a.id,
      name: a.name,
      family: rung.family,
      style: rung.style,
      vibe: rung.vibe,
      brief: a.brief,
      styleBlock: a.styleBlock,
      aspect: a.aspect,
      model: a.model,
      hue: a.hue,
      icon: a.icon,
      kind: "builtin",
      uses: 0,
      datasetCount: 0,
      coverPath: null,
      createdBy: null,
      createdAt: 0,
    } satisfies Vibe;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: PASS — 26 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-studio/vibes-seed.ts src/lib/image-studio/vibes.test.ts
git commit -m "Seed the registry from the five agents, briefs untouched"
```

---

## Task 4: The migration

**Files:**
- Create: `supabase/migrations/20261002120000_image_vibes.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20261002120000_image_vibes.sql`:

```sql
-- ============================================================================
-- Image Studio — the shared vibe registry.
--
-- `image_vibes` is one row per named look, and it is deliberately world-
-- readable: the whole point of the Vibe Lab is that a look one person names
-- becomes a category everyone can generate from. See
-- docs/superpowers/specs/2026-10-02-image-studio-vibe-lab-design.md.
--
-- Three decisions worth knowing before changing anything here:
--
-- 1. THE PRIMARY KEY IS THE SLUG, not a uuid. The id appears in the Generate
--    tab's URL, in the catalog handed to the vision model, and in every
--    matched verdict, and a readable id is what makes a bad match obvious in
--    a log. Collisions are resolved before insert by uniqueSlug().
--
-- 2. dataset_count IS MAINTAINED, NOT COUNTED. The library table shows it for
--    every row at once, and a count(*) per row would be a join per row.
--    insert_vibe_sample() keeps the two in step.
--
-- 3. NO UNIQUE INDEX IS PARTIAL. A PostgREST upsert cannot use a partial
--    unique index — error 42P10, which is what broke the Jarvis memory sync.
--    Resist adding a WHERE clause to one.
--
-- Additive and idempotent: safe to run twice.
-- ============================================================================

-- 1 of 4 --------------------------------------------------------------------
create table if not exists public.image_vibes (
  id            text primary key,
  name          text not null,
  family        text not null default '',
  style         text not null default '',
  vibe          text not null default '',
  brief         text not null default '',
  style_block   text not null default '',
  aspect        text not null default 'portrait'
                  check (aspect in ('portrait', 'square', 'landscape')),
  model         text not null default '',
  hue           int[] not null default '{210,280}',
  icon          text not null default '✦',
  kind          text not null default 'community'
                  check (kind in ('builtin', 'community')),
  uses          int not null default 0,
  dataset_count int not null default 0,
  cover_path    text,
  created_by    text,
  created_at    timestamptz not null default now()
);

-- The library's default sort, and the Generate picker's order.
create index if not exists image_vibes_family_idx on public.image_vibes (family, uses desc);
create index if not exists image_vibes_uses_idx on public.image_vibes (uses desc, created_at desc);

-- 2 of 4 --------------------------------------------------------------------
create table if not exists public.image_vibe_samples (
  id           uuid primary key default gen_random_uuid(),
  vibe_id      text not null references public.image_vibes (id) on delete cascade,
  storage_path text not null,
  caption      text not null default '',
  created_at   timestamptz not null default now()
);

create index if not exists image_vibe_samples_vibe_idx
  on public.image_vibe_samples (vibe_id, created_at desc);

-- 3 of 4 --------------------------------------------------------------------
-- Filing a sample and bumping the counter are one statement, so the number the
-- library shows cannot drift from the rows behind it.
create or replace function public.insert_vibe_sample(
  p_vibe_id text,
  p_storage_path text,
  p_caption text
) returns int
language plpgsql
security invoker
as $$
declare
  v_count int;
begin
  insert into public.image_vibe_samples (vibe_id, storage_path, caption)
  values (p_vibe_id, p_storage_path, coalesce(p_caption, ''));

  update public.image_vibes
     set dataset_count = dataset_count + 1,
         uses = uses + 1
   where id = p_vibe_id
  returning dataset_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

-- 4 of 4 --------------------------------------------------------------------
alter table public.image_vibes enable row level security;
alter table public.image_vibe_samples enable row level security;

-- Readable by anyone, including before sign-in: the library is the app's
-- shared vocabulary and a signed-out visitor should still see it.
drop policy if exists image_vibes_read on public.image_vibes;
create policy image_vibes_read on public.image_vibes for select using (true);

drop policy if exists image_vibe_samples_read on public.image_vibe_samples;
create policy image_vibe_samples_read on public.image_vibe_samples for select using (true);

-- Writable by a signed-in visitor, who may add to the taxonomy. There is
-- deliberately no check on `kind`: a built-in's authority lives in
-- vibes-seed.ts, and the store takes a seed id's brief, name and kind from
-- code rather than from its row (see fromRow in vibe-store.ts), so a row that
-- claims to be built-in gains nothing by it. The column exists so a
-- materialised seed row — one created the first time someone files a sample
-- against Nostalgia — still reads as built-in to a plain SQL query.
drop policy if exists image_vibes_insert on public.image_vibes;
create policy image_vibes_insert on public.image_vibes
  for insert to authenticated with check (true);

drop policy if exists image_vibes_update on public.image_vibes;
create policy image_vibes_update on public.image_vibes
  for update to authenticated using (true) with check (true);

drop policy if exists image_vibe_samples_insert on public.image_vibe_samples;
create policy image_vibe_samples_insert on public.image_vibe_samples
  for insert to authenticated with check (true);
```

- [ ] **Step 2: Show the owner the SQL to run**

The owner runs migrations by hand in the Supabase SQL editor. Copy it to their clipboard and say
which project it is for (`kiiwaiwrfslqankcsnkf`):

```bash
Set-Clipboard -Value (Get-Content -Raw supabase/migrations/20261002120000_image_vibes.sql)
```

Tell them: "The Image Studio vibe tables are on your clipboard — paste into the Supabase SQL editor
for `kiiwaiwrfslqankcsnkf` and run. The app works without this; the library just stays on its seed."

- [ ] **Step 3: Add it to the combined schema**

```bash
printf '\n' >> supabase/all-schemas.sql
cat supabase/migrations/20261002120000_image_vibes.sql >> supabase/all-schemas.sql
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261002120000_image_vibes.sql supabase/all-schemas.sql
git commit -m "Migration: image_vibes + image_vibe_samples, world-readable by design"
```

---

## Task 5: The read prompt

**Files:**
- Create: `src/lib/image-studio/vibe-prompt.ts`
- Test: `src/lib/image-studio/vibes.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/image-studio/vibes.test.ts`:

```ts
import { argumentTurns, readSystem, readUser, type ArgumentTurn } from "./vibe-prompt";
import { seedVibes as seedForPrompt } from "./vibes-seed";
import { toCandidate } from "./vibes";

describe("readSystem", () => {
  const candidates = seedForPrompt().map(toCandidate);

  it("lists every candidate id the model is allowed to match", () => {
    const sys = readSystem(candidates);
    for (const c of candidates) expect(sys).toContain(c.id);
  });

  it("states the word floor for the deepest rung", () => {
    expect(readSystem(candidates)).toContain("at least 6 words");
  });

  it("forbids inventing an id", () => {
    expect(readSystem(candidates)).toMatch(/exactly as written|not in the list/i);
  });

  it("works with an empty library", () => {
    const sys = readSystem([]);
    expect(sys).toContain("The library is empty");
  });
});

describe("readUser", () => {
  it("attaches the image after the text", () => {
    const parts = readUser("I think this is 90s", "data:image/png;base64,AAA");
    expect(parts[0].type).toBe("text");
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAA" } });
  });

  it("marks the steer as a hint, not an answer", () => {
    const parts = readUser("I think this is 90s", "data:image/png;base64,AAA");
    expect(parts[0].type === "text" && parts[0].text).toContain("hint");
  });

  it("says plainly when no steer was given", () => {
    const parts = readUser("", "data:image/png;base64,AAA");
    expect(parts[0].type === "text" && parts[0].text).toContain("no hint");
  });
});

describe("argumentTurns", () => {
  const turns: ArgumentTurn[] = [
    { role: "user", text: "no, more Ghibli than cartoon" },
    { role: "assistant", text: '{"ladder":{"family":"animation"}}' },
  ];

  it("keeps the order of the argument", () => {
    const msgs = argumentTurns(turns);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("keeps only the last 12 turns, so a long argument cannot grow unbounded", () => {
    const many: ArgumentTurn[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `turn ${i}`,
    }));
    const msgs = argumentTurns(many);
    expect(msgs).toHaveLength(12);
    expect(msgs[11].content).toContain("turn 29");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: FAIL — `Failed to resolve import "./vibe-prompt"`.

- [ ] **Step 3: Write the prompt module**

Create `src/lib/image-studio/vibe-prompt.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — what the vision model is asked, for a read and for an
// argument.
//
// Pure string assembly, kept out of the route so the thing most likely to need
// tuning is the thing easiest to test. The instructions here are belt; the
// validator in vibes.ts is braces. Anything the prompt asks for and the
// validator does not enforce will eventually come back wrong.
// ---------------------------------------------------------------------------

import { MIN_VIBE_WORDS, type VibeCandidate } from "./vibes";
import type { Part } from "./prompt";

export interface ArgumentTurn {
  role: "user" | "assistant";
  text: string;
}

/** The most turns of an argument sent back. Beyond this the oldest fall off. */
export const MAX_ARGUMENT_TURNS = 12;

const SHAPE = `{
  "ladder": { "family": string, "style": string, "vibe": string },
  "confidence": { "family": number, "style": number, "vibe": number },
  "rivals": [ { "label": string, "depth": "family"|"style"|"vibe", "confidence": number, "why": string } ],
  "evidence": { "palette": ["#rrggbb"], "grain": string, "lighting": string, "era": string, "framing": string, "subject": string },
  "match": { "vibeId": string, "confidence": number, "why": string } | null,
  "proposal": { "name": string, "slug": string, "icon": string, "brief": string, "styleBlock": string, "aspect": "portrait"|"square"|"landscape", "hue": [number, number] } | null,
  "lora": { "verdict": "distinctive"|"borderline"|"generic", "why": string }
}`;

export function readSystem(candidates: VibeCandidate[]): string {
  const library = candidates.length
    ? candidates.map((c) => `- ${c.id} — ${c.name}: ${c.family} / ${c.style} / ${c.vibe}`).join("\n")
    : "The library is empty. You must propose a new vibe.";

  return [
    "You name the look of an image: not what is in it, but what kind of image it is.",
    "",
    "Answer at three depths, coarse to specific:",
    `- family — the broadest kind: "photography", "animation", "illustration", "3D render".`,
    `- style — the school inside it: "cel anime", "vintage consumer film", "satirical cover art".`,
    `- vibe — the specific look, as a DESCRIPTION of at least ${MIN_VIBE_WORDS} words. ` +
      `"Cartoon" is not an answer. "Soft gouache skies over a hand-painted pastoral valley" is. ` +
      "Name the treatment, not the subject: the same wedding shot on Polaroid and on a phone are different vibes.",
    "",
    "Also give 2-3 rivals — reads you considered and rejected — each with the one thing that ruled it out. " +
      "A rival is a real alternative a careful person might pick, not a strawman.",
    "",
    "Evidence must be what you actually see: up to 8 dominant colours as #rrggbb, the grain or its " +
      "absence, the lighting, any era cues (wardrobe, cars, signage, screens), the framing, and how the " +
      "subject is treated. These are the observations you will be held to if the user disagrees.",
    "",
    "THE LIBRARY — the vibes that already exist:",
    library,
    "",
    "If one of those is what this image is, set `match.vibeId` to its id, copied exactly as written " +
      "above, and set `proposal` to null. Matching beats proposing: a near-duplicate of an existing " +
      "vibe makes the library worse for everyone. If none of them fits, set `match` to null and fill " +
      "`proposal` with a new vibe, including a `brief` — a system prompt, 60-120 words, written in the " +
      "second person, that would make an image model reproduce this look from any request — and a " +
      "`styleBlock`, one comma-separated line of the look's visual markers. " +
      "Never use an id that is not in the list above.",
    "",
    "`lora.verdict` judges whether this look is its own thing: `distinctive` if it is specific and " +
      "repeatable enough to be worth collecting, `generic` if it is just a competent photograph, " +
      "`borderline` in between. Say why in one sentence.",
    "",
    `Reply with ONLY this JSON object, no markdown fence and no commentary:\n${SHAPE}`,
  ].join("\n");
}

/**
 * The first turn: the image, plus whatever the user said about it.
 *
 * The steer is framed as a hint on purpose. A user who writes "90s" is often
 * right about the decade and wrong about the medium, and a model told that is
 * the answer stops looking.
 */
export function readUser(steer: string, imageDataUrl: string): Part[] {
  const hint = steer.trim()
    ? `The user offered a hint about this image: "${steer.trim()}". Treat it as a hint, not an answer — ` +
      "weigh it against what you see, and say so in a rival if you disagree with it."
    : "The user gave no hint. Read the image cold.";
  return [{ type: "text", text: hint }, { type: "image_url", image_url: { url: imageDataUrl } }];
}

/** The argument so far, newest last, trimmed to the most recent turns. */
export function argumentTurns(turns: ArgumentTurn[]): { role: "user" | "assistant"; content: string }[] {
  return turns.slice(-MAX_ARGUMENT_TURNS).map((t) => ({ role: t.role, content: t.text }));
}

/** Added when the user pushes back, so the model re-reads instead of restating. */
export function arguingSystem(): string {
  return [
    "The user disagrees with your read. They have seen it and are telling you where it is wrong.",
    "Take the correction seriously: they can see things about this image's origin that you cannot.",
    "Re-read the image against their objection — do not merely restate your evidence at them.",
    "If they are right, change the ladder. If you still believe your read, keep it and say what in the " +
      "image specifically rules out what they suggested.",
    "Return the COMPLETE JSON object again, every field filled, in the same shape as before.",
  ].join("\n");
}

/** One stricter retry, used only when the deepest rung came back as a label. */
export function stricterRetry(bad: string): string {
  return (
    `Your previous answer gave "${bad}" as the vibe. That is a label, not a read of this image. ` +
    `Replace it with at least ${MIN_VIBE_WORDS} words describing the specific treatment — the medium, ` +
    "the light, the palette, the finish — such that someone could reproduce the look without seeing " +
    "the picture. Return the complete JSON object again."
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: PASS — 35 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-studio/vibe-prompt.ts src/lib/image-studio/vibes.test.ts
git commit -m "The read prompt: three depths, rivals that are real, and no inventing ids"
```

---

## Task 6: The vibe store

**Files:**
- Create: `src/lib/image-studio/vibe-store.ts`

No unit tests here: every function is a Supabase call, and a test of one would be a test of a mock.
The logic worth testing — the seed merge rule — is pure and lands in Task 7.

- [ ] **Step 1: Write the store**

Create `src/lib/image-studio/vibe-store.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — reading and writing the shared vibe registry.
//
// One rule runs through this file: for a built-in, CODE WINS. A seed row's
// name, brief, style block and ladder come from vibes-seed.ts even when a row
// for it exists in the database; only the counters, the cover and the dates
// come from the row. That is what lets the five agents be rows — so samples
// can be filed against them and their use counts can climb — without the
// database becoming a second, drifting copy of their briefs.
//
// With no Supabase configured, every read returns the seed and every write
// says so instead of failing. The app stays fully usable; the library just
// does not grow past what ships with it.
// ---------------------------------------------------------------------------

import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { seedVibes } from "./vibes-seed";
import { mergeWithSeed, uniqueSlug, type Vibe, type VibeLadder, type VibeProposal } from "./vibes";

const TABLE = "image_vibes";
const SAMPLES = "image_vibe_samples";

/** The shape Supabase returns: snake_case, and `hue` arrives as number[]. */
export interface VibeRow {
  id: string;
  name: string;
  family: string;
  style: string;
  vibe: string;
  brief: string;
  style_block: string;
  aspect: string;
  model: string;
  hue: number[] | null;
  icon: string;
  kind: string;
  uses: number;
  dataset_count: number;
  cover_path: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Registry {
  vibes: Vibe[];
  /** False when this came from the seed because Supabase is not configured. */
  stored: boolean;
}

export async function listVibes(): Promise<Registry> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { vibes: seedVibes(), stored: false };

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("uses", { ascending: false })
    .limit(500);

  if (error) {
    console.error("[image-studio] vibe list failed:", error.message);
    return { vibes: seedVibes(), stored: false };
  }
  return { vibes: mergeWithSeed((data ?? []) as VibeRow[], seedVibes()), stored: true };
}

/**
 * Commits a proposed vibe.
 *
 * The slug is settled here rather than client-side, against the ids that exist
 * at this moment — two people naming the same look a minute apart must both
 * get a row.
 */
export async function saveProposal(
  proposal: VibeProposal,
  ladder: VibeLadder,
  coverPath: string | null,
  createdBy: string | null,
): Promise<Vibe | string> {
  const { vibes, stored } = await listVibes();
  const vibe: Vibe = {
    id: uniqueSlug(proposal.slug, vibes.map((v) => v.id)),
    name: proposal.name,
    family: ladder.family,
    style: ladder.style,
    vibe: ladder.vibe,
    brief: proposal.brief,
    styleBlock: proposal.styleBlock,
    aspect: proposal.aspect,
    model: seedVibes()[0].model,
    hue: proposal.hue,
    icon: proposal.icon,
    kind: "community",
    uses: 1,
    datasetCount: 0,
    coverPath,
    createdBy,
    createdAt: Date.now(),
  };

  if (!stored) return vibe; // Nothing to write to; the client keeps it locally.

  const supabase = await getSupabaseServerClient();
  if (!supabase) return vibe;

  const { error } = await supabase.from(TABLE).insert({
    id: vibe.id,
    name: vibe.name,
    family: vibe.family,
    style: vibe.style,
    vibe: vibe.vibe,
    brief: vibe.brief,
    style_block: vibe.styleBlock,
    aspect: vibe.aspect,
    model: vibe.model,
    hue: vibe.hue,
    icon: vibe.icon,
    kind: "community",
    uses: 1,
    cover_path: vibe.coverPath,
    created_by: vibe.createdBy,
  });
  if (error) {
    console.error("[image-studio] vibe insert failed:", error.message);
    return `The database refused the new vibe (${error.message}).`;
  }
  return vibe;
}

/**
 * Files an image under a vibe and returns the vibe's new dataset count.
 *
 * A built-in may not have a row yet — the five agents exist in code, not in the
 * database — so its row is materialised from the seed on first use. The upsert
 * ignores duplicates, so this is a no-op every time after the first.
 */
export async function fileSample(
  vibeId: string,
  storagePath: string,
  caption: string,
): Promise<number | string> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return "Saved in this browser only — no database is configured.";

  const seed = seedVibes().find((v) => v.id === vibeId);
  if (seed) {
    const { error } = await supabase.from(TABLE).upsert(
      {
        id: seed.id,
        name: seed.name,
        family: seed.family,
        style: seed.style,
        vibe: seed.vibe,
        brief: seed.brief,
        style_block: seed.styleBlock,
        aspect: seed.aspect,
        model: seed.model,
        hue: seed.hue,
        icon: seed.icon,
        kind: "builtin",
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) console.error("[image-studio] builtin materialise failed:", error.message);
  }

  const { data, error } = await supabase.rpc("insert_vibe_sample", {
    p_vibe_id: vibeId,
    p_storage_path: storagePath,
    p_caption: caption,
  });
  if (error) {
    console.error("[image-studio] sample insert failed:", error.message);
    return `The image was not filed (${error.message}).`;
  }
  return typeof data === "number" ? data : 0;
}

export async function listSamples(vibeId: string): Promise<{ storagePath: string; caption: string }[]> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from(SAMPLES)
    .select("storage_path, caption")
    .eq("vibe_id", vibeId)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) {
    console.error("[image-studio] sample list failed:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    storagePath: r.storage_path as string,
    caption: (r.caption as string) ?? "",
  }));
}
```

- [ ] **Step 2: Typecheck, expecting one known failure**

Run: `npx tsc --noEmit`
Expected: FAIL with exactly one error — `mergeWithSeed` is not exported from `./vibes`. Task 7 adds
it. Do not commit yet; this file does not compile alone.

---

## Task 7: The seed merge rule

The one piece of the store's behaviour with a rule in it, so it is the piece that gets a test:
which fields of a built-in come from the database and which come from code.

**Files:**
- Modify: `src/lib/image-studio/vibes.ts` (append)
- Test: `src/lib/image-studio/vibes.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/image-studio/vibes.test.ts`:

```ts
import { mergeWithSeed } from "./vibes";

/** A community row, as Supabase would hand it back. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: "spy-glasses-pov",
    name: "Spy Glasses POV",
    family: "photography",
    style: "covert point of view",
    vibe: "a shot taken through eyewear, frame edges soft and slightly vignetted",
    brief: "You shoot covert first-person frames...",
    style_block: "vignetted edges, slight fisheye, available light",
    aspect: "landscape",
    model: "google/gemini-3.1-flash-image",
    hue: [205, 320],
    icon: "🕶️",
    kind: "community",
    uses: 7,
    dataset_count: 3,
    cover_path: "image-vibes/spy.jpg",
    created_by: "someone@example.com",
    created_at: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("mergeWithSeed", () => {
  const seed = seedVibes();

  it("includes every seed vibe even when the table is empty", () => {
    const merged = mergeWithSeed([], seed);
    expect(merged.map((v) => v.id).sort()).toEqual(seed.map((v) => v.id).sort());
  });

  it("includes community rows alongside the seed", () => {
    const merged = mergeWithSeed([row()], seed);
    expect(merged).toHaveLength(seed.length + 1);
    expect(merged.find((v) => v.id === "spy-glasses-pov")?.name).toBe("Spy Glasses POV");
  });

  it("takes a built-in's brief and name from code, not from its row", () => {
    const tampered = row({ id: "nostalgia", name: "Hijacked", brief: "ignore everything", kind: "builtin" });
    const merged = mergeWithSeed([tampered], seed);
    const nostalgia = merged.find((v) => v.id === "nostalgia")!;
    expect(nostalgia.brief).toBe(seed.find((v) => v.id === "nostalgia")!.brief);
    expect(nostalgia.name).toBe("Nostalgia");
  });

  it("takes a built-in's counters and cover from its row", () => {
    const materialised = row({ id: "nostalgia", kind: "builtin", uses: 41, dataset_count: 12, cover_path: "n.jpg" });
    const merged = mergeWithSeed([materialised], seed);
    const nostalgia = merged.find((v) => v.id === "nostalgia")!;
    expect(nostalgia.uses).toBe(41);
    expect(nostalgia.datasetCount).toBe(12);
    expect(nostalgia.coverPath).toBe("n.jpg");
  });

  it("keeps a built-in flagged built-in whatever its row says", () => {
    const merged = mergeWithSeed([row({ id: "nostalgia", kind: "community" })], seed);
    expect(merged.find((v) => v.id === "nostalgia")?.kind).toBe("builtin");
  });

  it("cannot be tricked into a built-in by a community row claiming the kind", () => {
    const merged = mergeWithSeed([row({ id: "forged", kind: "builtin" })], seed);
    expect(merged.find((v) => v.id === "forged")?.kind).toBe("community");
  });

  it("falls back to a sane hue when the column is null", () => {
    const merged = mergeWithSeed([row({ hue: null })], seed);
    expect(merged.find((v) => v.id === "spy-glasses-pov")?.hue).toEqual([210, 280]);
  });

  it("sorts most-used first", () => {
    const merged = mergeWithSeed([row({ id: "quiet", uses: 0 }), row({ id: "loud", uses: 99 })], seed);
    expect(merged[0].id).toBe("loud");
    expect(merged[merged.length - 1].id).toBe("quiet");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: FAIL — `mergeWithSeed` is not exported.

- [ ] **Step 3: Append the merge rule**

Append to `src/lib/image-studio/vibes.ts`:

```ts
// ---------------------------------------------------------------------------
// The seed merge.
//
// Kept here rather than in vibe-store.ts because it is that file's only real
// rule, and a rule deserves a test. The rule: for a built-in, code wins on
// identity, and counters come from the row.
// ---------------------------------------------------------------------------

/** A row's shape, structurally — so this file never imports a server module. */
export interface VibeRowLike {
  id: string;
  name: string;
  family: string;
  style: string;
  vibe: string;
  brief: string;
  style_block: string;
  aspect: string;
  model: string;
  hue: number[] | null;
  icon: string;
  kind: string;
  uses: number;
  dataset_count: number;
  cover_path: string | null;
  created_by: string | null;
  created_at: string;
}

function rowToVibe(r: VibeRowLike): Vibe {
  const hue = Array.isArray(r.hue) && r.hue.length >= 2 ? r.hue : [210, 280];
  return {
    id: r.id,
    name: r.name,
    family: r.family ?? "",
    style: r.style ?? "",
    vibe: r.vibe ?? "",
    brief: r.brief ?? "",
    styleBlock: r.style_block ?? "",
    aspect: ASPECTS.find((a) => a === r.aspect) ?? "portrait",
    model: r.model ?? "",
    hue: [hueNum(hue[0], 210), hueNum(hue[1], 280)],
    icon: r.icon || "✦",
    // Never read from the row. A forged `builtin` must gain nothing by it;
    // only an id present in the seed is built-in, and mergeWithSeed decides.
    kind: "community",
    uses: Number(r.uses) || 0,
    datasetCount: Number(r.dataset_count) || 0,
    coverPath: r.cover_path ?? null,
    createdBy: r.created_by ?? null,
    createdAt: Date.parse(r.created_at ?? "") || 0,
  };
}

/**
 * The registry as the app sees it: every seed vibe, plus every stored row.
 *
 * A stored row whose id is in the seed is a MATERIALISED BUILT-IN — created so
 * samples could be filed against one of the five agents — and contributes only
 * its counters, cover and dates. Its name, ladder, brief and style block come
 * from the seed, so a brief has exactly one home and cannot drift.
 */
export function mergeWithSeed(rows: VibeRowLike[], seed: Vibe[]): Vibe[] {
  const seedById = new Map(seed.map((v) => [v.id, v]));
  const out = new Map<string, Vibe>();

  for (const v of seed) out.set(v.id, { ...v });

  for (const r of rows) {
    const fromRow = rowToVibe(r);
    const builtin = seedById.get(r.id);
    if (builtin) {
      out.set(r.id, {
        ...builtin,
        uses: fromRow.uses,
        datasetCount: fromRow.datasetCount,
        coverPath: fromRow.coverPath ?? builtin.coverPath,
        createdAt: fromRow.createdAt || builtin.createdAt,
      });
    } else {
      out.set(r.id, fromRow);
    }
  }

  return [...out.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: PASS — 43 tests.

- [ ] **Step 5: Typecheck and commit both files**

```bash
npx tsc --noEmit
git add src/lib/image-studio/vibes.ts src/lib/image-studio/vibes.test.ts src/lib/image-studio/vibe-store.ts
git commit -m "The store, and the rule that a built-in's brief has exactly one home"
```

Expected from `tsc`: clean.

---

## Task 8: The read-and-argue route

**Files:**
- Create: `src/app/api/image-studio/vibe/route.ts`

- [ ] **Step 1: Write the route**

Create `src/app/api/image-studio/vibe/route.ts`:

```ts
import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/provider";
import { REWRITE_MODEL } from "@/lib/image-studio/agents";
import { extractResult } from "@/lib/image-studio/prompt";
import { chat } from "@/lib/image-studio/server";
import { listVibes } from "@/lib/image-studio/vibe-store";
import {
  argumentTurns,
  arguingSystem,
  readSystem,
  readUser,
  stricterRetry,
  type ArgumentTurn,
} from "@/lib/image-studio/vibe-prompt";
import { toCandidate, validateVerdict } from "@/lib/image-studio/vibes";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Vision-capable and cheap. The read is one image in, a page of JSON out. */
const READ_MODEL = process.env.IMAGE_STUDIO_VIBE_MODEL || REWRITE_MODEL;

/** ~6MB of base64, which the client's downscale comes nowhere near. */
const MAX_IMAGE_CHARS = 8_000_000;

// POST /api/image-studio/vibe
// Body: { image: dataUrl, steer?: string, turns?: [{ role, text }] }
// Returns: { verdict, problems, candidates, stored } | { offline, candidates }
//          | { error, refused? }
//
// One call is either the first read of an image or one turn of the argument
// about it — the same request either way, because the model returns a complete
// verdict every time. The client holds the transcript; this route holds nothing.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const image = typeof b.image === "string" ? b.image : "";
  if (!image.startsWith("data:image/")) {
    return NextResponse.json({ error: "Add an image first." }, { status: 400 });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ error: "That image is too large to read. Try a smaller one." }, { status: 413 });
  }
  const steer = typeof b.steer === "string" ? b.steer.slice(0, 600) : "";
  const turns: ArgumentTurn[] = (Array.isArray(b.turns) ? b.turns : [])
    .map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      return {
        role: o.role === "assistant" ? ("assistant" as const) : ("user" as const),
        text: typeof o.text === "string" ? o.text.slice(0, 6000) : "",
      };
    })
    .filter((t) => t.text.length > 0);

  const { vibes, stored } = await listVibes();
  const candidates = vibes.map(toCandidate);
  const candidateIds = candidates.map((c) => c.id);

  // Keyless: the client has a canvas and does the heuristic read itself, which
  // keeps the honest fallback honest — visibly a guess from pixels, not a
  // model pretending to be offline.
  if (!aiConfigured()) {
    return NextResponse.json({ offline: true, candidates, stored });
  }

  const system = [readSystem(candidates), turns.length ? arguingSystem() : ""].filter(Boolean).join("\n\n");
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: readUser(steer, image) },
    ...argumentTurns(turns),
  ];

  try {
    const first = await askOnce(messages);
    if (typeof first === "string") throw new Error(first);

    let checked = validateVerdict(first, candidateIds);

    // One stricter retry, and only for the failure this app exists to prevent:
    // a deepest rung that came back as a label.
    const labelled = typeof checked !== "string" && checked.problems.some((p) => p.field === "ladder.vibe");
    if (typeof checked === "string" || labelled) {
      const nudge = typeof checked === "string" ? checked : stricterRetry(checked.verdict.ladder.vibe);
      const second = await askOnce([...messages, { role: "user" as const, content: nudge }]);
      if (typeof second !== "string") {
        const rechecked = validateVerdict(second, candidateIds);
        if (typeof rechecked !== "string") checked = rechecked;
      }
    }

    if (typeof checked === "string") {
      return NextResponse.json({ error: checked, candidates, stored }, { status: 502 });
    }
    return NextResponse.json({ verdict: checked.verdict, problems: checked.problems, candidates, stored });
  } catch (err) {
    const message = (err as Error).message ?? "";
    console.error("[image-studio] vibe read failed:", message);
    // A refusal is a different thing from an outage and takes a different
    // route through the UI, so it is named rather than folded into a 502.
    if (/refus|safety|policy|cannot assist/i.test(message)) {
      return NextResponse.json({
        error: "The model wouldn't read that image. Describe the look yourself and it will take it from there.",
        refused: true,
        candidates,
        stored,
      });
    }
    return NextResponse.json({ error: "The model didn't answer. Try again in a moment.", candidates, stored }, { status: 502 });
  }
}

/** One call, parsed out of whatever wrapping the model put the JSON in. */
async function askOnce(messages: { role: "system" | "user" | "assistant"; content: unknown }[]): Promise<unknown | string> {
  const json = await chat(
    READ_MODEL,
    messages as never,
    { temperature: 0.4, max_tokens: 2000, response_format: { type: "json_object" } },
    55_000,
  );
  const text = extractResult(json).text;
  if (!text) return "The model returned nothing.";
  return parseLoose(text);
}

/**
 * JSON out of a model's reply.
 *
 * `response_format` is asked for, but not every model on the hub's fallback
 * chain honours it, and the ones that do not wrap the object in a fence or a
 * sentence. The widest brace span is the object.
 */
export function parseLoose(text: string): unknown | string {
  const cleaned = text.trim().replace(/^```[a-z]*\s*|\s*```$/g, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through to the brace scan */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return "The model's answer was not JSON.";
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return "The model's answer was not JSON.";
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify the keyless path answers rather than 500s**

Start a preview on a port nothing else uses:

```bash
node scripts/dev-preview.mjs 3123 --no-auth
```

In another shell:

```bash
curl -s -X POST http://localhost:3123/api/image-studio/vibe -H "Content-Type: application/json" -d "{\"image\":\"data:image/png;base64,iVBORw0KGgo=\"}"
```

Expected (with no `OPENROUTER_API_KEY` set): JSON containing `"offline":true` and a `candidates`
array holding the five built-in ids. With a key set: a full `verdict`. Either way, not a 500.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/image-studio/vibe/route.ts
git commit -m "Read route: one shape for a first read and an argument turn, one stricter retry"
```

---

## Task 9: The save route

**Files:**
- Create: `src/app/api/image-studio/vibes/route.ts`
- Create: `src/lib/image-studio/bytes.ts`
- Test: `src/lib/image-studio/vibes.test.ts` (append)

- [ ] **Step 1: Write the failing tests for the decoder**

Append to `src/lib/image-studio/vibes.test.ts`:

```ts
import { dataUrlToBytes } from "./bytes";

describe("dataUrlToBytes", () => {
  it("decodes a png data URL and names its extension", () => {
    const out = dataUrlToBytes("data:image/png;base64,aGVsbG8=");
    expect(out?.ext).toBe("png");
    expect(out?.contentType).toBe("image/png");
    expect(out?.data.toString()).toBe("hello");
  });

  it("maps jpeg to jpg, because the extension is not the media type", () => {
    expect(dataUrlToBytes("data:image/jpeg;base64,aGVsbG8=")?.ext).toBe("jpg");
  });

  it("refuses a non-image data URL", () => {
    expect(dataUrlToBytes("data:text/plain;base64,aGVsbG8=")).toBeNull();
  });

  it("refuses a bare https URL", () => {
    expect(dataUrlToBytes("https://example.com/a.png")).toBeNull();
  });

  it("refuses an empty payload", () => {
    expect(dataUrlToBytes("data:image/png;base64,")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: FAIL — `Failed to resolve import "./bytes"`.

- [ ] **Step 3: Write the decoder**

Create `src/lib/image-studio/bytes.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — a data URL as bytes.
//
// Separate from media.ts because that file is browser-side (Blob, canvas,
// IndexedDB) and this runs in a route. Pure, so it is tested.
// ---------------------------------------------------------------------------

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

export interface DecodedImage {
  data: Buffer;
  contentType: string;
  ext: string;
}

export function dataUrlToBytes(dataUrl: string): DecodedImage | null {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) return null;
  const contentType = match[1].toLowerCase();
  try {
    const data = Buffer.from(match[2], "base64");
    if (!data.length) return null;
    return { data, contentType, ext: EXT[contentType] ?? "bin" };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/image-studio/vibes.test.ts`
Expected: PASS — 48 tests.

- [ ] **Step 5: Write the route**

Create `src/app/api/image-studio/vibes/route.ts`:

```ts
import { NextResponse } from "next/server";
import { FILES_BUCKET } from "@/lib/supabase/config";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { dataUrlToBytes } from "@/lib/image-studio/bytes";
import { fileSample, listSamples, listVibes, saveProposal } from "@/lib/image-studio/vibe-store";
import { slugify, type VibeLadder, type VibeProposal } from "@/lib/image-studio/vibes";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/image-studio/vibes            → { vibes, stored }
// GET /api/image-studio/vibes?samples=ID → { samples }
export async function GET(req: Request) {
  const samplesFor = new URL(req.url).searchParams.get("samples");
  if (samplesFor) return NextResponse.json({ samples: await listSamples(samplesFor) });
  const { vibes, stored } = await listVibes();
  return NextResponse.json({ vibes, stored });
}

// POST /api/image-studio/vibes
// Body: { image: dataUrl, caption: string, ladder, match?: vibeId, proposal? }
// Returns: { vibe, datasetCount, warning? }
//
// Commits one verdict: either the image joins an existing vibe's dataset, or a
// new vibe is minted with this image as its cover. Both paths file the image,
// because a vibe with no examples is a label again.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const image = typeof b.image === "string" ? b.image : "";
  if (!image.startsWith("data:image/")) {
    return NextResponse.json({ error: "There is no image to file." }, { status: 400 });
  }
  const caption = typeof b.caption === "string" ? b.caption.slice(0, 600) : "";
  const ladder = (b.ladder ?? {}) as VibeLadder;
  const matchId = typeof b.match === "string" ? b.match : "";
  const proposal = (b.proposal ?? null) as VibeProposal | null;

  if (!matchId && !proposal) {
    return NextResponse.json({ error: "Nothing to save — no vibe was matched or proposed." }, { status: 400 });
  }

  const cover = await uploadCover(image, matchId || slugify(proposal?.name ?? "vibe"));

  if (matchId) {
    const count = await fileSample(matchId, cover.path, caption);
    const { vibes } = await listVibes();
    const vibe = vibes.find((v) => v.id === matchId);
    if (!vibe) return NextResponse.json({ error: "That vibe no longer exists." }, { status: 404 });
    const datasetCount = typeof count === "number" ? count : vibe.datasetCount;
    return NextResponse.json({
      vibe: { ...vibe, datasetCount },
      datasetCount,
      warning: warn(count, cover.warning),
    });
  }

  const saved = await saveProposal(proposal!, ladder, cover.path || null, null);
  if (typeof saved === "string") return NextResponse.json({ error: saved }, { status: 502 });

  const count = await fileSample(saved.id, cover.path, caption);
  const datasetCount = typeof count === "number" ? count : 0;
  return NextResponse.json({
    vibe: { ...saved, datasetCount },
    datasetCount,
    warning: warn(count, cover.warning),
  });
}

function warn(count: number | string, coverWarning: string): string | undefined {
  return [typeof count === "string" ? count : "", coverWarning].filter(Boolean).join(" ") || undefined;
}

/**
 * Puts the image in the bucket and returns its path.
 *
 * A failed upload is not a failed save: the vibe is the valuable part and it
 * still lands, with the cover missing and a warning that says so.
 */
async function uploadCover(dataUrl: string, slug: string): Promise<{ path: string; warning: string }> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return { path: "", warning: "" };

  const bytes = dataUrlToBytes(dataUrl);
  if (!bytes) return { path: "", warning: "The image could not be decoded, so no cover was stored." };

  const path = `image-vibes/${slug}/${Date.now()}.${bytes.ext}`;
  const { error } = await supabase.storage
    .from(FILES_BUCKET)
    .upload(path, bytes.data, { contentType: bytes.contentType, upsert: false });
  if (error) {
    console.error("[image-studio] cover upload failed:", error.message);
    return { path: "", warning: "The vibe was saved, but its cover image was not stored." };
  }
  return { path, warning: "" };
}
```

- [ ] **Step 6: Verify the list endpoint answers keyless**

With the preview from Task 8 still running:

```bash
curl -s http://localhost:3123/api/image-studio/vibes
```

Expected: `{"vibes":[...5 built-ins...],"stored":false}`.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/app/api/image-studio/vibes/route.ts src/lib/image-studio/bytes.ts src/lib/image-studio/vibes.test.ts
git commit -m "Save route: a failed cover upload must not lose the vibe"
```

---

## Task 10: The shell

**INVOKE `interactive-web-studio` BEFORE THIS TASK** and announce it. Everything from here on is
UI, and the owner's standing rule is that a design skill drives the look before any JSX is written.

**Files:**
- Create: `src/lib/image-studio/sections.ts`
- Create: `src/components/image-studio/ImageStudioShell.tsx`
- Create: `src/components/image-studio/image-studio.css`
- Modify: `src/app/apps/image-studio/page.tsx`
- Modify: `src/components/image-studio/ImageStudio.tsx:195-215` (the header block)

- [ ] **Step 1: Write the section definitions**

Create `src/lib/image-studio/sections.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — the three studios, named once.
//
// Deliberately outside the shell component: the page is a server component and
// has to validate `?section=` before it renders anything, and a "use client"
// module's plain functions cannot be called from the server. No client marker
// here, so both sides read the same list. Same reasoning as
// lib/jarvis-audio-studio/sections.ts.
// ---------------------------------------------------------------------------

export type Section = "generate" | "lab" | "library";

export interface SectionDef {
  id: Section;
  /** What the switcher says. */
  label: string;
  /** What the studio is for, shown beside the label where there is room. */
  hint: string;
  /** Key in the shared icon set (src/components/icons.tsx). */
  icon: "Sparkles" | "Aperture" | "Database";
}

export const SECTIONS: SectionDef[] = [
  { id: "generate", label: "Generate", hint: "make the image", icon: "Sparkles" },
  { id: "lab", label: "Vibe Lab", hint: "name the look", icon: "Aperture" },
  { id: "library", label: "Library", hint: "every look, shared", icon: "Database" },
];

/** The studio a visitor lands in when nothing says otherwise. */
export const DEFAULT_SECTION: Section = "generate";

export function isSection(value: unknown): value is Section {
  return SECTIONS.some((s) => s.id === value);
}
```

- [ ] **Step 2: Write the shell**

Create `src/components/image-studio/ImageStudioShell.tsx`:

```tsx
"use client";

// ---------------------------------------------------------------------------
// Image Studio — three studios, one front door.
//
// This shell owns exactly one thing: which studio is mounted. Generate is the
// app as it was; Vibe Lab names a look; the Library is where the names live.
// Each studio draws its own everything one step below the switcher, which is
// why adding two did not cost Generate a feature.
//
// Studios are loaded one at a time. Someone who came to browse the library
// should not be made to download the composer, and the Lab pulls in a WebGL
// renderer that Generate has no use for.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_SECTION, SECTIONS, isSection, type Section } from "@/lib/image-studio/sections";
import { Icon } from "../icons";
import "./image-studio.css";

const STUDIOS: Record<Section, React.ComponentType<{ embedded?: boolean }>> = {
  generate: dynamic(() => import("./ImageStudio").then((m) => m.ImageStudio), {
    ssr: false,
    loading: () => <StudioSkeleton kind="generate" />,
  }),
  lab: dynamic(() => import("./vibe-lab/VibeLab").then((m) => m.VibeLab), {
    ssr: false,
    loading: () => <StudioSkeleton kind="lab" />,
  }),
  library: dynamic(() => import("./vibe-library/VibeLibrary").then((m) => m.VibeLibrary), {
    ssr: false,
    loading: () => <StudioSkeleton kind="library" />,
  }),
};

const REMEMBERED = "image-studio:section";

/**
 * @param initialSection The studio the URL asked for, or null when it asked
 *   for none. It has to be nullable: "the URL said Library" and "the URL said
 *   nothing" lead to different behaviour, and a plain default cannot tell them
 *   apart — collapsing them means a link to the Library lands wherever you
 *   last were instead.
 */
export function ImageStudioShell({ initialSection }: { initialSection: Section | null }) {
  const [section, setSection] = useState<Section>(initialSection ?? DEFAULT_SECTION);

  useEffect(() => {
    try {
      // Arriving by a link that named a studio counts as being there, so the
      // next bare visit resumes it rather than the studio before it.
      if (initialSection) {
        window.localStorage.setItem(REMEMBERED, initialSection);
        return;
      }
      const saved = window.localStorage.getItem(REMEMBERED);
      if (isSection(saved)) setSection(saved);
    } catch {
      /* private browsing, or storage refused — the default stands. */
    }
  }, [initialSection]);

  const go = useCallback((next: Section) => {
    setSection(next);
    try {
      window.localStorage.setItem(REMEMBERED, next);
    } catch {
      /* Remembering is a convenience, never a requirement. */
    }
    // The address should name what is on screen, without a navigation: the Lab
    // holds an argument and an unsaved verdict, and re-mounting it to change a
    // query string would throw both away.
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(null, "", url);
  }, []);

  // Generate is handed the vibe the Library sent it, once, then clears it.
  const Studio = STUDIOS[section];

  return (
    <div className="ims">
      <a href="#ims-stage" className="ims-skip">
        Skip to the studio
      </a>

      <header className="ims-bar">
        {/* image-studio is in PLUGIN_SLUGS, so hubProjects() excludes it and
            the hub grid does not list it. Back has to land where the app
            actually appears. */}
        <Link href="/apps/jarvis#plugins" className="ims-back">
          <Icon.ArrowLeft width={14} height={14} aria-hidden />
          <span>App plugins</span>
        </Link>

        <div className="ims-brand">
          <span className="ims-mark" aria-hidden>
            <Icon.Aperture width={15} height={15} />
          </span>
          <span className="ims-brand-t">
            <span className="ims-brand-n">
              Image <em>Studio</em>
            </span>
            <span className="ims-brand-s">Make it, name it, keep it</span>
          </span>
        </div>

        <Switcher section={section} onGo={go} />
      </header>

      <main id="ims-stage" className="ims-stage" key={section}>
        <Studio embedded />
      </main>
    </div>
  );
}

/**
 * The segmented switcher.
 *
 * The lit pane is one element that slides between the buttons rather than a
 * background that blinks on and off, so the move reads as one control changing
 * state instead of two controls swapping.
 */
function Switcher({ section, onGo }: { section: Section; onGo: (s: Section) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);

  // Measured rather than computed: the labels differ in length, and at the
  // widest breakpoint each also carries a hint.
  useLayoutEffect(() => {
    const place = () => {
      const host = row.current;
      const active = host?.querySelector<HTMLElement>(`[data-seg="${section}"]`);
      if (!host || !active) return;
      setThumb({ left: active.offsetLeft, width: active.offsetWidth });
    };
    place();

    const host = row.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(place);
    ro.observe(host);
    return () => ro.disconnect();
  }, [section]);

  return (
    <div className="ims-switch" role="tablist" aria-label="Studio" ref={row}>
      {thumb && <span className="ims-thumb" style={{ left: thumb.left, width: thumb.width }} aria-hidden />}
      {SECTIONS.map((s) => {
        const Glyph = Icon[s.icon];
        const on = s.id === section;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            data-seg={s.id}
            aria-selected={on}
            aria-current={on}
            className="ims-seg"
            onClick={() => onGo(s.id)}
          >
            <Glyph width={14} height={14} aria-hidden />
            <span className="ims-seg-l">{s.label}</span>
            <span className="ims-seg-h">{s.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Shaped like the studio it stands in for, so the page does not jump. */
function StudioSkeleton({ kind }: { kind: Section }) {
  const rows = kind === "library" ? 10 : 4;
  return (
    <div style={{ padding: "18px 16px" }} aria-busy="true" aria-label="Loading the studio">
      <div style={{ height: 40, borderRadius: "var(--ims-r)", background: "var(--ims-panel)", border: "1px solid var(--ims-line)" }} />
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gap: 8,
          gridTemplateColumns: kind === "library" ? "1fr" : "repeat(auto-fill,minmax(230px,1fr))",
        }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            style={{
              height: kind === "library" ? 44 : 150,
              borderRadius: "var(--ims-r)",
              background: "var(--ims-panel)",
              // The stagger keeps a wall of identical blocks from reading as a
              // frozen page.
              opacity: 1 - i * 0.07,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write the stylesheet**

Create `src/components/image-studio/image-studio.css`. Keep it to the shell's own tokens; the
studios use the hub's Tailwind classes as they already do.

```css
/* ---------------------------------------------------------------------------
   Image Studio shell. One place for the tokens the three studios share.
   --------------------------------------------------------------------------- */

.ims {
  --ims-r: 12px;
  --ims-panel: color-mix(in oklab, var(--color-panel) 92%, transparent);
  --ims-line: var(--color-line);
  --ims-ink: var(--color-ink);
  --ims-muted: var(--color-ink-muted);
  min-height: 100dvh;
  background: var(--color-bg);
}

.ims-skip {
  position: absolute;
  left: -9999px;
}
.ims-skip:focus {
  left: 12px;
  top: 12px;
  z-index: 60;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--ims-panel);
  border: 1px solid var(--ims-line);
}

.ims-bar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--ims-line);
  background: color-mix(in oklab, var(--color-panel) 86%, transparent);
  backdrop-filter: blur(10px);
}

.ims-back,
.ims-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ims-back {
  padding: 6px 10px;
  border: 1px solid var(--ims-line);
  border-radius: 10px;
  font-size: 12px;
  color: var(--ims-muted);
  transition: background 0.18s ease, color 0.18s ease;
}
.ims-back:hover {
  background: var(--color-panel-2);
  color: var(--ims-ink);
}

.ims-mark {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  color: var(--ims-ink);
  background: linear-gradient(135deg, hsl(265 70% 55% / 0.3), hsl(190 65% 45% / 0.14));
  border: 1px solid var(--ims-line);
}

.ims-brand-t {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
}
.ims-brand-n {
  font-size: 13px;
  font-weight: 650;
  color: var(--ims-ink);
}
.ims-brand-n em {
  font-style: normal;
  color: var(--ims-muted);
}
.ims-brand-s {
  font-size: 11px;
  color: var(--color-ink-faint);
}

.ims-switch {
  position: relative;
  margin-left: auto;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ims-line);
  border-radius: 12px;
  background: var(--color-panel-2);
}

.ims-thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  border-radius: 9px;
  background: color-mix(in oklab, var(--color-brand) 22%, transparent);
  border: 1px solid color-mix(in oklab, var(--color-brand) 45%, transparent);
  transition: left 0.28s cubic-bezier(0.22, 1, 0.36, 1), width 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

.ims-seg {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 11px;
  border-radius: 9px;
  font-size: 12px;
  color: var(--ims-muted);
  transition: color 0.18s ease;
}
.ims-seg[aria-selected="true"] {
  color: var(--ims-ink);
  font-weight: 600;
}
.ims-seg-h {
  display: none;
  color: var(--color-ink-faint);
  font-size: 11px;
}
@media (min-width: 1100px) {
  .ims-seg-h {
    display: inline;
  }
}

.ims-stage {
  min-height: calc(100dvh - 50px);
}

@media (prefers-reduced-motion: reduce) {
  .ims-thumb {
    transition: none;
  }
}
```

- [ ] **Step 4: Make the page validate `?section=`**

Replace `src/app/apps/image-studio/page.tsx` entirely:

```tsx
import { ImageStudioShell } from "@/components/image-studio/ImageStudioShell";
import { isSection } from "@/lib/image-studio/sections";

export const metadata = {
  title: "Image Studio · Ultimate Assistant OS",
  description:
    "Three studios: Generate with a specialist agent, name the look of any image in the Vibe Lab, and browse every vibe the Lab has named.",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  return <ImageStudioShell initialSection={isSection(section) ? section : null} />;
}
```

- [ ] **Step 5: Make the Generate studio embeddable**

In `src/components/image-studio/ImageStudio.tsx`, change the signature and drop its header when the
shell draws one. Replace the function signature line:

```tsx
export function ImageStudio() {
```

with:

```tsx
export function ImageStudio({ embedded = false }: { embedded?: boolean } = {}) {
```

Then replace the whole `<header>…</header>` block (currently `ImageStudio.tsx:195-215`, the element
beginning `<header className="sticky top-0 z-30 …">`) with:

```tsx
      {!embedded && (
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
          <Link
            href="/apps/jarvis#plugins"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink"
          >
            <Icon.ArrowLeft width={13} height={13} />
            App plugins
          </Link>
          <span className="text-sm font-semibold text-ink">Image Studio</span>
          <span className="ml-auto text-xs text-ink-faint">
            {running ? `Generating ${running}…` : `${items.length} image${items.length === 1 ? "" : "s"}`}
          </span>
        </header>
      )}
```

Note the two changes inside it: the link now goes to `/apps/jarvis#plugins` rather than `/`, and the
label matches, because the hub grid does not list this app.

Also change the root element's class so the shell is not double-counting viewport height. Replace:

```tsx
    <div className="min-h-dvh">
```

with:

```tsx
    <div className={embedded ? "" : "min-h-dvh"}>
```

- [ ] **Step 6: Stub the two new studios so the shell compiles**

The shell imports studios that Tasks 13 and 14 build. Create them as honest placeholders now, so
this task can be verified and committed on its own.

Create `src/components/image-studio/vibe-lab/VibeLab.tsx`:

```tsx
"use client";

export function VibeLab({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className="p-6 text-sm text-ink-muted" data-embedded={embedded}>
      The Vibe Lab is being built.
    </div>
  );
}
```

Create `src/components/image-studio/vibe-library/VibeLibrary.tsx`:

```tsx
"use client";

export function VibeLibrary({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className="p-6 text-sm text-ink-muted" data-embedded={embedded}>
      The Vibe Library is being built.
    </div>
  );
}
```

- [ ] **Step 7: Verify the shell in the browser**

Start the preview:

```bash
node scripts/dev-preview.mjs 3123 --no-auth
```

Then, using the browser tools (not by asking the owner to look):

1. `preview_start` / `navigate` to `http://localhost:3123/apps/image-studio`
2. `read_page` — confirm three tabs, and that Generate's composer and agent picker are on screen.
3. Click **Vibe Lab**, then `read_page` — confirm the placeholder, and that the URL now carries
   `?section=lab` (check with `javascript_tool`: `window.location.search`).
4. `navigate` to `http://localhost:3123/apps/image-studio?section=library` and confirm it lands in
   the Library rather than wherever step 3 left off.
5. `navigate` to `http://localhost:3123/apps/image-studio` with no query and confirm it resumes the
   Library, proving the remembered section works.
6. `read_console_messages` with `onlyErrors: true` — expect none.
7. `computer {action: "screenshot"}` for the record.

- [ ] **Step 8: Typecheck, test and commit**

```bash
npx tsc --noEmit
npx vitest run src/lib/image-studio
git add src/lib/image-studio/sections.ts src/components/image-studio/ImageStudioShell.tsx src/components/image-studio/image-studio.css src/components/image-studio/ImageStudio.tsx src/app/apps/image-studio/page.tsx src/components/image-studio/vibe-lab/VibeLab.tsx src/components/image-studio/vibe-library/VibeLibrary.tsx
git commit -m "Three studios behind one switcher, and a back link that lands where the app lives"
```

---

## Task 11: The trail reveal

**INVOKE `webgl-trail-reveal` BEFORE THIS TASK.** The mechanic has one failure mode that looks like
success — a spotlight that follows the cursor instead of a trail with memory — and the skill exists
to prevent exactly that.

Two decisions the skill forces, both already in the spec:

- **The hidden layer is always derived from the visible one.** Either the same texture graded
  in-shader (the Library) or a canvas drawn at the photo's exact pixel size (the Lab). A freshly
  generated image is never the hidden layer, because it would not align and the reveal would read
  as a photo being swapped.
- **One WebGL context for the page**, moved to whichever element is hovered. A context per table row
  passes the browser's limit inside one screenful of rows.

**Files:**
- Create: `src/components/image-studio/trail-reveal.ts`

- [ ] **Step 1: Write the renderer**

Create `src/components/image-studio/trail-reveal.ts`:

```ts
"use client";

// ---------------------------------------------------------------------------
// Image Studio — the trail reveal.
//
// Two layers in one frame. The cursor paints a TRAIL that is the reveal mask:
// a path with memory, not a circle around the current pointer. The trail holds
// for a beat after the pointer stops, then eases closed.
//
// The hidden layer is always derived from the visible one, never a second
// photograph — a misaligned pair reads as a photo being swapped rather than a
// layer being lifted. Two ways to derive it:
//
//   { kind: "texture", src }  a canvas or image at the base's exact size
//                            (the Lab's evidence annotations)
//   { kind: "grade", hue }    the same texture put through the vibe's own
//                            grade in-shader (the Library's covers)
//
// ONE context for the whole page, attached to whichever element is hovered.
// A context per card passes the browser's limit inside one screenful.
// ---------------------------------------------------------------------------

const TRAIL_N = 24;
/** Seconds a point takes to age out of the trail. */
const HOLD = 0.6;
/** Minimum uv distance before a new point is pushed, so idling cannot flood it. */
const STEP = 0.012;

export type RevealLayer =
  | { kind: "texture"; src: TexImageSource }
  | { kind: "grade"; hue: [number, number] };

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vUv.y = 1.0 - vUv.y;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uBase;
uniform sampler2D uReveal;
uniform vec2  uTrailPos[${TRAIL_N}];
uniform float uTrailAge[${TRAIL_N}];
uniform float uAspect;
uniform float uTime;
uniform float uMode;       // 0 = second texture, 1 = in-shader grade
uniform vec3  uHueA;
uniform vec3  uHueB;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

// The trail. Every point ages independently, so the tail fades before the
// head and the shape reads as a stroke rather than a blob.
float trailMask(vec2 uv) {
  float m = 0.0;
  for (int i = 0; i < ${TRAIL_N}; i++) {
    float age = uTrailAge[i];
    if (age >= 1.0) continue;
    vec2 d = uv - uTrailPos[i];
    d.x *= uAspect;                       // keeps the trail round at any aspect
    float radius = mix(0.095, 0.022, age); // head fat, tail tapered
    float falloff = 1.0 - smoothstep(radius * 0.4, radius, length(d));
    m = max(m, falloff * (1.0 - age));
  }
  return clamp(m, 0.0, 1.0);
}

// The vibe's own look, applied to the base: luma remapped between its two
// hues, with a little grain. Same pixels, so it stays aligned by construction.
vec3 grade(vec3 base, vec2 uv) {
  float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
  vec3 toned = mix(uHueA, uHueB, smoothstep(0.1, 0.9, luma));
  vec3 out3 = mix(base, toned * (0.55 + luma * 0.75), 0.62);
  float grain = (hash(uv * 900.0 + uTime) - 0.5) * 0.06;
  return clamp(out3 + grain, 0.0, 1.0);
}

void main() {
  vec3 base = texture2D(uBase, vUv).rgb;
  float mask = trailMask(vUv);

  // Peaks at the boundary and is zero on both sides of it, which is what keeps
  // the distortion a thin band instead of a wash over the whole reveal.
  float edge = 4.0 * mask * (1.0 - mask);

  vec2 jitter = (vec2(fbm(vUv * 40.0 + uTime), fbm(vUv * 40.0 - uTime)) - 0.5) * 0.006 * edge;

  vec3 hidden;
  if (uMode < 0.5) {
    float split = 0.003 * edge;
    vec3 r = texture2D(uReveal, vUv + jitter + vec2(split, 0.0)).rgb;
    vec3 g = texture2D(uReveal, vUv + jitter).rgb;
    vec3 b = texture2D(uReveal, vUv + jitter - vec2(split, 0.0)).rgb;
    hidden = vec3(r.r, g.g, b.b);
  } else {
    hidden = grade(texture2D(uBase, vUv + jitter).rgb, vUv);
  }

  vec3 result = mix(base, hidden, smoothstep(0.0, 1.0, mask));
  result += vec3(1.0, 0.82, 0.55) * edge * 0.22;  // a thin rim, not a glow
  gl_FragColor = vec4(result, 1.0);
}`;

interface Attached {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  base: WebGLTexture;
  reveal: WebGLTexture;
  mode: number;
  hue: [number, number];
}

interface Point {
  x: number;
  y: number;
  age: number;
}

/**
 * The page's single renderer.
 *
 * Created on first use and kept for the life of the page. `attach` moves it
 * into an element; `detach` parks it. Losing the context (a background tab
 * reclaimed by the GPU) marks it dead and every later attach declines, so the
 * caller falls back to CSS rather than drawing nothing.
 */
class TrailReveal {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private current: Attached | null = null;
  private points: Point[] = [];
  private raf = 0;
  private last = 0;
  private dead = false;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  /** True when WebGL is usable here at all. */
  available(): boolean {
    if (this.dead) return false;
    if (this.gl) return true;
    return this.init();
  }

  private init(): boolean {
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false }) as
        | WebGLRenderingContext
        | null) ?? null;
    if (!gl) {
      this.dead = true;
      return false;
    }
    const program = buildProgram(gl);
    if (!program) {
      this.dead = true;
      return false;
    }

    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.dead = true;
      this.stop();
    });

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);

    for (const name of ["uBase", "uReveal", "uTrailPos", "uTrailAge", "uAspect", "uTime", "uMode", "uHueA", "uHueB"]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform1i(this.uniforms.uBase, 0);
    gl.uniform1i(this.uniforms.uReveal, 1);

    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    return true;
  }

  /**
   * Moves the renderer into `host` and starts drawing.
   *
   * @returns false when WebGL is unusable, so the caller can fall back to a
   *   CSS crossfade instead of showing an empty box.
   */
  attach(host: HTMLElement, base: TexImageSource, layer: RevealLayer): boolean {
    if (!this.available() || !this.gl || !this.canvas) return false;
    const gl = this.gl;

    this.detach();

    const baseTex = makeTexture(gl, base);
    const revealTex =
      layer.kind === "texture" ? makeTexture(gl, layer.src) : makeTexture(gl, base);
    if (!baseTex || !revealTex) return false;

    host.appendChild(this.canvas);
    this.current = {
      host,
      canvas: this.canvas,
      base: baseTex,
      reveal: revealTex,
      mode: layer.kind === "grade" ? 1 : 0,
      hue: layer.kind === "grade" ? layer.hue : [0, 0],
    };
    this.points = [];
    this.last = performance.now();
    this.loop();
    return true;
  }

  /** Pointer position in the host's own box, 0-1. */
  move(uv: { x: number; y: number }): void {
    const head = this.points[this.points.length - 1];
    if (head && Math.hypot(head.x - uv.x, head.y - uv.y) < STEP) return;
    this.points.push({ x: uv.x, y: uv.y, age: 0 });
    if (this.points.length > TRAIL_N) this.points.shift();
  }

  detach(): void {
    this.stop();
    const gl = this.gl;
    if (this.current && gl) {
      gl.deleteTexture(this.current.base);
      if (this.current.mode === 0) gl.deleteTexture(this.current.reveal);
      this.current.canvas.remove();
    }
    this.current = null;
    this.points = [];
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private loop = (): void => {
    const gl = this.gl;
    const at = this.current;
    if (!gl || !at) return;

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    // Every point ages on its own clock, which is what makes the tail fade
    // before the head and the trail close from behind.
    for (const p of this.points) p.age += dt / HOLD;
    this.points = this.points.filter((p) => p.age < 1);

    const rect = at.host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (at.canvas.width !== w || at.canvas.height !== h) {
      at.canvas.width = w;
      at.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);

    const pos = new Float32Array(TRAIL_N * 2);
    const age = new Float32Array(TRAIL_N).fill(1);
    this.points.forEach((p, i) => {
      pos[i * 2] = p.x;
      pos[i * 2 + 1] = p.y;
      age[i] = p.age;
    });

    gl.uniform2fv(this.uniforms.uTrailPos, pos);
    gl.uniform1fv(this.uniforms.uTrailAge, age);
    gl.uniform1f(this.uniforms.uAspect, rect.width / Math.max(1, rect.height));
    gl.uniform1f(this.uniforms.uTime, (now % 100000) / 1000);
    gl.uniform1f(this.uniforms.uMode, at.mode);
    gl.uniform3fv(this.uniforms.uHueA, hueToRgb(at.hue[0]));
    gl.uniform3fv(this.uniforms.uHueB, hueToRgb(at.hue[1]));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, at.base);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, at.reveal);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this.raf = requestAnimationFrame(this.loop);
  };
}

function buildProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error("[image-studio] shader:", gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("[image-studio] link:", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function makeTexture(gl: WebGLRenderingContext, src: TexImageSource): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // CLAMP_TO_EDGE and LINEAR, with no mipmaps: the sources are arbitrary sizes
  // and a non-power-of-two texture with mipmaps renders black on WebGL 1.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  } catch {
    gl.deleteTexture(tex);
    return null;
  }
  return tex;
}

/** A hue 0-360 as a saturated rgb triple, for the grade's two ends. */
export function hueToRgb(hue: number): Float32Array {
  const h = (((hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const table: [number, number, number][] = [
    [1, x, 0],
    [x, 1, 0],
    [0, 1, x],
    [0, x, 1],
    [x, 0, 1],
    [1, 0, x],
  ];
  const [r, g, b] = table[Math.floor(h) % 6];
  return new Float32Array([r, g, b]);
}

let shared: TrailReveal | null = null;

/** The page's one renderer. */
export function trailReveal(): TrailReveal {
  if (!shared) shared = new TrailReveal();
  return shared;
}

/** True when the visitor asked for less movement. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/image-studio/trail-reveal.ts
git commit -m "Trail reveal: a stroke with memory, one context for the page, hidden layer always derived"
```

The mechanic is verified in the browser in Task 14, once there are covers to hover.

---

## Task 12: The keyless read

With no API key the Lab still has to answer, and the answer has to be visibly a guess from pixels
rather than a model pretending. This runs in the browser, where there is a canvas.

**Files:**
- Create: `src/components/image-studio/vibe-lab/offline-read.ts`
- Test: `src/components/image-studio/vibe-lab/offline-read.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/components/image-studio/vibe-lab/offline-read.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MIN_VIBE_WORDS, validateVerdict, wordCount } from "@/lib/image-studio/vibes";
import { offlineVerdict, readPixels } from "./offline-read";

/** A flat field of one colour, as ImageData would arrive from a canvas. */
function flat(r: number, g: number, b: number, w = 8, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

/** Hard vertical stripes — high edge density, like line art. */
function stripes(w = 8, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = x % 2 === 0 ? 0 : 255;
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("readPixels", () => {
  it("reports the dominant colour of a flat field", () => {
    const stats = readPixels(flat(200, 40, 40));
    expect(stats.palette[0]).toBe("#c82828");
  });

  it("reports near-zero saturation for grey", () => {
    expect(readPixels(flat(128, 128, 128)).saturation).toBeLessThan(0.05);
  });

  it("reports high saturation for a pure hue", () => {
    expect(readPixels(flat(255, 0, 0)).saturation).toBeGreaterThan(0.9);
  });

  it("reports low edge density for a flat field", () => {
    expect(readPixels(flat(90, 90, 90)).edges).toBeLessThan(0.05);
  });

  it("reports high edge density for hard stripes", () => {
    expect(readPixels(stripes()).edges).toBeGreaterThan(0.5);
  });
});

describe("offlineVerdict", () => {
  it("produces a verdict that passes the real validator", () => {
    const v = offlineVerdict(readPixels(stripes()), []);
    const checked = validateVerdict(v, []);
    if (typeof checked === "string") throw new Error(checked);
    expect(checked.problems).toEqual([]);
  });

  it("never answers with a label, even offline", () => {
    for (const img of [flat(255, 0, 0), flat(128, 128, 128), stripes()]) {
      const v = offlineVerdict(readPixels(img), []);
      expect(wordCount(v.ladder.vibe)).toBeGreaterThanOrEqual(MIN_VIBE_WORDS);
    }
  });

  it("calls a hard-edged saturated image illustration rather than photography", () => {
    expect(offlineVerdict(readPixels(stripes()), []).ladder.family).toBe("illustration");
  });

  it("says in the verdict that it could not see properly", () => {
    const v = offlineVerdict(readPixels(flat(90, 90, 90)), []);
    expect(v.lora.why.toLowerCase()).toContain("no ai key");
  });

  it("never claims a match, because a pixel guess must not join someone else's vibe", () => {
    expect(offlineVerdict(readPixels(flat(90, 90, 90)), ["nostalgia"]).match).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/image-studio/vibe-lab/offline-read.test.ts`
Expected: FAIL — `Failed to resolve import "./offline-read"`.

- [ ] **Step 3: Write the heuristic**

Create `src/components/image-studio/vibe-lab/offline-read.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — the read with no key.
//
// Three numbers off the pixels — the dominant colours, how saturated they are,
// how hard the edges are — are enough to tell a flat illustration from a
// photograph and to fill a verdict that is honest about being a guess. It goes
// through the same validator as a real read, including the word floor, because
// an offline answer of "cartoon" is the exact failure this app exists to stop.
//
// It never claims a match. A guess from pixels must not quietly file someone's
// image under an existing vibe.
//
// Takes a plain {data,width,height} rather than an ImageData instance, so it
// can be tested without a canvas.
// ---------------------------------------------------------------------------

import type { VibeVerdict } from "@/lib/image-studio/vibes";

export interface PixelStats {
  /** Up to 4 dominant colours as #rrggbb, most common first. */
  palette: string[];
  /** 0-1, mean saturation. */
  saturation: number;
  /** 0-1, mean brightness. */
  brightness: number;
  /** 0-1, share of neighbouring pixels differing sharply. */
  edges: number;
}

export interface PixelSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const hex = (n: number) => n.toString(16).padStart(2, "0");

export function readPixels(img: PixelSource): PixelStats {
  const { data, width, height } = img;
  // Quantised to 4 bits a channel so near-identical pixels count as one
  // colour; a photograph has thousands of unique values and no dominant one
  // without this.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let satSum = 0;
  let brightSum = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (data[i + 3] < 8) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    satSum += max === 0 ? 0 : (max - min) / max;
    brightSum += max / 255;
    count++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.n++;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }

  const palette = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((c) => `#${hex(Math.round(c.r / c.n))}${hex(Math.round(c.g / c.n))}${hex(Math.round(c.b / c.n))}`);

  // Horizontal neighbours only. A second axis would double the cost and
  // change nothing a decision this coarse depends on.
  let hard = 0;
  let pairs = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 1; x < width; x++) {
      const i = (y * width + x) * 4;
      const j = (y * width + x - 1) * 4;
      const d =
        Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]);
      if (d > 150) hard++;
      pairs++;
    }
  }

  return {
    palette,
    saturation: count ? satSum / count : 0,
    brightness: count ? brightSum / count : 0,
    edges: pairs ? hard / pairs : 0,
  };
}

/**
 * A complete verdict from the pixels alone.
 *
 * @param candidateIds Taken so the signature matches the online path. It is
 *   deliberately unused: see the note above about never claiming a match.
 */
export function offlineVerdict(stats: PixelStats, candidateIds: string[]): VibeVerdict {
  void candidateIds;

  const flatAndHard = stats.edges > 0.25 && stats.saturation > 0.3;
  const family = flatAndHard ? "illustration" : "photography";
  const light = stats.brightness > 0.62 ? "bright, open light" : stats.brightness < 0.3 ? "low, heavy shadow" : "even mid light";
  const colour = stats.saturation > 0.45 ? "strongly saturated" : stats.saturation < 0.12 ? "nearly colourless" : "muted";

  return {
    ladder: {
      family,
      style: flatAndHard ? "flat graphic artwork" : "photographic capture",
      // Always a sentence, never a label — the same rule the model is held to.
      vibe: `a ${colour} ${family} in ${light}, read from its pixels rather than understood`,
    },
    confidence: { family: 0.45, style: 0.3, vibe: 0.15 },
    rivals: [
      {
        label: flatAndHard ? "a photograph of flat artwork" : "a render pretending to be a photograph",
        depth: "family",
        confidence: 0.25,
        why: "nothing here can tell those apart without a model looking at it",
      },
    ],
    evidence: {
      palette: stats.palette,
      grain: "not measured without a model",
      lighting: light,
      era: "no era cues — nothing read the contents of this image",
      framing: "not measured without a model",
      subject: "not identified without a model",
    },
    match: null,
    proposal: {
      name: flatAndHard ? "Unnamed Flat Graphic" : "Unnamed Photographic Look",
      slug: flatAndHard ? "unnamed-flat-graphic" : "unnamed-photographic-look",
      icon: "◐",
      brief:
        "This vibe was named with no AI key configured, from colour and edge statistics only. " +
        "Read the image again with a key set before generating from it.",
      styleBlock: `${colour} palette, ${light}, ${flatAndHard ? "hard flat edges" : "photographic falloff"}`,
      aspect: "portrait",
      hue: [210, 280],
    },
    lora: {
      verdict: "borderline",
      why: "No AI key is configured, so this is a guess from colour and edges — nothing looked at the picture.",
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/image-studio/vibe-lab/offline-read.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/image-studio/vibe-lab/offline-read.ts src/components/image-studio/vibe-lab/offline-read.test.ts
git commit -m "Keyless read: a guess from pixels, held to the same word floor and never claiming a match"
```

---

## Task 13: The reveal stage and the evidence layer

One component wraps the renderer from Task 11, because both the Lab and the Library need the same
three things: attach on enter, feed pointer positions, fall back to CSS when WebGL or the visitor
says no.

**Files:**
- Create: `src/components/image-studio/RevealStage.tsx`
- Create: `src/components/image-studio/vibe-lab/evidence-layer.ts`

(Add both to the file-structure table at the top of this plan when you touch it — `RevealStage` is
shared by the two new studios, so it sits beside `trail-reveal.ts` rather than inside either.)

- [ ] **Step 1: Write the stage**

Create `src/components/image-studio/RevealStage.tsx`:

```tsx
"use client";

// ---------------------------------------------------------------------------
// Image Studio — the frame a trail reveal happens in.
//
// Owns the three things both studios need and neither should repeat: putting
// the shared renderer into this element on enter, feeding it pointer positions
// in this element's own coordinates, and taking it out again on leave.
//
// The fallback is a plain CSS crossfade on hover, used when WebGL is missing,
// when the context has been lost, and when the visitor asked for less
// movement. It is the same two layers either way, so nothing disappears — the
// reveal just stops being a stroke and becomes a fade.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion, trailReveal, type RevealLayer } from "./trail-reveal";

export function RevealStage({
  base,
  layer,
  alt,
  className = "",
}: {
  /** The visible image. Must be loaded before the stage can attach. */
  base: string;
  /** How the hidden layer is derived — never a second photograph. */
  layer: RevealLayer;
  alt: string;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [live, setLive] = useState(false);
  const [calm, setCalm] = useState(true);

  useEffect(() => setCalm(prefersReducedMotion()), []);

  // Leaving the element must always release the renderer, including when the
  // component unmounts mid-hover — otherwise the canvas stays in a detached
  // node and the page's one context is held by nothing.
  useEffect(() => {
    return () => {
      if (live) trailReveal().detach();
    };
  }, [live]);

  const enter = () => {
    if (calm || !host.current || !img.current?.complete) return;
    const ok = trailReveal().attach(host.current, img.current, layer);
    setLive(ok);
  };

  const leave = () => {
    if (!live) return;
    trailReveal().detach();
    setLive(false);
  };

  const move = (e: React.PointerEvent) => {
    if (!live || !host.current) return;
    const r = host.current.getBoundingClientRect();
    trailReveal().move({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <div
      ref={host}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onPointerMove={move}
      className={`relative overflow-hidden ${className}`}
      // The canvas sits on top when live; the img underneath is what it is
      // drawn from, so it must stay in the DOM rather than being swapped out.
      data-reveal={live ? "live" : calm ? "calm" : "idle"}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src={base}
        alt={alt}
        crossOrigin="anonymous"
        className="block h-full w-full object-cover"
        style={{ opacity: live ? 0 : 1 }}
      />
      {/* The calm path: the hidden layer fades in on hover instead of being
          painted. Only rendered when it is the path being used. */}
      {calm && layer.kind === "texture" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={typeof layer.src === "string" ? layer.src : ""}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 hover:opacity-100"
        />
      )}
    </div>
  );
}
```

Note: `layer.src` for the calm path must be a URL string. Where the caller has a canvas, pass
`canvas.toDataURL()` for the calm fallback and the canvas itself for the live path — see the Lab's
use in Task 14.

- [ ] **Step 2: Write the evidence layer**

Create `src/components/image-studio/vibe-lab/evidence-layer.ts`:

```ts
"use client";

// ---------------------------------------------------------------------------
// Image Studio — the model's read, drawn over the photograph.
//
// This is the hidden layer in the Lab. It is a canvas at the photo's EXACT
// natural size, because the reveal only reads as a layer being lifted if the
// two are pixel-aligned — anything else reads as a photo being swapped.
//
// What it draws is what the model said it saw: the palette it pulled, and the
// lighting, era, grain, framing and subject in its own words. Hovering is
// therefore how you check whether its evidence matches the picture, which is
// what you need before deciding whether to argue with it.
// ---------------------------------------------------------------------------

import type { VibeEvidence } from "@/lib/image-studio/vibes";

export function drawEvidenceLayer(source: HTMLImageElement, ev: VibeEvidence): HTMLCanvasElement {
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  // Scale every size off the image's own width, so the annotation reads the
  // same on a 600px thumbnail and a 3000px photo.
  const u = w / 100;

  ctx.drawImage(source, 0, 0, w, h);
  ctx.fillStyle = "rgba(6,8,14,0.72)";
  ctx.fillRect(0, 0, w, h);

  // A measuring grid — this is a read, so it should look like one.
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = Math.max(1, u * 0.08);
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo((w / 3) * i, 0);
    ctx.lineTo((w / 3) * i, h);
    ctx.moveTo(0, (h / 3) * i);
    ctx.lineTo(w, (h / 3) * i);
    ctx.stroke();
  }

  // The palette, as a strip of real swatches along the bottom.
  const swatches = ev.palette.slice(0, 8);
  if (swatches.length) {
    const sw = w / swatches.length;
    const sh = u * 7;
    swatches.forEach((hex, i) => {
      ctx.fillStyle = hex;
      ctx.fillRect(i * sw, h - sh, sw, sh);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `${u * 1.9}px ui-monospace, monospace`;
      ctx.textBaseline = "middle";
      ctx.fillText(hex, i * sw + u * 1.2, h - sh / 2);
    });
  }

  // The words, stacked top-left. Only the fields that came back filled.
  const lines: [string, string][] = [
    ["LIGHT", ev.lighting],
    ["ERA", ev.era],
    ["GRAIN", ev.grain],
    ["FRAME", ev.framing],
    ["SUBJECT", ev.subject],
  ].filter((pair): pair is [string, string] => Boolean(pair[1]));

  let y = u * 8;
  for (const [label, value] of lines) {
    ctx.font = `600 ${u * 2.1}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.textBaseline = "top";
    ctx.fillText(label, u * 5, y);

    ctx.font = `${u * 2.6}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    y = wrap(ctx, value, u * 5, y + u * 3, w - u * 10, u * 3.4);
    y += u * 3;
  }

  return canvas;
}

/** Draws wrapped text and returns the y it finished on. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): number {
  let line = "";
  let cursor = y;
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, cursor);
      cursor += lineHeight;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/image-studio/RevealStage.tsx src/components/image-studio/vibe-lab/evidence-layer.ts
git commit -m "The reveal stage, and the model's own evidence as the layer underneath"
```

---

## Task 14: The Vibe Lab

**Files:**
- Create: `src/components/image-studio/vibeApi.ts`
- Create: `src/components/image-studio/vibe-lab/LadderCard.tsx`
- Create: `src/components/image-studio/vibe-lab/ArgumentChat.tsx`
- Modify: `src/components/image-studio/vibe-lab/VibeLab.tsx` (replacing Task 10's placeholder)

- [ ] **Step 1: Write the client API**

Create `src/components/image-studio/vibeApi.ts`:

```ts
"use client";

import type {
  Vibe,
  VibeCandidate,
  VibeLadder,
  VibeProposal,
  VibeVerdict,
  VerdictProblem,
} from "@/lib/image-studio/vibes";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    if (res.status === 413) throw new Error("That image is too large. Try a smaller one.");
    throw new Error(`The server answered ${res.status} with something unreadable.`);
  }
  // A refusal arrives with 200 and an `error`, because it is an answer rather
  // than a failure — the caller shows it differently, so it must not throw.
  if (json.refused) return json as T;
  if (!res.ok || typeof json.error === "string") {
    throw new Error(String(json.error ?? `Request failed (${res.status}).`));
  }
  return json as T;
}

function post<T>(url: string, body: unknown, signal?: AbortSignal) {
  return req<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export interface ReadResult {
  verdict?: VibeVerdict;
  problems?: VerdictProblem[];
  candidates: VibeCandidate[];
  stored: boolean;
  offline?: boolean;
  refused?: boolean;
  error?: string;
}

export function readVibe(
  body: { image: string; steer?: string; turns?: { role: "user" | "assistant"; text: string }[] },
  signal?: AbortSignal,
) {
  return post<ReadResult>("/api/image-studio/vibe", body, signal);
}

export function fetchVibes() {
  return req<{ vibes: Vibe[]; stored: boolean }>("/api/image-studio/vibes");
}

export function fetchSamples(vibeId: string) {
  return req<{ samples: { storagePath: string; caption: string }[] }>(
    `/api/image-studio/vibes?samples=${encodeURIComponent(vibeId)}`,
  );
}

export function saveVibe(body: {
  image: string;
  caption: string;
  ladder: VibeLadder;
  match?: string;
  proposal?: VibeProposal | null;
}) {
  return post<{ vibe: Vibe; datasetCount: number; warning?: string }>("/api/image-studio/vibes", body);
}
```

- [ ] **Step 2: Write the ladder card**

Create `src/components/image-studio/vibe-lab/LadderCard.tsx`:

```tsx
"use client";

// ---------------------------------------------------------------------------
// The verdict, as one card.
//
// Three rungs coarse to specific, because the complaint this app answers is a
// model that says "cartoon" and stops. The rungs are stacked rather than
// side by side so reading downward is reading into the image.
//
// A rival is a button. Clicking it is the fastest way to argue, and the reason
// the rivals carry their rejection reason is that you cannot judge whether to
// promote one without knowing why it lost.
// ---------------------------------------------------------------------------

import { TRAINABLE_AT, datasetProgress, type Vibe, type VibeCandidate, type VibeVerdict, type VerdictProblem } from "@/lib/image-studio/vibes";

const VERDICT_COPY: Record<VibeVerdict["lora"]["verdict"], string> = {
  distinctive: "Its own thing",
  borderline: "Borderline",
  generic: "Not its own thing",
};

export function LadderCard({
  verdict,
  problems,
  candidates,
  matched,
  offline,
  saving,
  savedVibe,
  onRival,
  onSave,
}: {
  verdict: VibeVerdict;
  problems: VerdictProblem[];
  candidates: VibeCandidate[];
  /** The library row this matched, when it matched one. */
  matched: VibeCandidate | null;
  offline: boolean;
  saving: boolean;
  savedVibe: Vibe | null;
  onRival: (label: string) => void;
  onSave: () => void;
}) {
  const { ladder, confidence, rivals, evidence, lora } = verdict;
  const progress = datasetProgress(savedVibe?.datasetCount ?? 0);

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      {offline && (
        <p className="mb-3 rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11px] text-ink-muted">
          No AI key is configured, so this is a guess from colour and edges — nothing looked at the
          picture. Add <code>OPENROUTER_API_KEY</code> for a real read.
        </p>
      )}

      {problems.map((p) => (
        <p key={p.field} className="mb-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          {p.message}
        </p>
      ))}

      <ol className="space-y-2">
        {([
          ["Family", ladder.family, confidence.family],
          ["Style", ladder.style, confidence.style],
          ["Vibe", ladder.vibe, confidence.vibe],
        ] as const).map(([label, value, conf], i) => (
          <li key={label} className="rounded-xl border border-line bg-panel-2 p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">{label}</span>
              <span className="shrink-0 font-mono text-[10px] text-ink-faint">{Math.round(conf * 100)}%</span>
            </div>
            <p className={i === 2 ? "mt-1 text-[15px] leading-snug text-ink" : "mt-0.5 text-sm font-medium text-ink"}>
              {value}
            </p>
            <div className="mt-2 h-0.5 overflow-hidden rounded bg-line">
              <div className="h-full rounded bg-[var(--color-brand)]" style={{ width: `${Math.round(conf * 100)}%` }} />
            </div>
          </li>
        ))}
      </ol>

      {rivals.length > 0 && (
        <div className="mt-3">
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            Considered and rejected
          </h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {rivals.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => onRival(r.label)}
                title={`${r.why} — click to argue for this`}
                className="rounded-lg border border-line px-2.5 py-1.5 text-left text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
              >
                <span className="font-medium">{r.label}</span>
                <span className="ml-1.5 font-mono text-[10px] text-ink-faint">{Math.round(r.confidence * 100)}%</span>
                <span className="mt-0.5 block text-[10px] text-ink-faint">{r.why}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <details className="mt-3 rounded-xl border border-line bg-panel-2 p-3">
        <summary className="cursor-pointer text-[11px] font-medium text-ink-muted">
          What it says it saw
        </summary>
        {evidence.palette.length > 0 && (
          <div className="mt-2 flex gap-1">
            {evidence.palette.map((hex) => (
              <span key={hex} title={hex} className="h-6 flex-1 rounded border border-line" style={{ background: hex }} />
            ))}
          </div>
        )}
        <dl className="mt-2 grid gap-1.5 text-[11px]">
          {([
            ["Lighting", evidence.lighting],
            ["Era cues", evidence.era],
            ["Grain", evidence.grain],
            ["Framing", evidence.framing],
            ["Subject", evidence.subject],
          ] as const)
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="grid grid-cols-[72px_1fr] gap-2">
                <dt className="text-ink-faint">{k}</dt>
                <dd className="text-ink-muted">{v}</dd>
              </div>
            ))}
        </dl>
      </details>

      <div className="mt-3 rounded-xl border border-line bg-panel-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-ink">{VERDICT_COPY[lora.verdict]}</span>
          {matched ? (
            <span className="text-[10px] text-ink-faint">
              matches <strong className="text-ink-muted">{matched.name}</strong>
            </span>
          ) : (
            <span className="text-[10px] text-ink-faint">
              new — {verdict.proposal?.name ?? "unnamed"}
            </span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-ink-muted">{lora.why}</p>

        {savedVibe ? (
          <p className="mt-2 text-[11px] text-ink-muted">
            {progress.trainable
              ? `Usable as an agent now · ${progress.count} images — enough for a trainable set.`
              : `Usable as an agent now · ${progress.count}/${TRAINABLE_AT} images toward a trainable set.`}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">
            Saving files this image as its first example and makes the vibe generatable.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={saving || Boolean(savedVibe)}
        className="mt-3 w-full rounded-xl bg-[var(--color-brand)] px-3 py-2.5 text-[13px] font-semibold text-white transition disabled:opacity-50"
      >
        {savedVibe
          ? `Saved as ${savedVibe.name}`
          : saving
            ? "Saving…"
            : matched
              ? `File this under ${matched.name}`
              : `Save “${verdict.proposal?.name ?? "this vibe"}” to the library`}
      </button>
      <p className="mt-1.5 text-center text-[10px] text-ink-faint">
        {candidates.length} vibes in the library it checked against
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Write the argument chat**

Create `src/components/image-studio/vibe-lab/ArgumentChat.tsx`:

```tsx
"use client";

// ---------------------------------------------------------------------------
// The argument.
//
// The transcript is a log of the disagreement, not the answer — the answer is
// always the card beside it, rewritten in place. That is why an assistant turn
// shows the rung it landed on rather than its JSON: the JSON is what went back
// to the model, and showing it here would make the card and the chat compete
// to be the truth.
//
// Version pips walk back to an earlier read, because the model's second guess
// is sometimes the one that was right.
// ---------------------------------------------------------------------------

import { useState } from "react";

export interface ChatEntry {
  role: "user" | "assistant";
  /** What to show. For an assistant turn, the rung it landed on. */
  display: string;
  /** Which saved version this turn produced, for the pips. */
  version?: number;
}

const QUICK = [
  "That's not what I mean — be more specific about the medium.",
  "Look at the lighting, not the subject.",
  "You're one level too broad. Go deeper.",
];

export function ArgumentChat({
  entries,
  busy,
  versionCount,
  activeVersion,
  onSend,
  onVersion,
}: {
  entries: ChatEntry[];
  busy: boolean;
  versionCount: number;
  activeVersion: number;
  onSend: (text: string) => void;
  onVersion: (index: number) => void;
}) {
  const [text, setText] = useState("");

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <section className="flex min-h-[320px] flex-col rounded-2xl border border-line bg-panel">
      <header className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Tell it where it&apos;s wrong
        </h2>
        {versionCount > 1 && (
          <div className="flex items-center gap-1" role="group" aria-label="Earlier reads">
            {Array.from({ length: versionCount }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onVersion(i)}
                aria-label={`Read ${i + 1} of ${versionCount}`}
                aria-current={i === activeVersion}
                className={`h-2 w-2 rounded-full transition ${
                  i === activeVersion ? "bg-[var(--color-brand)]" : "bg-line hover:bg-ink-faint"
                }`}
              />
            ))}
          </div>
        )}
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
        {entries.length === 0 && (
          <p className="text-[11px] leading-relaxed text-ink-faint">
            It reads the image cold, then you correct it. &ldquo;No, more Ghibli than cartoon.&rdquo;
            &ldquo;That&apos;s a VHS still, not film.&rdquo; Every reply rewrites the card.
          </p>
        )}
        {entries.map((e, i) => (
          <p
            key={i}
            className={
              e.role === "user"
                ? "ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-[var(--color-brand)]/18 px-3 py-2 text-[12px] text-ink"
                : "max-w-[85%] rounded-xl rounded-bl-sm border border-line bg-panel-2 px-3 py-2 text-[12px] text-ink-muted"
            }
          >
            {e.role === "assistant" && (
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-ink-faint">Re-read</span>
            )}
            {e.display}
          </p>
        ))}
        {busy && <p className="text-[11px] text-ink-faint">Looking again…</p>}
      </div>

      <div className="border-t border-line p-2.5">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              onClick={() => onSend(q)}
              className="rounded-lg border border-line px-2 py-1 text-[10px] text-ink-faint transition hover:text-ink disabled:opacity-40"
            >
              {q.split("—")[0].trim()}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="No, I meant a different kind of cartoon — anime, Ghibli-ish."
            className="flex-1 resize-none rounded-xl border border-line bg-panel-2 px-3 py-2 text-[12px] text-ink placeholder:text-ink-faint"
          />
          <button
            type="button"
            onClick={send}
            disabled={busy || !text.trim()}
            className="self-end rounded-xl border border-line px-3 py-2 text-[12px] font-medium text-ink transition hover:bg-panel-2 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Write the studio**

Replace `src/components/image-studio/vibe-lab/VibeLab.tsx` entirely:

```tsx
"use client";

// ---------------------------------------------------------------------------
// Vibe Lab — give a look a name.
//
// Drop an image, optionally say what you think it is, and a vision model reads
// it at three depths. Then you argue, and every reply rewrites the card rather
// than adding to a pile of opinions: the verdict is one object, held here, and
// the chat beside it is the log of how it got there.
//
// The model never invents a category — the route only accepts an id it was
// shown — so arguing either lands on an existing vibe or mints one, and
// either way the image is filed as an example.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useRef, useState } from "react";
import { MAX_REFS } from "@/lib/image-studio/prompt";
import { downscaleToDataUrl } from "@/lib/image-studio/media";
import { isHeic, pickImageFiles } from "@/lib/image-studio/files";
import type { Vibe, VibeCandidate, VibeVerdict, VerdictProblem } from "@/lib/image-studio/vibes";
import { readVibe, saveVibe } from "../vibeApi";
import { RevealStage } from "../RevealStage";
import { ArgumentChat, type ChatEntry } from "./ArgumentChat";
import { LadderCard } from "./LadderCard";
import { drawEvidenceLayer } from "./evidence-layer";
import { offlineVerdict, readPixels } from "./offline-read";

interface Version {
  verdict: VibeVerdict;
  problems: VerdictProblem[];
}

export function VibeLab({ embedded = false }: { embedded?: boolean }) {
  const [image, setImage] = useState("");
  const [steer, setSteer] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [active, setActive] = useState(0);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [candidates, setCandidates] = useState<VibeCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Vibe | null>(null);
  const [offline, setOffline] = useState(false);
  const [stored, setStored] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /** The raw JSON of each model reply, which is what goes back as context. */
  const turns = useRef<{ role: "user" | "assistant"; text: string }[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const current = versions[active] ?? null;

  /** The hidden layer: the model's evidence, drawn at the photo's own size. */
  const evidenceLayer = useMemo(() => {
    if (!image || !current) return null;
    const img = document.createElement("img");
    img.src = image;
    // Only drawn once the bytes are decoded; a data URL from the same tab is
    // decoded synchronously often enough that this is worth attempting, and
    // the stage simply shows the photo until it is not null.
    if (!img.complete || !img.naturalWidth) return null;
    return drawEvidenceLayer(img, current.verdict.evidence);
  }, [image, current]);

  const addFiles = useCallback(async (files: File[]) => {
    setError("");
    setNotice("");
    if (!files.length) {
      setError("No image came through. Use the Add button, or save the image to your device first.");
      return;
    }
    const { accepted, skipped } = pickImageFiles(files, 1, MAX_REFS);
    const file = accepted[0];
    if (!file) {
      const first = skipped[0];
      setError(first ? `"${first.name}" ${first.reason}` : "That file is not an image this browser can open.");
      return;
    }
    try {
      const dataUrl = await downscaleToDataUrl(file);
      setImage(dataUrl);
      setVersions([]);
      setEntries([]);
      setSaved(null);
      turns.current = [];
      void read(dataUrl, steer, []);
    } catch {
      setError(
        isHeic(file)
          ? `"${file.name}" is an iPhone HEIC photo this browser can't open. Share it as JPEG (Photos → Share → Options → "Most Compatible"), or screenshot it.`
          : `"${file.name}" couldn't be opened as an image.`,
      );
    }
    // read is stable for the life of the component; steer is read at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steer]);

  const read = async (
    dataUrl: string,
    hint: string,
    history: { role: "user" | "assistant"; text: string }[],
  ) => {
    setBusy(true);
    setError("");
    try {
      const res = await readVibe({ image: dataUrl, steer: hint, turns: history });
      setCandidates(res.candidates ?? []);
      setStored(res.stored !== false);

      if (res.refused) {
        setError(res.error ?? "The model wouldn't read that image.");
        return;
      }

      // Keyless: the route says so and the client reads the pixels itself.
      if (res.offline) {
        setOffline(true);
        const stats = await statsFor(dataUrl);
        const verdict = offlineVerdict(stats, (res.candidates ?? []).map((c) => c.id));
        pushVersion({ verdict, problems: [] }, "Read from colour and edges only.");
        return;
      }

      if (!res.verdict) {
        setError("The model didn't return a read. Try again.");
        return;
      }
      turns.current = [...history, { role: "assistant", text: JSON.stringify(res.verdict) }];
      pushVersion({ verdict: res.verdict, problems: res.problems ?? [] }, res.verdict.ladder.vibe);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pushVersion = (version: Version, display: string) => {
    setVersions((prev) => {
      const next = [...prev, version];
      setActive(next.length - 1);
      return next;
    });
    setEntries((prev) => [...prev, { role: "assistant", display }]);
    // A new read is a new verdict, so an earlier save no longer describes it.
    setSaved(null);
  };

  const argue = (text: string) => {
    if (!image || busy) return;
    setEntries((prev) => [...prev, { role: "user", display: text }]);
    const history = [...turns.current, { role: "user" as const, text }];
    turns.current = history;
    void read(image, steer, history);
  };

  const commit = async () => {
    if (!current || !image) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await saveVibe({
        image,
        caption: current.verdict.ladder.vibe,
        ladder: current.verdict.ladder,
        match: current.verdict.match?.vibeId,
        proposal: current.verdict.proposal,
      });
      setSaved(res.vibe);
      if (res.warning) setNotice(res.warning);
      else if (!stored) setNotice("Saved in this browser only — no database is configured.");
    } catch (err) {
      setError(`${(err as Error).message} The read is still here — try saving again.`);
    } finally {
      setSaving(false);
    }
  };

  const matched = current?.verdict.match
    ? candidates.find((c) => c.id === current.verdict.match!.vibeId) ?? null
    : null;

  return (
    <div className={embedded ? "" : "min-h-dvh"}>
      <div className="mx-auto grid max-w-[1500px] gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex flex-col gap-4">
          <section
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles([...e.dataTransfer.files]);
            }}
            className="rounded-2xl border border-dashed border-line bg-panel p-4"
          >
            {image ? (
              <RevealStage
                base={image}
                layer={evidenceLayer ? { kind: "texture", src: evidenceLayer } : { kind: "grade", hue: [210, 280] }}
                alt="The image being read"
                className="aspect-[4/3] w-full rounded-xl"
              />
            ) : (
              <div className="grid aspect-[4/3] w-full place-items-center rounded-xl bg-panel-2 text-center">
                <div>
                  <p className="text-sm font-medium text-ink">Drop an image to find out what it is</p>
                  <p className="mx-auto mt-1 max-w-sm text-[11px] leading-snug text-ink-muted">
                    Not what&apos;s in it — what kind of image it is. 90s nostalgia, spy-glasses POV,
                    movie-trailer poster.
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    className="mt-3 rounded-xl border border-line px-3 py-2 text-[12px] font-medium text-ink transition hover:bg-panel"
                  >
                    Add an image
                  </button>
                </div>
              </div>
            )}

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void addFiles([...(e.target.files ?? [])])}
            />

            <div className="mt-3 flex gap-2">
              <input
                value={steer}
                onChange={(e) => setSteer(e.target.value)}
                placeholder="Optional: a hint — “I think this is 90s”, “read the lighting, not the subject”"
                className="flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2 text-[12px] text-ink placeholder:text-ink-faint"
              />
              <button
                type="button"
                disabled={!image || busy}
                onClick={() => {
                  turns.current = [];
                  setEntries([]);
                  void read(image, steer, []);
                }}
                className="rounded-xl border border-line px-3 py-2 text-[12px] font-medium text-ink transition hover:bg-panel-2 disabled:opacity-40"
              >
                {busy ? "Reading…" : versions.length ? "Read again" : "Read it"}
              </button>
            </div>

            {image && (
              <p className="mt-2 text-[10px] text-ink-faint">
                Hover the image to sweep the model&apos;s own read across it.
              </p>
            )}
          </section>

          {error && (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">{error}</p>
          )}
          {notice && (
            <p className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-[12px] text-ink-muted">{notice}</p>
          )}

          {current && (
            <ArgumentChat
              entries={entries}
              busy={busy}
              versionCount={versions.length}
              activeVersion={active}
              onSend={argue}
              onVersion={setActive}
            />
          )}
        </div>

        <div className="lg:sticky lg:top-16 lg:self-start">
          {current ? (
            <LadderCard
              verdict={current.verdict}
              problems={current.problems}
              candidates={candidates}
              matched={matched}
              offline={offline}
              saving={saving}
              savedVibe={saved}
              onRival={(label) => argue(`I think it's closer to ${label}. Make the case against that, or change your read.`)}
              onSave={() => void commit()}
            />
          ) : (
            <section className="rounded-2xl border border-line bg-panel p-4 text-[11px] leading-relaxed text-ink-muted">
              <p className="text-[12px] font-semibold text-ink">What comes back</p>
              <p className="mt-1.5">
                Three answers, coarse to specific — the family, the style inside it, and the vibe as a
                full description. Plus the reads it rejected and why, what it says it saw, and whether
                the look is distinctive enough to be worth collecting.
              </p>
              <p className="mt-2">
                If it&apos;s wrong, say so. It re-reads the picture against your objection instead of
                restating itself.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pixel statistics for the keyless read, off an offscreen canvas. */
async function statsFor(dataUrl: string) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  // 64px wide is plenty: every statistic is an average or a ratio, and a
  // full-size pass costs milliseconds for no change in the answer.
  const w = 64;
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return readPixels(ctx.getImageData(0, 0, w, h));
}
```

- [ ] **Step 5: Verify the Lab in the browser**

```bash
node scripts/dev-preview.mjs 3123 --no-auth
```

With the browser tools, against `http://localhost:3123/apps/image-studio?section=lab`:

1. `read_page` — confirm the dropzone copy and the right-hand explainer.
2. Put a test image in place with `javascript_tool`, since there is no file picker to drive:
   build a 256×256 canvas of hard magenta/black stripes, call `toDataURL()`, and dispatch it
   through the file input using a `DataTransfer`. Confirm the Lab reads it.
3. With no key set: confirm the offline banner appears, the card fills, and — the point of the
   whole feature — that the Vibe rung is a sentence, not one word. `read_page` and check it.
4. Hover the image and sweep the pointer across it with several `computer` moves, then
   `computer {action: "screenshot"}` **mid-sweep**. The screenshot must show a visible *trail
   shape*, not a single dot, and the boundary must read as a thin scan band rather than a flame.
   If it shows a dot, the ring buffer is not being fed — re-read `webgl-trail-reveal`.
5. Click a rival chip and confirm a user turn appears in the chat and a re-read is requested.
6. `read_console_messages` with `onlyErrors: true` — expect none. In particular, no WebGL warning
   about a non-power-of-two texture.
7. `resize_window` to `mobile`, reload, and confirm the two columns stack and nothing overflows
   horizontally.

- [ ] **Step 6: Typecheck, test and commit**

```bash
npx tsc --noEmit
npx vitest run src/lib/image-studio src/components/image-studio
git add src/components/image-studio/vibeApi.ts src/components/image-studio/vibe-lab/VibeLab.tsx src/components/image-studio/vibe-lab/LadderCard.tsx src/components/image-studio/vibe-lab/ArgumentChat.tsx
git commit -m "Vibe Lab: a read you can argue with, and a card that is always the one answer"
```

---

## Task 15: Generate reads the registry

**This task fixes a gap that would otherwise ship broken.** `parseBody` in
`src/lib/image-studio/server.ts:19` resolves an agent with `agentById`, which only knows the five
built-ins. The moment the picker offers a community vibe, generating with it answers "Pick an agent
first." Both existing routes have to resolve against the registry instead.

**Files:**
- Modify: `src/lib/image-studio/server.ts:19-21` (the `parseBody` lookup)
- Modify: `src/app/api/image-studio/rewrite/route.ts:24`
- Modify: `src/app/api/image-studio/generate/route.ts:24`
- Modify: `src/components/image-studio/AgentPicker.tsx` (whole file)
- Modify: `src/components/image-studio/ImageStudio.tsx` (agent state)
- Modify: `src/components/image-studio/ImageStudioShell.tsx` (pass `onGo` to studios)

- [ ] **Step 1: Resolve an agent from the registry**

In `src/lib/image-studio/server.ts`, add the import and the resolver, then make `parseBody` async.
Replace the imports at the top:

```ts
import "server-only";
import { aiFetch } from "@/lib/ai/provider";
import type { ImageAgent } from "./agents";
import { MAX_PROMPT, MAX_REFS, type Part, type RefInput } from "./prompt";
import { listVibes } from "./vibe-store";
import { vibeToAgent } from "./vibes";
```

Add above `parseBody`:

```ts
/**
 * The agent behind an id, built-in or community.
 *
 * Was `agentById`, which only knew the five hand-written agents — so the first
 * community vibe the picker offered would have failed to generate. The
 * registry is the one list now, and a vibe is an agent by construction.
 */
export async function resolveAgent(id: string): Promise<ImageAgent | null> {
  if (!id) return null;
  const { vibes } = await listVibes();
  const vibe = vibes.find((v) => v.id === id);
  return vibe ? vibeToAgent(vibe) : null;
}
```

Then change `parseBody`'s first two lines from:

```ts
export function parseBody(body: unknown): StudioRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const agent = agentById(String(b.agentId ?? ""));
  if (!agent) return "Pick an agent first.";
```

to:

```ts
export async function parseBody(body: unknown): Promise<StudioRequest | string> {
  const b = (body ?? {}) as Record<string, unknown>;
  const agent = await resolveAgent(String(b.agentId ?? ""));
  if (!agent) return "That vibe no longer exists — pick another.";
```

- [ ] **Step 2: Await it in both routes**

In `src/app/api/image-studio/rewrite/route.ts` and `src/app/api/image-studio/generate/route.ts`,
change the line:

```ts
  const parsed = parseBody(body);
```

to:

```ts
  const parsed = await parseBody(body);
```

- [ ] **Step 3: Verify the existing tests still pass**

`image-studio.test.ts` tests `agentById` directly and does not touch `parseBody`, so it is
unaffected — but confirm rather than assume.

Run: `npx vitest run src/lib/image-studio`
Expected: PASS, same count as after Task 12.

- [ ] **Step 4: Rewrite the picker to read vibes**

Replace `src/components/image-studio/AgentPicker.tsx` entirely:

```tsx
"use client";

// ---------------------------------------------------------------------------
// The picker, over the whole registry.
//
// Built-ins and community vibes are the same shape, so they are drawn in one
// grid rather than two sections — a vibe someone named last week is as usable
// as Nostalgia, and splitting them would imply otherwise. The family filter is
// what keeps that one grid navigable once there are eighty of them.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import type { Vibe } from "@/lib/image-studio/vibes";

export function AgentPicker({
  vibes,
  selected,
  onSelect,
}: {
  vibes: Vibe[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [family, setFamily] = useState("all");

  const families = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of vibes) seen.set(v.family, (seen.get(v.family) ?? 0) + 1);
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  }, [vibes]);

  const shown = family === "all" ? vibes : vibes.filter((v) => v.family === family);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Pick a vibe</h2>
        <span className="text-[10px] text-ink-faint">{vibes.length}</span>
      </div>

      {families.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {[["all", vibes.length] as const, ...families].map(([id, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFamily(id)}
              aria-pressed={family === id}
              className={`rounded-lg border px-2 py-1 text-[10px] transition ${
                family === id ? "border-[var(--color-brand)] text-ink" : "border-line text-ink-faint hover:text-ink"
              }`}
            >
              {id === "all" ? "All" : id} <span className="opacity-60">{n}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {shown.map((v) => {
          const on = v.id === selected;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              aria-pressed={on}
              className={`group relative overflow-hidden rounded-xl border p-3 text-left transition ${
                on ? "border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]" : "border-line hover:border-ink-faint"
              }`}
              style={{
                background: `linear-gradient(135deg, hsl(${v.hue[0]} 70% 50% / ${on ? 0.28 : 0.14}), hsl(${v.hue[1]} 60% 40% / ${on ? 0.16 : 0.06}))`,
              }}
            >
              <span className="block text-xl leading-none">{v.icon}</span>
              <span className="mt-1.5 block text-[13px] font-semibold text-ink">{v.name}</span>
              <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-muted">{v.vibe}</span>
              {v.kind === "community" && (
                <span className="mt-1 block text-[9px] uppercase tracking-wider text-ink-faint">
                  named in the Lab
                </span>
              )}
            </button>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="rounded-xl border border-line bg-panel-2 px-3 py-4 text-center text-[11px] text-ink-muted">
          No vibes in that family yet.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Make the Generate studio fetch the registry**

In `src/components/image-studio/ImageStudio.tsx`:

Replace the agents import:

```tsx
import { AGENTS, agentById } from "@/lib/image-studio/agents";
```

with:

```tsx
import { seedVibes } from "@/lib/image-studio/vibes-seed";
import { vibeToAgent, type Vibe } from "@/lib/image-studio/vibes";
import { fetchVibes } from "./vibeApi";
```

Replace the agent state lines:

```tsx
  const [agentId, setAgentId] = useState(AGENTS[0].id);
```

with:

```tsx
  // Seeded rather than empty: the five built-ins are known without a request,
  // so the picker is never blank while the registry loads.
  const [vibes, setVibes] = useState<Vibe[]>(() => seedVibes());
  const [agentId, setAgentId] = useState(() => seedVibes()[0].id);
```

Replace:

```tsx
  const agent = agentById(agentId) ?? AGENTS[0];
```

with:

```tsx
  const agent = vibeToAgent(vibes.find((v) => v.id === agentId) ?? vibes[0]);
```

Add this effect immediately after the existing `useEffect(() => setItems(loadGallery()), []);`:

```tsx
  // The registry, and the vibe the Library asked to generate with. Failing to
  // load it is survivable — the five built-ins are already on screen.
  useEffect(() => {
    let live = true;
    void fetchVibes()
      .then(({ vibes: loaded }) => {
        if (!live || !loaded.length) return;
        setVibes(loaded);
        try {
          const pending = window.localStorage.getItem(PENDING_VIBE);
          if (pending && loaded.some((v) => v.id === pending)) {
            setAgentId(pending);
            setNotice(`Generating with ${loaded.find((v) => v.id === pending)!.name}.`);
          }
          window.localStorage.removeItem(PENDING_VIBE);
        } catch {
          /* storage refused — the default vibe stands. */
        }
      })
      .catch(() => {
        if (live) setNotice("The vibe library didn't load, so only the built-in vibes are offered.");
      });
    return () => {
      live = false;
    };
  }, []);
```

And add the key next to the component's other module constants, above `export function ImageStudio`:

```tsx
/** Where the Library leaves the vibe it wants Generate to use. */
export const PENDING_VIBE = "image-studio:pending-vibe";
```

Finally, change the picker's props at the call site from:

```tsx
          <AgentPicker agents={AGENTS} selected={agentId} onSelect={pickAgent} />
```

to:

```tsx
          <AgentPicker vibes={vibes} selected={agentId} onSelect={pickAgent} />
```

- [ ] **Step 6: Let a studio ask the shell to switch**

In `src/components/image-studio/ImageStudioShell.tsx`, widen the studio prop type:

```tsx
type StudioProps = { embedded?: boolean; onGo?: (s: Section) => void };

const STUDIOS: Record<Section, React.ComponentType<StudioProps>> = {
```

and pass the callback at the mount point, replacing `<Studio embedded />` with:

```tsx
        <Studio embedded onGo={go} />
```

- [ ] **Step 7: Verify in the browser**

```bash
node scripts/dev-preview.mjs 3123 --no-auth
```

1. `navigate` to `http://localhost:3123/apps/image-studio` and `read_page` — the picker shows the
   five built-ins with their vibe sentences as the description, and a family filter (`photography`
   should hold three of them, `illustration` one).
2. Click a family chip and confirm the grid narrows.
3. `read_network_requests` filtered to `image-studio/vibes` — confirm one GET returning
   `stored:false` keyless, and that the picker did not blank while it was in flight.
4. Generate one image to prove the route still resolves a built-in id through the new
   `resolveAgent` path. Confirm an image lands in the gallery (an offline placeholder is a pass —
   what is being tested is that the request is not rejected with "That vibe no longer exists").

- [ ] **Step 8: Typecheck, test and commit**

```bash
npx tsc --noEmit
npx vitest run src/lib/image-studio src/components/image-studio
git add src/lib/image-studio/server.ts src/app/api/image-studio/rewrite/route.ts src/app/api/image-studio/generate/route.ts src/components/image-studio/AgentPicker.tsx src/components/image-studio/ImageStudio.tsx src/components/image-studio/ImageStudioShell.tsx
git commit -m "Generate over the whole registry, so a vibe named in the Lab can actually be used"
```

---

## Task 16: The Vibe Library

Dense and sortable, not a card grid — the owner's standing preference, and the right form for a
list whose job is comparison.

**Files:**
- Create: `src/components/image-studio/vibe-library/VibeRow.tsx`
- Modify: `src/components/image-studio/vibe-library/VibeLibrary.tsx` (replacing Task 10's placeholder)

- [ ] **Step 1: Write the row**

Create `src/components/image-studio/vibe-library/VibeRow.tsx`:

```tsx
"use client";

// ---------------------------------------------------------------------------
// One vibe, as a row.
//
// The cover's reveal uses the GRADE mode: the same texture with this vibe's own
// two hues and grain applied in-shader. So hovering shows what the vibe does to
// a photograph, stays aligned by construction, and costs no generation — a
// freshly generated preview would not line up with the cover and the reveal
// would read as a swap.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { SUPABASE_URL } from "@/lib/supabase/config";
import { TRAINABLE_AT, datasetProgress, type Vibe } from "@/lib/image-studio/vibes";
import { RevealStage } from "../RevealStage";
import { fetchSamples } from "../vibeApi";

/** A storage path as a public URL. Empty when there is no cover. */
export function coverUrl(path: string | null): string {
  if (!path || !SUPABASE_URL) return "";
  return `${SUPABASE_URL}/storage/v1/object/public/project-files/${path}`;
}

export function VibeRow({ vibe, onGenerate }: { vibe: Vibe; onGenerate: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<{ storagePath: string; caption: string }[] | null>(null);
  const progress = datasetProgress(vibe.datasetCount);
  const cover = coverUrl(vibe.coverPath);

  const expand = () => {
    setOpen((was) => !was);
    if (samples === null) {
      void fetchSamples(vibe.id)
        .then((r) => setSamples(r.samples))
        .catch(() => setSamples([]));
    }
  };

  return (
    <>
      <tr className="border-b border-line transition hover:bg-panel-2">
        <td className="px-2 py-1.5">
          <button type="button" onClick={expand} aria-expanded={open} className="flex items-center gap-2 text-left">
            <span className="w-5 text-center text-base leading-none">{vibe.icon}</span>
            <span>
              <span className="block text-[12px] font-semibold text-ink">{vibe.name}</span>
              <span className="block max-w-[46ch] truncate text-[10.5px] text-ink-faint">{vibe.vibe}</span>
            </span>
          </button>
        </td>
        <td className="px-2 py-1.5 text-[11px] text-ink-muted">{vibe.family}</td>
        <td className="px-2 py-1.5 text-[11px] text-ink-muted">{vibe.style}</td>
        <td className="px-2 py-1.5 text-right font-mono text-[11px] text-ink-muted">{vibe.uses}</td>
        <td className="px-2 py-1.5 text-right font-mono text-[11px]">
          <span className={progress.trainable ? "text-emerald-300" : "text-ink-muted"}>
            {progress.count}/{TRAINABLE_AT}
          </span>
        </td>
        <td className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
          {vibe.kind === "builtin" ? "built in" : "the Lab"}
        </td>
        <td className="px-2 py-1.5 text-right">
          <button
            type="button"
            onClick={() => onGenerate(vibe.id)}
            className="rounded-lg border border-line px-2 py-1 text-[10.5px] font-medium text-ink transition hover:bg-panel"
          >
            Generate
          </button>
        </td>
      </tr>

      {open && (
        <tr className="border-b border-line bg-panel-2/60">
          <td colSpan={7} className="px-2 py-3">
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              {cover ? (
                <RevealStage
                  base={cover}
                  layer={{ kind: "grade", hue: vibe.hue }}
                  alt={`${vibe.name} cover`}
                  className="aspect-[4/3] w-full rounded-xl border border-line"
                />
              ) : (
                <div
                  className="grid aspect-[4/3] w-full place-items-center rounded-xl border border-line text-2xl"
                  style={{
                    background: `linear-gradient(135deg, hsl(${vibe.hue[0]} 70% 50% / 0.28), hsl(${vibe.hue[1]} 60% 40% / 0.1))`,
                  }}
                >
                  {vibe.icon}
                </div>
              )}

              <div className="min-w-0">
                <p className="text-[11px] leading-relaxed text-ink-muted">{vibe.brief}</p>
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-ink-faint">{vibe.styleBlock}</p>

                <p className="mt-2 text-[10.5px] text-ink-faint">
                  {progress.trainable
                    ? `${progress.count} examples — enough for a trainable set.`
                    : `${progress.needed} more example${progress.needed === 1 ? "" : "s"} before this set is worth training on.`}
                </p>

                {progress.trainable && (
                  <a
                    href={`/api/image-studio/vibes?export=${encodeURIComponent(vibe.id)}`}
                    className="mt-2 inline-block rounded-lg border border-line px-2.5 py-1.5 text-[10.5px] font-medium text-ink transition hover:bg-panel"
                  >
                    Download captioned set
                  </a>
                )}

                {samples === null ? (
                  <p className="mt-2 text-[10.5px] text-ink-faint">Loading examples…</p>
                ) : samples.length === 0 ? (
                  <p className="mt-2 text-[10.5px] text-ink-faint">No examples stored for this vibe yet.</p>
                ) : (
                  <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
                    {samples.map((s) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={s.storagePath}
                        src={coverUrl(s.storagePath)}
                        alt={s.caption}
                        title={s.caption}
                        className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
```

- [ ] **Step 2: Write the library**

Replace `src/components/image-studio/vibe-library/VibeLibrary.tsx` entirely:

```tsx
"use client";

// ---------------------------------------------------------------------------
// The Vibe Library — every look the Lab has named, shared.
//
// A table, because the job here is comparison: which vibes exist, which are
// used, which have enough examples to train on. A card grid would make eighty
// vibes a scroll and hide exactly the columns you came to compare.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import type { Section } from "@/lib/image-studio/sections";
import { TRAINABLE_AT, datasetProgress, type Vibe } from "@/lib/image-studio/vibes";
import { PENDING_VIBE } from "../ImageStudio";
import { fetchVibes } from "../vibeApi";
import { VibeRow } from "./VibeRow";

type SortKey = "name" | "family" | "style" | "uses" | "dataset";

const COLUMNS: { key: SortKey | null; label: string; align?: "right" }[] = [
  { key: "name", label: "Vibe" },
  { key: "family", label: "Family" },
  { key: "style", label: "Style" },
  { key: "uses", label: "Uses", align: "right" },
  { key: "dataset", label: "Set", align: "right" },
  { key: null, label: "Named by" },
  { key: null, label: "" },
];

export function VibeLibrary({
  embedded = false,
  onGo,
}: {
  embedded?: boolean;
  onGo?: (s: Section) => void;
}) {
  const [vibes, setVibes] = useState<Vibe[]>([]);
  const [stored, setStored] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState("all");
  const [readyOnly, setReadyOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("uses");
  const [desc, setDesc] = useState(true);

  useEffect(() => {
    let live = true;
    void fetchVibes()
      .then((r) => {
        if (!live) return;
        setVibes(r.vibes);
        setStored(r.stored);
      })
      .catch((err) => live && setError((err as Error).message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const families = useMemo(() => [...new Set(vibes.map((v) => v.family))].sort(), [vibes]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = vibes.filter((v) => {
      if (family !== "all" && v.family !== family) return false;
      if (readyOnly && !datasetProgress(v.datasetCount).trainable) return false;
      if (!q) return true;
      return `${v.name} ${v.family} ${v.style} ${v.vibe}`.toLowerCase().includes(q);
    });
    const dir = desc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      switch (sort) {
        case "uses":
          return (a.uses - b.uses) * dir;
        case "dataset":
          return (a.datasetCount - b.datasetCount) * dir;
        case "family":
          return a.family.localeCompare(b.family) * dir;
        case "style":
          return a.style.localeCompare(b.style) * dir;
        default:
          return a.name.localeCompare(b.name) * dir;
      }
    });
  }, [vibes, query, family, readyOnly, sort, desc]);

  const generateWith = (id: string) => {
    try {
      window.localStorage.setItem(PENDING_VIBE, id);
    } catch {
      /* storage refused — Generate opens on its default vibe instead. */
    }
    onGo?.("generate");
  };

  const click = (key: SortKey | null) => {
    if (!key) return;
    if (key === sort) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(key === "uses" || key === "dataset");
    }
  };

  const ready = vibes.filter((v) => datasetProgress(v.datasetCount).trainable).length;

  return (
    <div className={embedded ? "" : "min-h-dvh"}>
      <div className="mx-auto max-w-[1500px] px-4 py-5">
        <header className="mb-3 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vibes…"
            className="min-w-[200px] flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2 text-[12px] text-ink placeholder:text-ink-faint"
          />
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            className="rounded-xl border border-line bg-panel-2 px-2.5 py-2 text-[12px] text-ink"
            aria-label="Family"
          >
            <option value="all">All families</option>
            {families.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setReadyOnly((r) => !r)}
            aria-pressed={readyOnly}
            className={`rounded-xl border px-2.5 py-2 text-[11px] transition ${
              readyOnly ? "border-[var(--color-brand)] text-ink" : "border-line text-ink-muted hover:text-ink"
            }`}
          >
            Trainable only <span className="opacity-60">{ready}</span>
          </button>
        </header>

        {!stored && (
          <p className="mb-3 rounded-xl border border-line bg-panel-2 px-3 py-2 text-[11px] text-ink-muted">
            No database is configured, so this is the library that ships with the app. Vibes you name
            in the Lab stay in your browser until Supabase is set up.
          </p>
        )}
        {error && (
          <p className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-red-200">
            {error}
          </p>
        )}

        <div className="overflow-x-auto rounded-2xl border border-line bg-panel">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-panel-2">
                {COLUMNS.map((c) => (
                  <th
                    key={c.label || "actions"}
                    scope="col"
                    aria-sort={c.key === sort ? (desc ? "descending" : "ascending") : undefined}
                    className={`px-2 py-2 text-[10px] font-medium uppercase tracking-wider text-ink-faint ${
                      c.align === "right" ? "text-right" : ""
                    }`}
                  >
                    {c.key ? (
                      <button type="button" onClick={() => click(c.key)} className="transition hover:text-ink">
                        {c.label}
                        {c.key === sort && <span aria-hidden>{desc ? " ↓" : " ↑"}</span>}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <VibeRow key={v.id} vibe={v} onGenerate={generateWith} />
              ))}
            </tbody>
          </table>

          {loading && <p className="px-3 py-6 text-center text-[11px] text-ink-faint">Loading the library…</p>}
          {!loading && rows.length === 0 && (
            <p className="px-3 py-6 text-center text-[11px] text-ink-muted">
              Nothing matches. {readyOnly && `No vibe has reached ${TRAINABLE_AT} examples yet.`}
            </p>
          )}
        </div>

        <p className="mt-2 text-[10.5px] text-ink-faint">
          {rows.length} of {vibes.length} vibes · a vibe becomes trainable at {TRAINABLE_AT} examples
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the library and the reveal in the browser**

```bash
node scripts/dev-preview.mjs 3123 --no-auth
```

Against `http://localhost:3123/apps/image-studio?section=library`:

1. `read_page` — five rows, the seed banner, and sortable headers.
2. Click the **Uses** header twice and confirm `aria-sort` flips between `descending` and
   `ascending` (`javascript_tool`: `document.querySelector('[aria-sort]').getAttribute('aria-sort')`).
3. Expand a row and confirm the brief, the style block and the "N more examples" line. Keyless there
   is no cover, so the gradient tile with the icon is the pass condition here — the grade reveal is
   verified once a real cover exists (step 5).
4. Click **Generate** on a row and confirm the shell switches to the Generate tab with that vibe
   selected and the notice naming it.
5. **With a key and Supabase set**, save a vibe from the Lab, come back, expand its row, hover the
   cover and sweep the pointer. Screenshot mid-sweep: a trail, not a dot, and the revealed area must
   be visibly the *same photograph graded*, not a different image.
6. `read_console_messages` with `onlyErrors: true` — expect none.
7. `resize_window` to `mobile` and confirm the table scrolls horizontally inside its container
   rather than widening the page.

- [ ] **Step 4: Typecheck, test and commit**

```bash
npx tsc --noEmit
npx vitest run src/lib/image-studio src/components/image-studio
git add src/components/image-studio/vibe-library/VibeLibrary.tsx src/components/image-studio/vibe-library/VibeRow.tsx
git commit -m "Vibe Library: a table, because the job is comparison"
```

---

## Task 17: The captioned export

**Files:**
- Create: `src/lib/image-studio/zip.ts`
- Create: `src/lib/image-studio/zip.test.ts`
- Modify: `src/app/api/image-studio/vibes/route.ts` (the `GET` handler)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/image-studio/zip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildZip, crc32 } from "./zip";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("crc32", () => {
  it("matches the known CRC-32 of 'hello'", () => {
    expect(crc32(bytes("hello")) >>> 0).toBe(0x3610a686);
  });

  it("is zero for no bytes", () => {
    expect(crc32(new Uint8Array()) >>> 0).toBe(0);
  });

  it("differs for different content", () => {
    expect(crc32(bytes("a"))).not.toBe(crc32(bytes("b")));
  });
});

describe("buildZip", () => {
  const zip = buildZip([
    { name: "captions.txt", data: bytes("01.jpg\ta soft pastoral look\n") },
    { name: "01.jpg", data: bytes("not-really-a-jpeg") },
  ]);

  it("starts with a local file header signature", () => {
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("ends with an end-of-central-directory signature", () => {
    const eocd = zip.slice(zip.length - 22, zip.length - 18);
    expect([...eocd]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("records both entries in the directory", () => {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint16(zip.length - 14, true)).toBe(2);
  });

  it("stores the file names in clear", () => {
    const text = new TextDecoder().decode(zip);
    expect(text).toContain("captions.txt");
    expect(text).toContain("01.jpg");
  });

  it("stores rather than compresses, so sizes match the input", () => {
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint16(8, true)).toBe(0); // method 0 = stored
    expect(view.getUint32(18, true)).toBe(view.getUint32(22, true)); // csize === usize
  });

  it("handles an empty entry list", () => {
    const empty = buildZip([]);
    expect(empty.length).toBe(22);
    expect([...empty.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/image-studio/zip.test.ts`
Expected: FAIL — `Failed to resolve import "./zip"`.

- [ ] **Step 3: Write the ZIP writer**

Create `src/lib/image-studio/zip.ts`:

```ts
// ---------------------------------------------------------------------------
// Image Studio — a ZIP, stored not compressed.
//
// No dependency, because there is nothing to gain from one: a dataset export is
// JPEGs, which are already compressed, so deflating them costs CPU to save
// almost nothing. Store-only ZIP is about sixty lines and every byte of it is
// testable, which a library's output is not.
//
// Pure. No streams, no Node APIs — it builds one Uint8Array.
// ---------------------------------------------------------------------------

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0 ^ -1;
  for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ TABLE[(c ^ bytes[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** Little-endian byte pusher. The whole format is little-endian. */
class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  u16(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }

  u32(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }

  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

export function buildZip(entries: ZipEntry[]): Uint8Array {
  const out = new Writer();
  const directory: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const crc = crc32(entry.data);
    directory.push({ name, crc, size: entry.data.length, offset: out.length });

    out.u32(0x04034b50); // local file header
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method 0 — stored
    out.u16(0); // mod time
    out.u16(0); // mod date
    out.u32(crc);
    out.u32(entry.data.length); // compressed size
    out.u32(entry.data.length); // uncompressed size
    out.u16(name.length);
    out.u16(0); // extra length
    out.push(name);
    out.push(entry.data);
  }

  const dirStart = out.length;
  for (const e of directory) {
    out.u32(0x02014b50); // central directory header
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method
    out.u16(0); // time
    out.u16(0); // date
    out.u32(e.crc);
    out.u32(e.size);
    out.u32(e.size);
    out.u16(e.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attrs
    out.u32(0); // external attrs
    out.u32(e.offset);
    out.push(e.name);
  }
  const dirSize = out.length - dirStart;

  out.u32(0x06054b50); // end of central directory
  out.u16(0); // this disk
  out.u16(0); // disk with directory
  out.u16(directory.length);
  out.u16(directory.length);
  out.u32(dirSize);
  out.u32(dirStart);
  out.u16(0); // comment length

  return out.done();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/image-studio/zip.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Serve the export**

In `src/app/api/image-studio/vibes/route.ts`, add the imports:

```ts
import { buildZip, type ZipEntry } from "@/lib/image-studio/zip";
import { datasetProgress } from "@/lib/image-studio/vibes";
```

and replace the whole `GET` handler with:

```ts
// GET /api/image-studio/vibes             → { vibes, stored }
// GET /api/image-studio/vibes?samples=ID  → { samples }
// GET /api/image-studio/vibes?export=ID   → a captioned ZIP of the dataset
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;

  const samplesFor = params.get("samples");
  if (samplesFor) return NextResponse.json({ samples: await listSamples(samplesFor) });

  const exportFor = params.get("export");
  if (exportFor) return exportDataset(exportFor);

  const { vibes, stored } = await listVibes();
  return NextResponse.json({ vibes, stored });
}

/**
 * The dataset as a ZIP a trainer can read: the images, plus a captions file
 * pairing each filename with its caption, plus the brief as the style's own
 * description.
 *
 * An image that fails to download is left out and named in the manifest rather
 * than failing the export — a 19-of-20 set is useful and a 500 is not.
 */
async function exportDataset(vibeId: string) {
  const { vibes } = await listVibes();
  const vibe = vibes.find((v) => v.id === vibeId);
  if (!vibe) return NextResponse.json({ error: "No such vibe." }, { status: 404 });

  const progress = datasetProgress(vibe.datasetCount);
  if (!progress.trainable) {
    return NextResponse.json(
      { error: `This set has ${progress.count} images and needs ${progress.needed} more.` },
      { status: 409 },
    );
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "No database is configured." }, { status: 409 });

  const samples = await listSamples(vibeId);
  const entries: ZipEntry[] = [];
  const captions: string[] = [];
  const missing: string[] = [];

  for (const [i, sample] of samples.entries()) {
    const ext = sample.storagePath.split(".").pop() || "jpg";
    const name = `${String(i + 1).padStart(3, "0")}.${ext}`;
    const { data, error } = await supabase.storage.from(FILES_BUCKET).download(sample.storagePath);
    if (error || !data) {
      missing.push(sample.storagePath);
      continue;
    }
    entries.push({ name, data: new Uint8Array(await data.arrayBuffer()) });
    captions.push(`${name}\t${sample.caption || vibe.vibe}`);
  }

  const manifest = [
    `# ${vibe.name}`,
    `family: ${vibe.family}`,
    `style: ${vibe.style}`,
    `vibe: ${vibe.vibe}`,
    `images: ${entries.length}`,
    missing.length ? `missing: ${missing.length} image(s) could not be downloaded` : "",
    "",
    vibe.brief,
    "",
    "Style block:",
    vibe.styleBlock,
  ]
    .filter(Boolean)
    .join("\n");

  const encoder = new TextEncoder();
  entries.push({ name: "captions.txt", data: encoder.encode(`${captions.join("\n")}\n`) });
  entries.push({ name: "README.txt", data: encoder.encode(`${manifest}\n`) });

  const zip = buildZip(entries);
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${vibe.id}-dataset.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
```

- [ ] **Step 6: Verify the refusal path**

With a preview running and no Supabase configured:

```bash
curl -s -i "http://localhost:3123/api/image-studio/vibes?export=nostalgia" | head -12
```

Expected: HTTP 409 and a message naming how many more images the set needs — not a 500 and not an
empty ZIP.

- [ ] **Step 7: Typecheck, test and commit**

```bash
npx tsc --noEmit
npx vitest run src/lib/image-studio
git add src/lib/image-studio/zip.ts src/lib/image-studio/zip.test.ts src/app/api/image-studio/vibes/route.ts
git commit -m "Captioned dataset export: store-only ZIP, and a missing image is named not fatal"
```

---

## Task 18: The catalog entry, and the whole thing verified

**Files:**
- Modify: `src/lib/catalog.ts:443-457` (the `image-studio` entry's `overview` and `tag`)

- [ ] **Step 1: Update the catalog**

In `src/lib/catalog.ts`, in the object whose `slug` is `"image-studio"`, replace the `tag` and
`overview` fields with:

```ts
    tag: "Name a look, then generate it",
    overview:
      "Three studios. GENERATE is a bench of specialist agents, each an expert in one look — " +
      "Nostalgia turns you into a photo from any decade, Glamour shoots magazine-grade editorial, " +
      "Family Portrait arranges everyone you upload, Cartoon → Real brings a drawn character to " +
      "life, GTA Life drops you into your most unhinged moments. Write a prompt, tag your reference " +
      "photos as a Person to keep or a Style to borrow, and the agent rewrites your idea into a " +
      "detailed prompt you can edit before it generates. VIBE LAB answers the other question: drop " +
      "any image and it tells you what KIND of image it is — not \"cartoon\" but the family, the " +
      "style inside it, and the vibe as a full description, with the reads it rejected and why. " +
      "Disagree with it and it looks again instead of restating itself; hover the photo to sweep " +
      "its own evidence across it. Whatever you settle on becomes a real agent you can generate " +
      "with immediately, and starts collecting examples toward a trainable set. VIBE LIBRARY is " +
      "every look anyone has named, as a sortable table you can filter, compare and generate from.",
```

- [ ] **Step 2: Run everything**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

Expected: all tests pass, no type errors, and a clean build. If the build fails on a nested project,
check the root `tsconfig.json` `exclude` list — that is the known cause in this repo.

- [ ] **Step 3: The owner's own click path**

A terminal pass is not verification here. Drive the real app:

```bash
node scripts/dev-preview.mjs 3123 --no-auth
```

1. `/apps/image-studio` → Generate is on screen with the picker populated.
2. Switch to **Vibe Lab**, drop an image, read it. Confirm the Vibe rung is a sentence.
3. Argue with it once (&ldquo;no, more like anime&rdquo;) and confirm the card rewrites and a version
   pip appears.
4. Save it. Confirm the verdict line reads *usable as an agent now · N/20*.
5. Switch to **Library**, find the vibe you just saved, and hit **Generate** on its row.
6. Confirm Generate opens with that vibe selected, then generate one image with it — this is the
   whole loop: a look you named, generated from.
7. Screenshot each of the three tabs for the record, including one mid-sweep hover.

- [ ] **Step 4: Commit and offer the deploy**

```bash
git add src/lib/catalog.ts
git commit -m "Image Studio is three studios now, and the catalog says so"
```

Then tell the owner what remains in their hands, in one message:

- the migration SQL is on their clipboard for the Supabase editor (Task 4) — without it the library
  works but does not grow;
- `git push` deploys it to Vercel.

Do not stop at "it works locally". Per the owner's standing rule, a feature is finished when the
deploy it needs is done.

- [ ] **Step 5: Save what was learned**

Write a memory file for this app at
`C:\Users\honey\.claude\projects\C--Users-honey-OneDrive-Desktop-claude-code-files\memory\image-studio-vibe-lab.md`
and add its one-line pointer to `MEMORY.md`. Update the existing
[image-studio app](image-studio-app.md) memory too — its claim that agents are added only in
`src/lib/image-studio/agents.ts` stops being true the moment this ships, because the Lab mints
them. The two non-obvious things worth recording:

- a vibe is an agent, and the registry merge takes a built-in's brief from code and its counters
  from the row, so briefs cannot drift;
- the reveal's hidden layer is always derived from the visible one — generated images do not align,
  and a misaligned reveal reads as a photo swap.

---

## Self-review

Run against the spec, after the plan was written.

**Spec coverage.** Every section maps to a task: the shell → 10; the registry and one-registry
decision → 1, 3, 7, 15; the migration → 4; the verdict contract and both gates → 2, 5, 8; the
argument → 8, 14; Vibe Lab → 12, 13, 14; Vibe Library → 16; the trail reveal → 11, 13; degradation
→ 6, 8, 12, 16; the dataset and export → 17; failure modes → 2, 8, 9, 14; tests → 1, 2, 3, 5, 7, 9,
12, 17; catalog → 18.

**Two deviations from the spec, both deliberate and both noted at the point they occur:**

1. `lora.needed` is not in the contract. A model should not do arithmetic that
   `datasetProgress(datasetCount)` does exactly. Stated in the "Read this before Task 1" section.
2. The migration's insert policy does not constrain `kind`. Built-in authority lives in
   `vibes-seed.ts` and `mergeWithSeed` takes a seed id's identity from code, so a forged `builtin`
   row gains nothing — and the column still has to be writable for a materialised seed row. Stated
   in the migration's own comment and tested in Task 7.

**One gap the spec did not anticipate, now Task 15:** `parseBody` resolved agents through
`agentById`, which only knows the five built-ins, so generating with a community vibe would have
been rejected. Caught while mapping the file structure, not while running the code.

**Type consistency.** `VibeVerdict`, `VibeLadder`, `VibeProposal`, `VibeEvidence`, `VibeCandidate`,
`VerdictProblem`, `Vibe` and `Section` are defined once each (Tasks 1, 2, 10) and imported
everywhere after. `datasetProgress` takes a number, not a `Vibe`, at all four call sites.
`mergeWithSeed` is declared in Task 7 and consumed in Task 6, which is why Task 6 cannot be
committed alone and says so. `PENDING_VIBE` is exported from `ImageStudio.tsx` in Task 15 and
imported by `VibeLibrary.tsx` in Task 16.

**No placeholders.** Every code step carries the code. The two placeholder studios in Task 10 are
deliberate scaffolding, named as such, and replaced in Tasks 14 and 16.
