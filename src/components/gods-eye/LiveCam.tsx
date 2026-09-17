"use client";

import { useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// One CCTV feed, as live as its agency allows:
//
//   1. HLS live video (Caltrans, NYSDOT, Nevada, Wisconsin, Louisiana) through
//      hls.js, or natively on Safari.
//   2. TfL's short mp4 clips.
//   3. Everyone else publishes a still. It is polled every second; when the
//      host allows cross-origin reads (most do) the poll is conditional, so a
//      frame is only decoded and swapped in when the agency actually published
//      a new one — and `onFrame` reports how often that really happens.
//      Some agencies republish every ~3 s (NYC DOT), others every minute or two.
// ---------------------------------------------------------------------------

const HLS_URL = "https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js";
const STILL_POLL_MS = 1_000;

interface HlsInstance {
  loadSource(url: string): void;
  attachMedia(el: HTMLMediaElement): void;
  on(event: string, cb: (event: string, data: { fatal?: boolean }) => void): void;
  destroy(): void;
}
interface HlsCtor {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string; MANIFEST_PARSED: string };
}

let hlsLoading: Promise<HlsCtor> | null = null;
function loadHls(): Promise<HlsCtor> {
  const w = window as unknown as { Hls?: HlsCtor };
  if (w.Hls) return Promise.resolve(w.Hls);
  hlsLoading ??= new Promise<HlsCtor>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = HLS_URL;
    s.async = true;
    s.onload = () => (w.Hls ? resolve(w.Hls) : reject(new Error("hls.js did not initialise")));
    s.onerror = () => {
      hlsLoading = null;
      s.remove();
      reject(new Error("Could not load hls.js"));
    };
    document.head.appendChild(s);
  });
  return hlsLoading;
}

/** Cache-bust a still without clobbering its own query (signed URLs are left alone). */
function bust(url: string, tick: number): string {
  if (/[?&](token|sig|signature|expires)=/i.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}t=${tick}`;
}

export type FeedMode = "video" | "clip" | "still";
export type FeedState = "loading" | "ok" | "err";

export function LiveCam({
  image,
  video,
  hls,
  alt,
  onState,
  onFrame: onFrameProp,
}: {
  image: string;
  video?: string;
  hls?: string;
  alt: string;
  onState?: (state: FeedState, mode: FeedMode) => void;
  /** Called with the arrival time of each genuinely new still. */
  onFrame?: (at: number) => void;
}) {
  const [mode, setMode] = useState<FeedMode>(hls ? "video" : video ? "clip" : "still");
  const [frame, setFrame] = useState(() => bust(image, Date.now()));
  const videoRef = useRef<HTMLVideoElement>(null);
  const report = useRef(onState);
  report.current = onState;
  const onFrame = useRef(onFrameProp);
  onFrame.current = onFrameProp;

  // A different camera starts from its best mode again.
  useEffect(() => {
    setMode(hls ? "video" : video ? "clip" : "still");
    setFrame(bust(image, Date.now()));
    report.current?.("loading", hls ? "video" : video ? "clip" : "still");
  }, [image, video, hls]);

  // Live HLS; any fatal error drops to fast stills.
  useEffect(() => {
    if (mode !== "video" || !hls) return;
    const el = videoRef.current;
    if (!el) return;
    let player: HlsInstance | null = null;
    let cancelled = false;
    const fail = () => {
      if (!cancelled) setMode("still");
    };
    const playing = () => report.current?.("ok", "video");
    el.addEventListener("playing", playing);
    // Browsers pause media in background tabs; pick the live edge back up when visible.
    const wake = () => {
      if (!document.hidden && el.paused) void el.play().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", wake);
    el.addEventListener("canplay", wake);
    const native = () => {
      el.src = hls;
      el.addEventListener("error", fail, { once: true });
      void el.play().catch(() => undefined);
    };
    // hls.js first: some Chromium builds claim native HLS support they can't deliver.
    // Native playback is only for browsers without MediaSource (iOS Safari).
    loadHls()
      .then((Hls) => {
        if (cancelled) return;
        if (!Hls.isSupported()) return native();
        player = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2, maxBufferLength: 10, manifestLoadingTimeOut: 8000 });
        player.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) fail();
        });
        player.on(Hls.Events.MANIFEST_PARSED, () => void el.play().catch(() => undefined));
        player.loadSource(hls);
        player.attachMedia(el);
      })
      .catch(() => (el.canPlayType("application/vnd.apple.mpegurl") ? native() : fail()));
    // A stream that never starts is as good as dead.
    const timeout = setTimeout(() => {
      if (el.readyState < 2 && !document.hidden) fail();
    }, 15_000);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      el.removeEventListener("playing", playing);
      document.removeEventListener("visibilitychange", wake);
      el.removeEventListener("canplay", wake);
      el.removeEventListener("error", fail);
      player?.destroy();
      el.removeAttribute("src");
      el.load();
    };
  }, [mode, hls]);

  // Stills: poll every second, swap only on a genuinely new frame.
  useEffect(() => {
    if (mode !== "still") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let objectUrl: string | null = null;
    let stamp = "";
    // Hosts that allow cross-origin reads get conditional polling; the rest are
    // simply re-displayed, which is all a plain <img> can do.
    let readable = true;

    const again = (ms = STILL_POLL_MS) => {
      if (alive) timer = setTimeout(() => void poll(), ms);
    };

    const show = (url: string, blob?: Blob) => {
      if (blob) {
        const next = URL.createObjectURL(blob);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = next;
        setFrame(next);
        // Only the readable path knows a frame is genuinely new; the display-only
        // path would report every poll and overstate how live the camera is.
        onFrame.current?.(Date.now());
      } else {
        setFrame(url);
      }
      report.current?.("ok", "still");
    };

    /** Display-only path for hosts without CORS. */
    const viaImage = (url: string) => {
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        show(url);
        again();
      };
      img.onerror = () => {
        if (!alive) return;
        report.current?.("err", "still");
        again(STILL_POLL_MS * 5);
      };
      img.src = url;
    };

    const poll = async () => {
      const url = bust(image, Date.now());
      if (!readable) return viaImage(url);
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!alive) return;
        if (!res.ok) {
          report.current?.("err", "still");
          return again(STILL_POLL_MS * 5);
        }
        const key = `${res.headers.get("etag") ?? res.headers.get("last-modified") ?? ""}|${res.headers.get("content-length") ?? ""}`;
        const blob = await res.blob();
        if (!alive) return;
        // Same bytes as last second: keep what's on screen, skip the decode.
        if (key !== "|" && key === stamp) report.current?.("ok", "still");
        else {
          stamp = key;
          show(url, blob);
        }
        again();
      } catch {
        // Cross-origin reads refused (NYC DOT and friends): never try fetch again.
        if (!alive) return;
        readable = false;
        viaImage(url);
      }
    };

    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mode, image]);

  if (mode === "video") {
    return <video ref={videoRef} poster={frame} autoPlay muted playsInline aria-label={alt} />;
  }
  if (mode === "clip" && video) {
    return (
      <video
        src={video}
        poster={frame}
        autoPlay
        muted
        loop
        playsInline
        aria-label={alt}
        onPlaying={() => report.current?.("ok", "clip")}
        onError={() => setMode("still")}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={frame} alt={alt} />;
}
