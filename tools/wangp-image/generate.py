"""
Draw images with WanGP, locally and for nothing.

Why this exists: every image the hub made went to a paid model
(`DEFAULT_IMAGE_MODEL` in src/lib/image-studio/agents.ts). The owner already
has WanGP installed with Flux 2 Klein 4B on disk — 3.8 GB, int8 — so the
picture can be drawn on their own card instead, with no key and no spend.

TWO MODES, and the difference is the whole performance story:

  one-shot   python generate.py --prompt "..." --out out.png
             Loads the model, draws once, exits. ~144 s on a 6 GB RTX 3050,
             almost all of it loading. Fine for a test, useless for a service.

  worker     python generate.py --serve
             Loads once, then reads one JSON job per line on stdin and writes
             one JSON result per line on stdout. Every job after the first
             skips the load, which is the only reason this is usable at all.
             WanGP's own API is built for exactly this ("keep the last loaded
             model alive across requests").

Results are ALWAYS one line of JSON on stdout, whatever happens:

    {"ok": true,  "path": "...", "ms": 18234, "model": "flux2_klein_4b", "id": "..."}
    {"ok": false, "error": "plain English", "ms": 120, "id": "..."}

WanGP's console noise goes to stderr so stdout stays parseable.

Use of the WanGP API is subject to the WanGP Terms and Conditions; anything
built on it should say that it uses WanGP.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

DEFAULT_ROOT = Path(os.environ.get("WANGP_ROOT", r"C:/pinokio/api/wan/app"))

# Flux 2 Klein 4B: cfg- and steps-distilled, 4 steps at 1024px, int8 weights of
# 3.8 GB. mmgp still shuttles it against a 6 GB card, so the win comes from
# loading it once rather than from it fitting outright.
DEFAULT_MODEL = "flux2_klein_4b"
DEFAULT_STEPS = 4


def emit(payload: dict) -> None:
    """One line of JSON on stdout, flushed. The only thing stdout is for."""
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def note(text: str) -> None:
    """Progress for a human, on stderr where it cannot corrupt a result."""
    sys.stderr.write(f"[wangp-image] {text}\n")
    sys.stderr.flush()


def plain_english(err: BaseException) -> str:
    """Turn a traceback into something a person can act on (checklist R3)."""
    text = f"{err}".strip() or err.__class__.__name__
    low = text.lower()
    if "out of memory" in low or ("cuda" in low and "memory" in low):
        return (
            "The graphics card ran out of memory. Close other GPU apps "
            "(a browser with hardware acceleration counts) and try again."
        )
    if "no module named" in low or "modulenotfound" in low:
        return (
            "WanGP's Python packages are not on this interpreter. Run this with "
            "WanGP's own venv: <wangp>/venv/Scripts/python.exe"
        )
    if "no such file" in low or "not found" in low:
        return f"WanGP could not find a file it needs: {text}"
    return text


def open_session(root: Path, profile: str):
    """Load WanGP once. Everything after this is just jobs."""
    sys.path.insert(0, str(root))
    os.chdir(root)
    from shared.api import init  # type: ignore

    return init(
        root=root,
        cli_args=["--attention", "sdpa", "--profile", profile],
        console_output=True,   # stderr
        console_isatty=False,
    )


def run_one(session, job: dict, root: Path) -> dict:
    """Draw one picture. Never raises — the caller must keep serving."""
    started = time.monotonic()
    job_id = job.get("id")
    try:
        prompt = str(job.get("prompt") or "").strip()
        if not prompt:
            return {"ok": False, "error": "Say what to draw.", "ms": 0, "id": job_id}

        out = Path(job.get("out") or "")
        if not out.name:
            return {"ok": False, "error": "No output path given.", "ms": 0, "id": job_id}

        settings = {
            "model_type": job.get("model") or DEFAULT_MODEL,
            "prompt": prompt,
            "resolution": f"{int(job.get('width') or 1024)}x{int(job.get('height') or 1024)}",
            "num_inference_steps": int(job.get("steps") or DEFAULT_STEPS),
            # A blank line in a prompt means "another picture" to WanGP by
            # default (multi_prompts_gen_type "PG"), and it REFUSES a job that
            # parses into more than one request. Callers write paragraphs --
            # Image Studio appends its aspect-ratio line after a blank one --
            # so every multi-paragraph prompt failed with "parses this prompt
            # into 2 separate generation requests" until this was set. "FG"
            # is WanGP's own flag for "the line breaks belong to one prompt".
            "multi_prompts_gen_type": "FG",
        }
        seed = int(job.get("seed", -1))
        if seed >= 0:
            settings["seed"] = seed

        task = session.submit_task(settings)
        result = task.result()

        if not getattr(result, "success", False):
            errors = [getattr(e, "message", str(e)) for e in (getattr(result, "errors", None) or [])]
            return {
                "ok": False,
                "error": "; ".join(errors) or "WanGP finished without producing an image.",
                "ms": int((time.monotonic() - started) * 1000),
                "id": job_id,
            }

        made = list(getattr(result, "generated_files", None) or [])
        if not made:
            return {
                "ok": False,
                "error": "WanGP reported success but produced no file.",
                "ms": int((time.monotonic() - started) * 1000),
                "id": job_id,
            }

        # Copy, never move: a failure here still leaves the picture where
        # WanGP put it, in its own outputs folder.
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(made[0], out)

        return {
            "ok": True,
            "path": str(out),
            "source": str(made[0]),
            "model": settings["model_type"],
            "steps": settings["num_inference_steps"],
            "ms": int((time.monotonic() - started) * 1000),
            "id": job_id,
        }
    except BaseException as e:  # noqa: BLE001 - one job must never kill the worker
        return {
            "ok": False,
            "error": plain_english(e),
            "ms": int((time.monotonic() - started) * 1000),
            "id": job_id,
        }


def serve(root: Path, profile: str) -> int:
    """Load once, then one job per line of stdin, forever."""
    try:
        note("loading WanGP…")
        session = open_session(root, profile)
    except BaseException as e:  # noqa: BLE001
        emit({"ok": False, "ready": False, "error": plain_english(e)})
        return 1

    # The server beside this waits for exactly this line before sending work.
    emit({"ok": True, "ready": True, "model": DEFAULT_MODEL})
    note("ready — the model loads on the first picture and stays loaded")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except Exception:
            emit({"ok": False, "error": "That job could not be read."})
            continue
        if job.get("stop"):
            note("stopping")
            return 0
        emit(run_one(session, job, root))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Draw images with WanGP.")
    ap.add_argument("--serve", action="store_true", help="Stay loaded and read jobs from stdin.")
    ap.add_argument("--prompt")
    ap.add_argument("--out")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=1024)
    ap.add_argument("--steps", type=int, default=DEFAULT_STEPS)
    ap.add_argument("--seed", type=int, default=-1)
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument(
        "--profile",
        default="4",
        help="WanGP memory profile. 4 is the low-VRAM one, which is what a 6 GB card wants.",
    )
    args = ap.parse_args()

    root = Path(args.root)
    if not (root / "shared" / "api.py").exists():
        emit({"ok": False, "error": f"No WanGP install at {root}. Set WANGP_ROOT or pass --root."})
        return 1

    if args.serve:
        return serve(root, args.profile)

    if not args.prompt or not args.out:
        emit({"ok": False, "error": "Pass --prompt and --out, or use --serve."})
        return 1

    started = time.monotonic()
    try:
        session = open_session(root, args.profile)
    except BaseException as e:  # noqa: BLE001
        emit({"ok": False, "error": plain_english(e), "ms": int((time.monotonic() - started) * 1000)})
        return 1

    out = run_one(session, {
        "prompt": args.prompt,
        "out": args.out,
        "model": args.model,
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "seed": args.seed,
    }, root)
    emit(out)
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
