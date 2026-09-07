"""Building the ComfyUI graph for one H3 render.

Why this is generated rather than a saved workflow file: a saved graph pins
every node's socket names at the moment it was exported, and ComfyUI renames
sockets between versions. A worker that ships a stale graph fails at render
time, which on serverless means after the GPU minutes are already spent.

So each node is assembled against `/object_info` — ComfyUI's own description
of what it accepts. `_sockets` maps a logical name ("model", "positive") to
whatever this build actually calls it, and if nothing matches, the error names
the real sockets instead of failing as "invalid prompt".

A caller who wants exact control can bypass all of this by passing a complete
API-format graph as `workflow` in the job input.
"""

from __future__ import annotations

from typing import Any

from . import comfy
from .geometry import canvas_for_resolution, frames_for_seconds

# Logical name -> the socket names ComfyUI has plausibly used for it. Order is
# preference; matching is exact first, then substring.
CANDIDATES: dict[str, list[str]] = {
    "model": ["model"],
    "clip": ["clip"],
    "vae": ["vae"],
    "audio_vae": ["audio_vae", "audio_vae_name", "vae_audio"],
    "positive": ["positive", "conditioning"],
    "negative": ["negative"],
    "latent": ["latent_image", "latent", "samples"],
    "samples": ["samples", "latent"],
    "text": ["text", "prompt"],
    "width": ["width"],
    "height": ["height"],
    "length": ["length", "num_frames", "frames", "batch_size"],
    "first_frame": ["first_frame", "start_image", "image"],
    "last_frame": ["last_frame", "end_image"],
    "unet_name": ["unet_name", "model_name", "ckpt_name"],
    "clip_name": ["clip_name", "text_encoder_name", "name"],
    "vae_name": ["vae_name", "name"],
    "lora_name": ["lora_name", "name"],
    "strength_model": ["strength_model", "strength"],
    "weight_dtype": ["weight_dtype", "dtype"],
    "type": ["type"],
    "steps": ["steps"],
    "scheduler": ["scheduler"],
    "sampler_name": ["sampler_name"],
    "denoise": ["denoise"],
    "noise_seed": ["noise_seed", "seed"],
    "noise": ["noise"],
    "guider": ["guider"],
    "sampler": ["sampler"],
    "sigmas": ["sigmas"],
    "images": ["images"],
    "audio": ["audio"],
    "fps": ["fps"],
    "video": ["video"],
    "filename_prefix": ["filename_prefix"],
    "shift_video": ["shift_video", "shift"],
    "shift_audio": ["shift_audio"],
    "ref_images": ["ref_images", "reference_images", "images"],
    "ref_image_size": ["ref_image_size"],
}


class WorkflowError(RuntimeError):
    pass


def _sockets(class_type: str, logical: list[str]) -> dict[str, str]:
    """Resolve logical names to this build's real socket names."""
    available = comfy.input_names(class_type)
    lowered = {a.lower(): a for a in available}
    out: dict[str, str] = {}
    for name in logical:
        for cand in CANDIDATES.get(name, [name]):
            if cand.lower() in lowered:
                out[name] = lowered[cand.lower()]
                break
        else:
            for cand in CANDIDATES.get(name, [name]):
                hit = next((a for a in available if cand.lower() in a.lower()), None)
                if hit:
                    out[name] = hit
                    break
    return out


def _require(class_type: str, resolved: dict[str, str], needed: list[str]) -> None:
    missing = [n for n in needed if n not in resolved]
    if missing:
        raise WorkflowError(
            f"{class_type} has no socket for {missing}. "
            f"It actually accepts: {comfy.input_names(class_type)}"
        )


