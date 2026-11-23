# Garment and scene photos — where they came from

**openmerch-engine** (MIT License, © its authors — https://github.com/osmaar/openmerch-engine,
`apps/demo/public/products/`): `tee-front`, `tee-back`, `oversized-front`, `hoodie-front`,
`hoodie-back`. Cropped to a square, resized to 1400 px and saved as WebP; otherwise unchanged.

**Rendered for DTF Studio** on the owner's GPU with Flux 2 Klein 4B (WanGP, local, free):

- `sweatshirt-*`, `long-sleeve-*`, `tank-*`, `oversized-back`, `tote-front` — Flux edits of the
  openmerch tee photo ("turn this into a …, same ghost-mannequin style"), cut out with rembg (u2net).
- `sleeve-short`, `sleeve-long`, `sleeve-hoodie` — side views, Flux edits that removed the
  mannequin. The right sleeve is the photo as is; the left sleeve is the same photo mirrored.
- `../scenes/*.webp` — lifestyle scenes (worn, folded, hanging, flat lay, carried) of blank white
  garments. Each `*-mask.png` comes from a second Flux render of the same frame with only the
  garment recoloured chroma green.

Calibration (collar point, pixels per cm, print quads) lives in `src/lib/dtf/mockups.ts`.
