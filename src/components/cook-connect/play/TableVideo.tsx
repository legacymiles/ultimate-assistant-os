"use client";

// Video at the spades table (owner's rule, Oct 2026):
//  - every player on video shows live on their own seat, in place of their avatar;
//  - only ONE video is ever enlarged (the spotlight), in its own strip above
//    the table, so it never covers the felt, the trick or your hand;
//  - tap someone's seat video to enlarge them; tap the enlarged one to shrink it.
//
// The call itself is one `useVideoCall` per table, owned by SpadesRoom. Every
// <video> here is muted — sound comes from one hidden <audio> per person, so
// showing the same stream on a seat AND in the spotlight never doubles the audio.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { useVideoCall, RemoteFeed } from "@/lib/cook-connect/hooks/useVideoCall";
import {
  NO_SPOTLIGHT, resolveSpotlight, seatsOnVideo, tapSpotlight, type SeatPerson, type Spotlight,
} from "@/lib/cook-connect/videoSeats";
import { Avatar, Button, IconButton, Spinner, cx } from "../ui";
import { CloseIcon, HangUpIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "../icons";

type Call = ReturnType<typeof useVideoCall>;

/** What a seat needs to draw its own live video. */
export interface SeatVideo {
  userId: string;
  name: string;
  avatar: string | null;
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  isMe: boolean;
  connecting: boolean;
  spotlit: boolean;
  onTap: () => void;
}

interface Person extends SeatPerson { name: string; avatar: string | null }

/** Joins the call to the seats and keeps the one-spotlight rule. */
export function useSeatVideo(call: Call, table: Person[], myId: string | null) {
  const [spot, setSpot] = useState<Spotlight>(NO_SPOTLIGHT);
  const me = myId ?? "";

  const bySeatId = useMemo(
    () => seatsOnVideo(table, call.remoteFeeds, { userId: me, joined: call.joined }),
    [table, call.remoteFeeds, me, call.joined],
  );
  const onVideo = useMemo(() => [...bySeatId.values()], [bySeatId]);

  // Keep the spotlight valid as people join, leave or turn cameras on and off.
  useEffect(() => {
    setSpot((s) => {
      const next = resolveSpotlight(s, onVideo, call.remoteFeeds, me);
      return next.userId === s.userId && next.chosen === s.chosen ? s : next;
    });
  }, [onVideo, call.remoteFeeds, me]);

  const tap = useCallback((userId: string) => setSpot((s) => tapSpotlight(s, userId)), []);
  const close = useCallback(() => setSpot({ userId: null, chosen: true }), []);

  const feedOf = useCallback((userId: string): Omit<SeatVideo, "spotlit" | "onTap"> | null => {
    const person = table.find((t) => t.userId === userId);
    if (userId === me && call.joined) {
      return {
        userId, isMe: true, name: "You", avatar: call.me.avatar,
        stream: call.localStream, micOn: call.micOn, camOn: call.camOn, connecting: false,
      };
    }
    const f = call.remoteFeeds.find((r: RemoteFeed) => r.userId === userId);
    if (!f) return null;
    return {
      userId, isMe: false, name: person?.name ?? f.name, avatar: person?.avatar ?? f.avatar,
      stream: f.stream, micOn: f.micOn, camOn: f.camOn, connecting: !f.stream && f.state !== "failed",
    };
  }, [table, me, call]);

  /** Seat number → its live video, for the seat pods. */
  const seatVideo = useMemo(() => {
    const out: Record<number, SeatVideo> = {};
    for (const [seat, userId] of bySeatId) {
      const f = feedOf(userId);
      if (f) out[seat] = { ...f, spotlit: spot.userId === userId, onTap: () => tap(userId) };
    }
    return out;
  }, [bySeatId, feedOf, spot.userId, tap]);

  const spotlit = spot.userId ? feedOf(spot.userId) : null;
  return { seatVideo, spotlit, onVideoCount: onVideo.length, close, tap };
}

/* ── The live picture ─────────────────────────────────────────── */

function Live({
  stream, camOn, mirrored, className,
}: { stream: MediaStream | null; camOn: boolean; mirrored?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  const show = !!stream && camOn && stream.getVideoTracks().length > 0;
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cx("h-full w-full object-cover", mirrored && "-scale-x-100", !show && "hidden", className)}
    />
  );
}

/** One hidden player per person, so voices play once however many tiles show them. */
export function CallAudio({ feeds }: { feeds: RemoteFeed[] }) {
  return (
    <div aria-hidden="true" className="hidden">
      {feeds.map((f) => <Voice key={f.peerId} stream={f.stream} />)}
    </div>
  );
}

function Voice({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

/* ── On the seat ──────────────────────────────────────────────── */

/** The live circle that replaces a seat's avatar while that player is on video. */
export function SeatVideoBubble({ v }: { v: SeatVideo }) {
  const showVideo = !!v.stream && v.camOn && v.stream.getVideoTracks().length > 0;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); v.onTap(); }}
      className={cx("hx-vbubble", v.spotlit && "is-spot")}
      aria-pressed={v.spotlit}
      aria-label={v.spotlit ? `Shrink ${v.name}'s video` : `Enlarge ${v.name}'s video`}
      title={v.spotlit ? "Shrink" : "Enlarge"}
    >
      <Live stream={v.stream} camOn={v.camOn} mirrored={v.isMe} />
      {!showVideo && <Avatar id={v.userId} name={v.name} url={v.avatar} size={44} />}
      {v.connecting && <span className="hx-vbubble-busy"><Spinner size={12} /></span>}
      {!v.micOn && <span className="hx-vbubble-mute" title="Muted"><MicOffIcon size={9} /></span>}
    </button>
  );
}

