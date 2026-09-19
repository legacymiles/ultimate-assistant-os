"""Reaching the two models, and deciding which one is allowed to be on the
GPU right now.

Two problems this file exists to solve.

**VRAM.** YuE2 wants 24 GB and AuK peaks around 24.8 GB in bf16. They do not
fit together on a 24 GB card — not nearly. So engines load lazily on first
use, at most one stays resident, and the other is torn down (drop the
reference, gc, `torch.cuda.empty_cache()`) *before* the next one loads. Every
swap is logged with the reason. On a card big enough for both (48 GB and up)
`--keep-loaded both` skips the swap; `--keep-loaded none` frees after every
job, which is what you want when the box is shared.

**Python versions.** YuE2 is a Python 3.12 install, AuK is Python 3.10, and
SheetSage2 wants its own 3.10/3.11 environment with FFmpeg 6.1 next to it.
One virtualenv cannot be all three. So each engine can be reached one of two
ways:

* *in-process* — the package imports in the interpreter running this server,
  the model stays resident between jobs, and a swap is a `del`;
* *subprocess* — `--yue2-python` / `--auk-python` / `--sheetsage-python`
  point at another venv's interpreter, and the job runs there through the
  scripts in `workers/`, which load the model, do the work, print a JSON
  result and exit.

Subprocess mode pays the model load on every job, which is minutes for YuE2.
That is the honest cost of running two incompatible environments on one box,
and it is written down here rather than hidden: the README says which layout
costs what. Since only one model may be resident anyway, the loss is smaller
than it looks unless you are generating song after song.

The worker scripts stream `@@STAGE@@` lines so a subprocess job reports the
same coarse stages an in-process one does.
"""

from __future__ import annotations

import gc
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time

from common import Unavailable, Unsupported, module_available, weights_state

log = logging.getLogger("music.engines")

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER_DIR = os.path.join(HERE, "workers")

STAGE_MARK = "@@STAGE@@"
RESULT_MARK = "@@RESULT@@"
ERROR_MARK = "@@ERROR@@"

# Peak VRAM the upstream projects report, used only for log lines and the
# README table. Nothing here decides anything from these numbers except how
# loudly to warn when --keep-loaded both is asked for on a small card.
VRAM_NEED_GB = {"yue2": 24.0, "auk": 24.8, "sheetsage": 6.0}


def _interpreter(path: str | None) -> str | None:
    if not path:
        return None
    if os.path.isfile(path):
        return path
    return shutil.which(path)


