// ---------------------------------------------------------------------------
// Workflow Maker — the blueprint, pure and tested.
//
// The owner's "rea to workflow": a video or picture of a process plus what
// they want → Jarvis watches it and writes the pipeline as a blueprint the
// owner edits on screen — the inputs (as upload slots), each stage with its
// engine and where it runs, the one result, the judge, and the Studio card —
// and Claude Code on the PC builds the real, working thing from it with the
// rea-to-workflow skill.
//
// It is not only for videos. What it makes (`kind`) can be a workflow, an
// AGENT that goes and makes money (clipping, flipping websites, shipping web
// games…), an app, a website or a game. An agent comes with its kit: the goal
// it works toward, the tools it can use, the websites and resources it works
// from, the accounts to connect, when it runs, what it must ask the owner
// first, what it tracks, and its first moves.
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
export type Home = "studio" | "plugin" | "widget" | "agent";
export type Mode = "recreate" | "change";
/** What the Workflow Maker makes. */
export type MakeKind = "workflow" | "agent" | "app" | "website" | "game";
export type ToolKind = "skill" | "app" | "api" | "model" | "site";

export interface AgentTool {
  name: string;
  /** What the agent uses it for, one line. */
  does: string;
  kind: ToolKind;
  /** Already in Jarvis / the owner's skills (true) or needs setting up (false). */
  ready: boolean;
}

export interface AgentResource {
  label: string;
  /** Only a real address; "" when not known for sure. */
  url: string;
  why: string;
}

/** The agent's kit — everything it needs to go and do the job on its own. */
export interface AgentKit {
  /** Who it is, one line ("Finds paid clipping campaigns and fills them"). */
  role: string;
  /** A target it can be measured against ("$500 a month from campaigns"). */
  goal: string;
  tools: AgentTool[];
  resources: AgentResource[];
  /** Accounts the owner connects once (YouTube, GitHub, Stripe…). */
  accounts: string[];
  /** When it works ("every morning at 8, and when a new campaign appears"). */
  cadence: string;
  /** What it never does without the owner's yes. */
  approvals: string[];
  /** What it keeps score on. */
  kpis: string[];
  /** Its first three moves, today. */
  firstMoves: string[];
}

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
  /** What it makes: a workflow, an agent, an app, a website or a game. */
  kind: MakeKind;
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
  /** The agent's kit when it makes an agent (or a workflow that works on its own); null otherwise. */
  agent: AgentKit | null;
}

const KINDS: SlotKind[] = ["video", "image", "text", "audio", "link"];
const RUNS: RunsOn[] = ["browser", "cloud", "pc"];
const HOMES: Home[] = ["studio", "plugin", "widget", "agent"];
export const MAKE_KINDS: MakeKind[] = ["workflow", "agent", "app", "website", "game"];
const TOOL_KINDS: ToolKind[] = ["skill", "app", "api", "model", "site"];

/** A real-looking address only: http(s), a dot in the host, no spaces. */
export function safeUrl(v: unknown): string {
  const u = typeof v === "string" ? v.trim() : "";
  if (!u || /\s/.test(u) || u.length > 300) return "";
  try {
    const full = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const url = new URL(full);
    // Keep the address as written (a round trip must not change it), once it's known to be real-looking.
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? full : "";
  } catch {
    return "";
  }
}

export function coerceAgent(raw: unknown): AgentKit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tools = Array.isArray(o.tools)
    ? o.tools
        .map((x): AgentTool | null => {
          if (!x || typeof x !== "object") return null;
          const t = x as Record<string, unknown>;
          const name = str(t.name, 48);
          if (!name) return null;
          return {
            name,
            does: str(t.does, 140),
            kind: TOOL_KINDS.includes(t.kind as ToolKind) ? (t.kind as ToolKind) : "skill",
            ready: t.ready === true,
          };
        })
        .filter((x): x is AgentTool => Boolean(x))
        .slice(0, 12)
    : [];
  const resources = Array.isArray(o.resources)
    ? o.resources
        .map((x): AgentResource | null => {
          if (!x || typeof x !== "object") return null;
          const r = x as Record<string, unknown>;
          const label = str(r.label, 60);
          if (!label) return null;
          return { label, url: safeUrl(r.url), why: str(r.why, 140) };
        })
        .filter((x): x is AgentResource => Boolean(x))
        .slice(0, 10)
    : [];
  const kit: AgentKit = {
    role: str(o.role, 160),
    goal: str(o.goal, 160),
    tools,
    resources,
    accounts: list(o.accounts, 8, 60),
    cadence: str(o.cadence, 140),
    approvals: list(o.approvals, 6, 140),
    kpis: list(o.kpis, 6, 100),
    firstMoves: list(o.firstMoves, 5, 160),
  };
  return kit.role || kit.goal || kit.tools.length ? kit : null;
}

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
  const kind: MakeKind = MAKE_KINDS.includes(r.kind as MakeKind) ? (r.kind as MakeKind) : fallback.kind;
  const agent = coerceAgent(r.agent) ?? (kind === "agent" ? fallback.agent : null);
  return {
    name,
    oneLiner: str(r.oneLiner, 160) || fallback.oneLiner,
    endGoal: str(r.endGoal, 200) || fallback.endGoal,
    beyond: str(r.beyond, 200) || fallback.beyond,
    watched: str(r.watched, 600) || fallback.watched,
    mode: r.mode === "recreate" || r.mode === "change" ? r.mode : fallback.mode,
    kind,
    home: HOMES.includes(r.home as Home) ? (r.home as Home) : kind === "agent" ? "agent" : fallback.home,
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
    agent,
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
  /** The kit when this field is run as an agent. */
  agent?: AgentKit;
}

