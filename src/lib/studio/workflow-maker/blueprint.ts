// ---------------------------------------------------------------------------
// Workflow Maker — the blueprint, pure and tested.
//
// The owner's "rea to workflow": a video or picture of a process plus what
// they want → Jarvis watches it and writes the pipeline as a blueprint the
// owner edits on screen — the inputs (as upload slots), each stage with its
// engine and where it runs, the one result, the judge, and the Studio card —
// and Claude Code on the PC builds the real, working tool from it with the
// rea-to-workflow skill.
//
// The brief the PC reads is written in the prompt-enhancer's shape (goal,
// context, request in the owner's words, requirements, mastery, standard,
// success criteria) with the exact blueprint as JSON underneath, so nothing
// the owner approved is re-guessed from prose.
// ---------------------------------------------------------------------------

export const MAKER_FOLDER = "flow:workflow-maker";
export const MAKER_SKILL = "rea-to-workflow";

export type SlotKind = "video" | "image" | "text" | "audio" | "link";
export type RunsOn = "browser" | "cloud" | "pc";
export type Home = "studio" | "plugin" | "widget";
export type Mode = "recreate" | "change";

export interface BpSlot {
  id: string;
  label: string;
  kind: SlotKind;
  /** What it is for, one line ("the clip whose motion is kept"). */
  role: string;
  required: boolean;
}

export interface BpStage {
  id: string;
  label: string;
  /** The model, skill or tool that does it (Viggle, MiniMax H3, ffmpeg…). */
  engine: string;
  runsOn: RunsOn;
  detail: string;
  on: boolean;
}

export interface Blueprint {
  name: string;
  oneLiner: string;
  endGoal: string;
  /** The goal beyond the goal (Felix). */
  beyond: string;
  /** What the video showed, two or three sentences. */
  watched: string;
  mode: Mode;
  home: Home;
  inputs: BpSlot[];
  stages: BpStage[];
  /** The one result, shown big. */
  output: string;
  /** 2–4 checkable lines an outside judge can verify. */
  judge: string[];
  /** Where the money is, honestly — "" when it doesn't earn. */
  money: string;
  /** The Scholar's techniques for this field, each one line. */
  mastery: string[];
  card: { name: string; blurb: string; hue: number };
}

const KINDS: SlotKind[] = ["video", "image", "text", "audio", "link"];
const RUNS: RunsOn[] = ["browser", "cloud", "pc"];
const HOMES: Home[] = ["studio", "plugin", "widget"];

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, n: number, max: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : [];

export function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "my-workflow"
  );
}

/** Whatever a model (or an old save) wrote, as a well-formed blueprint over a fallback. */
export function coerceBlueprint(raw: unknown, fallback: Blueprint): Blueprint {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const inputs = Array.isArray(r.inputs)
    ? r.inputs
        .map((x, i): BpSlot | null => {
          if (!x || typeof x !== "object") return null;
          const o = x as Record<string, unknown>;
          const label = str(o.label, 48);
          if (!label) return null;
          return {
            id: `in${i + 1}`,
            label,
            kind: KINDS.includes(o.kind as SlotKind) ? (o.kind as SlotKind) : "text",
            role: str(o.role, 140),
            required: o.required !== false,
          };
        })
        .filter((x): x is BpSlot => Boolean(x))
        .slice(0, 8)
    : [];
  const stages = Array.isArray(r.stages)
    ? r.stages
        .map((x, i): BpStage | null => {
          if (!x || typeof x !== "object") return null;
          const o = x as Record<string, unknown>;
          const label = str(o.label, 48);
          if (!label) return null;
          return {
            id: `st${i + 1}`,
            label,
            engine: str(o.engine, 60) || "AI",
            runsOn: RUNS.includes(o.runsOn as RunsOn) ? (o.runsOn as RunsOn) : "cloud",
            detail: str(o.detail, 200),
            on: o.on !== false,
          };
        })
        .filter((x): x is BpStage => Boolean(x))
        .slice(0, 10)
    : [];
  const card = (r.card && typeof r.card === "object" ? r.card : {}) as Record<string, unknown>;
  const name = str(r.name, 48) || fallback.name;
  const hue = Number(card.hue);
  return {
    name,
    oneLiner: str(r.oneLiner, 160) || fallback.oneLiner,
    endGoal: str(r.endGoal, 200) || fallback.endGoal,
    beyond: str(r.beyond, 200) || fallback.beyond,
    watched: str(r.watched, 600) || fallback.watched,
    mode: r.mode === "recreate" || r.mode === "change" ? r.mode : fallback.mode,
    home: HOMES.includes(r.home as Home) ? (r.home as Home) : fallback.home,
    inputs: inputs.length ? inputs : fallback.inputs,
    stages: stages.length >= 2 ? stages : fallback.stages,
    output: str(r.output, 200) || fallback.output,
    judge: list(r.judge, 4, 200).length ? list(r.judge, 4, 200) : fallback.judge,
    money: str(r.money, 240),
    mastery: list(r.mastery, 8, 220).length ? list(r.mastery, 8, 220) : fallback.mastery,
    card: {
      name: str(card.name, 32) || name,
      blurb: str(card.blurb, 110) || fallback.card.blurb,
      hue: Number.isFinite(hue) ? Math.round(((hue % 360) + 360) % 360) : fallback.card.hue,
    },
  };
}

