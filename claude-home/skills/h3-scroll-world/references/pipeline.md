# Pipeline: copy-paste scripts (bash; Git Bash on Windows is fine)

Every video goes through `node "$SKILL/scripts/h3.mjs"` (MiniMax H3), every still through
`node "$SKILL/scripts/still.mjs"` (OpenRouter). Both are Node 18+, zero deps, and read
keys from the process env → `./.env.local` → the owner's hub `.env.local`
(`C:/Users/honey/OneDrive/Desktop/claude code files/.env.local`). There is no ffprobe on
this machine — `node "$SKILL/scripts/probe.mjs" <file>` prints
`{width,height,fps,duration,frames}` instead.

Set these once. `NAMES` is the ordered section ids; the last is the hero/finale.

```bash
SKILL="$HOME/.claude/skills/h3-scroll-world"
WORK="$PWD/.scroll-world-work"   # scratch: prompts, raw clips, frames (keep it out of the site's public dir)
ASSETS=./assets                  # where the site reads stills (webp) + clips (mp4)
mkdir -p "$WORK" "$ASSETS/vid"
NAMES="farm kitchen shop delivery plaza finale"   # <-- your section ids, in order

# ffmpeg: PATH first, else the hub's ffmpeg-static binary. ALWAYS quote "$FFMPEG" (spaces in path).
FFMPEG="${FFMPEG:-$(command -v ffmpeg || echo "/c/Users/honey/OneDrive/Desktop/claude code files/node_modules/ffmpeg-static/ffmpeg.exe")}"

# H3 backend — ONE for every chained clip (SKILL Step 4).
#   runpod  : owner's own H3, first_frame only → architecture A (default)
#   minimax : hosted, first_frame + last_frame → required for architecture B connectors
#   gateway : Vercel AI Gateway minimax/minimax-h3
BACKEND=runpod
TIER=draft                       # draft | final
case "$TIER" in
  final) RES=768P; LEG_DUR=8; DIVE_DUR=8; CONN_DUR=5 ;;   # RES=2K only if confirmed on the backend
  *)     RES=768P; LEG_DUR=6; DIVE_DUR=6; CONN_DUR=4 ;;
esac
RATIO=16:9                       # 9:16 for the §6b mobile chain

node "$SKILL/scripts/h3.mjs" --check   # which backends are configured + RunPod health
```

H3 renders take minutes (and the **first RunPod job after idle cold-starts for several
minutes** while ~40 GB of weights load). Launch every script below with your tool's
background/detached mode and poll the log; never block the foreground.

Shared helper — one clip with 3 attempts (rejections and transient errors are retried):

```bash
h3() { # out promptFile [extra h3.mjs flags...]
  out="$1"; pf="$2"; shift 2
  for try in 1 2 3; do
    node "$SKILL/scripts/h3.mjs" --prompt-file "$pf" --out "$out" \
      --backend "$BACKEND" --ratio "$RATIO" --resolution "$RES" "$@" \
      > "$out.json" 2> "$out.err" && [ -s "$out" ] && { echo "ok $out (try $try)"; return 0; }
    echo "retry $try failed: $out — $(tail -n 1 "$out.err")"
  done
  echo "FAIL $out (3 attempts — rephrase the prompt, prompts.md → If a clip is rejected)"; return 1
}
lastframe()  { "$FFMPEG" -v error -y -sseof -0.15 -i "$1" -frames:v 1 -update 1 -q:v 2 "$2"; }
firstframe() { "$FFMPEG" -v error -y -ss 0 -i "$1" -frames:v 1 -q:v 2 "$2"; }
```

## 0. Qualify the backend's frame-lock (before the first full chain)

H3's frame-lock quality has **not been PSNR-tested yet** — qualify it on the first build
(one cheap draft clip). A backend passes when the output's frame 0 matches the input
still to codec noise:

