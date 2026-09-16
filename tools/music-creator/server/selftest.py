"""`--self-test`: check every moving part and print what is actually here.

The point is to answer "why does the website say the model is not installed"
without reading source. Nothing is loaded onto the GPU - weights are checked
by looking for files and cache folders, and packages by importing them in the
interpreter that would run them.
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys

import audio
from common import VERSION, gpu_info, module_available, weights_state

OK, NO, MAYBE = "ok  ", "NO  ", "??  "


def _line(mark: str, label: str, detail: str = ""):
    print(f"{mark}{label:<26} {detail}".rstrip())


def _can_import(python: str | None, module: str) -> tuple[str, str]:
    """(mark, detail) for `import module` in `python`, or in this process."""
    if python is None:
        return (OK, "importable here") if module_available(module) else (NO, "not importable in this interpreter")
    try:
        out = subprocess.run([python, "-c", f"import {module}; print({module}.__file__)"],
                             capture_output=True, text=True, timeout=300)
    except FileNotFoundError:
        return NO, f"interpreter not found: {python}"
    except subprocess.TimeoutExpired:
        return MAYBE, f"import {module} timed out after 300s in {python}"
    if out.returncode == 0:
        return OK, (out.stdout.strip().splitlines() or [""])[-1]
    tail = (out.stderr or "").strip().splitlines()[-1:] or ["failed"]
    return NO, f"{python}: {tail[0]}"


def run(args) -> int:
    print(f"Music Creator server self-test - version {VERSION}")
    print(f"    {platform.platform()}  python {sys.version.split()[0]}  ({sys.executable})")
    print()

    print("server")
    _line(OK if module_available("aiohttp") else NO, "aiohttp",
          "" if module_available("aiohttp") else "pip install -r requirements.txt")
    data_dir = os.path.abspath(args.data_dir)
    try:
        os.makedirs(data_dir, exist_ok=True)
        probe = os.path.join(data_dir, ".write-test")
        with open(probe, "w") as handle:
            handle.write("ok")
        os.remove(probe)
        _line(OK, "data dir", data_dir)
    except OSError as exc:
        _line(NO, "data dir", f"{data_dir}: {exc}")

    ffmpeg, ffprobe = audio.ffmpeg_path(), audio.ffprobe_path()
    _line(OK if ffmpeg else NO, "ffmpeg", ffmpeg or "not on PATH - /mix, uploads and probing will fail")
    _line(OK if ffprobe else MAYBE, "ffprobe", ffprobe or "not on PATH - durations will be reported as null")
    print()

    print("gpu")
    gpu = gpu_info()
    if gpu["name"]:
        _line(OK, "device", f"{gpu['name']}  {gpu['vram_gb']} GB total, {gpu['free_gb']} GB free")
    else:
        _line(NO, "device", "no CUDA device visible (the server still runs; jobs will fail)")
    if module_available("torch"):
        try:
            import torch
            _line(OK, "torch", f"{torch.__version__}  cuda={torch.version.cuda}  available={torch.cuda.is_available()}")
        except Exception as exc:  # noqa: BLE001
            _line(NO, "torch", f"import failed: {exc}")
    else:
        _line(MAYBE, "torch", "not in this interpreter (fine if the models run in their own venvs)")
    print()

    print("YuE2 - song generation (weights are CC BY-NC 4.0, non-commercial)")
    mark, detail = _can_import(args.yue2_python, "yue2")
    _line(mark, "yue2 package", detail)
    for label, spec in (("model", args.yue2_model), ("vae", args.yue2_vae)):
        state = weights_state(spec)
        mark = OK if state in ("local", "cached") else (MAYBE if state == "not-downloaded" else NO)
        _line(mark, label, f"{spec}  [{state}]")
    print()

    print("AuK - speech, voice cloning, separation (MIT). Speech only: it cannot sing.")
    mark, detail = _can_import(args.auk_python, "auk")
    _line(mark, "auk package", detail)
    for label, path in (("base config", args.auk_config), ("base ckpt", args.auk_ckpt),
                        ("flash config", args.auk_flash_config), ("flash ckpt", args.auk_flash_ckpt)):
        full = os.path.abspath(path)
        exists = os.path.exists(full)
        optional = label.startswith("flash")
        _line(OK if exists else (MAYBE if optional else NO), label,
              full + ("" if exists else "  (missing)" + (" - optional, 4-step distilled model" if optional else "")))
    omni = weights_state("Qwen/Qwen2.5-Omni-3B")
    _line(OK if omni == "cached" else MAYBE, "Qwen2.5-Omni-3B",
          f"[{omni}] - AuK loads it as part of the stack")
    print()

    print("SheetSage2 - audio -> ABC (its own venv: python 3.10/3.11 + FFmpeg 6.1)")
    sheet_python = args.sheetsage_python or sys.executable
    _line(OK if sheet_python else NO, "interpreter", sheet_python)
    mark, detail = _can_import(sheet_python, "transformers")
    _line(mark, "transformers", detail)
    state = weights_state(args.sheetsage_dir)
    _line(OK if state in ("local", "cached") else (MAYBE if state == "not-downloaded" else NO),
          "SheetSage2", f"{os.path.abspath(args.sheetsage_dir)}  [{state}]")
    mert = weights_state("m-a-p/MERT-v2-FullSong")
    _line(OK if mert == "cached" else MAYBE, "MERT-v2-FullSong", f"[{mert}] - loaded by SheetSage2 itself")
    print()

    print("residency")
    _line(OK, "--keep-loaded", args.keep_loaded)
    if args.keep_loaded == "both" and gpu["vram_gb"] and gpu["vram_gb"] < 48:
        _line(NO, "vram", f"{gpu['vram_gb']} GB cannot hold YuE2 (~24 GB) and AuK (~24.8 GB) at once; "
                          "use --keep-loaded one")
    elif gpu["vram_gb"] and gpu["vram_gb"] < 24:
        _line(NO, "vram", f"{gpu['vram_gb']} GB is below what either model needs (~24 GB); "
                          "try --cpu-offload for AuK, but YuE2 will not fit")
    else:
        _line(OK, "vram", "one model resident at a time" if args.keep_loaded != "both" else "both may stay resident")

    print()
    print("A line marked NO in the server section means the server itself will misbehave.")
    print("A line marked NO under a model means that model's endpoints return 503 and say why;")
    print("the server still starts and /health still answers - that is deliberate.")
    return 0 if module_available("aiohttp") else 1
