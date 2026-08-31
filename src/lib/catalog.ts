// ---------------------------------------------------------------------------
// Single source of truth for the hub.
// Add a new project = add an object to PROJECTS. Everything else is derived.
// ---------------------------------------------------------------------------

export type Category =
  | "AI"
  | "Image"
  | "Video"
  | "Music"
  | "Trading"
  | "Automation"
  | "Websites"
  | "Apps"
  | "Utilities";

export const CATEGORIES: Category[] = [
  "AI",
  "Image",
  "Video",
  "Music",
  "Trading",
  "Automation",
  "Websites",
  "Apps",
  "Utilities",
];

/** Visual style used for each animated icon. */
export type IconStyle = "aurora" | "orbit" | "rings" | "mesh" | "pulse" | "waves";

export interface CatalogProject {
  slug: string;
  title: string;
  tag?: string;
  category: Category;
  overview: string;
  status: "live" | "coming-soon";
  /** Internal route, e.g. `/apps/projects-timeline`. */
  appUrl?: string;
  /** External URL — when set, the detail page embeds it in an iframe. */
  externalUrl?: string;
  iconStyle: IconStyle;
  /** Two hues 0-360 used by the animated icon. */
  hue: [number, number];
}

export const PROJECTS: CatalogProject[] = [
  {
    slug: "friends-night-out",
    title: "Friends Night Out",
    tag: "Find the night nobody posted about",
    category: "Apps",
    overview:
      "An event finder built around the events you never hear about. Set a point on the map and a radius, " +
      "and it works two sides at once. One side is what's happening: concerts, festivals, church " +
      "gatherings, farmers markets and block parties, grouped into this weekend, this week, this month. " +
      "The other is what you can go do — the standing and seasonal stuff that has no date because it's " +
      "always there: ice rinks, climbing walls, stables, zip lines, kayak launches, drive-ins. Free, paid " +
      "and donation are colour-coded on every card, and \"price unknown\" stays its own honest grey rather " +
      "than being guessed at. The part that makes it worth having is the obscurity score: after results " +
      "from every source are merged, an event carried by one church bulletin's calendar outranks the " +
      "stadium tour that six sites already told you about, so hidden gems sort to the top instead of the " +
      "bottom. Sources are a ticket API, any RSS or iCal calendar you point it at, an AI sweep of your " +
      "area, and an inbox where a pasted Instagram link or a photographed flyer becomes a real event. " +
      "A date-night generator pairs an activity, an event and a food stop into a whole evening with a " +
      "price estimate. Local-first, and genuinely usable with no API keys at all.",
    status: "live",
    appUrl: "/apps/friends-night-out",
    iconStyle: "aurora",
    hue: [315, 190],
  },
  {
    slug: "ai-rankings",
    title: "AI Rankings",
    tag: "Your tool database",
    category: "AI",
    overview:
      "A private database of every tool worth remembering — AI models first, but also the editors, " +
      "platforms, design apps, media tools, security and trading software around them. It reads like a " +
      "database because it is one: a section tree down the left, a dense sortable table in the middle, " +
      "and the full record on the right. Each row carries the three facts that decide whether you reach " +
      "for it — what it costs you, whether the code or weights are open and it runs on your own machine, " +
      "and whether using it from code needs an API key you may or may not already hold. Those are three " +
      "independent axes on purpose: an open model with a paid hosted tier is a different thing from a " +
      "free website. Every record is stamped with the date you added it, so a two-year-old bookmark stops " +
      "passing for current. The record panel is where it earns its keep: freeform notes plus a list of " +
      "features you mark love / good / missing / dealbreaker — and that list is the written case for the " +
      "rank you drag it to, so the tool that lost the benchmark but owns one feature you rely on holds " +
      "its slot and says why. One button files a record for you: with an AI key it reads the tool and " +
      "proposes a section, tags and licensing to accept or discard, and without one a keyword pass does " +
      "the same job offline. Seeded with ~95 real tools, fully editable, local-first, JSON in and out.",
    status: "live",
    appUrl: "/apps/ai-rankings",
    iconStyle: "rings",
    hue: [275, 200],
  },
  {
    slug: "recall",
    title: "Recall",
    tag: "Personal RAG second brain",
    category: "AI",
    overview:
      "A private second brain where a folder is a page, not a filter. Home is a grid of folder tiles and " +
      "nothing else; open one and it holds only the sections you asked for — sub-folders as tiles, notes, " +
      "to-dos, links & files, logins, websites — added from a single + menu, so a folder that holds two " +
      "things is two lines tall. Drop in PDFs, docs, images or video and Recall reads them (everything but " +
      "video), so one search box finds a phrase that only ever existed inside a document. Passwords are " +
      "sealed with AES-GCM under a master password and never leave the device or reach the AI. The agent " +
      "answers from your own content with sources and can reorganise across 13 actions — always as a plan " +
      "you confirm first. Alongside it, a shared Lists board for the daily churn — to-do, to-buy, bills, " +
      "reminders — colour-coded red/orange/yellow by urgency and by who added each row. Family join through " +
      "a one-time invite link, get the board and nothing else, and can only delete their own; you can delete " +
      "anything. Local-first with zero setup; sharper with an AI Gateway key.",
    status: "live",
    appUrl: "/apps/recall",
    iconStyle: "aurora",
    hue: [190, 265],
  },
  {
    slug: "prompt-architect",
    title: "Prompt Architect",
    tag: "Idea → amazing prompt",
    category: "AI",
    overview:
      "Turn a vague, half-formed idea into an amazing, build-ready prompt. Describe what you want and " +
      "Prompt Architect runs a short adaptive interview — a first round of sharp questions, then a second " +
      "round that closes the gaps your answers open and lands a real, named quality bar to beat. It shapes " +
      "everything into an editable overview (one-liner, purpose, design direction, core vs supporting " +
      "features) and routes the idea's vibe to the right design skills, then writes an optimized prompt for " +
      "an agent like Claude Code — with a Builder-vs-Critic gauntlet baked in and a one-click 'Copy for " +
      "Gauntlet' handoff. A portable toggle strips personal references for a shareable prompt. AI-powered " +
      "with a full offline fallback.",
    status: "live",
    appUrl: "/apps/prompt-architect",
    iconStyle: "mesh",
    hue: [258, 190],
  },
  {
    slug: "voice-studio",
    title: "Voice Studio",
    tag: "Text → speech + voice clone",
    category: "AI",
    overview:
      "Give your words a voice. Type anything in 80+ languages and hear it spoken, or clone a " +
      "voice from a 10–30s clip — upload a file or record from your mic — and make it say whatever " +
      "you type. Adjust speed, pick MP3 or WAV, and download the result; every clip is kept in a " +
      "local history you can replay. Powered by fish-speech (state-of-the-art open TTS + voice " +
      "cloning) through the fish.audio API, with the browser's built-in voices as a free, no-key " +
      "fallback and a swappable backend that can point at your own self-hosted server.",
    status: "live",
    appUrl: "/apps/voice-studio",
    iconStyle: "waves",
    hue: [190, 280],
  },
  {
    slug: "website-redesigner",
    title: "Website Redesigner",
    tag: "URL → redesign + build prompt",
    category: "Websites",
    overview:
      "Paste any URL and get a fresh redesign that keeps what the site does. Website Redesigner fetches " +
      "and analyzes the real page, captures a functionality inventory to preserve, then proposes three " +
      "distinct redesign directions — restrained, expressive and experimental — each driven by a design " +
      "skill and named a real site to beat. Pick one and it writes a complete, paste-ready, " +
      "functionality-preserving build prompt for Claude Code. Works on any external URL, or your own site " +
      "(so the rebuild edits real source and only restyles). AI-powered with a full offline fallback.",
    status: "live",
    appUrl: "/apps/website-redesigner",
    iconStyle: "rings",
    hue: [280, 200],
  },
  {
    slug: "pod-play-connect",
    title: "Pod Play Connect",
    tag: "Communities · pods · live Spades",
    category: "Apps",
    overview:
      "A social app for interest communities and real-time activity pods — join curated groups (Spades, " +
      "Basketball, Brunch, Study Sessions), form pods, and play full multiplayer Spades with bidding, " +
      "tricks and live scoring. Includes optional video verification and peer-governed safety. Built as a " +
      "Vite + React + Supabase app (auth, realtime); opens in its own window.",
    status: "live",
    // TODO: swap for the deployed URL once Pod Play Connect is hosted (currently the local Vite dev server).
    externalUrl: "http://localhost:8080",
    iconStyle: "orbit",
    hue: [268, 320],
  },
  {
    slug: "soundprint",
    title: "Soundprint",
    tag: "Reference → Suno prompt",
    category: "Music",
    overview:
      "Make songs that sound like other songs. Describe the sound you're chasing — down to a " +
      "single section, like an intro you loved before the drums ruined it — and Soundprint writes " +
      "the two prompts you paste into Suno: the style prompt and the lyrics prompt. Drop the audio " +
      "in and it genuinely listens: tempo, key, brightness, dynamics and whether percussion is even " +
      "playing are measured straight off the waveform in your browser, then a model of your choice " +
      "(Gemini, Claude, Qwen, GPT and more) turns those measurements into a producer-grade style " +
      "breakdown across 250+ genres. Create the song on Suno, paste the share link back, and the " +
      "real track plays right in the app — and naming a singer converts them into a usable vocal profile.",
    status: "live",
    appUrl: "/apps/soundprint",
    iconStyle: "waves",
    hue: [286, 196],
  },
  {
    slug: "seedance-studio",
    title: "Seedance Studio",
    tag: "Seedance 2 prompt builder",
    category: "Video",
    overview:
      "A CapCut-style prompt builder for Seedance 2. Drop a song on the audio track and lay out " +
      "prompt segments on the video track below it — each with its own prompt, mood and video-effect " +
      "dropdowns, and optional image/video references. Add segments with a +, reorder or delete them, " +
      "then hit Generate to render each block into a video clip along the timeline and play the reel " +
      "back with a scrubbing playhead. Wired to Seedance 2 through the Vercel AI Gateway (real video " +
      "when AI_GATEWAY_API_KEY is set), with a graceful placeholder mode so the editor is fully usable offline.",
    status: "live",
    appUrl: "/apps/seedance-studio",
    iconStyle: "pulse",
    hue: [190, 300],
  },
  {
    slug: "projects-timeline",
    title: "Projects Timeline",
    tag: "Project intelligence",
    category: "AI",
    overview:
      "A project intelligence system that becomes the single source of truth for every one of your projects. " +
      "Capture features, versions, files and a Knowledge Inbox (notes, ideas, AI chats, PDFs and images), " +
      "then let the AI Project Analyst keep the documentation, summaries and feature lists current as the " +
      "project evolves. Built for makers who run a lot of projects in parallel and need them to stay organised.",
    status: "live",
    appUrl: "/apps/projects-timeline",
    iconStyle: "aurora",
    hue: [248, 280],
  },
  {
    slug: "multi-order-calculator",
    title: "Multi-Order Calculator",
    tag: "MT4 basket math",
    category: "Trading",
    overview:
      "A professional multi-order basket P/L calculator for MT4 XAUUSD (gold). " +
      "Add unlimited Buy / Sell orders at different lot sizes and entry prices and " +
      "see total basket profit, weighted average entry, break-even, $/point and $/pip " +
      "update live as you type. Includes a reverse mode (desired profit → required exit) " +
      "and an interactive profit curve so traders can verify a basket before placing it.",
    status: "live",
    appUrl: "/apps/multi-order-calculator",
    iconStyle: "rings",
    hue: [42, 18],
  },
  {
    slug: "kart-showcase",
    title: "APEX/01 Kart Teardown",
    tag: "Interactive 3D showcase",
    category: "Websites",
    overview:
      "A cinematic, interactive 3D racing-kart teardown. Orbit the machine on a lit stage, hover a " +
      "section to explode it into individually labelled parts with names and specs, and click any part " +
      "to isolate it — then scroll down to drop into a first-person, scroll-driven ride through a neon " +
      "tunnel with a live speed/gear HUD. Built with React Three Fiber, GSAP and Lenis; honours reduced " +
      "motion and degrades gracefully without WebGL.",
    status: "live",
    appUrl: "/apps/kart-showcase",
    iconStyle: "orbit",
    hue: [16, 194],
  },
  {
    slug: "fire-reveal",
    title: "EMBER Reveal",
    tag: "WebGL image reveal",
    category: "Image",
    overview:
      "A WebGL mouse-trail image-reveal studio, built with a custom GLSL shader in the style of " +
      "Unicorn Studio's scanning effect. Two pixel-aligned images are stacked in one shader; moving " +
      "the cursor paints a persistent trail that scans the top image away to reveal what's hidden " +
      "underneath, with a thin chromatic-split distortion band at the boundary. The trail holds for " +
      "a beat after you stop, then eases closed. Upload your own two images and switch rim tints " +
      "(Ember, Inferno, Frost, Toxic) live. Runs as a single draw call at 60fps, honours reduced " +
      "motion with a drag-to-reveal crossfade, and degrades gracefully without WebGL.",
    status: "live",
    appUrl: "/apps/fire-reveal",
    iconStyle: "pulse",
    hue: [22, 40],
  },
  {
    slug: "skills-library",
    title: "Skills Library",
    tag: "Searchable prompt vault",
    category: "Utilities",
    overview:
      "A private, searchable library for all your skill prompts. Save any skill by pasting its " +
      "markdown — the title and quick overview auto-fill from the frontmatter — then browse everything " +
      "as clean rows, search by name, and open any skill to read and copy the full prompt in one click. " +
      "Login-gated and single-owner: your skills stay yours. Backed by Supabase, with a local-storage " +
      "fallback so it works offline.",
    status: "live",
    appUrl: "/apps/skills-library",
    iconStyle: "mesh",
    hue: [268, 200],
  },
  {
    slug: "cookbook-genie",
    title: "Cookbook Genie",
    tag: "Social AI cookbook",
    category: "AI",
    overview:
      "A social AI cookbook platform. Generate recipes from natural-language prompts with free AI-generated food " +
      "photos, then publish cookbooks other members can discover, star and follow. Browse a Discover feed, climb a " +
      "global cookbook leaderboard ranked by stars and shares, and check a per-city restaurant leaderboard built from " +
      "everyone's food journals. Includes AI recipe editing, serving scaling, protein/meal/cuisine tags, user profiles " +
      "with following, and link/email sharing. Runs fully in-browser as a live demo, or on Supabase for real multi-user auth.",
    status: "live",
    appUrl: "/apps/cookbook-genie",
    iconStyle: "waves",
    hue: [28, 45],
  },
  {
    slug: "ea-feature-list",
    title: "Expert Advisor Feature List",
    tag: "Tagged EA spec vault",
    category: "Trading",
    overview:
      "Every Expert Advisor feature spec in one organised, searchable place. Each feature gets a " +
      "plain-English summary and a set of tags — position management, risk control, trailing stop, " +
      "entry logic — so you can filter down to exactly the behaviour you're thinking about. Open any " +
      "feature to read the full spec verbatim and copy it in one click, ready to hand to a build agent.",
    status: "live",
    appUrl: "/apps/ea-feature-list",
    iconStyle: "mesh",
    hue: [40, 24],
  },
  {
    slug: "image-lab",
    title: "Image Lab",
    tag: "AI image studio",
    category: "Image",
    overview:
      "A creative workspace for generating, editing and remixing images with AI. Combine prompts, " +
      "reference images and presets to produce on-brand visuals fast.",
    status: "coming-soon",
    iconStyle: "mesh",
    hue: [320, 20],
  },
  {
    slug: "video-forge",
    title: "Video Forge",
    tag: "AI video pipeline",
    category: "Video",
    overview:
      "Storyboard, generate and edit short-form video with AI. Script → scenes → cuts → captions in a single flow.",
    status: "coming-soon",
    iconStyle: "waves",
    hue: [200, 260],
  },
  {
    slug: "sonic",
    title: "Sonic",
    tag: "Music & sound",
    category: "Music",
    overview:
      "Generate stems, melodies and full tracks. Pair AI composition with simple arrangement tools for quick musical sketches.",
    status: "coming-soon",
    iconStyle: "rings",
    hue: [160, 200],
  },
  {
    slug: "amhe",
    title: "Adaptive Mission Hedge Engine",
    tag: "Kalshi + MT4 hedge bot",
    category: "Trading",
    overview:
      "A combined Kalshi + MT4 risk management system. The Kalshi position expresses a market opinion; " +
      "the MT4 Expert Advisor adaptively builds and manages a hedge against the rare scenario where that " +
      "opinion is wrong. Five tightly integrated engines — Mission, Market Context, Adaptive Exposure, " +
      "Harvest, and Recovery — plus Position Governance (legacy/working classification, trailing stop, " +
      "partial close, breakeven lock), a Milestone Monitor with alerts and screenshots, and transparent " +
      "Statistical Learning via CSV trade logging. Semi-autonomous: you set the mission, the EA handles the rest.",
    status: "live",
    appUrl: "/apps/projects-timeline",
    iconStyle: "orbit",
    hue: [40, 22],
  },
  {
    slug: "goldea",
    title: "GoldEA Console",
    tag: "MT4 expert advisor",
    category: "Trading",
    overview:
      "Mission control for the GoldEA basket trading system. Monitor open baskets, lot sizes, pending orders " +
      "and risk in one view — and push parameter updates to the MT4 EA.",
    status: "coming-soon",
    iconStyle: "orbit",
    hue: [40, 22],
  },
  {
    slug: "flowmaker",
    title: "FlowMaker",
    tag: "Visual automation",
    category: "Automation",
    overview:
      "A lightweight visual builder for personal automations. Connect triggers, actions and AI steps without " +
      "wrestling with full IPaaS platforms.",
    status: "coming-soon",
    iconStyle: "pulse",
    hue: [140, 180],
  },
  {
    slug: "portfolio",
    title: "Portfolio",
    tag: "Personal site",
    category: "Websites",
    overview:
      "The public-facing portfolio: featured work, case studies and a contact path. Fast, mobile-first, " +
      "and built to look sharp on phones.",
    status: "coming-soon",
    iconStyle: "aurora",
    hue: [220, 200],
  },
  {
    slug: "snippetbox",
    title: "SnippetBox",
    tag: "Code & prompt vault",
    category: "Utilities",
    overview:
      "A tiny searchable vault for the code snippets, prompts and shell commands you keep forgetting. " +
      "Tag, pin and copy in one tap.",
    status: "coming-soon",
    iconStyle: "mesh",
    hue: [10, 340],
  },
  {
    slug: "scratchpad",
    title: "Scratchpad",
    tag: "Quick capture",
    category: "Apps",
    overview:
      "An instant-open note for the half-formed thought you want to come back to later — captured to your " +
      "Projects Timeline inbox of choice in one tap.",
    status: "coming-soon",
    iconStyle: "waves",
    hue: [280, 320],
  },
];

export function getProject(slug: string): CatalogProject | null {
  return PROJECTS.find((p) => p.slug === slug) ?? null;
}
