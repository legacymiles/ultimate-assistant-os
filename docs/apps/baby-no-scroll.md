# Baby No Scroll

Route: `/apps/baby-no-scroll` · Category: Apps · Live

Record reviewed: 2026-11-25

> **This file is the truth about this app.** Read it before changing the app and update it in the
> same commit. Everything above the "From the code" block is written by hand and kept; that block
> is rewritten from the code by `npm run apps:records`, and `npm run check:records` (part of
> `npm run verify`) fails when it is stale. Edit prompt: `npm run change-it -- baby-no-scroll "what to change"`.

## What it does

A child lock for a screen you are about to put in a small pair of hands. Pick a YouTube video or playlist, or one of eleven games, set a password, press Hand it over, and that one thing fills the screen with everything else taken away: no scrolling, no bouncing, no pinch, no pull-to-refresh, no long-press menus, no keyboard, no back gesture, and over a video no YouTube controls, no channel link and no wall of other videos at the end. The way back out is the parent's password: a dull steel key in a corner that must be pressed and held for over a second (a baby slaps, a baby does not press and wait), then a number pad the app draws itself, so the phone's own keyboard never opens. Three wrong tries and the pad makes you wait, longer each time, and it closes itself if left alone. Parents who prefer no password can switch back to the padlock, which opens only by being dragged an angle across two edges of the screen: along a line of widely spaced dots to the next corner, then a right-angle turn and along a second line of dots to the corner opposite. Two far-apart dotted paths and one deliberate turn — a baby's thumb travels one way and stops, so it gets nowhere, while a parent does it in a second with no hold at the end. The games are built for a hand that cannot aim and every touch is correct: a racing sky of glossy balloons whose pops climb a musical scale, with gold balloons that set off fireworks and rainbow ones that split into a flock; a Musical Playroom with a toy shelf of six instruments (piano, xylophone, drums, harp, bells, bongos), one big instrument on screen at a time, all tuned so no mashing sounds wrong; rainbow soap bubbles; fireworks that launch to wherever a finger lands; squishy jelly friends with faces that wobble and bounce; a fish tank to feed; a toy-town road of beeping vehicles; peekaboo animals hiding in a meadow; neon finger paint that sings as it moves; eggs to crack open; and Silly faces, a Snapchat-style magic mirror where the front camera puts puppy ears, a crown or a lion's mane on the face it sees (tracked with jeeliz FaceFilter), a swipe changes the lens and an open mouth sets off its trick — the picture never leaves the device, and with no camera a cartoon buddy wears the lenses instead. Everything is drawn on a canvas at 60fps and every sound is synthesised in the browser, so there is nothing to download and it works on a plane. It is honest about its ceiling: a web page cannot disable a home button, so the setup screen tells you to install it and put Guided Access or Screen Pinning underneath it for a device you actually walk away from.

## Features

