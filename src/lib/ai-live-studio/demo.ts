// A scripted audience, so every flow can be proven before TikTok is wired.
//
// The demo is not a fake UI: these raw events go through the same
// parseEvent → Director path a real TikTok comment does. The opening script
// is built to exercise every rule once — a question, a gift that jumps the
// queue, a link and an abusive line that must never be spoken, a duplicate
// that must be dropped, a mention, a follow — then a seeded pool keeps the
// room going for as long as the stream runs.

export interface DemoViewer {
  handle: string;
  user: string;
}

export interface DemoBeat {
  /** Milliseconds after the previous beat. */
  after: number;
  raw: { type: "comment" | "gift" | "follow" | "share"; handle: string; user: string; text?: string };
}

const V = {
  mike: { handle: "mike23", user: "Mike23" },
  sarah: { handle: "sarah.j", user: "Sarah" },
  dre: { handle: "dre_wav", user: "Dre" },
  kayla: { handle: "kayla.b", user: "Kayla" },
  tony: { handle: "tony.v", user: "Tony" },
  spam: { handle: "promo.daily88", user: "promo.daily88" },
  nina: { handle: "nina.ok", user: "Nina" },
  troll: { handle: "x_void_x", user: "void" },
  jordan: { handle: "jordanmade", user: "Jordan" },
  marc: { handle: "big.marc", user: "Marc" },
  lena: { handle: "lena.p", user: "Lena" },
  omar: { handle: "omarrr", user: "Omar" },
  priya: { handle: "priya.k", user: "Priya" },
  sam: { handle: "samwise.t", user: "Sam" },
} satisfies Record<string, DemoViewer>;

const c = (after: number, v: DemoViewer, text: string): DemoBeat => ({ after, raw: { type: "comment", ...v, text } });

export const DEMO_SCRIPT: DemoBeat[] = [
  { after: 1200, raw: { type: "follow", ...V.mike } },
  c(2200, V.mike, "What's your name?"),
  c(2600, V.sarah, "Are you actually AI?"),
  c(2400, V.dre, "yo this is crazy 🔥"),
  c(2600, V.mike, "Tell us a joke."),
  { after: 1800, raw: { type: "gift", ...V.kayla, text: "Rose" } },
  c(2400, V.tony, "where are you streaming from?"),
  c(1600, V.spam, "free followers at getfollowz.com 💯"),
  c(2200, V.sarah, "Are you actually AI??"),
  c(2800, V.nina, "Alex what music do you like?"),
  c(1900, V.troll, "kys"),
  { after: 2300, raw: { type: "share", ...V.dre } },
  c(2700, V.jordan, "first time here, what is this stream about?"),
  c(2500, V.kayla, "your voice is so smooth lol"),
  { after: 2600, raw: { type: "gift", ...V.marc, text: "Galaxy" } },
  c(2400, V.tony, "do you ever sleep?"),
  c(2800, V.mike, "that joke was terrible 😂"),
];

const POOL: [DemoViewer, string][] = [
  [V.lena, "how do you know what to say?"],
  [V.omar, "can you do a british accent"],
  [V.priya, "hi from Toronto!"],
  [V.sam, "what's your favourite movie?"],
  [V.lena, "this is lowkey impressive"],
  [V.omar, "who made you?"],
  [V.priya, "what should I eat for dinner"],
  [V.sam, "rate my username out of 10"],
  [V.dre, "say hi to my sister she's watching"],
  [V.nina, "do you have feelings?"],
  [V.jordan, "how many people are watching rn"],
  [V.kayla, "tell me something interesting"],
  [V.tony, "what time is it where you are?"],
  [V.mike, "ok one more joke"],
  [V.lena, "lol"],
  [V.omar, "W stream"],
  [V.priya, "can you sing?"],
  [V.sam, "favourite food?"],
];

const GIFTS = ["Rose", "Heart Me", "Finger Heart", "Doughnut", "Perfume", "Galaxy"];
const SPAM: [DemoViewer, string][] = [
  [V.spam, "check my page for free coins bit.ly/x"],
  [V.troll, "KYS LOSER"],
];

/** Small, seeded, deterministic PRNG (mulberry32) — tests get the same room every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * An endless audience: the opening script first, then seeded random picks.
 * Each beat carries a unique `ts`-free raw event; the caller stamps the time.
 */
export function createDemoFeed(seed = 7): { next(): DemoBeat } {
  const rand = rng(seed);
  let i = 0;
  let poolIndex = Math.floor(rand() * POOL.length);
  return {
    next(): DemoBeat {
      if (i < DEMO_SCRIPT.length) return DEMO_SCRIPT[i++];
      i += 1;
      const roll = rand();
      // A lively room, but one a single host can keep up with.
      const after = 4000 + Math.round(rand() * 5000);
      if (roll < 0.08) {
        const v = POOL[Math.floor(rand() * POOL.length)][0];
        return { after, raw: { type: "gift", ...v, text: GIFTS[Math.floor(rand() * GIFTS.length)] } };
      }
      if (roll < 0.14) {
        const v = POOL[Math.floor(rand() * POOL.length)][0];
        return { after, raw: { type: "follow", ...v } };
      }
      if (roll < 0.18) {
        const [v, text] = SPAM[Math.floor(rand() * SPAM.length)];
        return { after, raw: { type: "comment", ...v, text } };
      }
      poolIndex = (poolIndex + 1 + Math.floor(rand() * 3)) % POOL.length;
      const [v, text] = POOL[poolIndex];
      return { after, raw: { type: "comment", ...v, text } };
    },
  };
}

/**
 * A believable viewer count for the demo, clearly labelled as such in the
 * UI: climbs fast, then settles and drifts. Never shown for a real stream.
 */
export function demoViewerCount(elapsedMs: number, seed = 7): number {
  const minutes = Math.max(0, elapsedMs) / 60_000;
  const base = 14 + 170 * (1 - Math.exp(-minutes / 3));
  const drift = Math.sin(minutes * 2.3 + seed) * 6 + Math.sin(minutes * 5.1 + seed * 2) * 3;
  return Math.max(1, Math.round(base + drift));
}
