# AI Live Studio

Route: `/apps/ai-live-studio` · Category: Video · Live

Record reviewed: 2026-11-24

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- ai-live-studio "what to change"`.

## What it does

A real-time AI host for a TikTok LIVE stream, and the owner's control room for it. The host (Alex by default) reads the chat and answers people by name, out loud — gifts and follows first, @mentions next, plain questions aged up so a busy room never starves them, repeats dropped, and a line of its own when the room goes quiet. Nothing a viewer types is read aloud until it passes moderation. The owner can answer any comment now, skip it, mute its sender, or type a line for the host to say word for word.

Design spec and plan: `docs/superpowers/specs/tiktok-live-voice-agent.md`, `docs/superpowers/plans/2026-11-23-tiktok-live-voice-agent-phase-1.md`.

## Features

- **Stage** — 9:16, the host's portrait (`public/ai-live-studio/alex.jpg`, 145 KB) breathing and gently swaying; or LiveTalking's lip-synced WebRTC stream when picked under Avatar and running on this PC (`C:\dev\livetalking`, :8010). States: off air, listening, thinking, speaking, AI paused.
- **The key light** (`data-standout="voice-light"`) — the light around the stage is driven per frame by the host's real audio level (AnalyserNode on Phonon/Fish audio or the LiveTalking stream); a speech-shaped envelope for the browser voice, which reports no levels. Opacity/transform only.
- **Live chat** — newest at the bottom with auto-scroll and a "N new" pill when scrolled up (deliberate exception to U6: the brief asked for a real livestream chat). Viewers, events (gift/follow/share) and the host's own lines are three different objects; the line being spoken is highlighted.
- **Director** (`src/lib/ai-live-studio/director.ts`) — priority (operator > gift > follow > mention > share > question > chatter) with ageing (+1.5/s), per-minute cap from Response frequency, 5-minute repeat window, 2-minute staleness, idle filler from Audience interaction, interrupts on higher priority, `drainDiscarded` so every passed-over comment says why.
- **Thinking ahead** — while one line is spoken the next reply is already being written (`peek` + prefetch). Measured: thinking time 37% → 0%, reply speed 4.5 s → 0.1 s.
- **Moderation** (`moderation.ts`) — harassment (incl. spaced-out spellings), links, phone numbers, emails, spam, and the owner's own word list, before the queue; unsayable usernames become "friend". The model's reply is moderated too.
- **Owner's hand** — Answer now (passes the per-minute cap, starts writing its reply at once), Skip, Mute viewer, "Make Alex say", "Comment as a viewer" (demo only), Pause AI (can be armed before going live), Mute voice, End live with a 3-second confirm window.
- **Brain** — `POST /api/ai-live-studio/reply`, owner-only, input checked server-side, 40 calls/min cap, 8 s timeout, canned line with no AI key, model `LIVE_STUDIO_MODEL` or `anthropic/claude-haiku-4.5`. A busy queue asks for one-sentence replies. Replies parsed by `reply.ts`, which strips made-up tool-call markup the model sometimes emits.
- **Voice** — `/api/tts` (Phonon, Fish as its net) per sentence, next sentence synthesized while one plays; falls back to the browser voice with a plain-English notice.
- **Personality** — 5 presets; name, persona, humour, energy, expressiveness, style, voice, speed, response frequency, audience interaction, blocked words, TikTok account, LiveTalking avatar. Every field changes behaviour; synced across devices (`ai-live-studio:v1`).
- **Status strip** — health, comments source, face, voice, frame rate (render or real WebRTC stream fps), reply speed, comments waiting. Status = icon + word, never colour alone.
- **Stage only** — the frame full screen with operator chrome hidden, for window capture.
- **Director booth** (left column; below 1180 px it slides in from the top bar's Director button, full screen on a phone) — the owner's private side, in a cool blue (#8ab4ff) that never appears on the stage. A mic orb whose ring follows your voice (tap = Director Mode on/off; listening modes Always / Hold to talk (hold the orb or the ` key) / Only after "Alex"), a giant TALKBACK OFF/ON switch, where each voice goes (Talkback device vs the stream's device, pickable under Change, with the reason whenever Talkback falls back to text), the private thread (you on the right, Alex privately on the left, ✓ acks inline, "Which Mike?" choices, "Not sure I heard that right — apply it?" for unsure recognition), Performance (emotion chips, eye contact, head movement, reactions, standing notes and avoided topics with ×, Reset), the command bar with 8 types (Direction, Say exactly, Reply to comment, Reply to person, Change subject, React, Skip, Prioritize) and End session (stops the mic and Talkback; the stream and the direction carry on). Acks also float in the room's left gutter, never on the stage.
- **Chat for a director** — a numbered Up next queue (answering now, then the order with the reason: gift, mention, question · waited, "Prioritized by you · note"); comments show new · selected · queued · answered · prioritized; the selected comment gets Answer next / Reply again, Instruct…, Reply to @user, Skip, Mute and History (everything that viewer said and Alex's replies). Every chat action is logged in the private thread.
- **The face performs** — expression chip on the stage ("Sarcastic · eyes 8 · head 5"); the frame leans, tilts, sways by head movement and drifts off the lens by eye contact (`.als-perf`, transform/translate only); speaking speed follows the emotion.
- **Director engine** — the owner directs Alex like an actor. `command.ts` turns natural speech ("be a little more sarcastic", "Respond to Mike next. Tell him that's a ridiculous question.", "stop talking about politics and ask everyone where they're from", "wait five seconds") into structured directions instantly and offline; anything it can't place goes to `POST /api/ai-live-studio/direct`, which returns the same checked shape. Names resolve against the live chat ("Mik" → @mike23; two Mikes → "Which Mike?"; nobody yet → answered the moment they comment). `performance.ts` holds the acting state (emotion, eye contact, head movement, reactions, standing notes, topics to avoid) and writes it into the public brain as a private block — the reply route rejects any line that would mention being directed (`leaksDirection`). The Director's cue lines ("ask the room…") are written by the brain from a private intent that is never itself spoken. `routing.ts` keeps Talkback off the stream: it only speaks on a different physical output device (compared by groupId, so "default" aliases can't fool it), else it answers in text; Alex's own words heard by the mic are dropped as echo.
- **Demo audience** — a scripted room that exercises every rule (the brief's own conversation, a gift, a link, harassment, a repeat, a mention), then an endless seeded pool.

## Must keep working

- Go live with the demo audience: the host answers within a few seconds, and keeps answering.
- A gift is thanked before older plain comments; the first question of the stream is still answered once it has waited.
- "kys", links and the owner's blocked words are never spoken and show as hidden with a reason.
- A repeated question is marked "Not answered — already answered a question like it".
- Answer now puts that comment next, even at the per-minute cap.
- With no comments, the host speaks up after the Audience-interaction delay.
- No AI key → canned lines; no Phonon → browser voice; LiveTalking off → portrait. Never a silent stream, never a crash.
- No markup is ever read aloud or shown as the host's line.
- A director's instruction is never spoken, shown in the public chat, or acknowledged on air; a reply that mentions being directed is replaced before it airs.
- Talkback never plays on the stream's device: when the two outputs can't be told apart (before mic permission, unplugged, same speakers) or the voice is the browser's, Alex answers in text.
- With Talkback off, nothing in the booth makes a sound. Turning Talkback off never stops Director Mode; End session never ends the stream.
- A new direction never cuts Alex off mid-sentence — it reshapes his next reply (the one written ahead is cancelled and rewritten). "Don't answer that" during that answer lets the current sentence finish.
- A plain question to Alex ("what do you think of the audience?") never changes the show.
- Nothing touches the microphone or the audio devices until the owner taps the mic or opens Change; Jarvis's own hands-free voice never listens on this page.
- The page never scrolls sideways at 390 px, and the hub's voice orb stays off this page (it would hear the host).

## Requested, not built yet

- **TikTok relay** (`tools/tiktok-live-agent/`, plan Tasks 7–8) — the studio's side is built and listens on `ws://127.0.0.1:8787`; the relay that reads TikTok and forwards comments is next.
- **Alex's own LiveTalking avatar — built 2026-11-24.** `alex_portrait` (150 frames, 540×960) was made from the portrait itself: a 6 s seamless "breathing" loop (`ffmpeg … zoompan z='1.0+0.012*sin(2*PI*on/150)'` → `C:\dev\livetalking\data\source\alex_portrait.mp4`) through `PYTHONPATH=. .venv/Scripts/python.exe avatars/wav2lip/genavatar.py --video_path data/source/alex_portrait.mp4 --img_size 256 --avatar_id alex_portrait`. Start LiveTalking with `--model wav2lip --avatar_id alex_portrait --modelres 256 --transport webrtc --listenport 8010`; it is now the default `avatarId`. A real video of Alex (WanGP) would add head motion; the still loop already lip-syncs.
- **Local speech recognition — built 2026-11-24.** The director mic listens through LiveTalking's own recognizer (SenseVoiceSmall, `ws://127.0.0.1:8010/api/asr`) whenever it answers — `src/lib/ai-live-studio/localRecognition.ts`, shared with Jarvis's real face — so the director's voice stays on this PC. Turning Director Mode on checks for it first; not running → the browser's recognition as before. One-time setup: `uv pip install --python .venv/Scripts/python.exe funasr modelscope` in `C:\dev\livetalking` (first start downloads the model, ~80 s; ~0.4 s per utterance after).

- **Expression stills** — real smiles/surprise need expression variants of the portrait (Flux 2 Klein in WanGP, free); until then expressions are performed by moving the frame.
- **Owner's mic** (phase 2) and **guest audio with an echo gate** (phase 3).
- **Output for an OBS browser source** — Stage only works with window capture today; a separate output page needs the relay as a cross-process bus, since LiveTalking gives each WebRTC connection its own session.

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/ai-live-studio` — owner's sign-in
- `src/app/api/ai-live-studio/`
- `src/components/ai-live-studio/`
- `src/lib/ai-live-studio/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

| Methods | Route | Who can call it |
|---|---|---|
| POST | `/api/ai-live-studio/direct` | owner's sign-in |
| POST | `/api/ai-live-studio/reply` | owner's sign-in |

### Data & database rules

- Saved data `ai-live-studio:perf:v1` — `src/components/ai-live-studio/useStudio.ts`
- Saved data `ai-live-studio:v1` — `src/components/ai-live-studio/useStudio.ts`

### Keys & outside services

- `LIVE_STUDIO_MODEL` — `src/app/api/ai-live-studio/direct/route.ts`, `src/app/api/ai-live-studio/reply/route.ts`
- AI calls through `src/lib/ai/provider.ts` — `src/app/api/ai-live-studio/direct/route.ts`, `src/app/api/ai-live-studio/reply/route.ts`

### Tests

- `src/lib/ai-live-studio/command.test.ts`
- `src/lib/ai-live-studio/demo.test.ts`
- `src/lib/ai-live-studio/director.test.ts`
- `src/lib/ai-live-studio/events.test.ts`
- `src/lib/ai-live-studio/limits.test.ts`
- `src/lib/ai-live-studio/livetalking.test.ts`
- `src/lib/ai-live-studio/localRecognition.test.ts`
- `src/lib/ai-live-studio/moderation.test.ts`
- `src/lib/ai-live-studio/performance.test.ts`
- `src/lib/ai-live-studio/personality.test.ts`
- `src/lib/ai-live-studio/priority.test.ts`
- `src/lib/ai-live-studio/reply.test.ts`
- `src/lib/ai-live-studio/routing.test.ts`
- `src/lib/ai-live-studio/speech.test.ts`
<!-- code:end -->
