"use client";

// ---------------------------------------------------------------------------
// Camera Autopilot's watch — checks the iPhone inbox every 10 minutes.
//
// Mounted in the SHELL, like the Updates feed, so it runs whichever tab the
// owner is on. Each check reads what the phone's Shortcut has pushed; with
// auto-pull on (the default) new photos are claimed and read straight into
// the Autopilot queue, so the Deck already shows them with a guess and the
// Updates feed raises "N new photos to sort".
//
// The website cannot see the camera roll by itself — Apple gives a web page no
// way in. The phone side is the iOS Shortcut (Photos tab › Link iPhone); with
// a Personal Automation it pushes on its own, and this is the half that
// notices.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { importPhotos } from "@/lib/recall/photos/pipeline";
import { getData } from "@/lib/recall/store";
import { folderPaths } from "@/lib/recall/classify";

export const CAMERA_CHECK_MS = 10 * 60_000;
export const CAMERA_CHANGED = "jarvis-camera-changed";
const SETTINGS_KEY = "jarvis-camera-watch:v1";

export interface InboxEntry {
  id: string;
  name?: string;
  takenAt?: string;
  receivedAt?: string;
}

export interface CameraWatchSettings {
  /** Pull new iPhone photos into Autopilot on each check. */
  autoPull: boolean;
}

export interface CameraWatch {
  linked: boolean;
  /** Photos on the server not pulled in yet. */
  inbox: InboxEntry[];
  lastChecked: number | null;
  nextCheck: number | null;
  /** What is happening right now, or "". */
  busy: string;
  error: string;
  settings: CameraWatchSettings;
  setAutoPull: (on: boolean) => void;
  /** Check now; pulls too when auto-pull is on, or when `pull` is true. */
  check: (pull?: boolean) => Promise<void>;
}

function readSettings(): CameraWatchSettings {
  const s = loadLocal<Partial<CameraWatchSettings>>(SETTINGS_KEY, {});
  return { autoPull: s.autoPull !== false };
}

function recallCtx() {
  const data = getData();
  const tags = new Set<string>();
  for (const it of data.items) for (const t of it.tags) tags.add(t);
  return { folderPaths: folderPaths(data.folders), existingTags: [...tags] };
}

export function useCameraWatch(): CameraWatch {
  const [linked, setLinked] = useState(false);
  const [inbox, setInbox] = useState<InboxEntry[]>([]);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<CameraWatchSettings>({ autoPull: true });
  const running = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => setSettings(readSettings()), []);
  useRemotePull(SETTINGS_KEY, () => setSettings(readSettings()));

  const setAutoPull = useCallback((on: boolean) => {
    const next = { ...readSettings(), autoPull: on };
    saveSynced(SETTINGS_KEY, next);
    setSettings(next);
  }, []);

  const check = useCallback(async (pull?: boolean) => {
    if (running.current) return;
    running.current = true;
    setError("");
    try {
      const r = await fetch("/api/dashboard/inbox", { cache: "no-store" });
      if (!r.ok) throw new Error(`The photo inbox answered ${r.status}.`);
      const d = (await r.json()) as { linked?: boolean; entries?: InboxEntry[] };
      const entries = d.entries ?? [];
      setLinked(Boolean(d.linked));
      setInbox(entries);

      if (entries.length && (pull ?? settingsRef.current.autoPull)) {
        setBusy(`Pulling ${entries.length} new photo${entries.length === 1 ? "" : "s"} from your iPhone…`);
        const c = await fetch("/api/dashboard/inbox/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: entries.map((e) => e.id) }),
        });
        const got = (await c.json()) as { photos?: { name: string; contentType: string; dataUrl: string }[] };
        const files = await Promise.all(
          (got.photos ?? []).map(async (p) => new File([await (await fetch(p.dataUrl)).blob()], p.name, { type: p.contentType })),
        );
        if (files.length) {
          setBusy(`Reading ${files.length} new photo${files.length === 1 ? "" : "s"}…`);
          await importPhotos({
            files,
            ...recallCtx(),
            onQueue: () => window.dispatchEvent(new Event(CAMERA_CHANGED)),
          });
        }
        setInbox([]);
        window.dispatchEvent(new Event(CAMERA_CHANGED));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check for new photos.");
    } finally {
      setLastChecked(Date.now());
      setBusy("");
      running.current = false;
    }
  }, []);

  // On load, then every 10 minutes. A laptop that slept through a check gets
  // one the moment the tab is looked at again, rather than waiting out the rest
  // of an interval that started hours ago.
  const lastRef = useRef<number | null>(null);
  lastRef.current = lastChecked;
  useEffect(() => {
    void check();
    const id = window.setInterval(() => void check(), CAMERA_CHECK_MS);
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (!lastRef.current || Date.now() - lastRef.current >= CAMERA_CHECK_MS) void check();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [check]);

  return {
    linked,
    inbox,
    lastChecked,
    nextCheck: lastChecked ? lastChecked + CAMERA_CHECK_MS : null,
    busy,
    error,
    settings,
    setAutoPull,
    check,
  };
}
