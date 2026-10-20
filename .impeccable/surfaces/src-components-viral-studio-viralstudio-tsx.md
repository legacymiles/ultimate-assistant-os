---
version: 1
slug: "src-components-viral-studio-viralstudio-tsx"
primary_target: "src/components/viral-studio/ViralStudio.tsx"
related_targets: ["src/app/apps/viral-studio-content/page.tsx"]
---

# Viral Studio Content — surface brief

Scope: the whole app at /apps/viral-studio-content. Mode: Experience (the clips lead), with an Operate core (paste a link, delete a clip) that must never get buried.

Audience and job: the owner, at night on a laptop or iPhone, saving viral clips into four boards (Viral audio, Fights, Dances, Motion) as reference for video workflows. Action: paste a social link into the open tab; hover to watch; one tap to delete, with Undo.

Constraints: real thumbnails only (no stand-in art); one WebGL context at a time; works with no keys (embeds when the file can't be saved); keyboard and touch both first-class.

Owner's answers: resting wall is black & white, colour comes in on hover; big cinematic tiles, ~4 across on a laptop; must not feel plain/template-y; adding and deleting stay obvious. Took the category standard (clean streaming grid) with Apple TV+ as the craft bar. Roll ran degraded (no challengers, roll service unreachable from the sandbox).

## Direction contract

THESIS: A streaming-grade gallery where colour is earned: every clip rests in black and white, and the cursor scans colour and motion into it. Refuses the neon dashboard card grid the first build shipped.
OWN-WORLD: True-black ground, one cool-grey ramp, white as the only accent; the content supplies all colour. Geist Sans, large confident titles, 14px rounded artwork, soft offset shadows on lift, translucent nav bar. No per-tab neon, no glows.
STORY: The owner sees their newest clip lit large, understands the four boards at a glance, pastes a link without looking for a button, scans a tile to watch it, and removes one with a single tap.
FIRST VIEWPORT: Translucent top bar (wordmark left, four-segment board switcher centre, sound right). Hero: the board's name at display size, its count and hint, the paste field as the primary action; the newest clip's art blurred behind as ambient light. Below, the first row of 3:4 posters, four across.
FORM: Category standard played straight (the standing exit, Apple TV+ bar); the roll assigned grounded candidate 4 (riso print wall) and the owner declined it. Seed key 1f745dc1. Signature interaction: webgl-trail-reveal ring-buffer trail from B&W to colour, flooding to full colour as the clip starts.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
