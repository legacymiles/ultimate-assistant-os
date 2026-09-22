"use client";

// Video chat beside the board. Before you join it is a one-line invitation
// that says who is already on; after you join it is a strip of tiles and three
// controls. Nothing here is a modal — you are meant to keep playing.

import { useEffect, useRef } from "react";
import { useCook } from "../CookConnect";
import { useVideoCall, type RemoteFeed } from "@/lib/cook-connect/hooks/useVideoCall";
import { Avatar, Button, IconButton, Panel, SectionHead, Spinner, cx } from "../ui";
import { HangUpIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "../icons";

function Tile({
  stream, name, id, avatar, muted, mirrored, micOn, camOn, connecting,
}: {
  stream: MediaStream | null;
  name: string;
  id: string;
  avatar: string | null;
  muted?: boolean;
  mirrored?: boolean;
  micOn: boolean;
  camOn: boolean;
  connecting?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);

  const showVideo = !!stream && camOn && stream.getVideoTracks().length > 0;

  return (
    <div className="relative aspect-[4/3] shrink-0 overflow-hidden rounded-lg border border-[var(--cc-line)] bg-[#0d0f16]">
      {/* Audio still plays through the element when the camera is off. */}
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={cx(
          "h-full w-full object-cover",
          mirrored && "-scale-x-100",
          !showVideo && "invisible absolute",
        )}
      />
      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar id={id} name={name} url={avatar} size={40} />
        </div>
      )}
      {connecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white/80">
          <Spinner size={16} />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4">
        {!micOn && <span className="shrink-0 text-[var(--cc-loss)]" title="Muted"><MicOffIcon size={11} /></span>}
        <span className="truncate text-[10px] font-semibold text-white">{name}</span>
      </div>
    </div>
  );
}

export function VideoPanel({ room, title = "Video" }: { room: string; title?: string }) {
  const { sb, profile } = useCook();
  const call = useVideoCall(sb, profile, room);
  const { joined, joining, error, othersInCall } = call;

  if (!joined) {
    const waiting = othersInCall.length;
    return (
      <Panel>
        <SectionHead title={title} count={waiting > 0 ? `${waiting} on` : undefined} />
        <div className="flex items-center gap-2.5 p-3">
          {waiting > 0 && (
            <span className="flex shrink-0 -space-x-1.5">
              {othersInCall.slice(0, 4).map((p) => (
                <span key={p.peerId} className="rounded-full border-2 border-[var(--cc-panel)]" title={p.name}>
                  <Avatar id={p.userId || p.peerId} name={p.name} url={p.avatar} size={22} />
                </span>
              ))}
            </span>
          )}
          <p className={cx(
            "min-w-0 flex-1 text-[12px] leading-snug",
            error ? "text-[var(--cc-loss)]" : "text-[var(--cc-ink-muted)]",
          )}>
            {error ?? (waiting > 0
              ? `${othersInCall.map((p) => p.name).join(", ")} ${waiting === 1 ? "is" : "are"} on video.`
              : "Talk face to face while you play.")}
          </p>
          <Button variant="primary" className="shrink-0" disabled={joining} onClick={() => void call.join()}>
            {joining ? <Spinner size={13} /> : <VideoIcon size={13} />}
            {joining ? "Starting" : waiting > 0 ? "Join" : "Start"}
          </Button>
        </div>
      </Panel>
    );
  }

  const failed = call.remoteFeeds.some((f) => f.state === "failed");
  const count = call.remoteFeeds.length + 1;

  return (
    <Panel>
      <SectionHead title={title} count={`${count} on`} />
      <div className="p-2">
        <div className={cx("grid gap-1.5", count === 1 ? "grid-cols-1" : "grid-cols-2")}>
          <Tile
            key="me"
            id={profile?.id ?? "me"}
            stream={call.localStream}
            name={`${call.me.name} (you)`}
            avatar={call.me.avatar}
            muted
            mirrored
            micOn={call.micOn}
            camOn={call.camOn}
          />
          {call.remoteFeeds.map((f: RemoteFeed) => (
            <Tile
              key={f.peerId}
              id={f.userId || f.peerId}
              stream={f.stream}
              name={f.name}
              avatar={f.avatar}
              micOn={f.micOn}
              camOn={f.camOn}
              connecting={!f.stream && f.state !== "failed"}
            />
          ))}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--cc-ink-faint)]">
            {failed
              ? "Could not reach someone — their network may be blocking video."
              : count === 1
                ? "You are first. Others appear as they join."
                : `${count} on video.`}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label={call.micOn ? "Mute microphone" : "Unmute microphone"}
              active={!call.micOn}
              onClick={call.toggleMic}
            >
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
        </div>
      </div>
    </Panel>
  );
}
