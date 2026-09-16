"""End-to-end WebRTC check without a browser: send the real webcam to the
running Realtime Lucy server exactly as the page does (offer → answer,
video sendrecv, "control" data channel), record what comes back.

    python server/client_test.py --seconds 40 --out bench/client-test.mp4

Prints every stats message the server sends and writes the received
generated frames to an MP4, so the transport (aiortc both ends, VP8/H264
encode/decode, pacing, data channel) is exercised, not just the model.
"""

import argparse
import asyncio
import json
import os
import sys
import time

import cv2
import numpy as np
from aiohttp import ClientSession
from aiortc import RTCPeerConnection, RTCSessionDescription, VideoStreamTrack
from av import VideoFrame


class WebcamTrack(VideoStreamTrack):
    def __init__(self, index=0, width=640, height=480):
        super().__init__()
        self.cap = cv2.VideoCapture(index, cv2.CAP_DSHOW if os.name == "nt" else 0)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        if not self.cap.isOpened():
            raise SystemExit("no webcam")
        self.sent = 0

    async def recv(self):
        pts, time_base = await self.next_timestamp()
        ok, bgr = await asyncio.get_event_loop().run_in_executor(None, self.cap.read)
        if not ok:
            raise RuntimeError("webcam read failed")
        frame = VideoFrame.from_ndarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), format="rgb24")
        frame.pts, frame.time_base = pts, time_base
        self.sent += 1
        return frame


async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--server", default="http://localhost:8765")
    p.add_argument("--seconds", type=float, default=40)
    p.add_argument("--prompt", default=None)
    p.add_argument("--strength", type=int, default=2)
    p.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "bench", "client-test.mp4"))
    p.add_argument("--token", default=None)
    args = p.parse_args()

    pc = RTCPeerConnection()
    cam = WebcamTrack()
    pc.addTrack(cam)
    dc = pc.createDataChannel("control")
    stats = []
    received = []
    unique = set()
    t_first = None

    @dc.on("message")
    def on_msg(m):
        msg = json.loads(m)
        if msg.get("type") == "stats":
            stats.append(msg)
            print(f"stats: chunk {msg.get('chunk_id')} total {msg.get('total_ms')} ms "
                  f"gen_fps {msg.get('gen_fps')} g2g {msg.get('glass_to_glass_ms', '—')} ms "
                  f"queue_wait {msg.get('queue_wait_ms', '—')} ms sent {msg.get('frames_sent')}")
        else:
            print("server:", msg)

    @pc.on("track")
    def on_track(track):
        async def pump():
            nonlocal t_first
            while True:
                try:
                    f = await track.recv()
                except Exception:
                    return
                arr = f.to_ndarray(format="rgb24")
                if t_first is None:
                    t_first = time.time()
                    print(f"first generated frame {arr.shape[1]}x{arr.shape[0]} after {t_first - t0:.1f}s")
                received.append(arr)
                unique.add(hash(arr[::16, ::16].tobytes()))
        asyncio.ensure_future(pump())

    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    body = {"sdp": pc.localDescription.sdp, "type": pc.localDescription.type,
            "strength": args.strength, "token": args.token}
    if args.prompt:
        body["prompt"] = args.prompt
    t0 = time.time()
    async with ClientSession() as s:
        async with s.post(f"{args.server}/offer", json=body) as r:
            if r.status != 200:
                raise SystemExit(f"offer failed: {r.status} {await r.text()}")
            ans = await r.json()
    await pc.setRemoteDescription(RTCSessionDescription(sdp=ans["sdp"], type=ans["type"]))
    print("session", ans.get("session"), "— streaming for", args.seconds, "s")
    await asyncio.sleep(args.seconds)
    await pc.close()
    cam.cap.release()

    print(f"\ncamera frames sent: {cam.sent}; generated frames received: {len(received)} "
          f"({len(unique)} distinct); stats messages: {len(stats)}")
    if received:
        import imageio
        # frames before the stream opened are the server's black hold frames
        # at its default size; write everything at the generated size.
        h, w = received[-1].shape[:2]
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        with imageio.get_writer(args.out, fps=16, codec="libx264", quality=8, macro_block_size=1) as wr:
            for fr in received:
                if fr.shape[:2] != (h, w):
                    fr = cv2.resize(fr, (w, h), interpolation=cv2.INTER_AREA)
                wr.append_data(fr)
        print("wrote", args.out)
    if stats:
        g2g = [s["glass_to_glass_ms"] for s in stats if "glass_to_glass_ms" in s]
        tot = [s["total_ms"] for s in stats if "total_ms" in s]
        print(f"mean step {np.mean(tot):.0f} ms; glass-to-glass min/mean {min(g2g) if g2g else '—'}/"
              f"{np.mean(g2g) if g2g else float('nan'):.0f} ms over {len(g2g)} chunks")
    ok = len(received) > 0 and len(unique) > 1 and len(stats) > 0
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
