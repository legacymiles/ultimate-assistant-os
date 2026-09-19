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

/**
 * What the carousel (hub v2) shows on a panel's face when it comes to rest.
 *
 *   "live"  — an iframe of the project's own route. The app really runs on the
 *             panel: a 3D scene keeps orbiting, a video wall keeps playing.
 *   "video" — a looping muted clip. Drop the file in `public/hub/` and point
 *             `src` at it, e.g. { kind: "video", src: "/hub/kart.mp4" }.
 *   "site"  — an iframe of an external URL (only works where the other site
 *             permits framing; many refuse, so this is opt-in per project).
 *
 * Only ONE of these is ever mounted at a time — the focused panel, once it has
 * settled. See the carousel for why that is both the performance rule and the
 * intended feel.
 */
export type Preview =
  | { kind: "live" }
  | { kind: "video"; src: string; poster?: string }
  | { kind: "site"; url: string };

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
  /**
   * Overrides what the carousel puts on this panel. Left unset, a live app
   * gets a running preview of itself — see `previewFor`.
   */
  preview?: Preview;
  /** Turns the carousel preview off for this project, whatever the default. */
  noPreview?: boolean;
}

export const PROJECTS: CatalogProject[] = [
  {
    slug: "new-dashboard",
    title: "New Dashboard",
    tag: "Your AI Operating System, in one screen",
    category: "AI",
    overview:
      "Seven quick questions turn into a personal AI Operating System dashboard, built on the AIS-OS kit's " +
      "Four Cs: Context (who you are, your 90-day priorities, pasted voice samples), Connections (the seven " +
      "systems your AI should reach and how each is wired), Capabilities (your skills — pulled straight from " +
      "Claude Code), and Cadence (routines, credited only once they've actually run). Ask it what to focus on " +
      "this week, keep an append-only decisions log, and export the exact CLAUDE.md + context files that make " +
      "every Claude Code session know you. Onboard friends and family onto their own dashboards too.",
    status: "live",
    appUrl: "/apps/new-dashboard",
    iconStyle: "rings",
    hue: [190, 265],
  },
  {
    slug: "std-safe",
    title: "STD Safe",
    tag: "Provable results, honest about what they don't prove",
    category: "Apps",
    overview:
      "A tracker for the STD lab reports you already receive, and a way to show someone what you " +
      "were tested for, what came back, and how long ago the sample was taken. Upload the PDF from " +
      "STDcheck, Quest, Labcorp or MyChart and it is read server-side — lab, panel, collection date " +
      "and each of ten results — then handed to you on a review screen where nothing is saved until " +
      "you confirm every line. A phone photo goes to a vision model instead, and when there is no " +
      "key it says so and drops to manual entry rather than pretending. The word \"clean\" appears " +
      "nowhere in it. Status is derived per infection rather than per record, because someone may " +
      "have had HIV drawn two weeks ago and syphilis six months ago, and one overall date would hide " +
      "that; every row carries its own age, fresh under 30 days and stale past 90, and the ones " +
      "nobody tested for stay on screen in grey so a two-test panel can never look like a full " +
      "workup. Positives are first-class and carry treatment context — treated and cleared, " +
      "undetectable, on suppressive therapy — because an undetectable viral load is not " +
      "transmissible and flattening that into a red dot is both wrong and cruel. Sharing is a live " +
      "handshake: you read out a six-character code, they type it, you see a preview of exactly " +
      "what approving would show, and a yes opens it for 24 hours. Denials are silent, since a " +
      "refusal that announces itself is a disclosure of its own, and rotating your code cuts " +
      "everyone off at once. The report files are never shared — they carry a legal name and a date " +
      "of birth — and no result page is without the two things it cannot prove: that the document " +
      "is authentic, and that anything has happened since the sample was taken.",
    status: "live",
    appUrl: "/apps/std-safe",
    iconStyle: "rings",
    hue: [158, 199],
  },
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
    slug: "tiktok-dances",
    title: "Dance Vault",
    tag: "The wall that never stops moving",
    category: "Video",
    overview:
      "A living wall of TikTok dances. Rows of vertical tiles drift sideways forever, alternating " +
      "direction; hover one and its row eases to a halt while that dance plays. Every record keeps " +
      "the name people actually say, the song behind it, the choreographer who made it where that " +
      "is documented, the year it broke, and your own score out of 100 — with unrated kept as its " +
      "own honest state rather than collapsed into a zero. Sorting by score turns the front of the " +
      "wall into your leaderboard, so there is no separate rankings page to keep in sync. " +
      "The part that makes it trustworthy is what it refuses to do: every video is resolved by " +
      "search, verified through a keyless oEmbed call, and then checked for whether it will " +
      "actually play inside an embed — a dance that survives none of that is dropped rather than " +
      "shipped as a tile that looks fine and plays nothing. Dance of the Day adds one new viral " +
      "dance each morning through the same gate, so a name a model invented can never enter the " +
      "vault. Runs with no API key at all; a key only buys better-named picks.",
    status: "live",
    appUrl: "/apps/tiktok-dances",
    iconStyle: "pulse",
    hue: [335, 190],
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
    slug: "dashboard",
    title: "Dashboard",
    tag: "Personal RAG second brain",
    category: "AI",
    overview:
      "A private second brain where a folder is a page, not a filter. Home is a grid of folder tiles and " +
      "nothing else; open one and it holds only the sections you asked for — sub-folders as tiles, notes, " +
      "to-dos, links & files, logins, websites — added from a single + menu, so a folder that holds two " +
      "things is two lines tall. Drop in PDFs, docs, images or video and Dashboard reads them (everything but " +
      "video), so one search box finds a phrase that only ever existed inside a document. Saved logins stay " +
      "on the device and are filtered out of every AI call. The agent " +
      "answers from your own content with sources and can reorganise across 13 actions — always as a plan " +
      "you confirm first. Alongside it, a shared Lists board for the daily churn — to-do, to-buy, bills, " +
      "reminders — colour-coded red/orange/yellow by urgency and by who added each row. Family join through " +
      "a one-time invite link, get the board and nothing else, and can only delete their own; you can delete " +
      "anything. Local-first with zero setup; sharper with an AI key.",
    status: "live",
    appUrl: "/apps/dashboard",
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
    slug: "music-classified",
    title: "Music Classified",
    tag: "Your favourite songs, filed by how they hit",
    category: "Music",
    overview:
      "A private catalogue of the songs you love, organised by what they actually sound like. Type a " +
      "song name or paste a YouTube, Apple Music or Spotify link; it confirms the exact recording " +
      "against the music catalogue, measures the tempo and key off the 30-second preview right in " +
      "your browser, and files it on a 1–10 energy ladder — 1 still and ambient, 10 mosh-pit hype — " +
      "then into a genre playlist inside that level and a sub-genre inside that. Reuses the " +
      "playlist names you already have so R&B never splits into three spellings. Before it runs you " +
      "pick how you want it described: plain English, producer, songwriter, music theory, DJ, vibe, " +
      "dancer, or a recipe for making one like it with a ready style prompt — and any song can be " +
      "re-described another way later. Each filing says how sure it is. Any playlist can be turned " +
      "into a blueprint: what its songs have in common, written as a guide to making the next one. " +
      "Star any song and filter to just your favorites — across every level or one number at a time. " +
      "A second tab, My Music, is for the songs you make: upload audio, name the artist, and an " +
      "audio-capable model actually listens to each file while tempo and key are measured in the " +
      "browser — then it's filed the same way, browsed by artist, and any artist's songs can be " +
      "turned into a blueprint of their sound. A third tab, Style Prompt, is the producer: describe a " +
      "song in plain words with any references, and it makes the production calls — groove, drums, bass, " +
      "melody, human vocal behaviour, buried hooks, where it strips down and builds — then compresses them " +
      "into a style prompt of at most 1,000 characters for a music generator, checked against a 12-point " +
      "quality gate and rewritten if it fails. No lyrics. Library songs are only names and words; uploads " +
      "stay on the device they came from. Local-first, synced across devices.",
    status: "live",
    appUrl: "/apps/music-classified",
    iconStyle: "waves",
    hue: [250, 40],
  },
  {
    slug: "music-creator",
    title: "Music Creator",
    tag: "A studio, not a generate button",
    category: "Music",
    overview:
      "A music creation studio built as a container for tools that have no reason to look alike. Song Creator is " +
      "full-song production: write the brief, watch it become the style line and the lyric sheet, then render a real " +
      "48 kHz stereo song — vocals and accompaniment — on YuE2. Because YuE2 plans before it plays, the melody and " +
      "chords come back as a score you can actually read, which is what makes the rest possible: Remix / Stems edits " +
      "that score and re-renders it, so a reharmonisation is a musical edit rather than another roll of the dice. " +
      "Mashup is the honest kind: SheetSage2 transcribes one recording's melody, and YuE2 performs that melody in a " +
      "second song's world — the tune crosses over, the original singer and recording do not. Hook Creator chases one " +
      "earworm across several seeds so takes can be compared side by side. Artist Voice Studio finds a voice, isolates " +
      "it from the music it arrived in, cuts the five seconds worth cloning, and saves it to a Voice Library that never " +
      "has to process that artist again — then performs your words in it with AuK and mixes them over the bed. AuK is " +
      "a speech model, so that vocal is spoken or rapped, never sung, and the app says so where the choice is made. " +
      "The writing, planning, score editing and library all run with no GPU at all; rendering needs a 24 GB card, " +
      "which the studio points at over a URL and reports honestly when it is not there.",
    status: "live",
    appUrl: "/apps/music-creator",
    iconStyle: "waves",
    hue: [268, 199],
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
    slug: "auteur",
    title: "Auteur",
    tag: "AI film studio for MiniMax H3",
    category: "Video",
    overview:
      "An AI filmmaking studio, not a prompt box. Type the film in plain language, pick a template " +
      "(short film, music video, commercial, trailer, UGC ad, fashion film…) and a genre (romance, " +
      "horror, comedy, noir…), and drop in references: a face that must stay the same, a location, a " +
      "product, a style frame, a track. The AI Director develops the idea into a concept, a cast with " +
      "continuity sheets, the worlds it happens in and a visual style, then breaks it into scenes and " +
      "a shot list with camera, lighting, action, expression and what must match the previous shot. " +
      "Every shot becomes a card on a storyboard you can reorder, duplicate, edit and delete, and each " +
      "carries its own MiniMax H3 brief — composed from the whole project's context in H3's real " +
      "format (a [Shot 1] production brief with a prose camera move, named <Subject N> references, a " +
      "soundscape and a music line), invisible to most people and one click away for anyone who wants " +
      "to read or edit it. Generate renders through MiniMax's v2 API (or the Vercel AI Gateway), " +
      "polls the task and stores the clip in the browser; retakes are plain sentences — \"closer\", " +
      "\"darker\", \"change her outfit\", \"make him look angry, keep everything else\" — turned into " +
      "a patch on the shot so nothing else moves, and every take is kept. A timeline plays the active " +
      "takes in order under a music track. With no key at all it still plans, boards, retakes and cuts " +
      "with animatics, so the whole workflow is usable before a single frame is paid for.",
    status: "live",
    appUrl: "/apps/auteur",
    iconStyle: "aurora",
    hue: [40, 20],
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
    slug: "gods-eye-view",
    title: "God's Eye View",
    tag: "A spy-satellite view of the real, live planet",
    category: "Apps",
    overview:
      "A spy-satellite simulator in the browser, where the data turns out to be real. A CesiumJS globe " +
      "behind a keyhole scope and a tactical HUD: coordinates, altitude, estimated GSD and NIIRS, sun " +
      "elevation, a REC clock. Toggle live layers from public, keyless sources: every aircraft OpenSky can " +
      "see (adsb.lol around you when OpenSky is throttled), military traffic from adsb.lol, thousands of " +
      "satellites propagated in the browser with SGP4 from CelesTrak, the last day of USGS earthquakes, " +
      "~25,000 live public traffic cameras (click one to enlarge it, hop to the next, or let it auto-hop), " +
      "space missions from the Launch Library, datacenters, dams, and with free keys NASA FIRMS fires, AIS ships and " +
      "TomTom street traffic, plus the world's submarine cables. Ride any aircraft in COCKPIT first person. Aircraft glide " +
      "between updates by dead reckoning. Click anything to lock on: a detection box, a telemetry card, a " +
      "trail, and a camera that follows it, orbit ring included for satellites. Re-skin the whole planet " +
      "through the original's GLSL sensor looks: CRT, NVG, FLIR (Ironbow or white-hot), Anime, Noir and " +
      "Snow, on keys 1-7. Drive it by typing or holding Space to talk: \"fly to Tokyo\", \"thermal\", " +
      "\"turn on satellites\", \"track the ISS\", \"reset globe\". Views share as links. Esri imagery works " +
      "with no keys; paste a Cesium ion token or Google Maps key in POWER UP for photorealistic 3D cities. " +
      "A port of bilawalsidhu/gods-eye-view (MIT).",
    status: "live",
    appUrl: "/apps/gods-eye-view",
    iconStyle: "orbit",
    hue: [186, 32],
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
    slug: "image-studio",
    title: "Image Studio",
    tag: "Specialist image agents",
    category: "Image",
    overview:
      "A studio of specialist image agents, each an expert in one look. Nostalgia turns you into a " +
      "photo from any decade — 70s Polaroid, 90s disposable, VHS still. Glamour shoots sultry, " +
      "magazine-grade editorial portraits. Family Portrait arranges everyone you upload into the photo " +
      "you'd frame. Cartoon → Real brings any cartoon or anime character to life as a real person. GTA " +
      "Life drops you into your most unhinged moments: wrestling bears, yacht chaos, headlining a " +
      "stadium. Write a prompt, add reference photos and tag each one as a Person to keep or a Style to " +
      "borrow; the agent rewrites your idea into a detailed prompt you can edit, then generates up to " +
      "four variations. Everything lands in a gallery you can filter by agent, download, or refine into " +
      "the next round.",
    status: "live",
    appUrl: "/apps/image-studio",
    iconStyle: "mesh",
    hue: [320, 20],
  },
  {
    slug: "smart-shot-videos",
    title: "Smart Shot Videos",
    tag: "Prompt → editable storyboard → H3 video",
    category: "Video",
    overview:
      "One prompt and your own photos become a full production sheet before a single frame of video " +
      "is rendered. Upload images and tag each as a character, a location, a product or a style; " +
      "describe the film; pick how many cuts. The planner writes the shoot and draws it: a character " +
      "reference sheet built from your photo (turnaround, portrait, wardrobe, palette), environment " +
      "set-design plates, a top-down floor plan with every cut's camera position, a side elevation " +
      "for the crane move, one storyboard frame per cut captioned with lens, duration, camera move and " +
      "framing, four lighting references, mood words and cinematography notes — the OpenArt Smart " +
      "Shot layout, on one sheet. Everything is editable in place and every panel can be redrawn. " +
      "When the board is right, each cut gets a MiniMax H3 brief in H3's real reference format " +
      "(subject definitions, retention analysis, a prose camera move with amplitude and speed, " +
      "soundscape and score) with the character sheet, the set plate and the storyboard frame " +
      "attached as references, and renders on your own H3 — RunPod, MiniMax hosted or the AI " +
      "Gateway. Play the cuts back to back, retake any one, download each clip.",
    status: "live",
    appUrl: "/apps/smart-shot-videos",
    iconStyle: "waves",
    hue: [200, 260],
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
    slug: "game-creator",
    title: "Game Creator",
    tag: "Describe a game → Unreal Engine builds it",
    category: "Apps",
    overview:
      "Type an idea for a video game and Unreal Engine 5.8 on your own PC builds it. A builder on the " +
      "PC picks up each prompt and runs Claude Code with the Unreal game-builder skill: it writes a " +
      "one-page design, creates a Blueprint project from the right engine template, builds the " +
      "gameplay through Epic's in-editor MCP tools (Blueprint graphs, level actors, HUD widgets), " +
      "playtests it in the editor, takes screenshots from the player's eye, and packages a Windows " +
      "game. Every game lands in a gallery that updates live while it is being built — status, the " +
      "design document, the build log, what was built and what was left out, and the controls. A " +
      "finished game opens straight into Unreal or launches to play on the PC that built it.",
    status: "live",
    appUrl: "/apps/game-creator",
    iconStyle: "orbit",
    hue: [265, 330],
  },
  {
    slug: "3d-studio",
    title: "3D Studio Video Creator",
    tag: "Describe a video → an AI animation director makes it",
    category: "Video",
    overview:
      "An AI animation director that turns a simple prompt into a complete animated video. Pick a style, " +
      "length and format; the director interprets the idea, writes the story beats, casts characters, " +
      "scouts sets and storyboards every shot with a camera move, lighting and timing. For each piece of " +
      "motion it decides the right tool — Mixamo mocap clips for everyday humanoid movement, Cascadeur " +
      "for stunts, fights, creatures and physics-based motion, Blender for cameras, objects and effects — " +
      "and explains why. The storyboard plays instantly as a moving 3D animatic you can export, and one " +
      "click sends it to Blender on your own PC, where Claude Code builds, animates and renders the " +
      "finished film for you to watch and download.",
    status: "live",
    appUrl: "/apps/3d-studio",
    iconStyle: "mesh",
    hue: [190, 285],
  },
  {
    slug: "realtime-lucy",
    title: "Realtime Lucy",
    tag: "Your webcam, re-imagined live by a world model",
    category: "Video",
    overview:
      "A live video-to-video stream driven by LingBot-World 2.0's causal-fast world model, running on your " +
      "own GPU. The webcam goes out over WebRTC; on the PC the model's inference loop is turned inside out " +
      "so it never stops: every quarter second of camera video is VAE-encoded, noised into the distilled " +
      "four-step schedule, denoised against a rolling KV-cache memory of what the model already generated, " +
      "written into that memory, and decoded straight back into the return video track. Type a prompt to " +
      "change the look mid-stream, choose how much of the camera to keep, and hold WASD or the arrow keys " +
      "to drive the model's own camera-control conditioning. A live panel shows real numbers — generated " +
      "fps, glass-to-glass latency, per-stage timings and VRAM — because the whole point is that it is real " +
      "model inference, not a filter.",
    status: "live",
    appUrl: "/apps/realtime-lucy",
    iconStyle: "pulse",
    hue: [330, 20],
    noPreview: true,
  },
];