class Engines:
    def __init__(self, args):
        self.args = args
        self.lock = threading.RLock()
        self._yue2 = None            # the resident YuE2Pipeline, in-process mode only
        self._auk = None             # the resident AukInfer, in-process mode only
        self._auk_variant = None     # "base" or "flash" — they are different checkpoints
        self._separation_support = None  # cached answer, see separation_supported()

    # --- how each engine is reachable -----------------------------------

    def yue2_mode(self) -> str | None:
        if _interpreter(self.args.yue2_python):
            return "subprocess"
        return "inprocess" if module_available("yue2") else None

    def auk_mode(self) -> str | None:
        if _interpreter(self.args.auk_python):
            return "subprocess"
        return "inprocess" if module_available("auk") else None

    def sheetsage_mode(self) -> str | None:
        # Always out of process: SheetSage2 pins transformers versions that
        # fight with YuE2's, and it is the one model here that is documented
        # as needing its own environment.
        # So no --sheetsage-python means not installed — falling back to this
        # interpreter reported "available" on a pod that skipped SheetSage2 and
        # would only have failed mid-job.
        if not self.args.sheetsage_python:
            return None
        return "subprocess" if _interpreter(self.args.sheetsage_python) else None

    def auk_paths(self, flash: bool) -> tuple[str, str]:
        if flash:
            return os.path.abspath(self.args.auk_flash_config), os.path.abspath(self.args.auk_flash_ckpt)
        return os.path.abspath(self.args.auk_config), os.path.abspath(self.args.auk_ckpt)

    # --- what /health reports -------------------------------------------

    def availability(self) -> dict:
        args = self.args
        yue_mode = self.yue2_mode()
        model_state = weights_state(args.yue2_model)
        vae_state = weights_state(args.yue2_vae)
        yue_reason = None
        if not yue_mode:
            yue_reason = ("the yue2 package is not importable here and --yue2-python was not given; "
                          "see the README's YuE2 install")
        elif model_state == "missing" or vae_state == "missing":
            yue_reason = f"weights not found (model: {model_state}, vae: {vae_state})"

        auk_mode = self.auk_mode()
        config_path, ckpt_path = self.auk_paths(False)
        auk_reason = None
        if not auk_mode:
            auk_reason = ("the auk package is not importable here and --auk-python was not given; "
                          "see the README's AuK install")
        elif not os.path.exists(ckpt_path) or not os.path.exists(config_path):
            missing = [p for p in (ckpt_path, config_path) if not os.path.exists(p)]
            auk_reason = "checkpoint files not found: " + ", ".join(missing)

        sheet_dir = os.path.abspath(args.sheetsage_dir) if args.sheetsage_dir else None
        sheet_mode = self.sheetsage_mode()
        sheet_state = weights_state(args.sheetsage_dir)
        sheet_reason = None
        if not sheet_mode:
            sheet_reason = "no interpreter for SheetSage2 (--sheetsage-python)"
        elif sheet_state in ("missing", "not-set"):
            sheet_reason = f"SheetSage2 not found at {sheet_dir}"

        with self.lock:
            yue_loaded = self._yue2 is not None
            auk_loaded = self._auk is not None
            auk_variant = self._auk_variant

        return {
            "yue2": {
                "available": bool(yue_mode) and yue_reason is None,
                "loaded": yue_loaded,
                "model": args.yue2_model,
                "vae": args.yue2_vae,
                "mode": yue_mode or "not-installed",
                "weights": model_state,
                "reason": yue_reason,
            },
            "auk": {
                "available": bool(auk_mode) and auk_reason is None,
                "loaded": auk_loaded,
                "variant": auk_variant,
                "flash_available": os.path.exists(os.path.abspath(args.auk_flash_ckpt)),
                "mode": auk_mode or "not-installed",
                "reason": auk_reason,
            },
            "sheetsage": {
                "available": bool(sheet_mode) and sheet_reason is None,
                "dir": sheet_dir,
                "mode": sheet_mode or "not-installed",
                "reason": sheet_reason,
            },
        }

    def resident(self) -> list[str]:
        with self.lock:
            names = []
            if self._yue2 is not None:
                names.append("yue2")
            if self._auk is not None:
                names.append("auk:" + (self._auk_variant or "?"))
            return names

    def require(self, name: str):
        """Raise Unavailable with a useful sentence if `name` cannot run."""
        info = self.availability()[name]
        if not info["available"]:
            raise Unavailable(f"{name} is not available on this server: {info['reason']}")

    # --- residency -------------------------------------------------------

    def _free_cuda(self):
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception as exc:
            log.debug(f"empty_cache skipped: {exc}")

    def _unload_yue2(self, why: str):
        with self.lock:
            pipe, self._yue2 = self._yue2, None
        if pipe is None:
            return
        log.info(f"unloading YuE2 ({why})")
        # YuE2Pipeline is documented as a context manager; use its own teardown
        # when it has one rather than assuming a dropped reference is enough.
        for closer in ("close", "__exit__"):
            method = getattr(pipe, closer, None)
            if callable(method):
                try:
                    method(None, None, None) if closer == "__exit__" else method()
                    break
                except Exception as exc:
                    log.warning(f"YuE2 {closer}() raised: {exc}")
        del pipe
        gc.collect()
        self._free_cuda()

    def _unload_auk(self, why: str):
        with self.lock:
            engine, self._auk, self._auk_variant = self._auk, None, None
        if engine is None:
            return
        log.info(f"unloading AuK ({why})")
        for closer in ("close", "unload"):
            method = getattr(engine, closer, None)
            if callable(method):
                try:
                    method()
                    break
                except Exception as exc:
                    log.warning(f"AuK {closer}() raised: {exc}")
        del engine
        gc.collect()
        self._free_cuda()

    def free_gpu(self, keep: str | None = None, why: str = ""):
        """Make room for `keep`, honouring --keep-loaded.

        `keep` is the engine about to run. Anything else resident is freed
        unless the operator asked for both to stay.
        """
        if self.args.keep_loaded == "both":
            return
        reason = why or f"making room for {keep or 'the next job'}"
        if keep != "yue2":
            self._unload_yue2(reason)
        if keep != "auk":
            self._unload_auk(reason)

    def release_after_job(self, name: str):
        if self.args.keep_loaded == "none":
            self.free_gpu(keep=None, why="--keep-loaded none: freeing after the job")

    # --- in-process loads -------------------------------------------------

    def _load_yue2(self, report):
        with self.lock:
            if self._yue2 is not None:
                return self._yue2
        self.free_gpu(keep="yue2")
        report("loading YuE2", 0.05)
        from workers import yue2_worker
        started = time.perf_counter()
        pipe = yue2_worker.load(self.args.yue2_model, self.args.yue2_vae, device="cuda")
        log.info(f"YuE2 loaded in {time.perf_counter() - started:.1f}s")
        with self.lock:
            self._yue2 = pipe
        return pipe

    def _load_auk(self, flash: bool, report):
        variant = "flash" if flash else "base"
        with self.lock:
            if self._auk is not None and self._auk_variant == variant:
                return self._auk
        if self._auk is not None:
            self._unload_auk(f"switching AuK checkpoint to {variant}")
        self.free_gpu(keep="auk")
        config_path, ckpt_path = self.auk_paths(flash)
        report(f"loading AuK ({variant})", 0.05)
        from workers import auk_worker
        started = time.perf_counter()
        engine = auk_worker.load(config_path, ckpt_path, cpu_offload=self.args.cpu_offload)
        log.info(f"AuK {variant} loaded in {time.perf_counter() - started:.1f}s")
        with self.lock:
            self._auk = engine
            self._auk_variant = variant
        return engine

    # --- subprocess plumbing ---------------------------------------------

    def _run_worker(self, python: str, script: str, payload: dict, report, timeout: int) -> dict:
        """Run one worker script and return its result dict.

        stdout carries the protocol (@@STAGE@@ / @@RESULT@@ / @@ERROR@@ lines);
        anything else on stdout is model chatter and is logged at debug. stderr
        is drained by a thread — a progress-bar-happy library will fill the pipe
        and deadlock the child otherwise — and its tail goes into the error
        message when the worker dies.
        """
        cmd = [python, script]
        log.info(f"worker: {os.path.basename(script)} via {python}")
        proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1,
        )  # cwd is inherited on purpose: AuK and YuE2 resolve some of their own
        #    relative paths against it, so the operator's working directory wins
        tail: list[str] = []

        def drain():
            for line in proc.stderr:
                tail.append(line.rstrip())
                del tail[:-40]
                log.debug(f"[worker] {line.rstrip()}")

        drainer = threading.Thread(target=drain, name="worker-stderr", daemon=True)
        drainer.start()

        result, error = None, None
        try:
            proc.stdin.write(json.dumps(payload) + "\n")
            proc.stdin.flush()
            proc.stdin.close()
            for line in proc.stdout:
                line = line.rstrip()
                if line.startswith(STAGE_MARK):
                    try:
                        stage = json.loads(line[len(STAGE_MARK):])
                        report(stage.get("stage", "working"), stage.get("progress"))
                    except Exception:
                        pass
                elif line.startswith(RESULT_MARK):
                    result = json.loads(line[len(RESULT_MARK):])
                elif line.startswith(ERROR_MARK):
                    error = json.loads(line[len(ERROR_MARK):]).get("error")
                elif line:
                    log.debug(f"[worker] {line}")
            proc.wait(timeout=timeout)
        finally:
            if proc.poll() is None:
                proc.kill()
            drainer.join(timeout=2)

        if error:
            raise RuntimeError(error)
        if result is None:
            raise RuntimeError(
                f"{os.path.basename(script)} exited with code {proc.returncode} without a result. "
                f"Last output: " + (" / ".join(tail[-5:]) or "(nothing on stderr)")
            )
        return result

    # --- the four things a job can ask for --------------------------------

    def song(self, request: dict, out_dir: str, report, timeout: int) -> dict:
        self.require("yue2")
        mode = self.yue2_mode()
        if mode == "subprocess":
            self.free_gpu(keep=None, why="running YuE2 in its own interpreter")
            payload = {
                "task": "song", "model": self.args.yue2_model, "vae": self.args.yue2_vae,
                "request": request, "out_dir": out_dir,
            }
            return self._run_worker(_interpreter(self.args.yue2_python),
                                    os.path.join(WORKER_DIR, "yue2_worker.py"),
                                    payload, report, timeout)
        from workers import yue2_worker
        pipe = self._load_yue2(report)
        try:
            return yue2_worker.run_song(pipe, request, out_dir, report)
        finally:
            self.release_after_job("yue2")

    def speak(self, spec: dict, report, timeout: int) -> dict:
        self.require("auk")
        flash = bool(spec.get("flash"))
        mode = self.auk_mode()
        config_path, ckpt_path = self.auk_paths(flash)
        if flash and not os.path.exists(ckpt_path):
            raise Unavailable(
                f"the AuK-Flash checkpoint is not at {ckpt_path}; download tencent/AuK-Flash "
                "or drop flash:true to use the base model"
            )
        if mode == "subprocess":
            self.free_gpu(keep=None, why="running AuK in its own interpreter")
            payload = {"task": "speak", "config": config_path, "ckpt": ckpt_path,
                       "cpu_offload": bool(self.args.cpu_offload), **spec}
            return self._run_worker(_interpreter(self.args.auk_python),
                                    os.path.join(WORKER_DIR, "auk_worker.py"),
                                    payload, report, timeout)
        from workers import auk_worker
        engine = self._load_auk(flash, report)
        try:
            return auk_worker.run_speak(engine, spec, report)
        finally:
            self.release_after_job("auk")

    def separate(self, spec: dict, report, timeout: int) -> dict:
        self.require("auk")
        self.separation_supported(raise_if_not=True)
        mode = self.auk_mode()
        config_path, ckpt_path = self.auk_paths(False)
        if mode == "subprocess":
            self.free_gpu(keep=None, why="running AuK in its own interpreter")
            payload = {"task": "separate", "config": config_path, "ckpt": ckpt_path,
                       "cpu_offload": bool(self.args.cpu_offload), **spec}
            return self._run_worker(_interpreter(self.args.auk_python),
                                    os.path.join(WORKER_DIR, "auk_worker.py"),
                                    payload, report, timeout)
        from workers import auk_worker
        engine = self._load_auk(False, report)
        try:
            return auk_worker.run_separate(engine, spec, report)
        finally:
            self.release_after_job("auk")

    def transcribe(self, audio_path: str, out_dir: str, melody_only: bool, report, timeout: int) -> dict:
        self.require("sheetsage")
        self.free_gpu(keep=None, why="SheetSage2 needs the GPU to itself")
        payload = {"model_dir": os.path.abspath(self.args.sheetsage_dir), "audio": os.path.abspath(audio_path),
                   "out_dir": os.path.abspath(out_dir), "melody_only": bool(melody_only)}
        return self._run_worker(_interpreter(self.args.sheetsage_python or sys.executable),
                                os.path.join(WORKER_DIR, "sheetsage_worker.py"),
                                payload, report, timeout)

    # --- separation capability check --------------------------------------

    def separation_supported(self, raise_if_not: bool = False) -> bool:
        """Does the installed AuK build expose a separation entry point?

        AuK's model card lists source separation (denoise, speech separation,
        music separation) alongside TTS and speech editing, but the published
        Python example only covers generation. Rather than guess at a calling
        convention and hand back something that is not what was asked for,
        this looks for a real method on AukInfer — importing the class costs
        an import, not a checkpoint — and returns 501 when there is none.
        """
        if self._separation_support is not None:
            supported = self._separation_support
        else:
            supported = self._probe_separation()
            self._separation_support = supported
        if not supported and raise_if_not:
            raise Unsupported(
                "the installed AuK build exposes no separation entry point on AukInfer "
                "(looked for: separate, source_separation, separate_audio, denoise). AuK documents "
                "separation as a model capability, but this server will not invent a calling "
                "convention for it — update AuK, or see the README section 'Separation'."
            )
        return supported

    def _probe_separation(self) -> bool:
        names = ("separate", "source_separation", "separate_audio", "denoise")
        mode = self.auk_mode()
        if mode == "inprocess":
            try:
                from auk.infer.infer_auk import AukInfer
                return any(callable(getattr(AukInfer, n, None)) for n in names)
            except Exception as exc:
                log.warning(f"could not import AukInfer to check separation support: {exc}")
                return False
        if mode == "subprocess":
            code = (
                "from auk.infer.infer_auk import AukInfer;"
                "print(any(callable(getattr(AukInfer, n, None)) for n in "
                f"{names!r}))"
            )
            try:
                out = subprocess.run([_interpreter(self.args.auk_python), "-c", code],
                                     capture_output=True, text=True, timeout=300)
                return out.returncode == 0 and out.stdout.strip().endswith("True")
            except Exception as exc:
                log.warning(f"separation probe failed: {exc}")
                return False
        return False
