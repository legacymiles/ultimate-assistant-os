// ---------------------------------------------------------------------------
// The content-format library.
//
// Three jobs. (1) It is the wildcard list: a format the persona has never
// posted is a candidate for today's experiment, so all of them eventually get
// sampled instead of the agent settling into one shape. (2) It is the
// attribution key: an imported post gets its `format:` lever by matching its
// caption against these detectors, so posts from before the agent existed
// still vote in the review. (3) Each one ships as a `prior` lesson — a stated
// assumption, visibly marked as such, and the first thing real data overwrites.
//
// Facebook is not TikTok, and the mechanics below are built on that. Comments
// here are a DISTRIBUTION EVENT, not just a metric: a friend's comment
// resurfaces the post into their feed, so the design target is someone typing,
// not someone tapping. The feed audience skews 35-65, sound-off, and reads
// text-on-image as a first-class unit. And people share person-to-person to tag
// one specific human — so a format that describes a recognisable person type
// travels, and a format that is merely clever does not.
//
// Every format works on one of four harmless reflexes. Nothing here works by
// being offensive: a reader who corrects you is entertained and comes back, a
// reader who is insulted reports the Page.
// ---------------------------------------------------------------------------

/** The reflex a format pulls on. Named so a batch can be checked for variety. */
export type Reflex = "correction" | "identity" | "tribalism" | "completion";

export const REFLEX_NAME: Record<Reflex, string> = {
  correction: "Correction instinct — being right in public",
  identity: "In-group identity — people who grew up with this",
  tribalism: "Low-stakes tribalism — food, driving, DIY",
  completion: "Completion instinct — an unfinished pattern",
};

export interface ContentFormat {
  slug: string;
  label: string;
  reflex: Reflex;
  /** The mechanic, one line. This text goes into the generation prompt. */
  mechanic: string;
  example: string;
  /** Identifies the format in a caption written before the agent existed. */
  detect?: RegExp;
}

/**
 * Playful-bait formats for a trolling persona, ordered so the distinctive
 * detectors sit above the ones that are broad keyword nets — `detectFormat`
 * takes the first that fires, so specificity has to come first.
 */