// ----- The no-AI first draft -----------------------------------------------------

interface Template {
  test: RegExp;
  name: string;
  oneLiner: string;
  endGoal: string;
  beyond: string;
  inputs: Omit<BpSlot, "id">[];
  stages: Omit<BpStage, "id" | "on">[];
  output: string;
  money: string;
  mastery: string[];
  hue: number;
}

/** Field templates the offline draft starts from, by what the request talks about. */
const TEMPLATES: Template[] = [
  {
    test: /\bclip(?:s|ping)?\b|\bshorts?\b|\bpodcast\b|\bhighlights?\b/i,
    name: "Clip Engine",
    oneLiner: "Paste a long video, get ready-to-post shorts",
    endGoal: "Turn one long video into shorts that earn, without editing by hand.",
    beyond: "Learns which hooks perform and finds better moments every week.",
    inputs: [
      { label: "Long video link", kind: "link", role: "the source the moments come from", required: true },
      { label: "Niche & tone", kind: "text", role: "what the channel is about and how it talks", required: false },
    ],
    stages: [
      { label: "Download", engine: "link-to-video", runsOn: "pc", detail: "The source file and its captions" },
      { label: "Find moments", engine: "OpenRouter (vision + transcript)", runsOn: "cloud", detail: "The 10 strongest self-contained moments" },
      { label: "Cut & caption", engine: "ffmpeg + embedded-captions", runsOn: "pc", detail: "9:16, face-centred, burned-in captions" },
      { label: "Hook score", engine: "Scholar rules", runsOn: "cloud", detail: "Scores the first 2 seconds of each clip" },
      { label: "Approve & queue", engine: "Personas Studio", runsOn: "browser", detail: "Nothing posts without approval" },
    ],
    output: "A grid of playable shorts with hook scores, approved one by one",
    money: "Paid clipping campaigns (per 1K views) and the creator's own channels.",
    mastery: [
      "The first 1.5 seconds decide the view: open on the line, not the lead-in.",
      "One idea per clip; cut the setup, keep the payoff.",
      "Captions in big two-to-four-word bursts, synced to the beat of the speech.",
    ],
    hue: 18,
  },
  {
    test: /\bswap\b|\breplace (?:the )?(?:character|person|face)\b|\brecast\b|\bviggle\b/i,
    name: "Recast",
    oneLiner: "Same motion, new characters, a new world",
    endGoal: "Put any character into any clip without reshooting.",
    beyond: "A saved cast the owner reuses across every new trend.",
    inputs: [
      { label: "Driving video", kind: "video", role: "the motion, camera and timing", required: true },
      { label: "New character", kind: "image", role: "a clear face photo", required: true },
      { label: "New world", kind: "image", role: "the background to stand in", required: false },
    ],
    stages: [
      { label: "Swap", engine: "Viggle Animate", runsOn: "pc", detail: "One frame edited, carried through every frame" },
      { label: "World", engine: "MiniMax H3", runsOn: "pc", detail: "A living plate from the background picture" },
      { label: "Composite", engine: "Robust Video Matting + ffmpeg", runsOn: "pc", detail: "Matted, light-wrapped, graded" },
    ],
    output: "A before | after you drag across",
    money: "Custom recasts for creators and brands; trend videos with a recurring avatar.",
    mastery: ["Mark the frame where every face is largest and frontal.", "Match the plate's light to the people, not the other way round."],
    hue: 220,
  },
  {
    test: /\bavatar\b|\btalking head\b|\bai influencer\b|\bspokes(?:person|model)\b/i,
    name: "Avatar Agent",
    oneLiner: "A consistent AI host that presents your scripts",
    endGoal: "Publish a daily talking-head video without filming.",
    beyond: "The avatar drafts tomorrow's script from what performed today.",
    inputs: [
      { label: "Avatar picture", kind: "image", role: "the host's face, kept the same every video", required: true },
      { label: "Script or topic", kind: "text", role: "what they say", required: true },
      { label: "Voice sample", kind: "audio", role: "how they sound", required: false },
    ],
    stages: [
      { label: "Script", engine: "OpenRouter", runsOn: "cloud", detail: "Hook, three beats, a call to action" },
      { label: "Voice", engine: "TTS", runsOn: "cloud", detail: "The host's voice" },
      { label: "Lip-sync video", engine: "MiniMax H3 / lip-sync", runsOn: "pc", detail: "The avatar speaks the line" },
      { label: "Captions & finish", engine: "embedded-captions", runsOn: "pc", detail: "9:16 with captions" },
    ],
    output: "A finished vertical video with the avatar speaking",
    money: "Sponsored segments and affiliate links once the channel grows.",
    mastery: ["Same framing, light and wardrobe every episode: consistency is the brand.", "Eye contact in the first frame."],
    hue: 280,
  },
  {
    test: /\bfitness\b|\bworkout\b|\bgym\b|\bexercise\b/i,
    name: "Fitness Reels",
    oneLiner: "Workout clips with form cues and counters",
    endGoal: "Post coaching-quality workout reels from raw gym footage.",
    beyond: "Builds a weekly program from the clips that got saved most.",
    inputs: [
      { label: "Workout clip", kind: "video", role: "the raw set", required: true },
      { label: "Exercise & cues", kind: "text", role: "what the move is and what to watch for", required: false },
    ],
    stages: [
      { label: "Find the reps", engine: "OpenRouter (vision)", runsOn: "cloud", detail: "Each rep and its best angle" },
      { label: "Cut & counter", engine: "ffmpeg + motion-graphics", runsOn: "pc", detail: "Rep counter and form cues on screen" },
      { label: "Finish", engine: "embedded-captions", runsOn: "pc", detail: "9:16 with music bed" },
    ],
    output: "A coached reel with rep counts and cues",
    money: "Program sales and coaching sign-ups from the reels.",
    mastery: ["Show the result in the first second, then the how.", "One cue per rep, never three."],
    hue: 140,
  },
  {
    test: /\bcook(?:ing)?\b|\brecipe\b|\basmr\b|\bkitchen\b|\bfood\b/i,
    name: "ASMR Kitchen",
    oneLiner: "Close-up cooking videos with crisp sound",
    endGoal: "Turn a recipe into a satisfying close-up cooking video.",
    beyond: "A series that brings viewers back every week for the next dish.",
    inputs: [
      { label: "Recipe or link", kind: "link", role: "what's being made", required: true },
      { label: "Hero ingredient photo", kind: "image", role: "the look of the dish", required: false },
    ],
    stages: [
      { label: "Shot list", engine: "OpenRouter", runsOn: "cloud", detail: "Macro shots in the order of the recipe" },
      { label: "Shots", engine: "MiniMax H3", runsOn: "pc", detail: "Close-ups: sizzle, pour, cut, steam" },
      { label: "Sound & cut", engine: "ffmpeg + media-use", runsOn: "pc", detail: "Foley-first mix, no music under the crunch" },
    ],
    output: "A 30–45 s close-up cooking video",
    money: "Brand deals with cookware and ingredients; recipe e-book.",
    mastery: ["Sound is the picture in ASMR: every cut lands on a sound.", "Macro, shallow focus, slow hands."],
    hue: 30,
  },
];