```bash
FIRST=$(set -- $NAMES; echo "$1")          # needs still_$FIRST.png from §1 + a leg/dive brief
h3 "$WORK/probe.mp4" "$WORK/leg_$FIRST.txt" --first-frame "$WORK/still_$FIRST.png" --duration 4
firstframe "$WORK/probe.mp4" "$WORK/probe_f0.png"
"$FFMPEG" -hide_banner -i "$WORK/probe_f0.png" -i "$WORK/still_$FIRST.png" \
  -lavfi "[1:v][0:v]scale2ref[b][a];[a][b]psnr" -f null - 2>&1 | grep -o 'average:[0-9.]*'
node "$SKILL/scripts/probe.mjs" "$WORK/probe.mp4"   # confirm width/height/fps/duration
```

- `average` ≳ **30 dB** → frame-locked; chain on this backend. Record the number (and
  the resolution `probe.mjs` reports) in the build notes — it's the first real H3
  measurement.
- Well under 30 dB, or a visibly re-composed opening → the backend is *conditioning*,
  not *continuing*; seams will pop. Don't chain on it: try another backend and tell the
  user.
- For arch B, add a connector probe on `--backend minimax`: `--first-frame` one still,
  `--last-frame` a *different* still; the final frame must land on that composition
  (a near-miss with the same composition is fine — the engine's seam crossfade covers it).

## 1. Scene stills (Step 2)

Write one prompt file per section to `$WORK/still_<name>.txt` (see prompts.md). Scene 0
first, then the rest with scene 0 as a style reference (this is what keeps the world
cohesive):

```bash
# H3 768P canvas (measured): 16:9 -> 1344x768, 9:16 -> 768x1344
FIT=$([ "$RATIO" = "9:16" ] && echo 768x1344 || echo 1344x768)
gen_still() { # name [refPng]   (paths may contain spaces — the ref goes through "$@")
  n="$1"; shift; [ -n "$1" ] && set -- --ref "$1"
  for try in 1 2 3; do
    node "$SKILL/scripts/still.mjs" --prompt-file "$WORK/still_$n.txt" \
      --out "$WORK/still_$n.png" --aspect "$RATIO" --fit "$FIT" "$@" > "$WORK/still_$n.log" 2>&1 \
      && { echo "still $n ok"; return 0; }
  done; echo "still $n FAIL (see still_$n.log)"
}
set -- $NAMES; first="$1"; shift
gen_still "$first"
for n in "$@"; do gen_still "$n" "$WORK/still_$first.png" & done; wait
```

Run a few in parallel, not dozens. Convert to webp for the site (optionally run
`knockout.py` first for transparency — needs Python + Pillow):

```bash
for n in $NAMES; do "$FFMPEG" -v error -y -i "$WORK/still_$n.png" -vf "scale='min(1800,iw)':-2" \
  -c:v libwebp -q:v 84 "$ASSETS/$n.webp"; done
```

Review the stills for cohesion before continuing. Re-roll any off-style one with
`gen_still <name> "$WORK/still_<good>.png"`.

## 2A. Architecture A — sequential legs (the DEFAULT)

Prompt files at `$WORK/leg_<name>.txt` (prompts.md → Leg prompt). Leg 0 starts on scene
0's still; every later leg starts on the **previous leg's ACTUAL last frame**. No
`--last-frame`, ever. Strictly sequential — can't parallelize.

```bash
prev_frame=""
for n in $NAMES; do
  start="${prev_frame:-$WORK/still_$n.png}"
  h3 "$WORK/leg_$n.mp4" "$WORK/leg_$n.txt" --first-frame "$start" --duration "$LEG_DUR" || break
  lastframe  "$WORK/leg_$n.mp4" "$WORK/last_$n.png"
  firstframe "$WORK/leg_$n.mp4" "$WORK/first_$n.png"   # poster for this section (see below)
  prev_frame="$WORK/last_$n.png"
  echo "CHECK $WORK/last_$n.png before the next leg is trusted"
done
```

Eyeball each `last_<name>.png` as it lands (calm forward glide, angle not drifted for
locked-iso). If one is bad, stop, re-roll that leg, and re-run the loop from there
(`NAMES` trimmed to the remaining ids, `prev_frame` set to the last good frame).

Posters for arch A: use each leg's `first_<name>.png` → webp as the section `still` so
the poster matches the frame the video opens on.

## 2B. Architecture B — dive-in clips (needs `BACKEND=minimax` for the connectors)

Run the whole B chain on **one** backend: `BACKEND=minimax` (the only one with
last-frame keyframes). Prompt files at `$WORK/dive_<name>.txt`. First frame = the
solid-bg still PNG. Dives are independent, so they run in parallel:

```bash
for n in $NAMES; do
  h3 "$WORK/dive_$n.mp4" "$WORK/dive_$n.txt" --first-frame "$WORK/still_$n.png" --duration "$DIVE_DUR" &
done; wait
```

## 3. Extract boundary frames — the seam handoff (Step 5, arch B)

For each adjacent pair, the connector's first frame = dive_i's LAST frame, last frame =
dive_{i+1}'s FIRST frame — extracted from the **rendered videos**, never the stills.

```bash
for n in $NAMES; do
  firstframe "$WORK/dive_$n.mp4" "$WORK/first_$n.png"   # establishing
  lastframe  "$WORK/dive_$n.mp4" "$WORK/last_$n.png"    # interior
done
```

## 4. Connector clips (Step 5, arch B)

Prompt files at `$WORK/conn_<i>.txt` (i = 1..N-1). Iterate adjacent pairs:

```bash
[ "$BACKEND" = minimax ] || { echo "connectors need BACKEND=minimax (last-frame)"; exit 1; }
set -- $NAMES ; i=0 ; prev=""
for n in "$@"; do
  if [ -n "$prev" ]; then
    i=$((i+1))
    h3 "$WORK/conn_$i.mp4" "$WORK/conn_$i.txt" \
      --first-frame "$WORK/last_$prev.png" --last-frame "$WORK/first_$n.png" --duration "$CONN_DUR" &
  fi
  prev="$n"
done ; wait
```

## 5. Encode everything for scrubbing (Step 6)

Native resolution (whatever `probe.mjs` reports — never upscale), crf 20, GOP 8, light
sharpen, **no audio (`-an` — H3 always renders a soundtrack; the page is muted and the
audio track is dead weight)**, faststart. Same for legs, dives and connectors.

```bash
enc() { "$FFMPEG" -v error -y -i "$1" -an -vf "unsharp=5:5:0.8:5:5:0.0" \
  -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p \
  -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart "$2"; echo "enc $2 $(du -h "$2"|cut -f1)"; }

# arch A
for n in $NAMES; do enc "$WORK/leg_$n.mp4" "$ASSETS/vid/$n.mp4"; done
# arch B
for n in $NAMES; do enc "$WORK/dive_$n.mp4" "$ASSETS/vid/$n.mp4"; done
i=0; for f in "$WORK"/conn_*.mp4; do i=$((i+1)); enc "$WORK/conn_$i.mp4" "$ASSETS/vid/conn$i.mp4"; done
```

(The connector loop indexes by `$i` rather than the glob order, so `conn_10` can't sort
before `conn_2`.) Engine config: `sections[k].clip = assets/vid/<name>.mp4`; arch B
adds `connectors = [assets/vid/conn1.mp4, …]` (length N-1, in order); arch A uses
`connectors: []` and `crossfade: 0.08`.

## 6. Centre-crop mobile encodes — FALLBACK ONLY, not the mobile version

**The mobile version is the native 9:16 portrait chain (§6b).** These crop encodes exist
for one case: the user opted into mobile but won't pay for the portrait chain — and
shipping them must be called out and approved, never silent (portrait phones see the
landscape film's centre ~26%). The encode mechanics matter either way: scrubbing sets
`currentTime` every frame, and a phone decoder's **seek cost scales with how many frames
it must decode from the nearest keyframe** — so a `-g 8` master that scrubs fine on a
laptop stutters on a phone. A **smaller frame + tighter GOP** fixes that (and cuts
cellular bytes). The crop `-m.mp4` sibling per clip:

```bash
# 720p, GOP 4 (twice the keyframes = ~half the seek-decode work), crf 23, same sharpen/faststart.
encm() { "$FFMPEG" -v error -y -i "$1" -an -vf "scale=-2:720,unsharp=5:5:0.6:5:5:0.0" \
  -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
  -g 4 -keyint_min 4 -sc_threshold 0 -movflags +faststart "$2"; echo "encm $2 $(du -h "$2"|cut -f1)"; }

for n in $NAMES; do encm "$WORK/leg_$n.mp4" "$ASSETS/vid/$n-m.mp4"; done   # dive_$n.mp4 for arch B
i=0; for f in "$WORK"/conn_*.mp4; do i=$((i+1)); encm "$WORK/conn_$i.mp4" "$ASSETS/vid/conn$i-m.mp4"; done
```

Wire the variants in the engine config — the engine serves them automatically on phones,
falling back to the desktop `clip` when a mobile one is absent:

```js
sections[k].clipMobile = 'assets/vid/<name>-m.mp4';
connectorsMobile = ['assets/vid/conn1-m.mp4', …];   // length N-1, in order
```

If phone scrubbing still stutters, tighten the GOP further (`-g 2`, or `-g 1` for all-intra
= instant seeks at the cost of larger files); if cellular weight is the bigger worry, raise
`crf` (24–26) or drop to `scale=-2:600`. A 768P master still benefits — the tighter GOP is
what makes phone seeks cheap. Crop encodes stay 16:9 — the engine centre-crops them.

## 6b. Native 9:16 portrait chain — THE mobile version (Step 1.6 opt-in)

When the user opts into mobile, this is what they get: a **parallel 9:16 chain** rendered
natively for phones and shipped as the mobile variants — never the §6 crops. Same seam
laws as the main chain — the portrait chain frame-locks against its own rendered frames,
never the landscape ones. Same clip count again (~2× cost); state it at Step 1.6.

1. **Portrait start canvases.** Either generate portrait stills directly
   (`still.mjs --aspect 9:16`, scene 0 of the landscape set as `--ref`) or composite each
   scene onto a 1080×1920 canvas in the page bg colour (island at ~94% width, visual
   centre at ~45% height):
   `"$FFMPEG" -y -i still_n.png -vf "scale=1015:-2,pad=1080:1920:(ow-iw)/2:(oh-ih)*0.45:color=0xF5EDE0" still_n-p.png`.
   For knocked-out stills, composite the RGBA over the bg colour first.
2. **Legs/dives**: same briefs with a portrait sentence right after `[Shot 1] <style>,`
   ("vertical portrait composition, the scene centred with generous [bg] space above and
   below"), `RATIO=9:16`, same backend/resolution. Review each last frame before
   chaining, as ever.
3. **Connectors (arch B)**: extract first/last frames **from the 9:16 renders** and
   generate 9:16 connectors between them. A native 9:16 scene mixed into cropped-16:9
   neighbours pops at both seams — the portrait chain must be complete, not partial.
4. **Encode** with the §6 settings but portrait-oriented scale: `scale=720:-2` (720 wide),
   `-g 4`, crf 23, `-an` → these ARE the `-m.mp4` mobile files (and they replace any §6
   crop stopgaps that shipped earlier).
5. **Posters**: extract each 9:16 clip's first frame → webp → wire as the section's
   `stillMobile` so the poster matches the portrait video's frame 0 (no
   landscape→portrait flash when the clip paints).

## Notes

- `h3.mjs` prints `{backend, out, seconds}` on success; `seconds` × the backend's rate is
  the clip cost. Sum them per phase and compare against the Step 1.7 estimate.
- `--dry-run` on `h3.mjs` prints the request body without calling anything — use it to
  check a brief/flags before spending.
- `--last-frame` on `BACKEND=runpod` exits with an error by design (the RunPod worker is
  first-frame only). That's the signal to use arch A or switch the whole chain to
  `minimax`.
- **Previz on the cheap**: run the whole chain once at `TIER=draft` (768P, short legs) to
  validate the journey and seams, then re-render at `TIER=final` on the SAME backend —
  one model/backend end to end, so the previz translates directly. A final re-render is a
  new chain: arch A legs must be re-chained from the new renders' last frames, not the
  draft ones.
- Concurrency: RunPod Serverless scales workers per its endpoint settings; with one
  worker, parallel dives just queue. Don't launch dozens at once on any backend.
- If a whole batch stalls, check `$WORK/*.err` for the reason and
  `node "$SKILL/scripts/h3.mjs" --check` for backend health.