const ASK_FIRST = ["Posting anything publicly", "Sending a message to a person", "Spending money or signing up for paid plans"];

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
    agent: {
      role: "A clipper that finds paid clipping campaigns and creators worth clipping, and keeps shorts flowing",
      goal: "Earn from paid clipping campaigns every week — start with one campaign and 10 approved clips",
      tools: [
        { name: "Money Agent Studio", does: "Its home: Clippers, Campaigns, the Approve queue and Earnings", kind: "app", ready: true },
        { name: "link-to-video", does: "Downloads the source video from any link", kind: "skill", ready: true },
        { name: "video-analyzer", does: "Watches the source to find the moments people share", kind: "skill", ready: true },
        { name: "embedded-captions", does: "Burns in captions that hold attention", kind: "skill", ready: true },
        { name: "Personas Studio", does: "Posts approved clips on the persona's own accounts", kind: "app", ready: true },
        { name: "Web search", does: "Finds live campaigns, their rate per 1K views and rules", kind: "api", ready: true },
      ],
      resources: [
        { label: "Whop", url: "https://whop.com", why: "Content Rewards campaigns that pay per 1K views" },
        { label: "YouTube", url: "https://www.youtube.com", why: "Long videos to clip and a place to post Shorts" },
        { label: "TikTok", url: "https://www.tiktok.com", why: "Where most clipping campaigns count views" },
        { label: "Instagram", url: "https://www.instagram.com", why: "Reels count for many campaigns too" },
      ],
      accounts: ["TikTok", "YouTube", "Instagram (through Personas Studio)", "A campaign platform account"],
      cadence: "Every morning: check campaigns and new uploads from the creators it clips; clips land in Approve by evening",
      approvals: ASK_FIRST,
      kpis: ["Views per clip", "Approved clips per week", "Earnings per campaign (into Financial Bible)"],
      firstMoves: [
        "Find three live campaigns that fit the owner's niche, with their pay and rules",
        "Pick the best one and its source videos",
        "Make the first 5 clips and put them in Approve",
      ],
    },
  },
  {
    test: /\b(?:recreat\w*|redesign\w*|rebuild\w*|flip\w*|clon\w*) (?:\w+ )?(?:web)?sites?\b|\bwebsites? (?:for|to) (?:local )?(?:business|client)|\bweb ?design\b|\blocal business(?:es)?\b/i,
    name: "Site Flipper",
    oneLiner: "Finds businesses with weak websites and rebuilds them to sell",
    endGoal: "Land paying website clients by showing them their new site before they pay.",
    beyond: "Every sold site brings a monthly care plan and a referral.",
    inputs: [
      { label: "City & business type", kind: "text", role: "where and who to look for (\"barbers in Columbus\")", required: true },
      { label: "Their website", kind: "link", role: "the site to rebuild, when you already have one", required: false },
    ],
    stages: [
      { label: "Find leads", engine: "apify (Google Maps) + local-seo", runsOn: "cloud", detail: "Businesses with no site, a slow site or bad reviews of it" },
      { label: "Score the site", engine: "seo-audit + PageSpeed", runsOn: "cloud", detail: "What's broken, in plain words, with numbers" },
      { label: "Rebuild it", engine: "website-redesigner + clone-site", runsOn: "pc", detail: "Same content, a premium new design, on its own Vercel link" },
      { label: "Pitch", engine: "Client Review + Gmail draft", runsOn: "cloud", detail: "Before | after and the live link — sent only after you approve" },
      { label: "Close & hand over", engine: "GitHub + Vercel", runsOn: "pc", detail: "Their repo and project, their domain" },
    ],
    output: "A pipeline of leads, each with a finished redesign and a pitch waiting for your yes",
    money: "One-off site builds plus monthly care plans; payments to your own Stripe.",
    mastery: [
      "Show, don't pitch: the business sees its own new site before any price.",
      "Lead with the one number they feel — calls lost to a slow, broken phone page.",
      "Keep their content and photos so it is unmistakably theirs, only better.",
    ],
    hue: 200,
    agent: {
      role: "A website agency in a box: finds local businesses with weak sites, rebuilds them and lines up the pitch",
      goal: "Two paying website clients this month",
      tools: [
        { name: "apify", does: "Pulls local businesses from Google Maps with their website and reviews", kind: "skill", ready: true },
        { name: "seo-audit / local-seo", does: "Scores each site and its Google ranking", kind: "skill", ready: true },
        { name: "website-redesigner", does: "Rebuilds the site with a fresh design, same function", kind: "skill", ready: true },
        { name: "clone-site", does: "Reads the old site's content and structure to rebuild from", kind: "skill", ready: true },
        { name: "Client Review", does: "Sends the client their new site and collects edits", kind: "app", ready: true },
        { name: "Gmail", does: "Drafts the pitch email — sent only on your yes", kind: "api", ready: true },
        { name: "GitHub + Vercel", does: "A repo and a live link per client", kind: "api", ready: true },
      ],
      resources: [
        { label: "Google Maps", url: "https://www.google.com/maps", why: "Where local businesses and their websites are listed" },
        { label: "PageSpeed Insights", url: "https://pagespeed.web.dev", why: "Proof that their current site is slow on phones" },
        { label: "Upwork", url: "https://www.upwork.com", why: "Businesses already asking for website work" },
        { label: "Fiverr", url: "https://www.fiverr.com", why: "A second marketplace for website gigs" },
      ],
      accounts: ["Gmail", "GitHub", "Vercel", "Stripe (for payments)"],
      cadence: "Weekday mornings: 10 new leads scored, the best 2 rebuilt by afternoon",
      approvals: ["Sending any pitch or message to a business", "Publishing a site on a client's domain", "Charging anyone"],
      kpis: ["Leads found", "Redesigns ready", "Pitches sent", "Replies", "Clients won and monthly revenue"],
      firstMoves: [
        "Pull 20 businesses of the owner's chosen type in the owner's city",
        "Score their sites and pick the 3 with the most to gain",
        "Rebuild the best one and draft the pitch for approval",
      ],
    },
  },
  {
    test: /\bgames?\b|\bgameplay\b|\bplayable\b/i,
    name: "Game Forge",
    oneLiner: "Turns a game you like into an original game you can publish",
    endGoal: "Ship small, polished web games that earn from plays.",
    beyond: "Each release teaches the next one what keeps players coming back.",
    inputs: [
      { label: "Gameplay video", kind: "video", role: "the game whose fun you want to capture", required: false },
      { label: "Your twist", kind: "text", role: "theme, character or rule that makes it yours", required: true },
    ],
    stages: [
      { label: "Find the fun", engine: "video-analyzer + rea", runsOn: "pc", detail: "The core loop, controls and pacing, rebuilt as rules" },
      { label: "Design", engine: "Scholar (game design)", runsOn: "cloud", detail: "Original theme, art direction and the hook" },
      { label: "Build", engine: "Game Studio › Game Creator", runsOn: "pc", detail: "A playable web build" },
      { label: "Playtest", engine: "playwright-cli", runsOn: "pc", detail: "It loads, it plays, it doesn't crash" },
      { label: "Publish", engine: "itch.io / web game portals", runsOn: "browser", detail: "Only after you approve" },
    ],
    output: "A playable original game with a store page ready to publish",
    money: "Ad revenue share on web game portals, paid downloads, then bigger stores.",
    mastery: [
      "Copy the loop, never the look: same fun, original everything else.",
      "A new player should be having fun inside 10 seconds.",
      "One more round: end every run one step short of the next reward.",
    ],
    hue: 300,
    agent: {
      role: "A small game studio: finds what's fun, builds an original version and lines up the release",
      goal: "One original web game published this month, then one every two weeks",
      tools: [
        { name: "Game Studio", does: "Builds and hosts playable games in Jarvis", kind: "app", ready: true },
        { name: "video-analyzer + rea", does: "Breaks down the game's loop from gameplay video", kind: "skill", ready: true },
        { name: "unreal-game-builder", does: "Bigger 3D games as a Windows build", kind: "skill", ready: true },
        { name: "playwright-cli", does: "Plays the build to prove it works", kind: "skill", ready: true },
        { name: "Web search", does: "Finds what's trending on game portals right now", kind: "api", ready: true },
      ],
      resources: [
        { label: "itch.io", url: "https://itch.io", why: "Publish and sell indie games, see what's popular" },
        { label: "CrazyGames for developers", url: "https://developer.crazygames.com", why: "A web game portal that shares ad revenue" },
      ],
      accounts: ["itch.io", "A web game portal developer account"],
      cadence: "A new game idea every Monday; a playable build by Friday",
      approvals: ["Publishing a game", "Using any art or sound that isn't original or licensed", "Spending money"],
      kpis: ["Plays", "Average play time", "Returning players", "Earnings"],
      firstMoves: [
        "Pick three trending games and name the loop that makes each one fun",
        "Design an original game around the best loop",
        "Build a playable first version in Game Studio",
      ],
    },
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

const GENERIC_AGENT: AgentKit = {
  role: "Does the method in the video on its own and reports back",
  goal: "A first real result this week, measured",
  tools: [
    { name: "Web search", does: "Finds what's working right now and the places to do it", kind: "api", ready: true },
    { name: "Jarvis skills", does: "The owner's skills for the steps the video shows", kind: "skill", ready: true },
  ],
  resources: [],
  accounts: [],
  cadence: "Every morning, with a short report",
  approvals: ASK_FIRST,
  kpis: ["Results made", "Money earned (into Financial Bible)"],
  firstMoves: ["Research the method with deep research", "Set up the accounts it needs, with your OK", "Make the first result"],
};

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
/** What the request asks to make. An agent when it talks about an agent or earning on its own. */
export function kindOf(request: string): MakeKind {
  const r = request.toLowerCase();
  if (/\bagents?\b|\bmake (?:me )?money\b|\bearn\w*\b|\bside hustle\b|\bpassive income\b|\bon (?:its|it's) own\b|\b24\/7\b|\bautomat\w* (?:the )?(?:business|income)\b/.test(r)) return "agent";
  if (/\bgames?\b/.test(r)) return "game";
  if (/\b(?:web)?sites?\b|\blanding page\b/.test(r)) return "website";
  if (/\bapp\b|\bplugin\b|\btool\b/.test(r)) return "app";
  return "workflow";
}

export function draftBlueprint(request: string, attached: ("video" | "image")[] = []): Blueprint {
  const t = TEMPLATES.find((x) => x.test.test(request)) ?? GENERIC;
  const mode: Mode = /\b(?:recreate|copy|same as|exactly|clone)\b/i.test(request) ? "recreate" : "change";
  const kind = kindOf(request);
  const home: Home =
    kind === "agent"
      ? "agent"
      : /\bwidget\b|\bdashboard\b/i.test(request)
        ? "widget"
        : kind === "app" || kind === "website" || kind === "game"
          ? "plugin"
          : "studio";
  const inputs = t.inputs.map((s, i) => ({ ...s, id: `in${i + 1}` }));
  if (t === GENERIC && attached.includes("video")) inputs.unshift({ id: "in0", label: "Video", kind: "video", role: "what the process starts from", required: true });
  return {
    name: t.name,
    oneLiner: t.oneLiner,
    endGoal: t.endGoal,
    beyond: t.beyond,
    watched: attached.length ? "Not watched yet — the AI wasn't available. Your PC watches it with video-analyzer before building." : "",
    mode,
    kind,
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
    agent: kind === "agent" ? (t.agent ?? GENERIC_AGENT) : null,
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
  if (bp.kind === "agent") {
    if (!bp.agent) out.push("Give the agent its kit — a goal and its tools.");
    else {
      if (!bp.agent.goal.trim()) out.push("Give the agent a goal it can be measured against.");
      if (!bp.agent.tools.length) out.push("Give the agent at least one tool.");
      if (!bp.agent.approvals.length) out.push("Say what the agent must ask you before doing.");
    }
  }
  return out;
}

const RUNS_LABEL: Record<RunsOn, string> = { browser: "in the browser", cloud: "in the cloud", pc: "on the owner's PC" };
const HOME_LABEL: Record<Home, string> = {
  studio: "a Studio card in Jarvis › Studio that opens its own screen (like Custom Video Swap)",
  plugin: "an App plugin card in Jarvis › App plugins with its own page",
  widget: "a Dashboard widget in Jarvis that expands on click",
  agent: "a standing agent in Jarvis with its own page: goal and scorecard, approve/decline cards, a live log, running on a schedule",
};
export const HOME_SHORT: Record<Home, string> = { studio: "Studio card + screen", plugin: "App plugin", widget: "Dashboard widget", agent: "Agent" };
export const KIND_LABEL: Record<MakeKind, string> = { workflow: "Workflow", agent: "Agent", app: "App", website: "Website", game: "Game" };

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
  const head = `WORKFLOW: ${bp.name} · ${KIND_LABEL[bp.kind]} · ${HOME_SHORT[bp.home]}`;
  const a = bp.agent;
  const agentReq = a
    ? ` The agent: ${a.role} Goal: ${a.goal}. It works from the tools, websites and accounts in BLUEPRINT JSON .agent (set up any that aren't ready — ready:false — with one-click steps for the owner), runs ${a.cadence || "on a schedule"}, keeps score on ${a.kpis.join(", ") || "its results"}, and asks the owner first before: ${a.approvals.join("; ")}. Research the method live (deep-research) before trusting any rate, platform or rule.`
    : "";
  const prose = [
    head,
    `<goal>${bp.endGoal} Beyond that: ${bp.beyond}</goal>`,
    `<context>Watched: ${bp.watched || "(no video — built from the owner's words)"} It lives as ${HOME_LABEL[bp.home]}. Mode: ${bp.mode === "recreate" ? "recreate what the video shows" : "change it to the owner's request"}.</context>`,
    `<request>${request.trim().slice(0, 600) || "(the owner only attached the video)"}</request>`,
    "<requirements>Build every input in BLUEPRINT JSON as an upload slot or field on the screen (never only a blank box), and every stage as a visible step with its engine, where it runs and real progress. Show the result big. Premium luxury feel (taste-skill), every state designed, works on a phone." +
      (bp.money ? ` Money: ${bp.money} Nothing posts or charges without the owner's approval.` : "") +
      agentReq +
      "</requirements>",
    `<mastery>${bp.mastery.join(" · ")}</mastery>`,
    "<standard>The owner's build checklist (website-build-checklist): never a white page, every error logged and in plain words, works on a phone, no duplicates, newest first, works with no keys set.</standard>",
    `<success_criteria>${bp.judge.join(" · ")} — report real results, including anything that missed.</success_criteria>`,
  ].join("\n");
  const full = `${prose}\n\nBLUEPRINT JSON: ${contract(bp)}`;
  if (full.length <= BRIEF_ROOM) return full;

  const guard = a ? `\nThe agent works from BLUEPRINT JSON .agent and asks the owner first before: ${a.approvals.join("; ").slice(0, 300)}.` : "";
  const short = `${head}\nExpand the blueprint below into the full build prompt with the prompt-enhancer (goal, context, request, requirements, mastery, standard, success criteria).\n<request>${request.trim().slice(0, 300)}</request>${guard}`;
  const trims: ((b: Blueprint) => Blueprint)[] = [
    (b) => b,
    (b) => ({ ...b, watched: b.watched.slice(0, 160), mastery: b.mastery.map((m) => m.slice(0, 100)).slice(0, 4) }),
    (b) => ({ ...b, stages: b.stages.map((s) => ({ ...s, detail: s.detail.slice(0, 50) })), inputs: b.inputs.map((s) => ({ ...s, role: s.role.slice(0, 50) })) }),
    (b) => ({ ...b, watched: "", mastery: b.mastery.slice(0, 2), stages: b.stages.map((s) => ({ ...s, detail: "" })), inputs: b.inputs.map((s) => ({ ...s, role: "" })) }),
    (b) =>
      b.agent
        ? {
            ...b,
            agent: {
              ...b.agent,
              tools: b.agent.tools.map((t) => ({ ...t, does: t.does.slice(0, 40) })),
              resources: b.agent.resources.map((r) => ({ ...r, why: r.why.slice(0, 40) })),
              firstMoves: b.agent.firstMoves.map((m) => m.slice(0, 80)),
            },
          }
        : b,
    (b) =>
      b.agent
        ? { ...b, agent: { ...b.agent, tools: b.agent.tools.map((t) => ({ ...t, does: "" })), resources: b.agent.resources.map((r) => ({ ...r, why: "" })), firstMoves: b.agent.firstMoves.slice(0, 2) } }
        : b,
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
