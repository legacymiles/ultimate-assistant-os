---
name: real-estate-reveal
description: >
  Turn a property listing (photos + facts, optionally a Zillow/Redfin/MLS link) into a
  cinematic luxury real estate website: one continuous scroll-driven camera journey through
  the real home, from drone approach through the rooms to the pool or front-estate finale, with
  footage generated from the listing photos by an image-to-video model and scrubbed by scroll
  (Lenis + GSAP ScrollTrigger), minimal serif copy, confirmed facts only, and a private-showing
  form at the end. Produces either a paste-ready universal master prompt (for Lovable, Cursor,
  v0 or Claude Code) or the built site itself from a tested single-file engine, with a
  no-key stills fallback. Use WHENEVER the user wants a real estate / property / listing /
  home / estate / villa / rental / Airbnb website, "real estate reveal", "property walkthrough
  site", "scroll through the house", "drone flythrough website", "luxury listing page",
  "architectural film", "turn these listing photos into a website", "a site for my listing /
  my client's home", or the Lovable + Higgsfield real estate build. Also for resorts, venues
  and hotels when the site should be a camera journey through one real place.
---

# Real Estate Reveal

A listing site that is a film instead of a brochure. Scrolling moves a camera through the
real house. Scroll down and it flies forward, scroll up and it plays back. The footage is
generated from the listing's own photos, so the house never changes shape. The only words on
screen are the address, a few true facts, and a quiet request-a-showing form over the final shot.

Origin: YouTube `lGFJ-jt4hhU` (Lovable + Higgsfield MCP). The prompt from that video is
transcribed in `references/source-prompt.md`. This skill does not depend on Higgsfield or Lovable.

## What you produce

| Mode | When | Output |
|---|---|---|
| **Prompt** | The user builds elsewhere (Lovable, Cursor, v0), or only asks for "the prompt" | The master template filled for this property. Paste-ready. |
| **Build** | Default when the user wants the site | A working site from `templates/estate-film.html`: the clips, the filled `FILM` config, and screenshots showing it scrolls end to end on desktop and mobile |

If the request does not say which, build, and hand over the filled prompt too. It costs one extra step.

## Files

