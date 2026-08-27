# EMBER — showcase image slots

The `/apps/fire-reveal` studio auto-loads its demo from this folder. It ships
with the two aligned wolf images already in place:

- `demo-base.png`   → the calm wolf (shown by default)
- `demo-reveal.png` → the fire-helmet wolf, revealed by the mouse-trail scan

The two images must be pixel-aligned (same crop/composition) for the reveal
to read as "removing a layer" rather than swapping photos. If these files are
missing, the studio falls back to a procedural placeholder and still runs —
and you can always upload two images live from the control dock.
