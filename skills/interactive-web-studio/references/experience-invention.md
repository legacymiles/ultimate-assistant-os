# Experience Invention — The Toy Comes First

Read this BEFORE art direction, at the very start of any project where the goal is a memorable interactive experience. This is the "Creative Experience Studio Brain": stop thinking like a frontend developer, start thinking like a multidisciplinary studio of creative directors, game designers, motion designers, technical artists, and storytellers.

**The core inversion:** never begin with components, layouts, buttons, or code. Begin by inventing an original interactive experience. A shader is not an idea. Particles are not an idea. Glassmorphism is not an idea. Three.js is not an idea. Those are tools. The idea comes first; technology exists only to serve it.

Success is not measured by how many effects the site contains. It's measured by whether someone says: **"I've never interacted with a website like this before."**

Invent first. Design second. Build last.

## Table of contents
1. Stage 1 — Invent the toy
2. Stage 2 — Layer surprise moments
3. Stage 3 — Think like a game designer
4. Stage 4 — Build living systems
5. Stage 5 — Controlled chaos (unexpected combinations)
6. Stage 6 — One dominant emotion
7. Writing the invention brief
8. Keeping invention shippable

---

## 1. Stage 1 — Invent the toy

Ask: **"If this website became a toy or game, what would users actually play with?"**

Invent ONE unforgettable core mechanic — the thing the whole experience is built around. Seed ideas (as inspiration, not a menu to reuse):

- A machine that manufactures the webpage in real time as you watch.
- Gravity that bends the UI around the cursor.
- Typography that escapes and must be collected.
- Living objects that evolve as they travel through the page.
- Interactive portals connecting different worlds/sections.
- A giant creature that reacts to user behavior.
- A musical instrument built from interface elements.
- A world where scrolling changes physics instead of position.
- A website that slowly constructs itself.
- A machine that recycles content into entirely new forms.

**Never repeat a mechanic from a previous project.** Treat these examples as expired the moment they're used — the job is always to invent a new one that grows out of *this* brand's story. The strongest mechanics are metaphors: a printing studio whose site literally prints itself; a data company whose content flows through visible pipes; a coffee brand whose page steams and pours.

A good toy test: could you describe the mechanic in one sentence to a friend and make them want to try it? "The headline shatters when you click it and you rebuild it by hovering" passes. "It has nice scroll animations" does not.

## 2. Stage 2 — Layer surprise moments

One mechanic isn't enough — the page should keep rewarding curiosity. Plan several smaller surprises around the core toy. Input dimensions to mine:

| Input | Surprise ideas |
|---|---|
| Hover | temporary gravity wells; objects lean toward/away; light ignites |
| Click | reality fractures; ripples propagate through the whole scene; hidden objects wake |
| Repeated clicks | escalation — something charges, hatches, or breaks through |
| Drag | the environment stretches like fabric; you can throw things |
| Scroll | changes time, season, scale, or physics — not just position |
| Hold | energy charges while held, releases on letting go |
| Cursor velocity | fast movement creates wind/turbulence; slow movement attracts particles |
| Idle (5–10s) | secret animations, characters peek out, the world relaxes |
| Sequences | one interaction unlocks another; timing changes the response |

Pick 2–4 that reinforce the core mechanic (not random novelty). Idle surprises are the cheapest delight-per-effort on the list — almost nobody does them.

## 3. Stage 3 — Think like a game designer

Design systems, not isolated animations. Before building, answer:

- What is the *player's* goal on this page? What are they discovering?
- What rewards exploration? Are there secrets? Alternate paths?
- Do objects react differently depending on timing or state?
- Can interactions chain — one unlocking or transforming another?
- Does scrolling feel like *progression* (a journey with milestones) instead of navigation?

Even one lightweight game loop (discover → interact → get rewarded → discover more) transforms a site from a brochure into a place. Small persistent state (things you've touched stay changed, a counter of secrets found) makes exploration feel real.

## 4. Stage 4 — Build living systems

Nothing should be idle. Every object gets *behavior*, not just an entrance animation — think ecosystem, not decoration:

- Ambient life: clouds drift, lights breathe, machines pulse, plants grow, water reacts, words mutate.
- Reactive life: elements notice the cursor from a distance, look at it, make room for it.
- Interconnection: particles communicate; disturbing one part ripples to others.

Implementation note: "alive" means continuous low-amplitude motion (noise-driven idle animation, springs at rest that can be disturbed) — cheap on GPU if driven by shaders/`useFrame` rather than per-element React state. Everything exists for a reason; if a living behavior doesn't serve the mechanic or the mood, cut it.

## 5. Stage 5 — Controlled chaos

Originality often comes from colliding categories nobody puts together:

Mechanical + Organic · Nature + Technology · Liquid + Geometry · Typography + Physics · Music + Navigation · Space + Office · Fantasy + Dashboard · Factory + Portfolio · Museum + Video Game · Kitchen + AI · Library + Galaxy

Use the collision to generate the mechanic (a *factory* portfolio → projects roll off an assembly line you control; a *library galaxy* → books orbit and you gravity-slingshot between shelves). Invent combinations people would never expect — then execute them with the discipline of the main skill so it reads as intentional, not random.

## 6. Stage 6 — One dominant emotion

Choose ONE dominant feeling and make every layer reinforce it: wonder, curiosity, joy, mystery, playfulness, discovery, power, calm, energy, adventure.

The emotion is the tiebreaker for every later decision — palette, easing, sound, lighting, copy. If the mechanic says "playful" but the lighting says "ominous," one of them is wrong. (Art direction for the chosen emotion lives in `art-direction.md`.)

## 7. Writing the invention brief

Output of this phase — 5–10 lines, shown to the user before the art-direction brief (or merged with it):

```
THE TOY: [one-sentence core mechanic]
WHY IT FITS: [how it embodies the brand/story]
SURPRISES: [2–4 secondary moments, by input]
THE LOOP: [what the player discovers/is rewarded with]
ALIVE: [what idles, breathes, reacts]
EMOTION: [the one dominant feeling]
```

If you can't fill "THE TOY" with something you've never seen a website do, keep inventing.

## 8. Keeping invention shippable

Invention doesn't suspend the main skill's guardrails — it raises the stakes on them:

- **Content still wins.** The toy must never hold the actual content hostage. A visitor in a hurry (or on a screen reader, or with reduced motion) gets everything without playing. Playfulness is a reward layer, not a gate.
- **Reduced motion / accessibility:** the mechanic gets a calm equivalent or a graceful off-switch. Secrets may be motion-only; content may not.
- **Performance:** physics and living systems run within the same 60fps budget (see tech-stack.md). Prefer shader/GPU-driven life over hundreds of DOM tweens.
- **Scope honestly.** One flawless toy + three tight surprises beats an ambitious broken world. If the mechanic can't be excellent in the available scope, shrink the mechanic, not the quality.
- **Clients exist.** For conservative briefs (enterprise SaaS, medical, legal), dial invention into micro-scale: one tasteful signature interaction and living details, not a game world. The invention mindset still applies — it just whispers.
