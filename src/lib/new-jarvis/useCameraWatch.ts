"use client";

// ---------------------------------------------------------------------------
// Camera Autopilot's watch — checks the iPhone inbox on its own, no buttons.
//
// Mounted in the SHELL, like the Updates feed, so it runs whichever tab the
// owner is on. It checks the moment Jarvis opens, every minute while Jarvis is
// on screen, and at least every 10 minutes in the background. Each check is
// one small request; whenever the phone's Shortcut has pushed photos, they are
// claimed a few at a time and read straight into the Autopilot queue, so the
// Deck shows them with a guess and the Updates feed raises "N new photos to
// sort" without anyone tapping anything. Photos stay in the inbox while they
// wait, so the phone and the laptop both get every one; filing or removing one
// anywhere drops it everywhere (see inboxSync.ts).
//
// The website cannot see the camera roll by itself — Apple gives a web page no
// way in. The phone side is the iOS Shortcut (Photos tab › Link iPhone); with
// a Personal Automation it pushes on its own, and this is the half that
// notices.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { drainInbox, inboxPhotoTime } from "@/lib/dashboard/drainInbox";
import { dropGone, importPhotos, releaseInbox, removeDuplicatePhotos } from "@/lib/recall/photos/pipeline";
import { getQueue, updatePending } from "@/lib/recall/photos/store";
import { getFile } from "@/lib/recall/files";
import { addShareSkip, fitForUpload, planRestamp, planShareUp, readShareSkip } from "./shareUp";
import { planInboxSync, readHad, rememberHad } from "./inboxSync";
import { getData } from "@/lib/recall/store";
import { folderPaths } from "@/lib/recall/classify";
import { NO_SIGNALS, readSignals, type PhoneSignals } from "@/lib/dashboard/phoneStatus";

/** The longest Jarvis ever goes between checks, even in a background tab. */
export const CAMERA_CHECK_MS = 10 * 60_000;
/** How often it looks while Jarvis is on screen — one small request, no AI. */
export const CAMERA_PEEK_MS = 60_000;
export const CAMERA_CHANGED = "jarvis-camera-changed";
/** Ask the shell's watch to check (and pull) now — the Photos tab's "Bring them in" uses it. */
export const CAMERA_CHECK_NOW = "jarvis-camera-check-now";
const SETTINGS_KEY = "jarvis-camera-watch:v1";

export interface InboxEntry {
  id: string;
  name?: string;
  takenAt?: string;
  receivedAt?: string;
  bytes?: number;
}

export interface CameraWatchSettings {
  /**
   * Pull new iPhone photos into Autopilot on each check. Always on now: the
   * owner asked for photos to arrive with no button pressed, and an old "off"
   * saved on one device was silently stopping that everywhere.
   */
  autoPull: boolean;
}

export interface CameraWatch {
  linked: boolean;
  /** Photos on the server not pulled in yet. */
  inbox: InboxEntry[];
  lastChecked: number | null;
  /** When the iPhone last sent a photo (ms), or null if it never has. */
  lastPush: number | null;
  /** Everything the phone has been doing — the line that says WHY nothing came. */
  phone: PhoneSignals;
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
  loadLocal<Partial<CameraWatchSettings>>(SETTINGS_KEY, {});
  return { autoPull: true };
}

/**
 * Send a few photos that are waiting only on this device up to the inbox.
 * Each gets the inbox id, so this device keeps it and the others copy it in.
 * Returns how many were linked.
 */