export function getProject(slug: string): CatalogProject | null {
  return PROJECTS.find((p) => p.slug === slug) ?? null;
}

/**
 * Routes that must never be framed as a preview.
 *
 * These are password-gated private workspaces. Framing one would either show a
 * stranger an unlock form on the front of the carousel (ugly and confusing) or,
 * for whoever IS signed in, put their own real data on a public-facing spinning
 * panel. Neither is wanted, so they keep the animated icon instead.
 */
const UNPREVIEWABLE = new Set(["dashboard", "new-dashboard", "projects-timeline"]);

/**
 * The preview a carousel panel should mount, or null for the animated icon.
 *
 * Deriving this rather than tagging each project means a new app added to the
 * catalog gets a living panel for free, which is the whole point of the
 * catalog being the single source of truth.
 */
export function previewFor(project: CatalogProject): Preview | null {
  if (project.noPreview || UNPREVIEWABLE.has(project.slug)) return null;
  if (project.preview) return project.preview;
  if (project.status !== "live") return null;
  return project.appUrl ? { kind: "live" } : null;
}

/** The URL a "live" or "site" preview loads. */
export function previewUrl(project: CatalogProject, preview: Preview): string | null {
  if (preview.kind === "live") return project.appUrl ?? null;
  if (preview.kind === "site") return preview.url;
  return null;
}
