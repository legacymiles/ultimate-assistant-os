"""Realtime Lucy inference server.

    python server/server.py --port 8765 [--token SECRET]

Browser  --WebRTC video track-->  FrameRing  -->  CausalStream.step()  -->  GeneratedTrack  --WebRTC-->  Browser
                              \-- data channel "control": prompt / strength / keys / reset  <-- stats --/

Signalling is one HTTP POST (/offer) with the browser's SDP; media and
control ride on the peer connection. One live session at a time (there is
one GPU); a new offer replaces the previous session.
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import threading
import time
import uuid
from fractions import Fraction

import numpy as np
from aiohttp import web
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from av import VideoFrame

from common import (FrameRing, MODEL_FPS, add_model_args, build_pipeline,
                    open_stream)

log = logging.getLogger("lucy")
CLOCK = 90000


class GeneratedTrack(MediaStreamTrack):
    """Outgoing video: frames produced by the model, paced for playback.

    Frames are emitted at the model's 16 fps while the queue has them. When
    the GPU falls behind real time the queue drains; the last frame is then
    held (re-sent) so the connection stays warm, and the newly generated
    chunk plays as soon as it lands. When the queue grows past one chunk the
    pace is raised so playback catches up instead of drifting into lag.
    """

    kind = "video"

    def __init__(self, session):
        super().__init__()
        self.session = session
        self.queue: asyncio.Queue = asyncio.Queue()
        self._last = None
        self._t0 = None
        self._count = 0

    async def recv(self):
        s = self.session
        period = 1.0 / MODEL_FPS
        depth = self.queue.qsize()
        if depth > 4 * s.chunk_size:
            period /= 1.5
        try:
            item = await asyncio.wait_for(self.queue.get(), timeout=period)
            frame_rgb, meta = item
            self._last = frame_rgb
            if meta is not None:
                s.note_emitted(meta)
        except asyncio.TimeoutError:
            frame_rgb = self._last
            if frame_rgb is None:
                frame_rgb = np.zeros((s.hold_h, s.hold_w, 3), dtype=np.uint8)
        if self._t0 is None:
            self._t0 = time.time()
        vf = VideoFrame.from_ndarray(np.ascontiguousarray(frame_rgb), format="rgb24")
        vf.pts = int((time.time() - self._t0) * CLOCK)
        vf.time_base = Fraction(1, CLOCK)
        self._count += 1
        return vf


class Session:
    """One browser connection: its ring of camera frames, its stream, its stats."""

    def __init__(self, engine, pc, loop, prompt, strength, cond_mode):
        self.id = uuid.uuid4().hex[:8]
        self.engine = engine
        self.pc = pc
        self.loop = loop
        self.ring = FrameRing(fps=MODEL_FPS)
        self.prompt = prompt
        self.strength = strength
        self.cond_mode = cond_mode
        self.keys = []
        self.reset_requested = False
        self.closed = False
        self.channel = None
        self.track = GeneratedTrack(self)
        self.stream = None
        self.chunk_size = engine.args.chunk_size
        self.hold_h, self.hold_w = 288, 384
        self.reanchors = 0
        self.frames_sent = 0
        self.last_stats = {}
        self._emit_meta = {}

    # --- control channel ----------------------------------------------
    def send(self, msg):
        if self.channel and self.channel.readyState == "open":
            try:
                self.channel.send(json.dumps(msg))
            except Exception as e:  # channel closing under us
                log.debug(f"send failed: {e}")

    def send_threadsafe(self, msg):
        self.loop.call_soon_threadsafe(self.send, msg)

    def on_message(self, raw):
        try:
            msg = json.loads(raw)
        except Exception:
            return
        t = msg.get("type")
        if t == "prompt" and isinstance(msg.get("text"), str) and msg["text"].strip():
            self.prompt = msg["text"].strip()[:1000]
        elif t == "strength" and isinstance(msg.get("value"), int):
            self.strength = max(0, min(3, msg["value"]))
        elif t == "keys" and isinstance(msg.get("keys"), list):
            self.keys = [str(k)[:16] for k in msg["keys"]][:8]
        elif t == "reset":
            self.reset_requested = True
        elif t == "cond_mode" and msg.get("value") in ("sdedit", "keyframe"):
            self.cond_mode = msg["value"]
            self.reset_requested = True

    # --- output bookkeeping -------------------------------------------
    def push_frames(self, frames, capture_ts_last, step_done_ts):
        """Called from the GPU thread with a generated chunk."""
        def _push():
            for i, f in enumerate(frames):
                meta = {"capture_ts": capture_ts_last, "done_ts": step_done_ts} if i == 0 else None
                self.track.queue.put_nowait((f, meta))
        self.loop.call_soon_threadsafe(_push)

    def note_emitted(self, meta):
        now = time.time()
        self.last_stats["glass_to_glass_ms"] = round((now - meta["capture_ts"]) * 1000)
        self.last_stats["queue_wait_ms"] = round((now - meta["done_ts"]) * 1000)
        self.send({"type": "stats", **self.last_stats})

    async def close(self):
        self.closed = True
        try:
            await self.pc.close()
        except Exception:
            pass


class Engine:
    """Owns the model and the single GPU thread."""

    def __init__(self, args):
        self.args = args
        self.pipe = None
        self.ready = False
        self.session = None
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._run, name="lucy-gpu", daemon=True)
        self.load_error = None

    def start(self):
        self.thread.start()

    def _run(self):
        try:
            self.pipe = build_pipeline(self.args)
            # Encode the default prompt now so the first session does not wait.
            self.pipe.encode_prompt(self.args.prompt, disk_cache_dir=self.args.prompt_cache_dir)
            self.ready = True
            log.info("engine ready")
        except Exception as e:
            self.load_error = f"{type(e).__name__}: {e}"
            log.exception("model load failed")
            return
        while True:
            s = self.session
            if s is None or s.closed:
                time.sleep(0.02)
                continue
            try:
                self._serve(s)
            except Exception:
                log.exception("session loop crashed")
                s.send_threadsafe({"type": "error", "message": "inference loop crashed; see server log"})
                s.closed = True

    def _serve(self, s: Session):
        import torch
        stream = None
        while not s.closed:
            if stream is None or s.reset_requested or stream.needs_reanchor:
                # (Re)anchor on the newest camera frame.
                latest = s.ring.take_latest(1)
                if latest is None:
                    time.sleep(0.01)
                    continue
                anchor, _ = latest[0]
                if stream is not None:
                    s.reanchors += 1
                s.reset_requested = False
                s.send_threadsafe({"type": "status", "state": "opening",
                                   "message": "encoding prompt and anchoring on the live frame"})
                t0 = time.perf_counter()
                args = self.args
                saved = (args.strength, args.cond_mode)
                args.strength, args.cond_mode = s.strength, s.cond_mode
                try:
                    stream = open_stream(self.pipe, args, anchor, prompt=s.prompt)
                finally:
                    args.strength, args.cond_mode = saved
                s.stream = stream
                s.hold_h, s.hold_w = stream.h, stream.w
                s.ring.clear()
                info = stream.describe()
                info["open_ms"] = round((time.perf_counter() - t0) * 1000)
                info["reanchors"] = s.reanchors
                s.send_threadsafe({"type": "status", "state": "streaming", "stream": info})
                # chunk 0 starts with the anchor frame itself
                pending = [(anchor, time.time())]
            else:
                pending = []

            need = stream.frames_needed - len(pending)
            got = s.ring.take_latest(need) if need > 0 else []
            if got is None:
                time.sleep(0.005)
                continue
            items = pending + got
            frames = np.stack([f for f, _ in items])
            capture_ts_last = items[-1][1]

            # live controls
            if s.prompt != stream.prompt:
                s.send_threadsafe({"type": "status", "state": "prompt", "message": "encoding new prompt"})
                stream.set_prompt(s.prompt)
                s.send_threadsafe({"type": "status", "state": "streaming", "stream": stream.describe()})
            if s.strength != stream.strength:
                stream.set_strength(s.strength)
            stream.set_keys(s.keys)

            out, stats = stream.step(frames)
            done = time.time()
            s.push_frames(list(out), capture_ts_last, done)
            s.frames_sent += len(out)
            s.last_stats = {
                **{k: (round(v, 1) if isinstance(v, float) else v) for k, v in stats.items()},
                "ring": len(s.ring),
                "cam_received": s.ring.received,
                "cam_kept": s.ring.kept,
                "frames_sent": s.frames_sent,
                "reanchors": s.reanchors,
                "vram_reserved_mb": round(torch.cuda.memory_reserved() / 1e6),
                "keys": s.keys,
            }
            s.send_threadsafe({"type": "stats", **s.last_stats})


def make_app(engine: Engine, token: str | None):
    app = web.Application(client_max_size=2 * 1024 * 1024)
    pcs = set()

    def cors(resp):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Headers"] = "content-type, authorization"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return resp

    def authorized(req, body=None):
        if not token:
            return True
        hdr = req.headers.get("authorization", "")
        if hdr.lower().startswith("bearer ") and hdr[7:].strip() == token:
            return True
        return bool(body) and body.get("token") == token

    async def options(_req):
        return cors(web.Response(status=204))

    async def health(req):
        import torch
        info = {
            "ok": True,
            "name": "realtime-lucy",
            "ready": engine.ready,
            "error": engine.load_error,
            "model": os.path.basename(engine.args.ckpt_dir),
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "config": {
                "size": engine.args.size, "chunk_size": engine.args.chunk_size,
                "local_attn_size": engine.args.local_attn_size, "sink_size": engine.args.sink_size,
                "vae_dtype": engine.args.vae_dtype, "fps": MODEL_FPS,
            },
            "session": engine.session.id if engine.session and not engine.session.closed else None,
            "auth": bool(token),
        }
        return cors(web.json_response(info))

    async def offer(req):
        body = await req.json()
        if not authorized(req, body):
            return cors(web.json_response({"error": "bad token"}, status=401))
        if not engine.ready:
            msg = engine.load_error or "model still loading"
            return cors(web.json_response({"error": msg}, status=503))
        if engine.session and not engine.session.closed:
            log.info(f"replacing session {engine.session.id}")
            await engine.session.close()
            engine.session = None

        pc = RTCPeerConnection()
        pcs.add(pc)
        loop = asyncio.get_event_loop()
        session = Session(
            engine, pc, loop,
            prompt=(body.get("prompt") or engine.args.prompt),
            strength=int(body.get("strength", engine.args.strength)),
            cond_mode=body.get("cond_mode", engine.args.cond_mode),
        )

        @pc.on("datachannel")
        def on_datachannel(channel):
            session.channel = channel

            @channel.on("message")
            def on_message(m):
                session.on_message(m)

            channel.send(json.dumps({"type": "status", "state": "connected",
                                     "message": "waiting for camera frames"}))

        @pc.on("connectionstatechange")
        async def on_state():
            log.info(f"session {session.id} connection {pc.connectionState}")
            if pc.connectionState in ("failed", "closed", "disconnected"):
                session.closed = True
                if engine.session is session:
                    engine.session = None
                pcs.discard(pc)

        @pc.on("track")
        def on_track(track):
            if track.kind != "video":
                return
            log.info(f"session {session.id} camera track received")

            async def pump():
                try:
                    while not session.closed:
                        frame = await track.recv()
                        session.ring.push(frame.to_ndarray(format="rgb24"), time.time())
                except Exception as e:
                    log.info(f"camera track ended: {e}")
                    session.closed = True
            asyncio.ensure_future(pump())

        pc.addTrack(session.track)
        await pc.setRemoteDescription(RTCSessionDescription(sdp=body["sdp"], type=body["type"]))
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        engine.session = session
        log.info(f"session {session.id} started")
        return cors(web.json_response({
            "sdp": pc.localDescription.sdp, "type": pc.localDescription.type, "session": session.id,
        }))

    async def on_shutdown(_app):
        for pc in list(pcs):
            await pc.close()

    app.router.add_route("OPTIONS", "/{tail:.*}", options)
    app.router.add_get("/health", health)
    app.router.add_post("/offer", offer)
    app.on_shutdown.append(on_shutdown)
    return app


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_model_args(p)
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--token", default=os.environ.get("LUCY_TOKEN"),
                   help="if set, /offer requires this token (header or body)")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="[%(asctime)s] %(levelname)s: %(message)s",
                        handlers=[logging.StreamHandler(stream=sys.stdout)])
    engine = Engine(args)
    engine.start()
    log.info(f"Realtime Lucy server on http://{args.host}:{args.port}  (model loading in background)")
    web.run_app(make_app(engine, args.token), host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
