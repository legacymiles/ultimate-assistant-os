"""Frame counts and canvas sizes H3 will actually accept.

Three hard rules come out of the model's architecture, and breaking any of
them either errors or quietly wastes a paid render:

1. The video VAE decodes on a `17n + 5` frame grid at a fixed 24 fps. A
   request for "6 seconds" is not 144 frames; it is the nearest grid point.
2. The trained window is 124 to 362 frames, i.e. about 5.2 to 15.1 seconds.
   Lower grid points decode but drift in quality, so we clamp into the window
   rather than honouring a too-short request literally.
3. Width and height must both be multiples of 32, and their product must not
   exceed 1032192 (which is exactly 1344 x 768). The short edge wants to be
   768.

Pure functions, no imports, so they can be tested without a GPU.
"""

FPS = 24

# The `17n + 5` grid, and the window the model was actually trained on.
FRAME_STEP = 17
FRAME_BASE = 5
MIN_FRAMES = 124
MAX_FRAMES = 362

CANVAS_MULTIPLE = 32
CANVAS_MAX_PIXELS = 1032192  # 1344 * 768
CANVAS_SHORT_EDGE = 768

ASPECTS = {
    "16:9": (16, 9),
    "9:16": (9, 16),
    "1:1": (1, 1),
    "21:9": (21, 9),
    "4:3": (4, 3),
    "3:4": (3, 4),
}


def frames_for_seconds(seconds: float) -> int:
    """The grid frame count closest to `seconds`, clamped to the trained window.

    Rounds to the NEAREST grid point rather than always up: at 6 seconds the
    request sits between 141 (5.9s) and 158 (6.6s), and 141 is the honest
    answer. Clamping happens after, so a 2-second request still returns the
    124-frame minimum rather than something the model was never trained on.
    """
    target = max(0.0, float(seconds)) * FPS
    n = round((target - FRAME_BASE) / FRAME_STEP)
    frames = FRAME_STEP * max(0, int(n)) + FRAME_BASE
    return max(MIN_FRAMES, min(MAX_FRAMES, frames))


def seconds_for_frames(frames: int) -> float:
    """What a frame count actually plays as, for reporting back."""
    return round(frames / FPS, 2)


def _round_to_multiple(value: float, multiple: int = CANVAS_MULTIPLE) -> int:
    return max(multiple, int(round(value / multiple)) * multiple)


def canvas_for_aspect(aspect: str) -> tuple[int, int]:
    """The largest legal canvas at this aspect ratio.

    Starts from a 768 short edge, snaps both axes to 32, then shrinks in
    32-pixel steps until the pixel budget is satisfied. Shrinking rather than
    scaling keeps both axes on the grid, which scaling would not.
    """
    ratio = ASPECTS.get(aspect) or ASPECTS["16:9"]
    w_ratio, h_ratio = ratio

    if w_ratio >= h_ratio:
        height = float(CANVAS_SHORT_EDGE)
        width = height * w_ratio / h_ratio
    else:
        width = float(CANVAS_SHORT_EDGE)
        height = width * h_ratio / w_ratio

    # A 768 short edge overshoots the pixel budget on wide ratios (21:9 wants
    # 1792x768). Scale BOTH axes by the same factor so the aspect survives —
    # trimming one axis alone would silently turn 21:9 into 16:9.
    pixels = width * height
    if pixels > CANVAS_MAX_PIXELS:
        scale = (CANVAS_MAX_PIXELS / pixels) ** 0.5
        width *= scale
        height *= scale

    width = _round_to_multiple(width)
    height = _round_to_multiple(height)

    # Snapping to 32 can push it back over by a few thousand pixels; step the
    # longer axis down until it fits.
    while width * height > CANVAS_MAX_PIXELS:
        if width >= height:
            width -= CANVAS_MULTIPLE
        else:
            height -= CANVAS_MULTIPLE
        if width < CANVAS_MULTIPLE or height < CANVAS_MULTIPLE:
            return (CANVAS_MULTIPLE, CANVAS_MULTIPLE)

    return (int(width), int(height))


def canvas_for_resolution(aspect: str, resolution: str) -> tuple[int, int]:
    """Canvas for a named quality tier.

    The open weights are 768p-native: MiniMax did not release the 2K
    upsampler, so "2K" here means the full 768p canvas rather than a lie about
    resolution, and "draft" means a smaller canvas that renders roughly twice
    as fast.
    """
    width, height = canvas_for_aspect(aspect)
    if str(resolution).upper() in ("DRAFT", "480P", "540P"):
        width = _round_to_multiple(width * 0.64)
        height = _round_to_multiple(height * 0.64)
    return (width, height)