/* ── The spotlight strip above the table ──────────────────────── */

export function VideoStage({
  call, spotlit, onVideoCount, onClose, waiting, place = "top", className,
}: {
  /** "top" = the strip above the table (phone/tablet); "rail" = the side column on a laptop. */
  place?: "top" | "rail";
  className?: string;
  call: Call;
  spotlit: Omit<SeatVideo, "spotlit" | "onTap"> | null;
  onVideoCount: number;
  onClose: () => void;
  waiting?: boolean;
}) {
  const { joined, joining, error, othersInCall } = call;
  const controls = joined && (
    <div className="flex shrink-0 items-center gap-1">
      <IconButton label={call.micOn ? "Mute microphone" : "Unmute microphone"} active={!call.micOn} onClick={call.toggleMic}>
        {call.micOn ? <MicIcon size={15} /> : <MicOffIcon size={15} />}
      </IconButton>
      <IconButton
        label={call.camOn ? "Turn camera off" : "Turn camera on"}
        active={!call.camOn}
        disabled={!call.localStream?.getVideoTracks().length}
        onClick={call.toggleCam}
      >
        {call.camOn ? <VideoIcon size={15} /> : <VideoOffIcon size={15} />}
      </IconButton>
      <button
        type="button"
        onClick={() => void call.leave()}
        aria-label="Leave video chat"
        title="Leave video chat"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#5d2338]
                   bg-[#2a131d] text-[var(--cc-loss)] transition-colors duration-150 hover:bg-[#361824]"
      >
        <HangUpIcon size={15} />
      </button>
    </div>
  );

  // Not on video yet: one slim line, so the table keeps its room.
  if (!joined) {
    const waitingN = othersInCall.length;
    return (
      <div className={cx("hx-vstage is-slim", `is-${place}`, className)}>
        {waitingN > 0 && (
          <span className="flex shrink-0 -space-x-1.5">
            {othersInCall.slice(0, 4).map((p) => (
              <span key={p.peerId} className="rounded-full border-2 border-[var(--cc-panel)]" title={p.name}>
                <Avatar id={p.userId || p.peerId} name={p.name} url={p.avatar} size={22} />
              </span>
            ))}
          </span>
        )}
        <p className={cx("min-w-0 flex-1 text-[12px] leading-snug", error ? "text-[var(--cc-loss)]" : "text-[var(--cc-ink-muted)]")}>
          {error ?? (waitingN > 0
            ? `${othersInCall.map((p) => p.name.split(" ")[0]).join(", ")} ${waitingN === 1 ? "is" : "are"} on video.`
            : waiting ? "Say hello on video while you wait." : "Video chat at the table — everyone shows on their own seat.")}
        </p>
        <Button variant="primary" className="shrink-0" disabled={joining} onClick={() => void call.join()}>
          {joining ? <Spinner size={13} /> : <VideoIcon size={13} />}
          {joining ? "Starting" : waitingN > 0 ? "Join video" : "Start video"}
        </Button>
      </div>
    );
  }

  // On video, nobody enlarged: a slim line with the controls.
  if (!spotlit) {
    return (
      <div className={cx("hx-vstage is-slim", `is-${place}`, className)}>
        <p className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--cc-ink-muted)]">
          <span className="cc-num font-semibold text-[var(--cc-ink)]">{onVideoCount}</span> on video · tap anyone&rsquo;s
          video on the table to make it big.
        </p>
        {controls}
      </div>
    );
  }

  const showVideo = !!spotlit.stream && spotlit.camOn && spotlit.stream.getVideoTracks().length > 0;
  return (
    <div className={cx("hx-vstage", `is-${place}`, className)}>
      <div className="hx-vstage-tile">
        <Live stream={spotlit.stream} camOn={spotlit.camOn} mirrored={spotlit.isMe} />
        {!showVideo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Avatar id={spotlit.userId} name={spotlit.name} url={spotlit.avatar} size={72} />
            <span className="text-[12px] text-white/60">{spotlit.camOn ? "Connecting…" : "Camera off"}</span>
          </div>
        )}
        {spotlit.connecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white/80"><Spinner size={18} /></div>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-6">
          {!spotlit.micOn && <span className="text-[var(--cc-loss)]" title="Muted"><MicOffIcon size={13} /></span>}
          <span className="truncate text-[13px] font-semibold text-white">{spotlit.name}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Shrink this video"
          title="Shrink"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white/85
                     backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="hx-vstage-side">
        <p className="text-[12px] leading-snug text-[var(--cc-ink-muted)]">
          <span className="cc-num font-semibold text-[var(--cc-ink)]">{onVideoCount}</span> on video. Only one video is big at
          a time — tap another player&rsquo;s seat to swap.
        </p>
        {controls}
      </div>
    </div>
  );
}