- **Parent password** — set on the console before the hand-over (4–8 numbers, typed twice, refuses `1111`/`1234`-style runs). Stored only as a salted SHA-256 hash, never the digits. Hand it over stays disabled until one is set.
- **Password gate on the locked screen** — a steel key in the chosen corner: press and hold 1.2 s to open the in-app number pad (a tap only wiggles it; triple-tap moves it to the next corner). Checks the moment the last digit lands. 3 wrong tries → 30 s wait, doubling to a 5 min cap, kept for the life of the tab. Pad closes itself after 20 s untouched. A real keyboard's digits and Backspace work too.
- **Angled drag lock (optional)** — the padlock dragged along two dotted lines on two edges of the screen with a right-angle turn between them, chosen under "How it unlocks". A tap shows the dots; they put themselves away after 4 s. The second leg only starts counting once the first has been travelled, the turn cannot be undone mid-drag, and a finger more than 110 px off the edge it is following stops counting rather than springing back — so one diagonal swipe to the far corner, which would otherwise cover both legs at once, opens nothing. Letting go short of the end springs it home with a knock. "Hold at the end" adds a second on the last corner; off by default, since the turn is the safeguard. Keyboard: focus the lock and hold Enter for 1.8 s.
- **YouTube** — one video or playlist, no controls, no end-screen wall, loop forever, saved shows newest first.
- **Balloon pop** — canvas sky of glossy balloons racing up past clouds; touch pops (shards, confetti, shockwave), tap empty sky inflates a new one from the finger, dragging pops everything it crosses, quick pops climb a pentatonic melody, gold balloons fire fireworks, rainbow balloons split into five.
- **Musical playroom** — toy shelf of six instruments (piano, xylophone, drums, harp, bells, bongos); one fills the screen at a time; every pitched one is pentatonic; dragging plays every key/bar/string crossed; remembers the last instrument.
- **Bubbles · Fireworks · Jelly friends · Aquarium · Zoom zoom · Peekaboo** — six more canvas games, every touch anywhere answered instantly with picture and sound.
- **Silly faces** — the front camera as a magic mirror (jeeliz FaceFilter, npm `facefilter`, Apache-2.0; model served from `public/baby-no-scroll/face/`). Ten lenses — puppy, bunny, crown, kitty, heart glasses, flower crown, bear, alien, lion mane, rainbow — that follow the face's position, size and tilt. Swipe left/right changes lens (Snapchat-style carousel, kept out of the lock's corners; lifts above them on a phone), tap = sparkles + giggle, open mouth = the lens's trick (puppy tongue, rainbow). The console's **Allow the camera** asks the browser before the hand-over so the baby never sees the permission dialog. No camera, blocked camera or no WebGL → a cartoon buddy wears the lenses. Camera light goes off when the game closes; nothing is recorded or sent.
- **Finger paint** — neon ribbons per finger with stars and a note for every stretch of distance; a tap blooms a flower of light.
- **Hide and seek** — six eggs to crack.
- **Escape-proofing** — fullscreen (repaired by the next touch if lost), wake lock, keyboard lock, back gesture swallowed, reload comes back locked, install-as-app prompt on phones.

## Must keep working

- A password must be set before Hand it over works when "Password" is chosen; the right password always opens the screen, a wrong one never does.
- Holding the corner key opens the pad; tapping it never does.
- The angled drag never opens from a single straight or diagonal swipe — only from a drag that travels the first leg, turns the corner, and travels the second.
- Baby No Scroll shows no microphone anywhere: the hub's voice only exists on pages that have a Jarvis chat or harness thread.
- Closing the app completely and reopening it lands on the console (the forgot-my-password route).
- Silly faces never shows the browser's camera question on a locked screen once the console's Allow the camera is done, and falls back to the cartoon buddy (never a black screen) when the camera is unavailable.
- A saved setting of the old "Baby piano" opens the Musical playroom.
- Every game answers every touch, and nothing on a locked screen scrolls, zooms or opens a menu.

## Requested, not built yet

_Nothing waiting._

<!-- code:start -->
## From the code

_Rewritten by `npm run apps:records` from the source — do not edit by hand. `npm run check:records` fails when it is out of date._

### Where it lives

- Page `/apps/baby-no-scroll` — owner's sign-in
- `src/components/baby-no-scroll/`
- `src/lib/baby-no-scroll/`

### Sign-in & who can use it

- _No sign-in code of its own; the hub middleware decides access (see routes below)._

### Server routes

- _None._

### Data & database rules

- Saved data `baby-no-scroll:v1` — `src/lib/baby-no-scroll/store.ts`

### Keys & outside services

- _None._

### Tests

- `src/lib/baby-no-scroll/device.test.ts`
- `src/lib/baby-no-scroll/faceLenses.test.ts`
- `src/lib/baby-no-scroll/instruments.test.ts`
- `src/lib/baby-no-scroll/lock.test.ts`
- `src/lib/baby-no-scroll/password.test.ts`
- `src/lib/baby-no-scroll/youtube.test.ts`
<!-- code:end -->
