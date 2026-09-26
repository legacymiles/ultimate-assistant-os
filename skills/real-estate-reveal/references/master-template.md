# Real Estate Reveal — universal master template

This is the paste-ready prompt. It works in Claude Code, Lovable (use **Plan** mode first),
Cursor, v0 or any coding agent. Fill each `{{SLOT}}`. A slot you cannot fill gets deleted
along with its line, never guessed. Lines marked `‹if …›` only stay when that condition holds.

It is built from the prompt in the video (`source-prompt.md`, kept close to word for word)
plus the fixes the presenter needed in the adapted version (`adapted-example.md`):

- the inspection step
- continuity locks
- first and last frame chaining
- the route choice
- mobile
- a stricter verify step

The video engine is a slot, so the prompt no longer depends on Higgsfield.

## How to fill it

| Slot | What goes in | Example |
|---|---|---|
| `{{ADDRESS}}` | Street address or estate name | 22510 La Quilla Dr |
| `{{LOCATION}}` | City, state | Chatsworth, California |
| `{{PRICE}}` | As listed, or "Price upon request" | $4,795,000 |
| `{{FACTS}}` | Only confirmed facts, one per line | 5 bd · 6 ba · 7,467 sq ft · 1.02 ac |
| `{{LISTING_URL}}` | Official listing, optional | zillow.com/homedetails/… |
| `{{AGENT}}` | Name · phone · email · brokerage | |
| `{{IMAGE_COUNT}}` | How many photos are attached | 8 |
| `{{ROUTE}}` | One of the route blocks below, pasted in | Route B |
| `{{VIDEO_ENGINE}}` | Engine line from `video-models.md` | Seedance 2 via the hub's AI Gateway |
| `{{STACK}}` | Where it is built | single static HTML page · Next.js route in the hub · Lovable |

---

