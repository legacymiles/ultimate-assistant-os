"use client";

// In-app video chat: a WebRTC mesh — everyone connects to everyone, which is
// fine up to about eight people — signalled over a realtime channel. No video
// touches our servers; the channel only carries offers, answers and ICE.
//
// Presence tells the room who is here and who has their camera on, so the UI
// can say "2 on video" before you decide whether to join.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Backend = any;

export interface CallPeer {
  peerId: string;
  userId: string;
  name: string;
  avatar: string | null;
  inCall: boolean;
}

export interface RemoteFeed {
  peerId: string;
  userId: string;
  name: string;
  avatar: string | null;
  stream: MediaStream | null;
  state: RTCPeerConnectionState | "new";
  micOn: boolean;
  camOn: boolean;
}

type Signal =
  | { kind: "offer" | "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; to: string; candidate: RTCIceCandidateInit };

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  // Optional relay for networks that block peer-to-peer (some offices, carriers).
  const turn = process.env.NEXT_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn.split(","),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

export function useVideoCall(sb: Backend, profile: Profile | null, room: string | null) {
  const peerId = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2),
  ).current;

  const [roster, setRoster] = useState<CallPeer[]>([]);
  const [remotes, setRemotes] = useState<Record<string, RemoteFeed>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null);
  const subscribed = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const pendingIce = useRef(new Map<string, RTCIceCandidateInit[]>());
  const rosterRef = useRef<CallPeer[]>([]);
  const mediaFlags = useRef({ micOn: true, camOn: true });
  const me = useRef({ name: "You", avatar: null as string | null });
  me.current = {
    name: profile?.display_name ?? "You",
    avatar: profile?.avatar_url ?? null,
  };

  const send = useCallback((signal: Signal) => {
    channelRef.current?.send({ type: "broadcast", event: "signal", payload: signal });
  }, []);

  const track = useCallback(async () => {
    if (!channelRef.current || !subscribed.current || !profile) return;
    await channelRef.current.track({
      userId: profile.id,
      name: me.current.name,
      avatar: me.current.avatar,
      inCall: joinedRef.current,
      micOn: mediaFlags.current.micOn,
      camOn: mediaFlags.current.camOn,
    });
  }, [profile]);

  const patchRemote = useCallback((id: string, patch: Partial<RemoteFeed>) => {
    setRemotes((prev) => {
      const peer = rosterRef.current.find((p) => p.peerId === id);
      const base: RemoteFeed = prev[id] ?? {
        peerId: id, userId: peer?.userId ?? "", name: peer?.name ?? "Member",
        avatar: peer?.avatar ?? null, stream: null, state: "new", micOn: true, camOn: true,
      };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }, []);

  const closePeer = useCallback((id: string) => {
    pcs.current.get(id)?.close();
    pcs.current.delete(id);
    pendingIce.current.delete(id);
    setRemotes((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const createPeer = useCallback((id: string) => {
    pcs.current.get(id)?.close();
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    pcs.current.set(id, pc);
    streamRef.current?.getTracks().forEach((t) => pc.addTrack(t, streamRef.current!));
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ kind: "ice", from: peerId, to: id, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => patchRemote(id, { stream: e.streams[0] ?? new MediaStream([e.track]) });
    pc.onconnectionstatechange = () => patchRemote(id, { state: pc.connectionState });
    patchRemote(id, { state: "new" });
    return pc;
  }, [patchRemote, peerId, send]);

  const flushIce = useCallback(async (id: string, pc: RTCPeerConnection) => {
    const queued = pendingIce.current.get(id) ?? [];
    pendingIce.current.delete(id);
    for (const c of queued) await pc.addIceCandidate(c).catch(() => {});
  }, []);

  const callPeer = useCallback(async (id: string) => {
    const pc = createPeer(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ kind: "offer", from: peerId, to: id, sdp: offer });
  }, [createPeer, peerId, send]);

  const onSignal = useCallback(async (s: Signal) => {
    if (s.to !== peerId || !joinedRef.current) return;
    try {
      if (s.kind === "offer") {
        const pc = createPeer(s.from);
        await pc.setRemoteDescription(s.sdp);
        await flushIce(s.from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ kind: "answer", from: peerId, to: s.from, sdp: answer });
      } else if (s.kind === "answer") {
        const pc = pcs.current.get(s.from);
        if (!pc || pc.signalingState !== "have-local-offer") return;
        await pc.setRemoteDescription(s.sdp);
        await flushIce(s.from, pc);
      } else if (s.kind === "ice") {
        const pc = pcs.current.get(s.from);
        if (pc?.remoteDescription) await pc.addIceCandidate(s.candidate).catch(() => {});
        else pendingIce.current.set(s.from, [...(pendingIce.current.get(s.from) ?? []), s.candidate]);
      }
    } catch {
      // A failed negotiation shows as a stuck tile; it must not break the room.
    }
  }, [createPeer, flushIce, peerId, send]);

  /**
   * Connect to everyone in the call we are not connected to yet. The peer with
   * the smaller id always makes the offer, so two peers never both offer.
   */
  const reconcile = useCallback(() => {
    const inCall = rosterRef.current.filter((p) => p.inCall && p.peerId !== peerId);
    const ids = new Set(inCall.map((p) => p.peerId));
    for (const id of [...pcs.current.keys()]) {
      if (!ids.has(id) || !joinedRef.current) closePeer(id);
    }
    if (!joinedRef.current) return;
    for (const p of inCall) {
      if (!pcs.current.has(p.peerId) && peerId < p.peerId) void callPeer(p.peerId);
    }
  }, [callPeer, closePeer, peerId]);

  useEffect(() => {
    if (!room || !profile) return;
    const channel = sb.channel(`call:${room}`, {
      config: { presence: { key: peerId }, broadcast: { self: false } },
    });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, Record<string, unknown>[]>;
        const list: CallPeer[] = Object.entries(state).map(([key, metas]) => {
          const m = (metas[metas.length - 1] ?? {}) as Record<string, unknown>;
          return {
            peerId: key,
            userId: String(m.userId ?? ""),
            name: String(m.name ?? "Member"),
            avatar: (m.avatar as string | null) ?? null,
            inCall: !!m.inCall,
          };
        });
        rosterRef.current = list;
        setRoster(list);
        // Keep names and mic/cam badges on the tiles current.
        setRemotes((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [key, metas] of Object.entries(state)) {
            const m = (metas[metas.length - 1] ?? {}) as Record<string, unknown>;
            if (next[key]) {
              next[key] = {
                ...next[key],
                name: String(m.name ?? next[key].name),
                avatar: (m.avatar as string | null) ?? null,
                micOn: m.micOn !== false,
                camOn: m.camOn !== false,
              };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
        reconcile();
      })
      .on("broadcast", { event: "signal" }, ({ payload }: { payload: unknown }) => {
        void onSignal(payload as Signal);
      })
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          subscribed.current = true;
          void track();
        }
      });
    return () => {
      subscribed.current = false;
      channelRef.current = null;
      sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, room, profile?.id]);

  // Re-announce once the profile name lands.
  useEffect(() => { void track(); }, [track]);

  const join = useCallback(async () => {
    setError(null);
    setJoining(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (e) {
        // No camera, or it is busy: fall back to voice only rather than failing.
        const name = (e as { name?: string })?.name;
        if (name === "NotFoundError" || name === "NotReadableError" || name === "OverconstrainedError") {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else throw e;
      }
      streamRef.current = stream;
      setLocalStream(stream);
      const hasVideo = stream.getVideoTracks().length > 0;
      mediaFlags.current = { micOn: true, camOn: hasVideo };
      setMicOn(true);
      setCamOn(hasVideo);
      joinedRef.current = true;
      setJoined(true);
      await track();
      reconcile();
    } catch (e) {
      const name = (e as { name?: string; message?: string })?.name
        ?? (e as { message?: string })?.message;
      setError(
        name === "NotAllowedError"
          ? "Camera and mic are blocked. Allow them in your browser's site settings, then try again."
          : name === "insecure"
            ? "Video chat needs a secure (https) page."
            : name === "NotFoundError"
              ? "No camera or microphone was found on this device."
              : "Couldn't start your camera. Close other apps using it and try again.",
      );
    } finally {
      setJoining(false);
    }
  }, [reconcile, track]);

  const leave = useCallback(async () => {
    joinedRef.current = false;
    setJoined(false);
    for (const id of [...pcs.current.keys()]) closePeer(id);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLocalStream(null);
    await track();
  }, [closePeer, track]);

  const toggleMic = useCallback(() => {
    const next = !mediaFlags.current.micOn;
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
    mediaFlags.current.micOn = next;
    setMicOn(next);
    void track();
  }, [track]);

  const toggleCam = useCallback(() => {
    if (!streamRef.current?.getVideoTracks().length) return;
    const next = !mediaFlags.current.camOn;
    streamRef.current.getVideoTracks().forEach((t) => { t.enabled = next; });
    mediaFlags.current.camOn = next;
    setCamOn(next);
    void track();
  }, [track]);

  // Hang up and release the camera when the screen goes away.
  useEffect(() => () => {
    joinedRef.current = false;
    pcs.current.forEach((pc) => pc.close());
    pcs.current.clear();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const inCall = roster.filter((p) => p.inCall);
  const others = inCall.filter((p) => p.peerId !== peerId);
  const remoteFeeds: RemoteFeed[] = others.map((p) => remotes[p.peerId] ?? {
    peerId: p.peerId, userId: p.userId, name: p.name, avatar: p.avatar,
    stream: null, state: "new" as const, micOn: true, camOn: true,
  });

  return {
    me: me.current, joined, joining, error, localStream, micOn, camOn,
    roster, inCallCount: inCall.length, othersInCall: others, remoteFeeds,
    join, leave, toggleMic, toggleCam,
  };
}
