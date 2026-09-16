// Realtime Lucy — browser side of the WebRTC session.
//
// The webcam MediaStream goes out as a video track, the model's frames come
// back as a video track, and a "control" data channel carries prompt /
// strength / key changes out and stats back. Signalling is a single POST of
// the offer; the server answers in the same response.

import type { ControlMessage, Health, ServerMessage, Strength, CondMode } from "./protocol";

export interface ConnectOptions {
  /** e.g. http://localhost:8765, or "" to go through this site's /api/realtime-lucy proxy. */
  serverUrl: string;
  token?: string;
  camera: MediaStream;
  prompt: string;
  strength: Strength;
  condMode: CondMode;
  onMessage: (msg: ServerMessage) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
}

export interface LucyConnection {
  pc: RTCPeerConnection;
  send: (msg: ControlMessage) => void;
  close: () => void;
}

function base(serverUrl: string) {
  const url = serverUrl.trim().replace(/\/+$/, "");
  return url ? url : "/api/realtime-lucy";
}

export async function fetchHealth(serverUrl: string, token?: string): Promise<Health> {
  const res = await fetch(`${base(serverUrl)}/health`, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}

function waitForIce(pc: RTCPeerConnection, timeoutMs = 1500) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

export async function connectLucy(opts: ConnectOptions): Promise<LucyConnection> {
  const isLocal = /^(https?:\/\/)?(localhost|127\.0\.0\.1)/.test(opts.serverUrl.trim()) || !opts.serverUrl.trim();
  const pc = new RTCPeerConnection({
    iceServers: isLocal ? [] : [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const dc = pc.createDataChannel("control", { ordered: true });
  dc.onmessage = (ev) => {
    try {
      opts.onMessage(JSON.parse(ev.data as string) as ServerMessage);
    } catch {
      /* ignore malformed */
    }
  };
  const remote = new MediaStream();
  pc.ontrack = (ev) => {
    remote.addTrack(ev.track);
    opts.onRemoteStream(remote);
  };
  pc.onconnectionstatechange = () => opts.onConnectionState(pc.connectionState);

  for (const track of opts.camera.getVideoTracks()) pc.addTrack(track, opts.camera);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc);

  const res = await fetch(`${base(opts.serverUrl)}/offer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify({
      sdp: pc.localDescription?.sdp,
      type: pc.localDescription?.type,
      prompt: opts.prompt,
      strength: opts.strength,
      cond_mode: opts.condMode,
      token: opts.token || undefined,
    }),
  });
  if (!res.ok) {
    pc.close();
    let detail = `${res.status}`;
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail;
    } catch {
      /* keep status */
    }
    throw new Error(detail);
  }
  const answer = (await res.json()) as RTCSessionDescriptionInit;
  await pc.setRemoteDescription(answer);

  return {
    pc,
    send(msg) {
      if (dc.readyState === "open") dc.send(JSON.stringify(msg));
    },
    close() {
      try {
        dc.close();
      } catch {
        /* already closed */
      }
      pc.close();
    },
  };
}
