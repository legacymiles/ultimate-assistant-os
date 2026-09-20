# Global rules

## Never ship a default-looking website — a design skill is mandatory

**Every time a task involves building or changing a user-facing interface — "make an app",
"build me a site", a landing page, a hero, a portfolio, a dashboard, a new page in an existing
app, or a visual overhaul — invoke a design skill FIRST, before writing any UI code, without
being asked.** Plain Tailwind-and-a-card-grid is a failure state. Announce which skill is
driving the look ("Using `impeccable` for the UI").

Defaults (both are free — pure code, zero API spend):

| What is being built | Skill that fires by default |
|---|---|
| App / tool / product UI — dashboards, databases, forms, settings, app shells, anything inside the OS hub | `impeccable` |
| Landing page, hero, marketing page, portfolio, public-facing site | `taste-skill` |

Rules around the defaults:

- **Free only by default.** Never auto-invoke a skill that spends money or generates footage.
  `h3-scroll-world`, `scroll-world`, `scroll-craft`, `real-estate-reveal`, `imagegen-frontend-web`,
  `imagegen-frontend-mobile`, `image-to-code-skill` and `blender-to-web` are **opt-in only** — use
  them exclusively when the owner names that skill or clearly asks for a scroll-video / generated-
  asset site. Do not drift into one because a page "would look cool as a scroll film".
- **The owner's word wins.** If they name a skill (`cinematic-ui`, `brutalist-skill`,
  `minimalist-skill`, `soft-skill`, `gpt-tasteskill`, `ui-ux-pro-max`, `interactive-web-studio`,
  `capcut-design`, `theme-factory`…), use that one instead of the default.
- **Other free swaps** when the brief obviously calls for it: `interactive-web-studio` (cinematic /
  WebGL / "wow" experiences), `cinematic-ui` (film art direction), `brutalist-skill` (dense
  technical/terminal), `minimalist-skill` (editorial calm), `soft-skill` (expensive agency feel),
  `ui-ux-pro-max` (needs palettes / font pairings / style reference), `redesign-skill` (upgrading an
  existing project).
- **Stack specialists on top** of the default when the mechanic fits: `exploded-showcase`,
  `webgl-trail-reveal`, `dataviz` for charts.
- Every new app the owner asks for is a new website. The rule fires there too — no exceptions for
  "internal" or "quick" tools.

- Higgsfield: whenever a repo, README, prompt, skill or video mentions Higgsfield (higgsfield.ai, the Higgsfield MCP, "Higgsfield models"), invoke the `higgsfield-models` skill. It runs the same models through muapi.ai (the Open-Generative-AI route) with MUAPI_API_KEY. Do not set up a Higgsfield account, SDK or MCP.

## Video-engine routing — one engine, one skill, no crossover

Whenever a task names one of these engines, invoke that engine's skill and only that one. Never
use an engine's skill for a different engine.

| Engine named | Skill to invoke |
|---|---|
| Unreal Engine, UE5, "render it in Unreal" — **video / cinematic / animation** | `unreal-cinematics` |
| Unreal Engine — a **playable game** | `unreal-game-builder` |
| Blender, Blender MCP, "do it in Blender" — video, animation, 3D asset, render | `blender-studio` (routes to the `blender-*` sub-skills) |
| Remotion | `remotion-best-practices` (the Remotion router) |
| HyperFrames | `hyperframes` (the HyperFrames router) |
| MiniMax H3, Higgsfield, generative AI footage | `h3-scroll-world` / `higgsfield-models` |

Corollary: do not reach for Unreal or Blender because a prompt says "3D". Route on the engine the
user actually named, or on what the work needs.
