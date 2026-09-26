# studio-bridge — the free renderer and edit bay for Jarvis Studio

```cmd
tools\studio-bridge\install-autostart.cmd
```

**Run that once.** It starts the renderer now and again at every Windows sign-in,
with no console window, so Studio's **Make the film** just works instead of
telling you to go and start something. Undo it with `uninstall-autostart.cmd`.

`start.cmd` still opens it in a visible window when you want to watch the log; a
second copy finding the port already taken says so and exits rather than
crashing. The hidden one writes to `out\bridge.log`.

Jarvis runs on Vercel, which cannot reach this PC; the browser can, so the page
posts jobs to `127.0.0.1:42010` and this renders them with MiniMax H3 in WanGP
(the Pinokio install) for $0.

## The two jobs

| | what it does |
|---|---|
| `POST /video` | One clip. What the **Make it** button on a `studio_generate` has always used. |
| `POST /film` | A whole shot plan, rendered **in order** and cut together into one continuous film. What **Make the film** on a storyboard uses. |

## …and the other thing a page can't do for itself

`/apps/realtime-lucy` is only a WebRTC client: something on this PC has to be
running the world model, and a web page cannot start a process. So this bridge
starts it too.

| | what it does |
|---|---|
| `GET /lucy/status` | `{ installed, running, ready, starting, exited, error, log }` — everything the page's one button needs to know. |
| `POST /lucy/start` | Runs `tools/realtime-lucy/start.ps1`, which picks the size this card can hold. Answers as soon as it is spawned; the model takes 20–30 s more, which the page watches on Lucy's own `/health`. |
| `POST /lucy/stop` | Kills it — our process tree first, then whatever still holds port 8765, so a server you started by hand stops too. |

The engine is deliberately **not** started at login: it holds about 5.2 GB of
VRAM the whole time it is loaded, and WanGP wants that card as well. Its output
goes to `out\lucy.log`, fresh on every start, and the page shows the tail of it
when the engine isn't up.

One trap, measured: that child is spawned **without** `detached: true`, unlike
WanGP's. Detached, a `powershell.exe` child hands the script to a new console —
our pid exits 0 within a second, the log stays empty, and `taskkill` on that pid
leaves the real process running, so the bridge would report "the engine stopped"
while the model was in fact loading.

## How a film is made to look like one take

Three things, and it needs all three:

1. **The words.** `src/lib/studio/storyboard.ts` writes every shot's prompt with
   the film's world, wardrobe, lighting, grade and lens repeated *verbatim*, plus
   the frame the previous shot ended on. Ref2VA's `retention_analysis` section
   carries the identities across a cut.
2. **The pixels.** A shot marked `continuous` is rendered by H3 **FL2VA from the
   last frame of the shot before it** (`image_start`, `image_prompt_type: "S"`).
   The join is not a match — it is the same frame. A shot marked `cut` is a
   deliberate new angle and gets the reference photos instead (Ref2VA).
3. **The edit.** ffmpeg concatenates the clips in one pass, one encode, dropping
   the single frame a chained shot shares with its predecessor so the splice has
   no stutter. An attached track is then ducked underneath at 0.35 and faded out.

## The ETA

`out/rate.json` holds a rolling seconds-per-frame measured **on this PC**, updated
by every finished shot (seeded at 2.76 s/frame — 5.7 min for a 5 s clip on the
RTX 3050). That number, not a guess, is what the progress bar and the "12 min
left" in the browser are computed from.

## Endpoints

```
GET  /health              { ok, wangp, queue, rate, films }
POST /video               { prompt, refs, durationSec, aspectRatio } -> { id }
GET  /job/:id             { status, position?, seconds?, etaSeconds?, error? }
GET  /file/:id            the MP4
POST /film                { title, aspectRatio, shots[], soundtrack? } -> { id, shots }
GET  /film/:id            the whole progress view, per shot, with the ETA
GET  /film/:id/file       the stitched film
GET  /film/:id/shot/:n    one finished clip (1-based)
POST /film/:id/cancel     stop after the shot currently in the machine
```

Everything a film produces is kept in `out/films/<id>/` — every clip, the link
frames, the cut and the scored version — so a browser tab closing never loses
three hours of GPU time.

## Needs

- **WanGP** at `C:\pinokio\api\wan\app` (override with `WANGP_DIR`). Started on
  demand; the first start loads ~20 GB and takes minutes.
- **ffmpeg** on PATH (override with `FFMPEG_PATH` / `FFPROBE_PATH`). Without it
  the clips still render and are downloadable one by one, but nothing is cut
  together and the bridge says so.

Licence: the H3 open weights exclude the US/EU/UK/KR — see `runpod/README.md`.
