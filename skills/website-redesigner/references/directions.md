# Redesign directions — presets & skill mappings

Use this to propose concrete, varied redesign directions instead of three flavors of
"clean and modern". Aim for three directions that sit at different points on the
restraint↔expression axis so the user's pick actually means something.

## The variety rule

For any site, propose directions spanning roughly:
1. **Restrained** — editorial, trustworthy, content-first. Fewer effects, strong type.
2. **Expressive** — branded, colorful, confident motion. A clear personality.
3. **Experimental** — WebGL / kinetic / unconventional layout. High-wow, higher-risk.

If the site's purpose constrains this (a bank won't go experimental), shift the whole band
toward restraint but still offer three distinguishable takes.

## Design-skill → direction mapping

Match the driving skill to what the direction needs:

- **interactive-web-studio** — cinematic, immersive, motion-driven, scroll-storytelling,
  "premium/Awwwards" feel. Best for the expressive and experimental directions.
- **capcut-design** — clean, modern product UI with an exact token system (color, type,
  spacing). Best for the restrained/product direction and anything that must feel polished
  and consistent fast.
- **webgl-trail-reveal** — a specific mechanic: mouse-trail image reveal (calm ↔ dramatic).
  Reach for it when the site has a strong hero image or a before/after story to tell.
- **exploded-showcase** — 3D product teardown / exploded hero with labeled parts. Best when
  the site sells a physical product, device, or machine.

The user may add skills; treat any newly-provided skill's description as its mapping.

## Palette presets (starting points, then tune to the site's brand)

- **Ink & Paper** — near-black `#111`, warm white `#FAF8F4`, one accent. Editorial, calm.
- **Midnight Neon** — deep `#0B0F1A`, high-contrast text, electric accent (cyan/violet).
  Kinetic dark.
- **Warm Brutalist** — bold off-black on `#F4EFE6`, one loud accent, hard edges, big type.
- **Soft SaaS** — off-white, slate text, a confident brand hue + a tint scale. Trustworthy.
- **Mono Luxe** — monochrome + a single metallic/jewel accent. High-end, minimal.

Pull the real brand hue out of the extracted tokens and fold it into whichever preset fits,
rather than discarding the site's identity wholesale — a redesign, not a different company.

## Typography pairings

- **Editorial** — a serif display (e.g. a Playfair/Fraunces-style) + a clean grotesque body.
- **Product** — one modern grotesque across the board (e.g. Inter/Geist-style), tight scale.
- **Expressive** — a characterful display face for headings + neutral body for legibility.

Keep body text legible and accessible regardless of direction (contrast, size, line length).

## Reference bars by site type (named + fetchable, to "beat")

Reuse the `[[gauntlet-loop-skill]]` bar idea — every direction names a real site to beat.

- SaaS / product → `linear.app`, `stripe.com`, `vercel.com`
- Dev tool → `planetscale.com`, `railway.app`, `dub.co`
- Agency / portfolio → a named Awwwards Site of the Day, `bruno-simon.com`
- E-commerce → a specific brand's PDP the user admires
- Content / editorial → `stripe.com/blog`, `pudding.cool`, a named publication

If the user already admires a specific site, that is the best possible bar — it encodes
their taste. Ask: "Is there a site you already think nails this?"
