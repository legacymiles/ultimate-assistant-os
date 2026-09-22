# Adding a video-generation method

A method is a folder. The app does not know the five shipped engines by name —
it reads the registries and draws whatever is in them — so adding a sixth never
touches the UI, the routes or the run loop.

```
src/lib/video-studio/methods/<id>/
  meta.ts     isomorphic  card copy, capabilities, input/output shape
  skill.ts    isomorphic  the skill layer: what it's good at, the optimiser
                          prompt, and the instructions the agent executes
  server.ts   server-only detect() — and, for a server-rendered method,
                          startScene()/pollScene()
  README.md   optional    anything a future reader needs about this engine
```

Then two one-line registrations:

- `src/lib/video-studio/registry.ts` — import `meta` and `skill`, add to `METHODS`
- `src/lib/video-studio/server/registry.ts` — import `server`, add to `SERVERS`

That is the whole change. Registration order is display order.

## The three files

### `meta.ts`

Everything the browser needs. Must not import node APIs — it is bundled into
the client. `transport` is the important field:

- `"server"` — renders inside a Next.js route. Implement `startScene`/`pollScene`
  in `server.ts`. Works from a deployed host.
- `"agent"` — renders on the owner's PC through the studio runner. Nothing else
  to implement; the run loop queues it and the runner loads `meta.skill`.

### `skill.ts`

`optimiserSystem` is the prompt that rewrites a plan scene into this engine's
own terms. It is the reason the user never has to know how the engine works, so
it is worth writing properly: say what the engine is good at, what it cannot do,
and the exact shape a directive should take.

`instructions` is handed to the executing agent verbatim. Point it at the
engine's skill rather than restating the skill here — two copies drift.

### `server.ts`

`detect(uid)` must look at the machine and report what is actually there. Use
the probes in `../../server/detect.ts` (`hasEnv`, `commandExists`, `pathExists`,
`mcpRegistered`, `skillInstalled`, `runnerInfo`) and roll the requirements up
with `rollUp`. A requirement that is nice-to-have gets `optional: true` so it
does not block the render.

**Never report `ready` optimistically.** The whole integrations page rests on
this being true, and a green tick over a missing install turns a two-second
error into a twenty-minute one.

## The five shipped methods

| id | engine | transport | skill |
|---|---|---|---|
| `remotion` | Remotion | agent | `remotion-best-practices` |
| `hyperframes` | HyperFrames | agent | `hyperframes` |
| `unreal` | Unreal Engine | agent | `unreal-cinematics` |
| `blender` | Blender | agent | `blender-studio` |
| `h3` | MiniMax H3 | server | `h3-scroll-world` |

## Candidates worth adding

ComfyUI workflows, Unity, other open cinematic models, AI avatar tools, and
image-to-video models all fit this shape. An image-to-video model is the
easiest: copy `h3/`, change the backend call, and it is done.