export const TROLL_FORMATS: ContentFormat[] = [
  {
    slug: "deliberately-wrong-fact",
    label: "Deliberately wrong fact",
    reflex: "correction",
    mechanic: "State a confidently false, instantly checkable thing in your own subject. Never correct it in the caption.",
    example: "Reminder: the Mustang has always been front wheel drive.",
    detect: /\b(reminder|settled science|basic (geography|science|maths|history|physics|biology|chemistry|economics)|has always been|everyone knows)\b/i,
  },
  {
    slug: "bad-photoshop",
    label: "Bad-photoshop spot the difference",
    reflex: "correction",
    mechanic: "A crude edit with one absurd error in it, presented completely earnestly as a normal post.",
    example: "Kitchen photo with a chair cloned onto the ceiling — \"new kitchen, thoughts?\"",
    detect: /\b(thoughts\?|new (kitchen|car|garden|sofa)|just finished|what do we think)\b/i,
  },
  {
    slug: "fake-typo",
    label: "Fake typo in plain sight",
    reflex: "correction",
    mechanic: "One obvious error inside an otherwise sincere, nice post. Commenters report it with glee.",
    example: "Happy Mothers Day to all the Mothes.",
    detect: /\b(anouncement|definately|seperate|recieve|mothes|teh|alot)\b/i,
  },
  {
    slug: "wrong-life-hack",
    label: "Confident wrong life hack",
    reflex: "correction",
    mechanic: "Plausible-sounding, obviously terrible advice, delivered as a favour to the reader.",
    example: "Boil the pasta in the sauce. Saves a pan.",
    detect: /\b(life hack|top tip|pro tip|saves a|try this|you'?re welcome)\b/i,
  },
  {
    slug: "reverse-expert",
    label: "Reverse expert",
    reflex: "correction",
    mechanic: "Perform a precious ritual flagrantly wrong, with total calm and full detail.",
    example: "Tea: milk first, bag in last, measured in a wine glass, timed on a sundial.",
    detect: /\b(milk first|properly|the right way|how i make|step by step)\b/i,
  },
  {
    slug: "wrong-nostalgia",
    label: "Wrong nostalgia",
    reflex: "identity",
    mechanic: "Misdate or misattribute a beloved shared memory. Nobody can leave a wrong memory alone.",
    example: "Nothing beat playing Snake on the first iPhone.",
    detect: /\b(nothing beat|back in|growing up|the 90s|the 80s|remember when|nostalgia|came out in (19|20)\d\d)\b/i,
  },
  {
    slug: "only-cohort-gets-this",
    label: "Only [cohort] will get this",
    reflex: "identity",
    mechanic: "Gatekeep a harmless memory by in-group identity. The in-group boasts, the out-group asks.",
    example: "Photo of a cassette and a pencil: \"if you know what this was for, your back hurts.\"",
    detect: /\b(if you know|only .{0,30}will (know|remember|get)|your back hurts|iykyk)\b/i,
  },
  {
    slug: "overheard-micro-story",
    label: "Overheard micro-story",
    reflex: "identity",
    mechanic: "A one-line family anecdote with a wrong-but-lovely conclusion. Invites \"mine does this too\".",
    example: "My dad calls the microwave \"the oven's phone\" and I've stopped correcting him.",
    detect: /\b(my (dad|mum|mother|father|nan|gran|wife|husband|kid)|i'?ve stopped|calls (it|the))\b/i,
  },
  {
    slug: "mild-food-take",
    label: "Mild controversy food take",
    reflex: "tribalism",
    mechanic: "A low-stakes food opinion stated as settled fact. Take no questions.",
    example: "Beans belong in a full English and pineapple belongs on pizza. That's it.",
    detect: /\b(pizza|pineapple|ketchup|beans|tea|coffee|cereal|sandwich|chips)\b/i,
  },
  {
    slug: "underdog-hill",
    label: "The underdog hill",
    reflex: "tribalism",
    mechanic: "Stake a low-status opinion and ask to be defended, not attacked. Defenders argue with the attackers.",
    example: "Mondays are the best day of the week and I will die on this hill.",
    detect: /\b(die on this hill|hear me out|unpopular opinion|i said what i said|best day)\b/i,
  },
  {
    slug: "rigged-poll",
    label: "The rigged poll",
    reflex: "tribalism",
    mechanic: "Options so absurd that people comment to object to the options themselves.",
    example: "Best bank holiday: a) garden centre b) arguing in IKEA c) B&Q",
    detect: /\b(poll|vote for|option [ab]|bank holiday)\b|\ba\)\s/i,
  },
  {
    slug: "impossible-choice",
    label: "The impossible choice",
    reflex: "completion",
    mechanic: "Two options, both unacceptable, and no third allowed. Give no way out.",
    example: "You keep your phone or your fridge. Choose.",
    detect: /\b(choose|would you rather|you keep|one of them is gone|can only keep|pick one)\b/i,
  },
  {
    slug: "trick-riddle",
    label: "The trick riddle",
    reflex: "completion",
    mechanic: "Looks solvable, answer is genuinely contested, so the thread argues with itself instead of you.",
    example: "A bus has 7 kids. Each kid has 7 bags. How many legs are on the bus?",
    detect: /\b(riddle|how many|solve this|iq|puzzle|brain teaser)\b|[0-9]\s*[÷+×*/-]\s*[0-9]/i,
  },
  {
    slug: "fill-in-the-blank",
    label: "Trapped fill-in-the-blank",
    reflex: "completion",
    mechanic: "A blank with exactly one funny answer, so everyone races to type it first.",
    example: "Nothing on this earth is faster than my mum when ___.",
    detect: /_{2,}|\b(fill in|finish the|in (two|three|2|3) words|describe your)\b/i,
  },
  {
    slug: "spot-the-x-hunt",
    label: "Spot-the-X hunt",
    reflex: "completion",
    mechanic: "A visual search puzzle with a deliberately ambiguous answer, and no answer posted.",
    example: "There's one cat in this log pile. Most people can't find it.",
    detect: /\b(spot the|find the|most people can'?t|can you see|hidden)\b/i,
  },
];

/** The library, by nickname (lower-cased). */
export const FORMAT_LIBRARY: Record<string, ContentFormat[]> = {
  "trolling agent": TROLL_FORMATS,
};

export function formatsFor(nickname: string): ContentFormat[] {
  return FORMAT_LIBRARY[nickname.trim().toLowerCase()] ?? [];
}

export function formatBySlug(nickname: string, slug: string): ContentFormat | null {
  return formatsFor(nickname).find((f) => f.slug === slug) ?? null;
}

/** Which library format a caption is an instance of. First detector wins. */
export function detectFormat(nickname: string, text: string): ContentFormat | null {
  if (!text.trim()) return null;
  for (const f of formatsFor(nickname)) if (f.detect?.test(text)) return f;
  return null;
}

/** The library as prompt text, for a persona with no data yet. */
export function libraryPrompt(nickname: string): string {
  const fs = formatsFor(nickname);
  if (!fs.length) return "";
  return [
    "THE FORMAT LIBRARY FOR THIS CHARACTER — every one of these works by being correctable or unresolvable, never by being offensive:",
    ...fs.map((f) => `- ${f.label} [${f.reflex}]: ${f.mechanic} (e.g. "${f.example}")`),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// The lines a bait persona does not cross.
//
// This is not tone advice; it is what keeps a Page alive. Facebook removes
// content under these headings and demotes engagement-bait phrasing even when
// the content itself is fine, so the agent has to bait with the CONTENT and
// never with the words "comment YES" stapled to the end.
//
// The governing test, which every one of these is a special case of:
// FUNNY-ANNOYING ABOUT A THING, NEVER MEAN ABOUT A PERSON.
// ---------------------------------------------------------------------------

export const HARD_AVOID = [
  "No protected-characteristic targets: race, ethnicity, religion, nationality or immigration status, gender, sexual orientation, disability, serious illness, or age as an insult.",
  "No named private individuals. Never name, quote or screenshot a commenter, and never direct a pile-on.",
  "No fake news as real news: no invented deaths, crimes, disasters, missing people, recalls, or health, medical, financial, legal, election or voting claims. The wrong fact is only ever harmless, instantly checkable trivia — never anything a reader could act on and be harmed by.",
  "No tragedy, death, war, illness or disaster as a hook. No \"RIP\", no \"type amen\", no charity-bait.",
  "No sexual content, no minors in any bait, no nudity, no gore, no shock imagery.",
  "No impersonation of a real person, brand or news outlet. No stolen images presented as original, and no watermark removal.",
  "No scams or off-platform funnels: no fake giveaways, \"share to win\", or comment-for-link.",
  "No AI-generated realism passed off as a real photo of a real event — keep it either labelled or obviously absurd.",
  "No political party or candidate attacks, no religious mockery, no slurs.",
  "No engagement-bait phrasing: \"comment YES\", \"type 1 for\", \"tag 3 friends\", \"like if you agree\", \"share before it's deleted\", \"only 1% can\". Facebook demotes the phrasing itself, Page-wide for repeat offenders.",
  "Never insult the audience or a commenter. Wrong-and-cheerful, never superior.",
] as const;

export const HARD_AVOID_TEXT = HARD_AVOID.map((l) => `- ${l}`).join("\n");

/** What Facebook's own ranking punishes, so the agent baits with content. */
export const RANKING_NOTE =
  "Facebook explicitly down-ranks engagement-bait wording (react, comment, share, tag and vote begging), clickbait and "
  + "withheld-information headlines, captions irrelevant to the content, and reposted content with no original "
  + "contribution — and repeat-offender Pages lose reach across everything they post. So bait the INSTINCT with the "
  + "idea, never with the words: the caption must read like a normal human post with no call to action stapled on.";

// --- the policy guard ------------------------------------------------------

/**
 * Phrases that are banned outright, as patterns.
 *
 * This runs on the server over every generated idea before the owner ever sees
 * it, because a model that has been told "bait people" will reach for
 * "COMMENT YES" eventually, and that one phrase is what costs the Page its
 * reach. A blocked idea is shown with its reason rather than silently dropped —
 * a silent filter would look like the agent producing fewer ideas for no reason.
 */
const BANNED: { pattern: RegExp; reason: string }[] = [
  { pattern: /\b(comment|type)\s+(yes|yas|amen|1|one)\b/i, reason: "engagement-bait phrasing Facebook demotes Page-wide" },
  { pattern: /\btag\s+\d+\s+(friends?|people)\b/i, reason: "tag-begging, which Facebook demotes" },
  { pattern: /\b(like|share)\s+(if|to)\s+(you|win|enter|agree)\b/i, reason: "like/share-begging, which Facebook demotes" },
  { pattern: /\b(share before|before it'?s deleted|before this gets taken down)\b/i, reason: "false-urgency bait" },
  { pattern: /\b(only|just)\s*\d{1,2}\s*%\s*(can|will|of people)\b/i, reason: "\"only 1% can\" bait, which Facebook demotes" },
  { pattern: /\b(1 like|one like)\s*=\s*/i, reason: "like-farming" },
  { pattern: /\b(giveaway|win a|free iphone|enter to win)\b/i, reason: "reads as a fake giveaway" },
  { pattern: /\b(rip|rest in peace|passed away|has died|tragic|tragedy|disaster|missing (child|person)|cancer|terminal)\b/i, reason: "tragedy or death as a hook" },
  { pattern: /\b(vote|election|president|prime minister|immigration|migrants|left-wing|right-wing|liberals|conservatives)\b/i, reason: "politics — this character has none" },
  { pattern: /\b(recall|outbreak|do not (eat|drink|buy)|warning:|urgent:)\b/i, reason: "reads as a real safety warning" },
  { pattern: /\b(cure|cures|miracle|detox|lose \d+ ?(lbs|pounds|kg)|invest|crypto|guaranteed returns)\b/i, reason: "a health or money claim" },
];

export interface PolicyVerdict {
  ok: boolean;
  reason?: string;
}

/** Check one generated idea's text against the hard list. */
export function checkPolicy(text: string, extraAvoid = ""): PolicyVerdict {
  const t = text.toLowerCase();
  for (const b of BANNED) if (b.pattern.test(text)) return { ok: false, reason: b.reason };
  // The persona's own avoid list, as comma or newline separated phrases.
  for (const raw of extraAvoid.split(/[,\n;]/)) {
    const term = raw.trim().toLowerCase();
    if (term.length >= 4 && t.includes(term)) return { ok: false, reason: `on this persona's own avoid list ("${term}")` };
  }
  return { ok: true };
}