async function shareUp(): Promise<number> {
  let linked = 0;
  for (const p of planShareUp(getQueue(), readShareSkip())) {
    const blob = await getFile(p.fileId).catch(() => null);
    if (!blob) {
      addShareSkip(p.id);
      continue;
    }
    const form = new FormData();
    form.append("photo", await fitForUpload(blob), p.name);
    form.append("name", p.name);
    if (p.takenAt || p.addedAt) form.append("takenAt", p.takenAt ?? p.addedAt);
    try {
      const r = await fetch("/api/dashboard/inbox/upload", { method: "POST", body: form });
      if (!r.ok) {
        // Too big or unreadable: don't keep retrying it every minute.
        if (r.status === 413 || r.status === 422 || r.status === 400) addShareSkip(p.id);
        continue;
      }
      const { id } = (await r.json()) as { id?: string | null };
      if (!id) {
        addShareSkip(p.id);
        continue;
      }
      // Still waiting here? (It may have been filed while it uploaded.)
      if (!getQueue().some((q) => q.id === p.id)) {
        releaseInbox([id]);
        continue;
      }
      updatePending(p.id, { inboxId: id });
      rememberHad([id]);
      linked++;
    } catch {
      // Offline: next check.
    }
  }
  return linked;
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
  const [lastPush, setLastPush] = useState<number | null>(null);
  const [phone, setPhone] = useState<PhoneSignals>(NO_SIGNALS);
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
      const d = (await r.json()) as {
        linked?: boolean;
        entries?: InboxEntry[];
        lastPush?: string | null;
        lastCheckIn?: string | null;
        problem?: { at?: string; message?: string } | null;
        refusedAt?: string | null;
      };
      if (!Array.isArray(d.entries)) throw new Error("The photo inbox didn't send its list.");
      const all = d.entries;
      setLinked(Boolean(d.linked));
      const pushed = d.lastPush ? Date.parse(d.lastPush) : NaN;
      setLastPush(Number.isNaN(pushed) ? null : pushed);
      setPhone(readSignals(d));

      // Same photos on every device: drop what was filed or removed elsewhere
      // (or deleted from the phone), and copy in what this device hasn't had.
      const plan = planInboxSync(all.map((e) => e.id), getQueue(), readHad());
      if (plan.toRemove.length) {
        await dropGone(plan.toRemove);
        window.dispatchEvent(new Event(CAMERA_CHANGED));
      }
      // Newest first, so the photo just taken is the first one in — not stuck
      // behind a backlog (or behind one that can't be read).
      const fresh = all
        .filter((e) => plan.toImport.includes(e.id))
        .sort((a, b) => (Date.parse(b.receivedAt ?? "") || 0) - (Date.parse(a.receivedAt ?? "") || 0));
      setInbox(fresh);

      let heldBack = 0;
      if (fresh.length && (pull ?? settingsRef.current.autoPull)) {
        const n = fresh.length;
        setBusy(`Bringing in ${n} new photo${n === 1 ? "" : "s"} from your iPhone…`);
        await drainInbox(
          fresh,
          async (files, inboxIdOf) => {
            const out = await importPhotos({
              files,
              ...recallCtx(),
              inboxIdOf,
              onQueue: () => window.dispatchEvent(new Event(CAMERA_CHANGED)),
            });
            rememberHad(out.inboxHandled);
            heldBack += out.deferred;
            // A copy of a photo already filed or waiting isn't waiting anywhere.
            releaseInbox(out.inboxDropped);
            window.dispatchEvent(new Event(CAMERA_CHANGED));
          },
          (done, total) => {
            if (done < total) setBusy(`Reading new photos from your iPhone… ${done} of ${total}`);
          },
          { share: true },
        );
        setInbox([]);
        window.dispatchEvent(new Event(CAMERA_CHANGED));
      }
      // Camera Autopilot holds a few hundred unsorted photos at most. Past
      // that, new ones wait on the server — say so instead of going quiet.
      if (heldBack) {
        setError(
          `Camera Autopilot is full, so ${heldBack} new photo${heldBack === 1 ? " is" : "s are"} waiting. File or remove some and they come straight in.`,
        );
      }
      // Same order on every device: each waiting inbox photo sorts by the
      // time the inbox gives it, not when this device happened to copy it in.
      const times = new Map(all.map((e) => [e.id, inboxPhotoTime(e.takenAt, e.receivedAt)]));
      const restamp = planRestamp(getQueue(), times);
      for (const r of restamp) updatePending(r.id, { takenAt: r.takenAt });
      if (restamp.length) window.dispatchEvent(new Event(CAMERA_CHANGED));

      // Photos waiting only on this device go up, so the others get them too.
      if (await shareUp()) window.dispatchEvent(new Event(CAMERA_CHANGED));

      // Copies that slipped in before duplicates were stopped at the door
      // (or arrived from another device) are cleared on every check.
      if (await removeDuplicatePhotos().catch(() => 0)) window.dispatchEvent(new Event(CAMERA_CHANGED));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't check for new photos.");
    } finally {
      setLastChecked(Date.now());
      setBusy("");
      running.current = false;
    }
  }, []);

  // On load; every minute while Jarvis is on screen; and every 10 minutes no
  // matter what (browsers slow timers in background tabs, so the 10-minute
  // check is the floor, not the plan). A laptop that slept, or a phone that
  // switched back to the tab, gets a check the moment Jarvis is looked at.
  const lastRef = useRef<number | null>(null);
  lastRef.current = lastChecked;
  useEffect(() => {
    // Other screens ask through this, so photos always come in one way —
    // shared with every device — instead of a second drain that deletes them.
    const now = () => void check(true);
    window.addEventListener(CAMERA_CHECK_NOW, now);
    (window as unknown as { __jarvisCameraWatch?: boolean }).__jarvisCameraWatch = true;
    return () => {
      window.removeEventListener(CAMERA_CHECK_NOW, now);
      (window as unknown as { __jarvisCameraWatch?: boolean }).__jarvisCameraWatch = false;
    };
  }, [check]);

  useEffect(() => {
    void check();
    const due = (ms: number) => !lastRef.current || Date.now() - lastRef.current >= ms - 1000;
    const peek = window.setInterval(() => {
      if (document.visibilityState === "visible" && due(CAMERA_PEEK_MS)) void check();
    }, CAMERA_PEEK_MS);
    const floor = window.setInterval(() => void check(), CAMERA_CHECK_MS);
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (due(CAMERA_PEEK_MS)) void check();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      window.clearInterval(peek);
      window.clearInterval(floor);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [check]);

  return {
    linked,
    inbox,
    lastChecked,
    lastPush,
    phone,
    nextCheck: lastChecked ? lastChecked + CAMERA_PEEK_MS : null,
    busy,
    error,
    settings,
    setAutoPull,
    check,
  };
}
