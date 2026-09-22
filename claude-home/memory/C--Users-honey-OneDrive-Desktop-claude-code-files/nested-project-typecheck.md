---
name: nested-project-typecheck
description: Nested Next apps inside the hub repo break the root build unless excluded in tsconfig
metadata:
  type: project
---

The hub repo contains at least one self-contained Next app in a subdirectory
(`item-storm-arena/`), with its own tsconfig and its own `@/*` alias. The root
tsconfig includes `**/*.tsx`, so `next build` sweeps those files in and resolves
their `@/*` against the hub's `src/` — producing "cannot find module" errors
about files that plainly exist.

**Why:** the error names the nested project's path but reads like a missing file
in the hub, so it's easy to chase the wrong thing. It was broken on `main` for a
while before anyone noticed, because nobody ran a full build.

**How to apply:** any new self-contained app dropped into this repo must be added
to the root `tsconfig.json` `exclude` array. Verify builds with
`NEXT_DIST_DIR=.next-verify npx next build` — see [[hub-parallel-dev-servers]].