const GENERIC: Template = {
  test: /./,
  name: "My Workflow",
  oneLiner: "Your process, as a tool anyone can run",
  endGoal: "Do what the video shows in one place, without the manual steps.",
  beyond: "It gets better from every run's result.",
  inputs: [{ label: "What you start with", kind: "text", role: "the input the process begins from", required: true }],
  stages: [
    { label: "Understand", engine: "OpenRouter", runsOn: "cloud", detail: "Reads the input the way an expert would" },
    { label: "Make", engine: "the right skill for the job", runsOn: "pc", detail: "The step the video shows" },
    { label: "Review", engine: "Scholar critic", runsOn: "cloud", detail: "Checked against the field's best work" },
  ],
  output: "The finished result, shown big, kept in your list",
  money: "",
  mastery: ["Depict the result, not the steps.", "Slots with examples beat a blank box."],
  hue: 160,
};

/** A first blueprint without AI, from the request and what was attached. */
export function draftBlueprint(request: string, attached: ("video" | "image")[] = []): Blueprint {
  const t = TEMPLATES.find((x) => x.test.test(request)) ?? GENERIC;
  const mode: Mode = /\b(?:recreate|copy|same as|exactly|clone)\b/i.test(request) ? "recreate" : "change";
  const home: Home = /\bwidget\b|\bdashboard\b/i.test(request) ? "widget" : /\bapp\b|\bplugin\b|\bwebsite\b/i.test(request) && t === GENERIC ? "plugin" : "studio";
  const inputs = t.inputs.map((s, i) => ({ ...s, id: `in${i + 1}` }));
  if (t === GENERIC && attached.includes("video")) inputs.unshift({ id: "in0", label: "Video", kind: "video", role: "what the process starts from", required: true });
  return {
    name: t.name,
    oneLiner: t.oneLiner,
    endGoal: t.endGoal,
    beyond: t.beyond,
    watched: attached.length ? "Not watched yet — the AI wasn't available. Your PC watches it with video-analyzer before building." : "",
    mode,
    home,
    inputs: inputs.map((s, i) => ({ ...s, id: `in${i + 1}` })),
    stages: t.stages.map((s, i) => ({ ...s, id: `st${i + 1}`, on: true })),
    output: t.output,
    judge: [
      "A new user gets a real result from their own input without help",
      "The result file exists and opens or plays",
      "Every stage shows its progress and any error in plain words",
    ],
    money: t.money,
    mastery: t.mastery,
    card: { name: t.name, blurb: t.oneLiner, hue: t.hue },
  };
}