```text
Build me an award winning cinematic luxury real estate website for {{ADDRESS}}, {{LOCATION}}.

The site should feel like a private architectural film, not a normal real estate listing website.
The entire website is ONE continuous scroll driven camera journey through this real property.
Scrolling physically moves the camera. The cinematic experience IS the website.

PROPERTY
Address: {{ADDRESS}}
Location: {{LOCATION}}
Price: {{PRICE}}
Facts:
{{FACTS}}
Agent: {{AGENT}}
‹if listing url› Official listing: {{LISTING_URL}}
‹if listing url› Use the listing for all factual information. If it differs from the facts above, the listing wins. If the listing cannot be read, use only the facts above. Store every fact in ONE data file, never hardcoded across components.

I have attached {{IMAGE_COUNT}} real photos of this property. They are the full visual source of truth.

FIRST STEP — INSPECT BEFORE BUILDING
Before writing any code or generating any footage, inspect every attached image.
Produce a table: # | file | what it shows (room, angle, time of day, key materials) | role in the journey.
Note what is NOT shown (e.g. no bedroom photo). Anything not shown is never claimed, pictured or invented.
Then write the camera route as one line of arrows, e.g. aerial → pool → rear doors → living → kitchen → foyer → front.
The route must be physically possible in this house: no teleporting, no walking through walls, no rooms in the wrong order.
Show me the table and the route, then build.

SOURCE OF TRUTH
Use my images and property details as the source of truth.
Do not invent architecture, views, materials, rooms, or layout connections that do not make sense.
Do not redesign the house. Do not turn it into a different property.
Preserve the real furniture, finishes, proportions, landscaping, lighting and spatial feel shown in the images.

CINEMATIC FOOTAGE — {{VIDEO_ENGINE}}
Use {{VIDEO_ENGINE}} for all image to video generation.
Use my supplied images as the anchor frame of every generated sequence.
Chain the clips: the LAST frame of each clip is the FIRST frame of the next, so the journey never cuts.
If the model supports first frame + last frame control, use it for every clip: start on image A, end on image B.
If two supplied images are not directly connected, generate a short connecting sequence between them rather than cutting.
Prioritize realism and architectural consistency over dramatic AI effects.
Continuity locks, all clips: do not move windows, change doors, change the pool, change courts, replace furniture, change flooring, change landscaping, add rooms, or create fake views. The property must stay recognizable in every frame.
Create motion that feels calm, expensive and believable. Slow, steady camera. One camera direction per clip.
Subtle environmental motion only: moving light, reflections, trees, curtains, water.
No audio. 16:9 for desktop, generated at the highest practical resolution; also export optimized mobile versions.
Clips of 5–8 seconds. No text, logos or people in the footage.
‹if no engine available› If no video model is available, build the same journey from the stills with slow push-in / parallax moves and cross-dissolves, and keep every clip slot ready to swap for real footage later.

THE ROUTE
{{ROUTE}}

WEBSITE STRUCTURE
Build the website in 6 sections. Each section is a chapter in one continuous story, and the sections follow the route above.
Every section is full-bleed footage with very little text laid over it. Facts appear quietly over the environment as the camera reaches the thing they describe, and disappear as the camera moves on. Never as feature cards.
Section 1 is the hero: the strongest opening shot, with only {{ADDRESS}}, {{LOCATION}}, {{PRICE}} and at most one short line such as "A private residence in {{LOCATION}}". It should make the property feel important immediately.
Section 2 introduces the residence with 3–4 confirmed numbers (square footage, bedrooms, bathrooms, lot size).
Sections 3–5 carry the walkthrough. Each shows 1–3 short callouts tied to what is on screen (e.g. "Floor to ceiling glass", "Stone surfaces", "Spa style bath"), and only when true for this property.
The interior hero moment (kitchen, primary suite or the single strongest room) lets the camera slow down and the image breathe.
Do not reveal the finale's view too early.
Section 6 is the finale: the widest, strongest shot. It holds the private showing call to action:
  "Experience the Residence" / "Private showings by appointment"
  Agent name, phone, email, and a Request Private Showing button.
  A simple form: Name, Email, Phone, Preferred Showing Date, Message.
  The footage stays visible behind the form.

DESIGN DIRECTION
Expensive, quiet and editorial. Let the property set the visual tone and pull the colors from the home and the photography.
Do not make every property black and gold by default.
A refined serif for large headlines. A clean sans serif for small details, set in small caps or wide tracking.
Lots of negative space. Very few words. Large imagery leads.
Text must stay readable without covering the property. Use soft gradients at the frame edge, not boxes.
No template cards, no generic real estate styling. It should not feel like Zillow, Redfin or a normal brokerage site.

SCROLL AND MOTION — {{STACK}}
Scroll is the only control. Scrolling down moves the camera forward. Scrolling up plays the journey backwards.
Use Lenis for smooth scrolling and GSAP ScrollTrigger for scroll tied animation.
Scrub the footage by scroll position. Use video scrubbing with clips re-encoded for seeking (short keyframe interval, faststart), or frame sequences drawn to a canvas where video seeking stutters.
Fully preload each clip before it is needed, show a quiet loading state, and never show a black frame.
Transitions between sections are continuous. No harsh cuts.
Respect prefers-reduced-motion: replace scrubbing with still frames and gentle cross-fades.
Mobile: use the mobile clip versions, re-frame with object-position so the subject stays in view, and keep the form usable.

COPY STYLE
Short, quiet and specific. No generic luxury phrases, no empty claims. Facts and visual mood. Let the property do the selling.

FINAL VERIFICATION
Launch the website locally and open it in a real browser.
Scroll the whole journey from start to finish, then scroll back in reverse.
Confirm: the same property identity throughout; every transition makes physical sense; no black or broken frames; no impossible architecture changes; no visual jumps; no loading gaps; text appears at the right moments; every fact matches the listing; desktop AND mobile both work; the form works.
Fix any broken transition, impossible camera jump, loading issue, frame stutter or layout issue.
Do not tell me the website is finished until the entire cinematic journey works from beginning to end in the browser.
```

---

## Route blocks (paste one into `{{ROUTE}}`)

**Route A — Front to backyard (the original).** For homes whose best shot is the backyard or pool.
```text
Front exterior hero (slow push toward the house) → approach and entry (outside to inside through the front door) → main living spaces (slow glide) → kitchen or signature interior (camera slows, breathes) → transition to outdoor living (approach the rear doors or terrace, hold back the view) → pool and backyard finale (widest shot, CTA).
```

**Route B — Drone in, walk through, drone out (the adapted version).** For estates whose grounds are the headline (courts, acreage, views).
```text
Do NOT begin at the front. Begin high above the backyard with a wide drone view that establishes the size of the estate → descend and fly across the grounds (pool, landscaping, courts, outdoor living) and turn toward the rear of the residence → enter through the rear doors and pass through the main interior spaces → interior hero moment → walk out through the front door and turn 180° so the front architecture enters the frame piece by piece → front estate drone finale: finish the rotation, pull back and rise, reveal the driveway, grounds and scale, end on a large aerial of the FRONT (CTA here).
```

**Route C — View reveal.** For hillside, waterfront or skyline homes where the view is the product.
```text
Arrival at the front door at dusk → entry → living spaces with the glass wall held just out of frame → primary suite → the camera turns to the glass and moves out onto the terrace → finale: the view opens to full width, the lights of the view come up, CTA over the sky.
```

**Route D — Custom.** Write the route from the inspection table. Keep 6 sections and keep it physically continuous.
