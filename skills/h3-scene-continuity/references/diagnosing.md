# Reading a continuity report

A real report, from a seven-shot H3 film that its author described as terrible.
Every number below is measured, not illustrative. The point of this page is that
"the film looks stitched" is never one defect, and the report tells you which
ones you actually have.

```
clip                    n   first6   first12  middle   last12   last6    luma
shot-1.mp4             158   0.0016   0.0015   0.0020   0.0013   0.0015   0.2688
shot-2.mp4             124   0.0028   0.0036   0.0127   0.0219   0.0243   0.2713
shot-3.mp4             175   0.0022   0.0033   0.0319   0.0347   0.0320   0.2797
shot-4.mp4             158   0.0290   0.0271   0.0296   0.0211   0.0196   0.3086
shot-5.mp4             192   0.0247   0.0324   0.0228   0.0167   0.0156   0.2426
shot-6.mp4             158   0.0211   0.0185   0.0196   0.0181   0.0171   0.3955
shot-7.mp4             226   0.0111   0.0127   0.0248   0.0018   0.0022   0.2770

seam: last frame of A -> first frame of B
join        cut-motion   A end-motion  B start-motion  ratio   luma A→B
1            0.1443        0.0015         0.0028       1.81    0.2688 → 0.2713
2            0.1857        0.0243         0.0022       0.09    0.2713 → 0.2797
3            0.0111        0.0320         0.0290       0.91    0.2797 → 0.3086
4            0.0121        0.0196         0.0247       1.26    0.3086 → 0.2426
5            0.0089        0.0156         0.0211       1.35    0.2426 → 0.3955
6            0.3896        0.0171         0.0111       0.65    0.3955 → 0.2770
```

## Which joins are cuts and which are chains

`cut-motion` is how much the picture changes across the join itself. Read it
first, because it tells you what kind of join each one is and nothing else in
the report makes sense without that.

Joins 1, 2 and 6 are **hard cuts** (0.14, 0.19, 0.39 — the picture is replaced).
Joins 3, 4 and 5 are **chained** (0.009–0.012, about half a normal frame's worth
of change, i.e. genuinely continuous).

So this film was three continuous joins and three cuts, which matches what the
shot plan asked for. Good — the chaining mechanism was working. The film was
still bad. That is the useful part.

## Defect 1: three shots are still photographs

Shot 1: 0.0016 / 0.0015 / 0.0020 / 0.0013 / 0.0015. The same tiny number from
first frame to last. Nothing in this shot moves, for 6.5 seconds, and it is the
film's opening.

The companion film (not shown) had two more like it, including its closing shot.
Across the two films, roughly a quarter of the total running time was shots that
did not move.

This is not a continuity defect and no seam work touches it. It is a failed
generation: the model was given a scene to depict rather than an action to
perform, and it produced a living photograph. **Fix this before anything else** —
it is the single biggest thing wrong with the film, and it is invisible if you
go looking for seam problems.

Threshold in practice: a shot whose `middle` is under ~0.004 and whose sections
are all within a factor of ~1.5 of each other is dead.

## Defect 2: shots start from rest

Shot 2: `first6` 0.0028 against a `middle` of 0.0127 — it opens 4.5× slower than
its own body, and 9× slower than its own ending.
Shot 3: `first6` 0.0022 against a `middle` of 0.0319 — **15× slower**.

Both of those shots follow a cut. Look at the `ratio` column for joins 1 and 2:
0.09 at join 2 means the incoming shot is moving at a *ninth* of the speed the
outgoing shot was. The film cuts away from a moving picture onto a still one,
then watches it accelerate.

Now compare joins 3, 4 and 5 — the chained ones — where the ratio is 0.91, 1.26
and 1.35. Motion crosses those joins at essentially full speed.

That comparison is the argument for §3 of the skill in one line: **the chained
joins carried motion and the cut joins did not.** The fix for the cut shots is
to trim the warm-up (§2), because there is no previous shot to carry motion from.

## Defect 3: a shot stops before its file does

Shot 7: `middle` 0.0248, `last12` 0.0018, `last6` 0.0022. It runs normally and
then stops dead for the last half second — the landing. It is also the film's
final shot, so the film ends by freezing for half a second before the picture
cuts to black.

Note what the freeze detector says about this film: it reported `no-lock` on six
of the seven clips. These clips were generated from a start frame only, with no
`image_end` to converge onto, so most of them never locked. Shot 7 is borderline
— decelerating hard, not quite locked.

This is why the skill insists the landing is mainly an end-frame phenomenon. If
you run the detector on start-frame-only clips and see `no-lock` everywhere, the
detector is working; you simply do not have that defect yet. You will the moment
you turn on anchors.

## Defect 4: the film pumps

The `luma` column: 0.2688, 0.2713, 0.2797, 0.3086, 0.2426, 0.3955, 0.2770.

Shot 6 is 63% brighter than shot 5, and shot 7 drops 30% back down. Worse, joins
4 and 5 — those are the *chained* joins — go 0.3086 → 0.2426 → 0.3955. So a pair
of shots that join seamlessly frame-to-frame still diverge wildly in exposure
across their length: the join frame matches, and then the new shot drifts away
from it over its six seconds.

That is drift (§4) showing up as exposure, and it is exactly what a last-frame
anchor exists to stop. The per-clip gain match (§5) cleans up what remains.

## The order the fixes came out in

Reading the two reports together, ranked by how much of the film each defect
actually damaged:

1. **Dead shots** — ~25% of running time, total loss. Nothing else comes close.
2. **Warm-up ramps** — every cut in the film, ~0.5 s each, and they set the
   film's whole rhythm.
3. **Exposure drift** — visible on every join, including the good ones.
4. **Landings** — one clear case here, but guaranteed to become the dominant
   defect as soon as anchors are turned on.
5. **Motion across the join** — already working on the chained joins; the upgrade
   from a still frame to real overlapped frames also buys audio continuity,
   which a still frame cannot give at all.

Generating the report on your own film before touching anything is the whole
point. This film's author was about to fix seams. The seams were the part that
worked.