// ----- What must be true before it goes ----------------------------------------------

export function checkBlueprint(bp: Blueprint): string[] {
  const out: string[] = [];
  if (!bp.name.trim()) out.push("Give it a name.");
  if (!bp.inputs.length) out.push("Add at least one input — what the user starts with.");
  if (bp.stages.filter((s) => s.on).length < 2) out.push("Keep at least two stages switched on.");
  if (!bp.output.trim()) out.push("Say what comes out at the end.");
  if (!bp.judge.length) out.push("Add how we'll know it works.");
  return out;
}

const RUNS_LABEL: Record<RunsOn, string> = { browser: "in the browser", cloud: "in the cloud", pc: "on the owner's PC" };
const HOME_LABEL: Record<Home, string> = {
  studio: "a Studio card in Jarvis › Studio that opens its own screen (like Custom Video Swap)",
  plugin: "an App plugin card in Jarvis › App plugins with its own page",
  widget: "a Dashboard widget in Jarvis that expands on click",
};

/** Room for the brief inside a queue request, after the title and skill line. */
export const BRIEF_ROOM = 3_700;

/** The blueprint as the contract: compact (ids are rebuilt on read, switched-off stages dropped). */
function contract(bp: Blueprint): string {
  return JSON.stringify({
    ...bp,
    inputs: bp.inputs.map(({ id: _id, ...s }) => s),
    stages: bp.stages.filter((s) => s.on).map(({ id: _id, on: _on, ...s }) => s),
  });
}