class Graph:
    """An API-format ComfyUI graph under construction."""

    def __init__(self) -> None:
        self.nodes: dict[str, dict[str, Any]] = {}
        self._n = 0

    def add(self, class_type: str, inputs: dict[str, Any], title: str = "") -> str:
        self._n += 1
        node_id = str(self._n)
        self.nodes[node_id] = {
            "class_type": class_type,
            "inputs": inputs,
            "_meta": {"title": title or class_type},
        }
        return node_id

    def as_dict(self) -> dict[str, Any]:
        return self.nodes


def _first_present(*class_types: str) -> str:
    """The first of these node classes this ComfyUI actually has."""
    info = comfy.object_info()
    for c in class_types:
        if c in info:
            return c
    raise WorkflowError(f"None of {list(class_types)} exist in this ComfyUI build.")


def build(
    *,
    prompt: str,
    duration_sec: float,
    aspect_ratio: str,
    resolution: str,
    dit_filename: str,
    clip_filename: str,
    video_vae_filename: str,
    audio_vae_filename: str,
    lora_filename: str | None,
    steps: int,
    seed: int,
    first_frame_name: str | None = None,
    reference_names: list[str] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Assemble the graph. Returns (graph, a summary of what was chosen)."""
    width, height = canvas_for_resolution(aspect_ratio, resolution)
    frames = frames_for_seconds(duration_sec)
    references = reference_names or []
    g = Graph()

    # ----- loaders ----------------------------------------------------------
    unet_class = _first_present("UNETLoader", "DiffusionModelLoader", "UnetLoaderGGUF")
    s = _sockets(unet_class, ["unet_name", "weight_dtype"])
    _require(unet_class, s, ["unet_name"])
    unet_inputs: dict[str, Any] = {s["unet_name"]: dit_filename}
    if "weight_dtype" in s:
        unet_inputs[s["weight_dtype"]] = comfy.pick_enum(
            unet_class, s["weight_dtype"], ["default"], fallback="default"
        )
    model = g.add(unet_class, unet_inputs, "H3 transformer")

    clip_class = _first_present("CLIPLoader")
    s = _sockets(clip_class, ["clip_name", "type"])
    _require(clip_class, s, ["clip_name"])
    clip_inputs: dict[str, Any] = {s["clip_name"]: clip_filename}
    if "type" in s:
        # The enum literal for H3's Qwen3-VL conditioner is not stable across
        # builds, so ask for the real options and match loosely.
        clip_inputs[s["type"]] = comfy.pick_enum(
            clip_class, s["type"], ["minimax_h3", "minimax", "qwen3vl", "qwen_vl", "qwen"]
        )
    clip = g.add(clip_class, clip_inputs, "Qwen3-VL conditioner")

    vae_class = _first_present("VAELoader")
    s = _sockets(vae_class, ["vae_name"])
    _require(vae_class, s, ["vae_name"])
    video_vae = g.add(vae_class, {s["vae_name"]: video_vae_filename}, "video VAE")
    audio_vae = g.add(vae_class, {s["vae_name"]: audio_vae_filename}, "audio VAE")

    # ----- turbo LoRA -------------------------------------------------------
    if lora_filename:
        lora_class = _first_present("LoraLoaderModelOnly", "LoraLoader")
        s = _sockets(lora_class, ["model", "lora_name", "strength_model"])
        _require(lora_class, s, ["model", "lora_name"])
        lora_inputs: dict[str, Any] = {s["model"]: [model, 0], s["lora_name"]: lora_filename}
        if "strength_model" in s:
            lora_inputs[s["strength_model"]] = 1.0
        model = g.add(lora_class, lora_inputs, "turbo LoRA")

    # No sigma-shift node here on purpose. Comfy Org's own H3 templates go
    # straight from the turbo LoRA to the guider, and matching a known-good
    # graph beats adding a node the reference workflow does without.
    info = comfy.object_info()

    # ----- conditioning + latent -------------------------------------------
    if references:
        node_class = "MiniMaxH3ReferenceToVideo"
        s = _sockets(node_class, ["clip", "vae", "audio_vae", "text", "width", "height", "length", "ref_image_size"])
        _require(node_class, s, ["clip", "text", "width", "height", "length"])
        inputs: dict[str, Any] = {
            s["clip"]: [clip, 0],
            s["text"]: prompt,
            s["width"]: width,
            s["height"]: height,
            s["length"]: frames,
        }
        if "vae" in s:
            inputs[s["vae"]] = [video_vae, 0]
        if "audio_vae" in s:
            inputs[s["audio_vae"]] = [audio_vae, 0]
        if "ref_image_size" in s:
            inputs[s["ref_image_size"]] = comfy.pick_enum(
                node_class, s["ref_image_size"], ["match"], fallback="match"
            )

        # Reference image sockets are dotted and indexed from zero —
        # "ref_images.ref_image_0", "ref_images.ref_image_1" — which is not a
        # naming a reasonable person would guess. Taken from Comfy Org's own
        # video_minimax_h3_r2v template. Only the slots this build actually
        # declares are filled; H3 accepts up to nine.
        available = set(comfy.input_names(node_class))
        slots = [n for n in available if "ref_image_" in n and "audio" not in n]
        slots.sort(key=lambda n: int(n.rsplit("_", 1)[-1]) if n.rsplit("_", 1)[-1].isdigit() else 99)
        if not slots:
            raise WorkflowError(
                f"{node_class} exposes no reference image slots. It accepts: {sorted(available)}"
            )

        load_class = _first_present("LoadImage")
        image_key = _sockets(load_class, ["image"]).get("image", "image")
        # Order is semantic to H3: the prompt names <Subject 1> first.
        for slot, name in zip(slots, references[:9]):
            img = g.add(load_class, {image_key: name}, f"reference {slot}")
            inputs[slot] = [img, 0]
        if len(references) > len(slots):
            print(f"[h3] only {len(slots)} reference slots available; dropped {len(references) - len(slots)}")
        cond = g.add(node_class, inputs, "reference conditioning")
    else:
        # Used for plain text-to-video too: the official t2v template is this
        # node with no keyframe attached.
        node_class = "MiniMaxH3ImageToVideo"
        s = _sockets(
            node_class, ["clip", "vae", "audio_vae", "text", "width", "height", "length", "first_frame"]
        )
        _require(node_class, s, ["clip", "text", "width", "height", "length"])
        inputs = {
            s["clip"]: [clip, 0],
            s["text"]: prompt,
            s["width"]: width,
            s["height"]: height,
            s["length"]: frames,
        }
        if "vae" in s:
            inputs[s["vae"]] = [video_vae, 0]
        if "audio_vae" in s:
            inputs[s["audio_vae"]] = [audio_vae, 0]
        if first_frame_name and "first_frame" in s:
            load_class = _first_present("LoadImage")
            ls = _sockets(load_class, ["image"])
            img = g.add(load_class, {ls.get("image", "image"): first_frame_name}, "first frame")
            inputs[s["first_frame"]] = [img, 0]
        cond = g.add(node_class, inputs, "conditioning")

    # These composite nodes emit conditioning and a latent together; slot
    # order is (positive, [negative,] latent) depending on the build.
    out_types = [str(t) for t in (comfy.object_info().get(node_class, {}).get("output", []) or [])]
    latent_slot = out_types.index("LATENT") if "LATENT" in out_types else len(out_types) - 1
    positive = [cond, 0]
    latent = [cond, latent_slot]

    # ----- sampling ---------------------------------------------------------
    # H3 is guidance-distilled: one forward pass per step, no CFG, so the
    # advanced sampler with a BasicGuider is the correct shape.
    guider_class = _first_present("BasicGuider")
    s = _sockets(guider_class, ["model", "positive"])
    _require(guider_class, s, ["model", "positive"])
    guider = g.add(guider_class, {s["model"]: [model, 0], s["positive"]: positive}, "guider")

    sel_class = _first_present("KSamplerSelect")
    s = _sockets(sel_class, ["sampler_name"])
    sampler = g.add(
        sel_class,
        {s.get("sampler_name", "sampler_name"): comfy.pick_enum(
            sel_class, s.get("sampler_name", "sampler_name"), ["res_multistep", "euler"]
        )},
        "sampler",
    )

    sched_class = _first_present("BasicScheduler")
    s = _sockets(sched_class, ["model", "scheduler", "steps", "denoise"])
    sched_inputs: dict[str, Any] = {s.get("model", "model"): [model, 0]}
    if "scheduler" in s:
        sched_inputs[s["scheduler"]] = comfy.pick_enum(sched_class, s["scheduler"], ["simple", "normal", "beta"])
    if "steps" in s:
        sched_inputs[s["steps"]] = steps
    if "denoise" in s:
        sched_inputs[s["denoise"]] = 1.0
    sigmas = g.add(sched_class, sched_inputs, "sigmas")

    noise_class = _first_present("RandomNoise")
    s = _sockets(noise_class, ["noise_seed"])
    noise = g.add(noise_class, {s.get("noise_seed", "noise_seed"): int(seed)}, "noise")

    adv_class = _first_present("SamplerCustomAdvanced")
    s = _sockets(adv_class, ["noise", "guider", "sampler", "sigmas", "latent"])
    _require(adv_class, s, ["noise", "guider", "sampler", "sigmas", "latent"])
    sampled = g.add(
        adv_class,
        {
            s["noise"]: [noise, 0],
            s["guider"]: [guider, 0],
            s["sampler"]: [sampler, 0],
            s["sigmas"]: [sigmas, 0],
            s["latent"]: latent,
        },
        "sample",
    )

    # ----- decode + save ----------------------------------------------------
    dec_class = _first_present("VAEDecode")
    s = _sockets(dec_class, ["samples", "vae"])
    _require(dec_class, s, ["samples", "vae"])
    images = g.add(dec_class, {s["samples"]: [sampled, 0], s["vae"]: [video_vae, 0]}, "decode video")

    audio = None
    if "VAEDecodeAudio" in info:
        s = _sockets("VAEDecodeAudio", ["samples", "vae"])
        if "samples" in s and "vae" in s:
            audio = g.add(
                "VAEDecodeAudio", {s["samples"]: [sampled, 0], s["vae"]: [audio_vae, 0]}, "decode audio"
            )

    vid_class = _first_present("CreateVideo")
    s = _sockets(vid_class, ["images", "fps", "audio"])
    _require(vid_class, s, ["images"])
    video_inputs: dict[str, Any] = {s["images"]: [images, 0]}
    if "fps" in s:
        video_inputs[s["fps"]] = 24
    if audio and "audio" in s:
        video_inputs[s["audio"]] = [audio, 0]
    video = g.add(vid_class, video_inputs, "mux")

    save_class = _first_present("SaveVideo", "SaveWEBM", "SaveAnimatedWEBP")
    s = _sockets(save_class, ["video", "filename_prefix"])
    save_inputs: dict[str, Any] = {}
    if "video" in s:
        save_inputs[s["video"]] = [video, 0]
    else:
        save_inputs[_sockets(save_class, ["images"]).get("images", "images")] = [images, 0]
    if "filename_prefix" in s:
        save_inputs[s["filename_prefix"]] = "h3"
    for extra, prefer in (("format", ["mp4", "auto"]), ("codec", ["h264", "auto"])):
        real = _sockets(save_class, [extra]).get(extra)
        if real:
            save_inputs[real] = comfy.pick_enum(save_class, real, prefer)
    g.add(save_class, save_inputs, "save")

    summary = {
        "width": width,
        "height": height,
        "frames": frames,
        "steps": steps,
        "seed": seed,
        "mode": "reference" if references else ("first_frame" if first_frame_name else "text"),
        "nodes": len(g.nodes),
    }
    return g.as_dict(), summary