- `references/master-template.md`: **the universal master prompt**, with a slot table and route blocks A–D. Read it every time.
- `references/source-prompt.md`: the video's prompt, close to word for word. Reference only.
- `references/adapted-example.md`: how the video adapted it to one listing (reversed route, stricter locks, Lovable's plan table), plus what the finished site looked like.
- `references/video-models.md`: the clip spec, the per-clip prompt shape, and the **engine order, which is still a placeholder for the owner's model hierarchy**.
- `templates/estate-film.html`: the tested engine. One stage of stacked clips, scroll mapped to clip time, crossfades between chained clips, captions and facts timed per scene, a finale form, a loader, reduced-motion and mobile clips, and a stills fallback.
- `scripts/prep-clips.mjs`: makes any clip scrub-ready and writes the poster and last frame. `--kenburns` turns a still into a clip when no video model is available.

## Workflow

### 1. Intake: ask only for what is missing

Needed:
- **6–10 real photos.** Front exterior, entry, living, kitchen or best room, rear, pool or yard, and an aerial if one exists.
- **Address, location and price.**
- **Confirmed facts.** Beds, baths, square feet, lot size, and standout features.
- **Agent details.** Name, phone, email, brokerage.
- **Where it lives.** A standalone folder, a hub route (`/apps/<slug>`), or prompt only.

A listing URL is a bonus. Zillow blocks automated reads (HTTP 403; this happened in the video
too). Never scrape around that. Ask the user to download the photos and paste the fact block.
Facts that nobody supplied are left out, never estimated.

### 2. Inspect: the step that makes it real

Open every photo with Read. Then write down:
1. **A mapping table**: `# | file | what it shows (room, angle, time of day, materials) | role in the journey`.
2. **What is not shown.** For example, no bedroom photo means no bedroom claim and no bedroom shot.
3. **The route**, as one line of arrows that could be walked in this house. Pick a route block from the
   master template:
   - **A** front → backyard, when the pool or yard is the payoff.
   - **B** drone in → walk through → 180° out front → aerial pullback, when the grounds or scale are the headline.
   - **C** view reveal, for hillside or waterfront homes.
   - **D** custom.
4. **The palette, pulled from the photos.** Take ink (light text), shade (deep background) and accent from the actual
   stone, wood, dusk sky and water. Never black and gold by default. A quick average of a photo:
   `ffmpeg -i photo.jpg -vf scale=1:1 -f rawvideo -pix_fmt rgb24 - | xxd -p`.

Show the table and route to the user in a few lines. Go ahead unless they object, because the table itself is the checkpoint.

### 3. Footage

Use one clip per scene, usually 6. That rises to 7–9 when a connecting move is needed. Plan each clip as
**start frame → end frame + camera move**, using the per-clip prompt shape in `video-models.md`.
**Chain the clips.** The last frame of clip N (`NN-last.jpg` from prep-clips) is the start frame of
clip N+1. Where the model allows it, the next listing photo is the end frame. This is what makes the
crossfades invisible.

Pick the engine from `video-models.md`. Until the owner's hierarchy exists:
- If a key is present and the render is paid, say the engine, the clip count and a rough cost, and get a yes first.
- If no key is present, build every scene with `prep-clips.mjs --kenburns`. Vary the moves: `in` for approaches, `right` or `left`
  for glides, `out` for finales. Tell the user which scenes are stand-ins. The site is complete either way.

Put every clip through prep-clips, generated or not:
```bash
node ~/.claude/skills/real-estate-reveal/scripts/prep-clips.mjs raw/03.mp4 --out site/clips --name 03
node ~/.claude/skills/real-estate-reveal/scripts/prep-clips.mjs --kenburns photos/kitchen.jpg --out site/clips --name 04 --move right
```
(ffmpeg comes from `$FFMPEG`, then PATH, then `pip install imageio-ffmpeg`. It is not on PATH on this PC.)

### 4. Build

**Standalone.** Copy `templates/estate-film.html` to `site/index.html` and fill the `FILM` JSON:
- property, agent and palette
- one entry per scene: `video`, `mobile`, `poster`, `length` in viewport-heights (1.3–1.8, with more for the interior hero and the finale), `focus` as an object-position for the portrait crop
- `captions` given as `{text, sub?, at:[in,out], place:left|right|center}`
- `facts` and `factsAt` on the introduction scene

Unfilled `{{SLOTS}}` hide themselves. `form.action` takes a POST endpoint. Left empty, the form opens
mail to the agent.

**In the hub.** Make a route at `src/app/apps/<slug>/page.tsx`. Port the engine into a client component with
the same logic, keep the clips under `public/<slug>/clips/`, and add the app to `src/lib/catalog.ts`. Lenis and
GSAP are already installed in the repo.

**Prompt mode.** Fill `master-template.md` with the table, route, facts, `{{VIDEO_ENGINE}}` and
`{{STACK}}`, then hand it over in one fenced block. For Lovable, say "use Plan mode first, attach the
photos, approve the plan after checking the image→section table".

Design rules. These come from the video's prompt and the finished site, and the engine already follows them:
- Full-bleed footage everywhere. No cards, no nav menu, only a hairline top bar (address · Private showing) and a 1px progress rail.
- The address sits large, in a light serif, bottom-left. Location, price and one line go under it in tiny tracked caps.
- Chapter words appear in italic serif on the right or in the centre, only while the camera is on that thing.
- 3–4 facts at most per scene. Fewer words is better.
- Text sits on soft edge gradients and a faint shadow, never in boxes. It must stay readable over bright footage.
- The finale holds the last frame while the showing form rises over it, fading in whole.
- Choose fonts to suit the house. The default is Cormorant Garamond with Jost. A modern house could take a sharper serif. Keep one serif and one sans.
- Copy is short and specific. Leave out "stunning", "luxurious" and "breathtaking".

### 5. Verify: never "done" before this passes

The browser pane throttles animation frames when it is hidden, so scrub screenshots there come out stale or blank.
Use **Playwright headless** (the `browser_run_code_unsafe` tool):
1. Serve the folder over HTTP. A `launch.json` entry running `python -m http.server <port> --directory <site>` works.
   Do not use `file://`, because blob preloading needs HTTP.
2. At 1440×810 and at 390×844, scroll to about 8 positions, including one inside a crossfade and one in the
   finale. At each, wait 1.5 s, screenshot, and log every `.shot` opacity. Put the screenshots on one contact sheet
   (`ffmpeg -i d%d.png -vf scale=640:-1,tile=4x2 sheet.jpg`) and look at it.
3. Check each of these:
   - There are no black or white frames.
   - The scenes come in route order.
   - A crossfade shows two opacities, such as `1.00 0.84`.
   - Captions show only on their scene.
   - Facts match the source.
   - The mobile clip loads (`currentSrc` points at `-m.mp4`).
   - The form works.
   - The console has no errors.
4. Scroll back up through the whole journey and confirm it plays in reverse.
5. Check each generated clip for warped architecture, especially windows, doors and pool shape. Regenerate a clip whose
   house has changed. Do not ship it.

Then offer `gauntlet-loop` if the user wants the site pushed further.

## Pitfalls (each one has cost a build)

- **Model output scrubs badly.** It has long keyframe gaps, so scrolling backwards freezes. The fix is always prep-clips (a keyframe every 6 frames, no B-frames).
- **Source frames with text or UI burned in** show through the overlays. Check the first and last frames of every clip.
- **White or black first frames**, common after screen recordings or fades, flash at the start of a scene. Trim them.
- **Portrait crop.** A 16:9 clip shown on a phone loses its sides. Set `focus` so the subject stays in frame, and check the mobile sheet.
- **Invented facts.** If a fact is not in the photos or the supplied block, it is not on the site. That covers bedrooms, views, "chef's kitchen" and anything else.
- **The Higgsfield MCP is optional.** The owner does not want it required. Never block on it.

## Related skills

- `scroll-craft`: general scroll-driven brand pages. This skill is the property-specific film.
- `interactive-web-studio`: when the property site should also have playful interaction.
- `video-analyzer`: to study a reference property video before building.
- `gauntlet-loop`: the quality gate after verification.