/**
 * The brief the PC builds from, in the prompt-enhancer's shape (goal, context,
 * request, requirements, mastery, standard, success criteria), ending with the
 * exact blueprint as JSON. A queue request holds ~3,900 characters: the JSON
 * is the contract and always goes in whole; the prose and then the JSON's own
 * free text shorten around it when space runs out — never its structure.
 */
export function buildBrief(bp: Blueprint, request: string): string {
  const head = `WORKFLOW: ${bp.name} · ${bp.home === "studio" ? "Studio card + screen" : bp.home === "plugin" ? "App plugin" : "Dashboard widget"}`;
  const prose = [
    head,
    `<goal>${bp.endGoal} Beyond that: ${bp.beyond}</goal>`,
    `<context>Watched: ${bp.watched || "(no video — built from the owner's words)"} It lives as ${HOME_LABEL[bp.home]}. Mode: ${bp.mode === "recreate" ? "recreate what the video shows" : "change it to the owner's request"}.</context>`,
    `<request>${request.trim().slice(0, 600) || "(the owner only attached the video)"}</request>`,
    "<requirements>Build every input in BLUEPRINT JSON as an upload slot or field on the screen (never only a blank box), and every stage as a visible step with its engine, where it runs and real progress. Show the result big. Premium luxury feel (taste-skill), every state designed, works on a phone." +
      (bp.money ? ` Money: ${bp.money} Nothing posts or charges without the owner's approval.` : "") +
      "</requirements>",
    `<mastery>${bp.mastery.join(" · ")}</mastery>`,
    "<standard>The owner's build checklist (website-build-checklist): never a white page, every error logged and in plain words, works on a phone, no duplicates, newest first, works with no keys set.</standard>",
    `<success_criteria>${bp.judge.join(" · ")} — report real results, including anything that missed.</success_criteria>`,
  ].join("\n");
  const full = `${prose}\n\nBLUEPRINT JSON: ${contract(bp)}`;
  if (full.length <= BRIEF_ROOM) return full;

  const short = `${head}\nExpand the blueprint below into the full build prompt with the prompt-enhancer (goal, context, request, requirements, mastery, standard, success criteria).\n<request>${request.trim().slice(0, 300)}</request>`;
  const trims: ((b: Blueprint) => Blueprint)[] = [
    (b) => b,
    (b) => ({ ...b, watched: b.watched.slice(0, 160), mastery: b.mastery.map((m) => m.slice(0, 100)).slice(0, 4) }),
    (b) => ({ ...b, stages: b.stages.map((s) => ({ ...s, detail: s.detail.slice(0, 50) })), inputs: b.inputs.map((s) => ({ ...s, role: s.role.slice(0, 50) })) }),
    (b) => ({ ...b, watched: "", mastery: b.mastery.slice(0, 2), stages: b.stages.map((s) => ({ ...s, detail: "" })), inputs: b.inputs.map((s) => ({ ...s, role: "" })) }),
  ];
  let lean = bp;
  for (const trim of trims) {
    lean = trim(lean);
    const text = `${short}\n\nBLUEPRINT JSON: ${contract(lean)}`;
    if (text.length <= BRIEF_ROOM) return text;
  }
  return `${head}\n\nBLUEPRINT JSON: ${contract(lean)}`;
}

export function parseBlueprint(text: string): Blueprint | null {
  const m = /BLUEPRINT JSON: (\{.*\})\s*$/m.exec(text);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]) as unknown;
    const fb = draftBlueprint("");
    const bp = coerceBlueprint(raw, fb);
    return bp;
  } catch {
    return null;
  }
}
