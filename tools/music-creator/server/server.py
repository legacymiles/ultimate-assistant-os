"""Music Creator inference server.

    python server/server.py --port 8770 [--token SECRET]

The GPU side of the Music Creator app (`/apps/music-creator` in the hub). It
wraps two open-source models and nothing else:

  YuE2  (m-a-p)          style + lyrics [+ an ABC melody] -> a whole song,
                         vocals and backing, decoded to audio.flac.
                         Apache-2.0 code, CC BY-NC 4.0 weights: non-commercial.
  AuK   (Tencent Hunyuan) a reference clip + text -> that text spoken in that
                         voice, zero-shot. MIT. Speech only — it cannot sing.

plus SheetSage2, which transcribes audio to an ABC score so a song can be
re-performed in a different style.

Everything long-running is a job: POST returns a job id, GET /jobs/{id} polls.
Jobs run one at a time in one worker thread because there is one GPU, and
because YuE2 and AuK cannot both be resident on a 24 GB card — see engines.py
for the swap rules.

The server starts, and /health answers, on a machine with no GPU and no model
installed. That is on purpose: the website's "server offline" and "model not
installed" states have to be testable, and a health endpoint that 500s when
the interesting part is missing tells you nothing.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import uuid

try:
    from aiohttp import web
except ImportError:  # --self-test has to run on a box that is missing pieces
    web = None       # and say which ones, so this is not fatal until main()

import audio
import selftest
from common import (DEFAULT_AUK_CKPT, DEFAULT_AUK_CONFIG, DEFAULT_AUK_FLASH_CKPT,
                    DEFAULT_AUK_FLASH_CONFIG, DEFAULT_DATA_DIR, DEFAULT_SHEETSAGE_DIR,
                    DEFAULT_YUE2_MODEL, DEFAULT_YUE2_VAE, SERVER_NAME, VERSION,
                    BadRequest, Unavailable, Unsupported, content_type_for,
                    decode_b64_audio, gpu_info, validate_song_request)
from engines import Engines
from idle import IdleStopper
from jobs import JobStore
from storage import FileStore, VoiceStore, public_voice
from tasks import Runner

log = logging.getLogger("music")

GAIN_RANGE = (-60.0, 24.0)
OFFSET_RANGE = (-600.0, 600.0)
GEN_SECONDS_RANGE = (0.5, 600.0)


# --- small request helpers ----------------------------------------------

async def json_body(request) -> dict:
    if not request.can_read_body:
        return {}
    try:
        body = await request.json()
    except json.JSONDecodeError as exc:
        raise BadRequest(f"body must be JSON: {exc}")
    if not isinstance(body, dict):
        raise BadRequest("body must be a JSON object")
    return body


def want_str(body: dict, field: str, required: bool = True, limit: int = 20000) -> str | None:
    value = body.get(field)
    if value is None:
        if required:
            raise BadRequest(f"{field} is required")
        return None
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"{field} must be a non-empty string")
    return value.strip()[:limit]


def want_number(body: dict, field: str, default, low: float, high: float):
    value = body.get(field, default)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BadRequest(f"{field} must be a number")
    value = float(value)
    if not low <= value <= high:
        raise BadRequest(f"{field} must be between {low:g} and {high:g}")
    return value


def want_bool(body: dict, field: str, default: bool) -> bool:
    value = body.get(field, default)
    if value is None:
        return default
    if not isinstance(value, bool):
        raise BadRequest(f"{field} must be true or false")
    return value


def make_app(args, engines: Engines, jobs: JobStore, runner: Runner,
             files: FileStore, voices: VoiceStore, idle: IdleStopper | None = None):
    # Uploads arrive base64-encoded inside JSON, which costs a third on top of
    # the raw size, so the body limit is the upload limit plus that overhead.
    max_upload = args.max_upload_mb * 1024 * 1024
    app = web.Application(client_max_size=int(max_upload * 1.4) + 1024 * 1024)
    token = args.token

    def cors(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "content-type, authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        return response

    def ok(payload, status: int = 200):
        return cors(web.json_response(payload, status=status))

    def authorized(request, body=None) -> bool:
        if not token:
            return True
        header = request.headers.get("authorization", "")
        if header.lower().startswith("bearer ") and header[7:].strip() == token:
            return True
        # A token in the body is accepted too, the way the Lucy server does it,
        # so a browser that cannot set headers on a particular call still works.
        return bool(body) and body.get("token") == token

    def guard(handler, needs_auth: bool = True):
        """Turn the exception types this server raises into honest statuses."""
        async def wrapped(request):
            body = None
            if request.method in ("POST", "PATCH", "PUT"):
                try:
                    body = await json_body(request)
                except BadRequest as exc:
                    return ok({"error": str(exc)}, status=400)
                request["body"] = body
            if needs_auth and not authorized(request, body):
                return ok({"error": "bad or missing token"}, status=401)
            if needs_auth and idle is not None:
                idle.touch()
            try:
                return await handler(request)
            except BadRequest as exc:
                return ok({"error": str(exc)}, status=400)
            except Unsupported as exc:
                return ok({"error": str(exc), "kind": "unsupported"}, status=501)
            except (Unavailable, audio.FfmpegMissing) as exc:
                return ok({"error": str(exc), "kind": "unavailable"}, status=503)
            except Exception as exc:  # noqa: BLE001
                log.exception(f"{request.method} {request.path} failed")
                return ok({"error": f"{type(exc).__name__}: {exc}"}, status=500)
        return wrapped

    # --- health ----------------------------------------------------------

    async def health(_request):
        """Never 500s. A missing model is data, not an error."""
        try:
            engine_state = engines.availability()
        except Exception as exc:  # noqa: BLE001
            log.exception("availability probe failed")
            engine_state = {
                "yue2": {"available": False, "loaded": False, "model": args.yue2_model, "reason": str(exc)},
                "auk": {"available": False, "loaded": False, "reason": str(exc)},
                "sheetsage": {"available": False, "reason": str(exc)},
            }
        return ok({
            "ok": True,
            "name": SERVER_NAME,
            "version": VERSION,
            "engines": engine_state,
            "gpu": gpu_info(),
            "queue": jobs.snapshot(),
            "resident": engines.resident(),
            "keep_loaded": args.keep_loaded,
            "cpu_offload": bool(args.cpu_offload),
            "ffmpeg": bool(audio.ffmpeg_path()),
            "auth": bool(token),
            "data_dir": os.path.abspath(args.data_dir),
            "idle_stop": idle.state() if idle is not None else {"enabled": False},
        })

    # --- jobs ------------------------------------------------------------

    async def post_song(request):
        body = request["body"]
        song_request = validate_song_request(body, fallback_id="song-" + uuid.uuid4().hex[:12])
        engines.require("yue2")
        job = jobs.submit("song", {"request": song_request}, runner.song)
        return ok({"job_id": job.id})

    async def post_transcribe(request):
        body = request["body"]
        data = decode_b64_audio(body.get("audio_b64"), "audio_b64", max_upload)
        melody_only = want_bool(body, "melody_only", True)
        engines.require("sheetsage")
        path = await asyncio.to_thread(runner.write_upload, data, body.get("filename"))
        job = jobs.submit("transcribe", {"audio_path": path, "melody_only": melody_only}, runner.transcribe)
        return ok({"job_id": job.id})

    async def post_speak(request):
        body = request["body"]
        text = want_str(body, "text", limit=5000)
        # The reference is resolved before the engine check so that a bad voice
        # id reads as a bad voice id, not as "AuK is not installed".
        voice_ref_id = body.get("voice_ref_id")
        if voice_ref_id:
            record = voices.get(voice_ref_id)
            if not record:
                raise BadRequest(f"no stored voice with id {voice_ref_id}")
            reference_path = record["path"]
            if not os.path.exists(reference_path):
                raise BadRequest(f"the clip for voice {voice_ref_id} is missing from disk")
        elif body.get("reference_b64"):
            data = decode_b64_audio(body["reference_b64"], "reference_b64", max_upload)
            reference_path = await asyncio.to_thread(runner.write_upload, data, body.get("filename"))
        else:
            raise BadRequest("send either voice_ref_id (a stored voice) or reference_b64 (a clip to clone)")
        engines.require("auk")

        params = {
            "text": text,
            "reference_path": reference_path,
            "voice_ref_id": voice_ref_id,
            "instruction": want_str(body, "instruction", required=False, limit=2000),
            "gen_seconds": want_number(body, "gen_seconds", None, *GEN_SECONDS_RANGE),
            "flash": want_bool(body, "flash", False),
        }
        job = jobs.submit("speak", params, runner.speak)
        return ok({"job_id": job.id})

    async def post_separate(request):
        body = request["body"]
        mode = body.get("mode")
        if mode not in ("vocals", "music"):
            raise BadRequest('mode must be "vocals" or "music"')
        data = decode_b64_audio(body.get("audio_b64"), "audio_b64", max_upload)
        engines.require("auk")
        # Checking this before queueing means the caller gets a 501 now rather
        # than a failed job in ten minutes. The probe imports AukInfer in the
        # right interpreter; it does not load a checkpoint.
        await asyncio.to_thread(engines.separation_supported, True)
        path = await asyncio.to_thread(runner.write_upload, data, body.get("filename"))
        job = jobs.submit("separate", {"audio_path": path, "mode": mode}, runner.separate)
        return ok({"job_id": job.id})

    async def get_job(request):
        job = jobs.get(request.match_info["job_id"])
        if not job:
            return ok({"error": "no such job"}, status=404)
        return ok(job.to_dict())

    async def get_jobs(_request):
        return ok({"jobs": jobs.recent(), **jobs.snapshot()})

    # --- voices ----------------------------------------------------------

    async def post_voice(request):
        body = request["body"]
        name = want_str(body, "name", limit=120)
        data = decode_b64_audio(body.get("audio_b64"), "audio_b64", max_upload)
        transcript = want_str(body, "transcript", required=False, limit=5000)
        record = await asyncio.to_thread(voices.add, name, data, body.get("filename"), transcript)
        return ok(public_voice(record), status=201)

    async def get_voices(_request):
        return ok([public_voice(record) for record in voices.list()])

    async def patch_voice(request):
        name = want_str(request["body"], "name", limit=120)
        record = voices.rename(request.match_info["voice_id"], name)
        if not record:
            return ok({"error": "no such voice"}, status=404)
        return ok(public_voice(record))

    async def delete_voice(request):
        if not voices.delete(request.match_info["voice_id"]):
            return ok({"error": "no such voice"}, status=404)
        return ok({"deleted": True})

    # --- files and mixing -------------------------------------------------

    async def get_file(request):
        record = files.get(request.match_info["file_id"])
        if not record:
            return ok({"error": "no such file"}, status=404)
        headers = {
            "Content-Type": content_type_for(record["path"]),
            "Content-Disposition": f'inline; filename="{record["name"]}"',
        }
        return cors(web.FileResponse(record["path"], headers=headers))

    def resolve_audio_input(body: dict, id_field: str, b64_field: str) -> str:
        file_id = body.get(id_field)
        if file_id:
            record = files.get(file_id)
            if not record:
                raise BadRequest(f"no such file: {file_id}")
            return record["path"]
        if body.get(b64_field):
            data = decode_b64_audio(body[b64_field], b64_field, max_upload)
            return runner.write_upload(data)
        raise BadRequest(f"send {id_field} or {b64_field}")

    async def post_mix(request):
        body = request["body"]
        music = await asyncio.to_thread(resolve_audio_input, body, "music_file_id", "music_b64")
        vocal = await asyncio.to_thread(resolve_audio_input, body, "vocal_file_id", "vocal_b64")
        music_gain = want_number(body, "music_gain_db", 0.0, *GAIN_RANGE)
        vocal_gain = want_number(body, "vocal_gain_db", 0.0, *GAIN_RANGE)
        offset = want_number(body, "offset_s", 0.0, *OFFSET_RANGE)
        result = await asyncio.to_thread(runner.mix, music, vocal, music_gain, vocal_gain, offset)
        return ok(result)

    async def options(_request):
        return cors(web.Response(status=204))

    app.router.add_route("OPTIONS", "/{tail:.*}", options)
    app.router.add_get("/health", guard(health, needs_auth=False))
    app.router.add_post("/jobs/song", guard(post_song))
    app.router.add_post("/jobs/transcribe", guard(post_transcribe))
    app.router.add_post("/jobs/speak", guard(post_speak))
    app.router.add_post("/jobs/separate", guard(post_separate))
    app.router.add_get("/jobs", guard(get_jobs))
    app.router.add_get("/jobs/{job_id}", guard(get_job))
    app.router.add_post("/voices", guard(post_voice))
    app.router.add_get("/voices", guard(get_voices))
    app.router.add_patch("/voices/{voice_id}", guard(patch_voice))
    app.router.add_delete("/voices/{voice_id}", guard(delete_voice))
    app.router.add_get("/files/{file_id}", guard(get_file))
    app.router.add_post("/mix", guard(post_mix))
    return app


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--token", default=os.environ.get("MUSIC_TOKEN"),
                        help="if set, every endpoint except /health requires Authorization: Bearer <token>")
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR,
                        help="produced audio, scores and voice clips (default: tools/music-creator/data)")

    group = parser.add_argument_group("YuE2 (song generation)")
    group.add_argument("--yue2-model", default=DEFAULT_YUE2_MODEL, help="hub id or local dir")
    group.add_argument("--yue2-vae", default=DEFAULT_YUE2_VAE,
                       help="the listening decoder; -legacy is only for reproducing benchmarks")
    group.add_argument("--yue2-python", default=os.environ.get("YUE2_PYTHON"),
                       help="python of the YuE2 venv; set this when yue2 is not importable here "
                            "(the model then loads per job instead of staying resident)")

    group = parser.add_argument_group("AuK (speech, voice cloning, separation)")
    group.add_argument("--auk-ckpt", default=DEFAULT_AUK_CKPT)
    group.add_argument("--auk-config", default=DEFAULT_AUK_CONFIG)
    group.add_argument("--auk-flash-ckpt", default=DEFAULT_AUK_FLASH_CKPT,
                       help="optional 4-step distilled checkpoint, used when a request sets flash:true")
    group.add_argument("--auk-flash-config", default=DEFAULT_AUK_FLASH_CONFIG)
    group.add_argument("--auk-python", default=os.environ.get("AUK_PYTHON"),
                       help="python of the AuK venv (it wants 3.10, YuE2 wants 3.12)")
    group.add_argument("--cpu-offload", action="store_true",
                       help="pass cpu_offload to AuK: about a third less VRAM, slower")

    group = parser.add_argument_group("SheetSage2 (audio -> ABC)")
    group.add_argument("--sheetsage-dir", default=DEFAULT_SHEETSAGE_DIR)
    group.add_argument("--sheetsage-python", default=os.environ.get("SHEETSAGE_PYTHON"),
                       help="python 3.10/3.11 venv with SheetSage2's deps and FFmpeg 6.1 on PATH "
                            "(default: this interpreter)")

    group = parser.add_argument_group("limits")
    group.add_argument("--keep-loaded", default="one", choices=["one", "both", "none"],
                       help="one: swap engines as needed (default, correct for 24 GB); "
                            "both: keep both resident (needs ~48 GB+); "
                            "none: free after every job")
    group.add_argument("--max-jobs", type=int, default=200, help="job records kept in memory")
    group.add_argument("--max-upload-mb", type=int, default=64, help="largest base64 audio upload")
    group.add_argument("--job-timeout", type=int, default=7200,
                       help="seconds before a worker subprocess is killed")
    group.add_argument("--idle-stop-minutes", type=float,
                       default=float(os.environ.get("MUSIC_IDLE_STOP_MINUTES", "0") or 0),
                       help="on RunPod, stop this pod after N minutes with no jobs and no "
                            "authorised requests (0 = never). The site can wake it again.")
    parser.add_argument("--self-test", action="store_true",
                        help="check imports, weights, ffmpeg and VRAM, print a report and exit")
    return parser


def main():
    args = build_parser().parse_args()
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s",
                        handlers=[logging.StreamHandler(stream=sys.stdout)])
    args.data_dir = os.path.abspath(args.data_dir)

    if args.self_test:
        raise SystemExit(selftest.run(args))
    if web is None:
        raise SystemExit("aiohttp is not installed: pip install -r tools/music-creator/requirements.txt")

    os.makedirs(args.data_dir, exist_ok=True)
    engines = Engines(args)
    files = FileStore(args.data_dir)
    voices = VoiceStore(args.data_dir)
    runner = Runner(args, engines, files, voices)
    jobs = JobStore(max_jobs=args.max_jobs)
    jobs.start()

    state = engines.availability()
    for name, info in state.items():
        if info["available"]:
            log.info(f"{name}: available ({info.get('mode')})")
        else:
            log.warning(f"{name}: NOT available — {info.get('reason')}")
    if not audio.ffmpeg_path():
        log.warning("ffmpeg is not on PATH: /mix, upload conversion and duration probing will fail")
    gpu = gpu_info()
    log.info(f"gpu: {gpu['name'] or 'none visible'}"
             + (f"  {gpu['vram_gb']} GB" if gpu["vram_gb"] else "")
             + f"  keep-loaded={args.keep_loaded}")
    log.info(f"Music Creator server on http://{args.host}:{args.port}  data in {args.data_dir}")

    idle = IdleStopper(args.idle_stop_minutes, jobs)
    idle.start()

    app = make_app(args, engines, jobs, runner, files, voices, idle)
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
