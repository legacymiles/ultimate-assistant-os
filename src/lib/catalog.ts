// ---------------------------------------------------------------------------
// Single source of truth for the hub.
// Add a new project = add an object to PROJECTS. Everything else is derived.
// ---------------------------------------------------------------------------

export type Category =
  | "AI"
  | "Image"
  | "Video"
  | "Music"
  | "Automation"
  | "Websites"
  | "Apps"
  | "Utilities";

export const CATEGORIES: Category[] = [
  "AI",
  "Image",
  "Video",
  "Music",
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
    slug: "new-jarvis",
    title: "New Jarvis",
    tag: "The assistant that can actually reach your computer",
    category: "AI",
    overview:
      "The same memory, folders, photos, lists, calendar and Record as Jarvis — the identical data, read " +
      "through a console instead of a chat. Every request, typed or spoken, becomes a block: exactly what " +
      "you said, a numbered ledger of every step it took, and what each step actually returned, rendered as " +
      "the thing it is — a table, a page, a screenshot, a command's real output. Nothing is flattened into " +
      "\"Done\" and nothing scrolls away; a block from an hour ago is still there and still re-runnable. " +
      "Voice is always on rather than a button you press: it waits for its name, hears the sentence after " +
      "it, and can be talked over mid-answer — with an echo test so it never replies to itself. " +
      "The part no web assistant has: a local agent on the PC, so it drives a real Chromium that keeps your " +
      "logins, runs shell commands, reads and writes files, lists and focuses windows, and sees the screen. " +
      "It reads freely and stops for a yes on the one class of step that cannot be undone. With the agent " +
      "off it still thinks, remembers and answers, and says plainly which capability is missing.",
    status: "live",
    appUrl: "/apps/new-jarvis",
    iconStyle: "pulse",
    hue: [225, 160],
  },
  {
    slug: "jarvis",
    title: "Jarvis",
    tag: "A personal assistant with a real memory",
    category: "AI",
    overview:
      "Talk or type, and Jarvis answers from what he actually knows — your memories, your master Claude " +
      "folder and your profile — naming every source and admitting what he's missing. His memory core is a " +
      "turning ball of connected dots, one per memory, coloured by where it came from. He reads your inbox " +
      "and calendar through your connected apps, drafts replies and books meetings, and always shows you the " +
      "exact message or event before anything happens. Underneath is the AIS-OS Four Cs profile he was built " +
      "on: Context, Connections, Capabilities and Cadence, exportable as the CLAUDE.md and context files that " +
      "make every Claude Code session know you. " +
      "It is also the one dashboard: the old Dashboard app moved in whole — Folders (with the Google Drive " +
      "backup and the folder assistant), Photos (vision triage into people and album folders) and the " +
      "shared family Lists, where members can keep entries private and the admin sees everything — plus " +
      "the Skills Library as its own tab. Your own calendar, with reminders and .ics export, sits beside " +
      "any connected one, and Jarvis can add a list entry, a note or an event when you say yes.",
    status: "live",
    appUrl: "/apps/jarvis",
    iconStyle: "rings",
    hue: [190, 265],
  },
  {
    slug: "std-safe",
    title: "Tap Safe",
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
    slug: "cook-connect",
    title: "Cook Connect",
    tag: "Cook together, then play each other",
    category: "Apps",
    overview:
      "A cookbook and a card table in one social app. Publish a cookbook, save the " +
      "ones worth keeping, and search a directory of cooks by name, handle or city — then challenge any " +
      "of them to spades or chess without leaving the page. A profile shows someone's cookbooks and " +
      "their game record side by side, because here they are the same person. Two leaderboards keep " +
      "score: players ranked on win rate, with a minimum-games qualifier so a 3–0 newcomer cannot top a " +
      "40–25 season, and cookbooks ranked by how many people have saved them. Every table carries text " +
      "chat and in-app WebRTC video, and computer players fill any empty seat so a game never waits for " +
      "a fourth. Recipes are drafted by AI from one sentence and then fully editable. Runs on its own " +
      "Supabase schema, or entirely in the browser with no keys — where two tabs can genuinely play " +
      "each other.",
    status: "live",
    appUrl: "/apps/cook-connect",
    iconStyle: "orbit",
    hue: [24, 145],
  },
  {
    slug: "jarvis-audio-studio",
    title: "Jarvis Audio Studio",
    tag: "Find it, file it, make it",
    category: "Music",
    overview:
      "Three music studios behind one switcher, because they were always three halves of the same "
      + "job: get the recording, understand it, make the next one. FIND searches a song, names the "
      + "exact recording first — album, year, length and thirty seconds of the real audio — and only "
      + "then hunts a file for it, scoring every candidate against what you confirmed rather than the "
      + "words you typed, so you stop ending up with a cover, a sped-up edit or a lyric video with a "
      + "nine-second intro. Files come from the Internet Archive, the Creative Commons catalogues "
      + "Openverse indexes, and roughly twenty sites through yt-dlp, grouped by what the licence "
      + "actually lets you do with them. CLASSIFY is the private catalogue: paste a name or a link and "
      + "it measures tempo and key off the preview in your own browser, files the song on a 1–10 "
      + "energy ladder into a genre and a sub-genre, and describes it in whichever voice you asked "
      + "for — plain English, producer, music theory, DJ, dancer — including a style prompt of that "
      + "exact recording an AI song generator can follow. Upload your own audio and a listening model "
      + "hears it rather than guessing from the filename. CREATE is the production side: write the "
      + "brief, watch it become a style line and a lyric sheet, and render a real 48 kHz song on YuE2 "
      + "— which plans before it plays, so the melody and chords come back as a score you can edit and "
      + "re-render instead of rerolling the dice. A voice you save once is cloned, isolated from the "
      + "music it arrived in, and kept in a library that never has to process that artist again. "
      + "Switching studio never leaves the app or drops what you were holding, and every one of them "
      + "works with no keys set: the catalogue, the measuring, the writing and the score editing all "
      + "run locally, and only rendering asks for a GPU — which it says plainly when it is not there.",
    status: "live",
    appUrl: "/apps/jarvis-audio-studio",
    iconStyle: "waves",
    hue: [268, 199],
  },
  {
    slug: "seedance-studio",
    title: "Music Video Studio",
    tag: "Audio-driven video engine",
    category: "Video",
    overview:
      "An audio-driven video engine: drop a song and the film is cut TO it, not laid over it. " +
      "The track is decoded in the browser and never uploaded — tempo, bar lines, sections, energy " +
      "and the exact moments it drops are all measured locally and free. A listening model " +
      "transcribes the words with their times (or paste your own lyrics and have them timed), and " +
      "then Jarvis's Studio chat — the same @-mentioned workflows, the same people out of your " +
      "Photos library, the same camera deck, the same uploads — plans the film as a SCORE: a shot " +
      "sheet where every cut is pinned to a second of the track, snapped to a measured bar line, " +
      "and landing on the drops. Lip-sync ranges say which seconds are sung to camera, and on those " +
      "cuts the words outrank the prompt: the performer is on camera, mouthing those exact words, " +
      "and the visual idea becomes the world around them. The board is editable after the plan and " +
      "after the render — move a cut, split it, lock it, toggle whether it sings, rewrite the woven " +
      "prompt, or render one cut on its own before committing the queue — with a second board " +
      "showing just the cuts that sing. The film renders free on the owner's own GPU, every clip " +
      "trimmed back to its planned slot so the picture cannot drift, and the song laid over it at " +
      "full level as the master. The original three-lane cutting room is still there behind a " +
      "toggle. Video prompts run end to end under the " +
      "track — add them with a +, drag to reorder, drag an edge to trim, and open any one to write " +
      "its prompt, attach reference images and set the Studio camera deck: Film setup (genre, era, " +
      "tempo), Camera, Movement as ordered #tokens, Style, Color palette and Lighting, all layered " +
      "over a reel-wide direction every block inherits. The first image becomes that block's artwork, " +
      "so the lane reads as a storyboard before anything is rendered. The song lane draws the real " +
      "waveform, decoded in the browser. The lip-sync lane holds plain ranges — no prompts, just drag " +
      "and trim them onto the seconds you want sung; whichever video prompts they land on turn amber " +
      "and lip-sync to the audio, while the rest play under the music. Wired to Seedance 2 through " +
      "the Vercel AI Gateway (real video when AI_GATEWAY_API_KEY is set), with graded stand-ins so " +
      "the cutting room is fully usable offline.",
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
    slug: "h3-experiments",
    title: "H3 Experiments",
    tag: "Which skill actually makes a good film",
    category: "Video",
    overview:
      "A lab ledger for video. Every skill that can drive a render shows as a folder; inside it are " +
      "the films it actually produced and the skill's own description, so the comparison is between " +
      "skills rather than between half-remembered attempts. A brief is the controlled variable — the " +
      "same short story goes to every skill, and the runs line up underneath it. Each run is a single " +
      "dense row that is also the film: hover and it plays in place, drag across it and the row's " +
      "width becomes the timeline, so twenty takes compare in twenty seconds without opening a single " +
      "player. Rate a run good, mixed or bad, tag what went wrong from a fixed vocabulary — identity " +
      "drift, style break, dead shot, bad join — and the tags are counted per skill, which turns one " +
      "bad film into a pattern worth fixing. The Queue pane lists every skill that has never rendered " +
      "a given brief, so work that has not been done is visible instead of remembered. Skills are read " +
      "off disk, so adding one to the library adds it here.",
    status: "live",
    appUrl: "/apps/h3-experiments",
    iconStyle: "waves",
    hue: [190, 280],
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
    slug: "video-studio-arena",
    title: "Video Studio Arena",
    tag: "One prompt, five engines, one finished video",
    category: "Video",
    overview:
      "The studio every other video idea plugs into, so there is one place to make a video instead of " +
      "eight apps. Describe what you want — subject, length, style, audience, aspect, narration, music, " +
      "captions — and pick HOW it gets made: Remotion for motion graphics, diagrams and data; " +
      "HyperFrames for AI-directed programmatic scenes; Unreal Engine for 3D cinematics, characters and " +
      "Sequencer camera work; Blender for custom 3D, simulations and product films; H3 for cinematic " +
      "AI footage. Every engine is a plugin with its own skill, capability detection and execution " +
      "pipeline, so adding a sixth is a folder, not a rewrite. The AI writes an engine-agnostic " +
      "production plan you read and approve scene by scene, then rewrites every scene in the chosen " +
      "engine's own terms — you never have to know how any of these tools work. Rendering is real and " +
      "so is the status list: H3 runs on the server, the other four run on your PC through the studio " +
      "runner, and a missing install, MCP or key is named on the card rather than faked. Regenerate a " +
      "single scene, duplicate the project to try another engine and compare them side by side, and — " +
      "in AI Director mode — let it route each scene to whichever engine suits it and assemble the lot.",
    status: "live",
    appUrl: "/apps/video-studio-arena",
    iconStyle: "orbit",
    hue: [268, 330],
  },
  {
    slug: "social-personas",
    title: "Social Personas",
    tag: "Your creator accounts, with an AI that knows them",
    category: "AI",
    overview:
      "A grid of your creator personas — a rap channel, an explainer page, a baby-growth diary — each " +
      "holding the TikTok, Instagram and Facebook accounts it posts to. Connect an account with the " +
      "platform's own login and every post syncs in with its caption and view, like and comment counts; " +
      "or paste links and the AI watches the video itself. From that it keeps a working memory of the " +
      "account: what it's about, its content pillars, which hooks and formats actually perform, and the " +
      "angles it hasn't tried. Every morning each persona gets a fresh batch of shootable ideas built on " +
      "that data — hook word for word, format, beat-by-beat outline and why it should work — to save, " +
      "mark made or skip, and a brainstorm chat that stays inside the niche and voice. Works offline " +
      "with template ideas when no AI key is set.",
    status: "live",
    appUrl: "/apps/social-personas",
    iconStyle: "orbit",
    hue: [330, 200],
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
  {
    slug: "ea-world",
    title: "Expert Advisor World",
    tag: "The trading-bot vault",
    category: "Utilities",
    overview:
      "Several studios behind one front door, the way Jarvis Audio Studio is — Analyze, Vault and "
      + "Bench, each its own application, sharing a palette and a store, and each carrying an accent "
      + "hue so which one you are in is something you feel before you read it. A folder of .mq4 files "
      + "records what you own; this records what you LEARNED, which is the only thing that "
      + "compounds toward a better bot. It starts at Analyze: drop an EA in, or paste it straight out "
      + "of MetaEditor, and it is read on the spot, "
      + "in the browser, with nothing uploaded — because an EA is often the only copy of something "
      + "somebody paid for. Source is taken apart into the family it belongs to, a risk score with "
      + "every tell quoted at its line number, and the mechanics worth copying with the code pulled "
      + "out ready to keep; a Strategy Tester .htm report is parsed by EA Lab's own parser for the real "
      + "numbers, so the two apps cannot disagree about what a report says; and an .ex4 is told "
      + "plainly that nothing can read inside machine code. The Vault is four ledgers: the EAs with their source kept as readable text "
      + "and synced to every device; the mechanics worth stealing, each one a short overview plus the "
      + "smallest MQL4 that actually works on a live server, stop levels and error codes included, "
      + "because those are the lines forum posts leave out and the reason the forum version loses "
      + "money; the strategy families, filed by HOW THEY DIE rather than what they read, since "
      + "grouping by indicator files a doubling grid next to a fixed-stop breakout; and the ideas not "
      + "built yet, each with the stage it has reached. Every record carries two fields a file listing "
      + "cannot — where it came from, and how it fails — and a bot whose failure mode is blank says so "
      + "in amber. Then the part that makes collecting worth anything: the build bench. Draft features, "
      + "bots and ideas onto it and it compiles ONE build prompt, governing rules first and risk floor "
      + "second so the rules outrank the signal rather than filtering it, and it names the "
      + "CONTRADICTIONS before any code — draft a loss-doubling sizer next to a drawdown ceiling and it "
      + "says so, in words, with the reconciling move, because that rule gets implemented twice and "
      + "obeyed once. The twelve dictated feature specs are read live from the EA Feature List rather "
      + "than copied, so the two cannot drift. Pairs with EA Lab: this is where a bot is understood, "
      + "that is where it is measured.",
    status: "live",
    appUrl: "/apps/ea-world",
    iconStyle: "rings",
    hue: [45, 150],
  },
  {
    slug: "ea-lab",
    title: "EA Lab",
    tag: "Test your trading bots",
    category: "Utilities",
    overview:
      "A bench where a MetaTrader Expert Advisor stops being a claim and becomes a measurement. " +
      "Drop an .ex4 into the watched folder and it is registered, installed into an idle test " +
      "terminal, backtested headless, filed by strategy and rated — without the terminal being " +
      "touched by hand. It reads like a database because it is one: strategy tree down the left, a " +
      "dense sortable table in the middle, the full record on the right. Two columns do the work no " +
      "MetaTrader report does. The first is NAKED: peak UNHEDGED exposure, reconstructed from the " +
      "open book rather than from closed trades, which is the figure that actually ends accounts — " +
      "one hedge EA from the owner's own folder posts a 71.6% win rate and quietly reaches 231x its " +
      "base lot unhedged. The second is modelling quality, which rides with every number, because a " +
      "profit factor from a 25%-quality run and one from real ticks are not the same kind of fact " +
      "and the lab refuses to rank them together. Ratings are built on out-of-sample results only: " +
      "ranking on in-sample profit factor just sorts the folder by how thoroughly each EA memorised " +
      "the past. EAs are filed by HOW THEY FAIL — martingale, hedge-recovery, grid, scalper, trend, " +
      "mean-reversion — since grouping by indicator would file a doubling grid next to a " +
      "fixed-stop breakout for both reading an RSI. Testing runs on this PC through a local runner; " +
      "with it off the app opens, says so plainly, and shows everything it already knows.",
    status: "live",
    appUrl: "/apps/ea-lab",
    iconStyle: "mesh",
    hue: [150, 35],
  },
  {
    slug: "financial-bible",
    title: "Financial Bible",
    tag: "The book of money plays",
    category: "Utilities",
    overview:
      "Several rooms behind one front door, and the first of them answers the question that kills most "
      + "ideas: not whether it is a good one, but what you actually DO on Saturday morning. Every idea "
      + "you have had is a card, and the card holds a build plan — phases, numbered steps, a cost range "
      + "on each one, the materials with quantities, who sells them near you, how long it takes and how "
      + "you know a step came out right. Then you argue with it. Ask for it cheaper, swap pine for oak, "
      + "ask whether a step even needs a permit where you live, and the answer comes back with the EDIT "
      + "attached: these four steps change, the total drops, accept or discard. Accept and it becomes "
      + "v2 with v1 still readable, because 'cheaper' and 'the good version' both have to survive. "
      + "Press Price this for real and a web-reading model goes and finds actual shops with actual "
      + "addresses and prices, and every line it checked starts saying VERIFIED with the page it came "
      + "from; everything it could not find keeps saying ESTIMATE, because that is the honest answer. "
      + "What it will not do is the thing every business-plan tool does: it never mentions an LLC, "
      + "insurance, branding or marketing. Those are nine buttons at the foot of the plan that generate "
      + "nothing until you press one. And anything legal — permits, resale certificates, selling food — "
      + "comes back as a question with somebody to ask, never as an answer, because no app knows the "
      + "rules where you live. The other three rooms (Deal Scout, Money Plays, Funding) say what they "
      + "will hold and admit they are not built yet.",
    status: "live",
    appUrl: "/apps/financial-bible",
    iconStyle: "rings",
    hue: [36, 168],
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
const UNPREVIEWABLE = new Set([
  "dashboard",
  "jarvis",
  "new-jarvis",
  "projects-timeline",
  "social-personas",
  "ea-lab",
  "ea-world",
  "financial-bible",
]);

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
