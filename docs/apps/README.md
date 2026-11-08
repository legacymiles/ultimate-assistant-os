# Apps in this hub

**Generated — do not edit.** `node scripts/apps-index.mjs` rewrites this from [`src/lib/catalog.ts`](../../src/lib/catalog.ts), which is the single source of truth for the hub. `node scripts/apps-index.mjs --check` fails when the two disagree.

40 projects — 40 live, 0 coming soon. Every live one is a real route under this one Next.js app; none of them is a separate project, repo or deployment. A rebuild that is missing routes from this table is not this site.

## AI (12)

| App | Route | What it is |
|---|---|---|
| **Jarvis** | `/apps/jarvis` | Your memory, folders, photos, lists, calendar and Record in one place. |
| **AI Rankings** | `/apps/ai-rankings` | A private database of every tool worth remembering — AI models first, but also the editors, platforms, design apps, media tools, security and trading software around them. |
| **Prompt Architect** | `/apps/prompt-architect` | Turn a vague, half-formed idea into an amazing, build-ready prompt. |
| **Client Review** | `/apps/client-review` | Send each website client a private link: their site fills the screen with a draggable Chat Intake on top, where they type as many edit requests as they like, point at the exact … |
| **Projects Timeline** | `/apps/projects-timeline` | A project intelligence system that becomes the single source of truth for every one of your projects. |
| **App Builder** | `/apps/app-builder` | Type an app idea — one line or a full brief — or drop a screen recording or screenshots of an app or workflow you want recreated or changed. |
| **YouTube videos** | `/apps/youtube-videos` | Paste any YouTube, Shorts, TikTok, Instagram, Facebook, X, Vimeo or Twitch link (or several at once, or paste anywhere on the page) and it lands at the top of your watch-later l… |
| **iPhone Notes** | `/apps/iphone-notes` | An iPhone Shortcut sends the notes you wrote or changed lately, and Jarvis reads each one into what it would do: a to-do, a calendar event, a birthday, something to remember, an… |
| **Text Inbox** | `/apps/text-inbox` | An iPhone Shortcut automation sends each text from the people you pick, and Jarvis drafts a reply in your voice — your own words about how you text, plus every reply you rewrite… |
| **Find My Life** | `/apps/find-my-life` | Your phone, laptop, Meta glasses, car, keys and wallet in one place, on a live radar with you in the middle. |
| **Contradicting** | `/apps/contradicting` | A clip-on recorder (the Omi pendant, or the Omi app on your phone) streams what was said, and Contradicting keeps each person's words with the exact time. |
| **Personas Studio** | `/apps/personas-studio` | A content studio for people who run several creator personas at once — a rap channel, an explainer page, a baby-growth diary. |

## Image (2)

| App | Route | What it is |
|---|---|---|
| **EMBER Reveal** | `/apps/fire-reveal` | A WebGL mouse-trail image-reveal studio, built with a custom GLSL shader in the style of Unicorn Studio's scanning effect. |
| **Image Studio** | `/apps/image-studio` | A studio of specialist image agents, each an expert in one look. |

## Video (10)

| App | Route | What it is |
|---|---|---|
| **Viral Studio Content** | `/apps/viral-studio-content` | Four boards for the clips worth saving — Viral audio (sounds and songs), Fights, Dances and Motion (surfing, hoops, rap performances and anything else that moves). |
| **Music Video Studio** | `/apps/seedance-studio` | An audio-driven video engine: drop a song and the film is cut TO it, not laid over it. |
| **H3 Experiments** | `/apps/h3-experiments` | A lab ledger for video. |
| **Smart Shot Videos** | `/apps/smart-shot-videos` | One prompt and your own photos become a full production sheet before a single frame of video is rendered. |
| **Video Studio Arena** | `/apps/video-studio-arena` | The studio every other video idea plugs into, so there is one place to make a video instead of eight apps. |
| **Money Agent Studio** | `/apps/money-agent-studio` | Standing agents whose only job is income from video. |
| **Workflow Maker** | `/apps/workflow-maker` | The owner's "rea to workflow". |
| **Custom Video Swap** | `/apps/custom-video-swap` | Recast any clip. |
| **3D Studio Video Creator** | `/apps/3d-studio` | An AI animation director that turns a simple prompt into a complete animated video. |
| **Realtime Lucy** | `/apps/realtime-lucy` | A live video-to-video stream driven by LingBot-World 2.0's causal-fast world model, running on your own GPU. |

## Music (1)

| App | Route | What it is |
|---|---|---|
| **Jarvis Audio Studio** | `/apps/jarvis-audio-studio` | Three music studios behind one switcher, because they were always three halves of the same job: get the recording, understand it, make the next one. |

## Websites (2)

| App | Route | What it is |
|---|---|---|
| **Website Redesigner** | `/apps/website-redesigner` | Paste any URL and get a fresh redesign that keeps what the site does. |
| **APEX/01 Kart Teardown** | `/apps/kart-showcase` | A cinematic, interactive 3D racing-kart teardown. |

## Apps (8)

| App | Route | What it is |
|---|---|---|
| **Tap Safe** | `/apps/std-safe` | A tracker for the STD lab reports you already receive, and a way to show someone what you were tested for, what came back, and how long ago the sample was taken. |
| **Friends Night Out** | `/apps/friends-night-out` | An event finder built around the events you never hear about. |
| **Cook Connect** | `/apps/cook-connect` | A cookbook and a card table in one social app. |
| **God's Eye View** | `/apps/gods-eye-view` | A spy-satellite simulator in the browser, where the data turns out to be real. |
| **Game Creator** | `/apps/game-creator` | Type an idea for a video game and Unreal Engine 5.8 on your own PC builds it. |
| **Game Studio** | `/apps/game-studio` | Every game in one place. |
| **Item Storm Arena** | `/apps/item-storm-arena` | A storm of living objects circles a floating arena, and your cursor is a gravity well. |
| **Baby No Scroll** | `/apps/baby-no-scroll` | A child lock for a screen you are about to put in a small pair of hands. |

## Utilities (5)

| App | Route | What it is |
|---|---|---|
| **Expert Advisor World** | `/apps/ea-world` | Several studios behind one front door, the way Jarvis Audio Studio is — Analyze, Vault and Bench, each its own application, sharing a palette and a store, and each carrying an a… |
| **EA Lab** | `/apps/ea-lab` | A bench where a MetaTrader Expert Advisor stops being a claim and becomes a measurement. |
| **Trading Studio** | `/apps/trading-studio` | Six trading tools that used to be six apps, behind one switcher the way Jarvis Audio Studio holds its three — each still the app it was, each with its own accent so where you ar… |
| **Financial Bible** | `/apps/financial-bible` | Several rooms behind one front door, and the first of them answers the question that kills most ideas: not whether it is a good one, but what you actually DO on Saturday morning. |
| **Dump Finder** | `/apps/dump-finder` | A map for whoever is standing next to a loaded truck. |

## Where an app's code lives

For an app with route `/apps/<slug>`:

| Part | Path |
|---|---|
| Page | `src/app/apps/<slug>/page.tsx` |
| UI components | `src/components/<folder>/` |
| Logic, types, tests | `src/lib/<folder>/` (`*.test.ts` beside the code) |
| Server routes | `src/app/api/<folder>/` |
| Catalog entry | `src/lib/catalog.ts` → `PROJECTS` |

`<folder>` is usually the slug but not always — read the table in [`CLAUDE.md`](../../CLAUDE.md) for the exceptions rather than guessing.
