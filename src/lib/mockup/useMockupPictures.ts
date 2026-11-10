"use client";

// ---------------------------------------------------------------------------
// Flux 2 pictures for the mockup lanes, drawn on the owner's PC.
//
// Two ways to reach the drawer (tools/wangp-image, 127.0.0.1:3391), tried in
// this order:
//
//   direct  — the page itself calls the drawer. This is the one that works on
//             the hosted hub: the server there is not on the owner's PC, but
//             the browser is. The drawer answers CORS and Private Network
//             Access, and binds 127.0.0.1 only.
//   server  — /api/mockup/draw, for a hub running on the PC itself.
//
// Neither reachable → "off": the lanes keep their coded drawings and say how
// to switch Flux on. Never a paid or watermarked lane — a mockup is not worth
// money when a free drawing of it already exists.
//
// Lanes are drawn ONE AT A TIME, in lane order (the recommendation first),
// because the drawer has one GPU worker and refuses a second job while busy.
// Every picture is cached in IndexedDB by its prompt, so reopening a project
// shows the pictures at once instead of drawing them again.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import { FLUX_SIZE, pictureKey } from "./flux";
import type { Device } from "./types";

const DRAWER = "http://127.0.0.1:3391";
const PROBE_MS = 2500;
const RECHECK_MS = 30_000;
/** Feature lists change while the owner clicks; wait for them to settle. */
const SETTLE_MS = 2500;
/** The drawer says 429 while it draws someone else's picture. */
const BUSY_WAIT_MS = 4000;
const BUSY_TRIES = 45;

export type PcState = "checking" | "direct" | "server" | "off";

export interface PictureJob {
  id: string;
  prompt: string;
}

export interface PictureState {
  status: "waiting" | "drawing" | "done" | "failed";
  image?: string;
  ms?: number;
  error?: string;
}

// ----- the cache ------------------------------------------------------------

const DB = "mockup-pictures";
const STORE = "pics";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cacheGet(key: string): Promise<{ image: string; ms: number } | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => {
        const v = r.result as { image?: string; ms?: number } | undefined;
        resolve(v?.image ? { image: v.image, ms: v.ms ?? 0 } : null);
        db.close();
      };
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePut(key: string, value: { image: string; ms: number }): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put({ ...value, at: Date.now() }, key);
    t.oncomplete = () => db.close();
  } catch {
    /* a picture that can't be cached is still on screen */
  }
}

// ----- reaching the drawer --------------------------------------------------

async function probe(): Promise<PcState> {
  try {
    const res = await fetch(`${DRAWER}/health`, { signal: AbortSignal.timeout(PROBE_MS), cache: "no-store" });
    if (res.ok) {
      const h = (await res.json()) as { ok?: boolean; hasWanGP?: boolean };
      if (h.ok && h.hasWanGP) return "direct";
    }
  } catch {
    /* not reachable from this page — try the server */
  }
  try {
    const res = await fetch("/api/mockup/draw", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (res.ok && ((await res.json()) as { up?: boolean }).up) return "server";
  } catch {
    /* fall through */
  }
  return "off";
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drawOne(pc: PcState, prompt: string, device: Device): Promise<{ image: string; ms: number }> {
  const size = FLUX_SIZE[device];
  for (let attempt = 0; attempt < BUSY_TRIES; attempt += 1) {
    const res =
      pc === "direct"
        ? await fetch(`${DRAWER}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, ...size, steps: 4, seed: 7 }),
          })
        : await fetch("/api/mockup/draw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, ...size }),
          });
    if (res.status === 429) {
      await wait(BUSY_WAIT_MS);
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as { image?: string; ms?: number; error?: string };
    if (!res.ok || !data.image) throw new Error(data.error || `The drawer answered ${res.status}.`);
    return { image: data.image, ms: data.ms ?? 0 };
  }
  throw new Error("Your PC's drawer stayed busy with other pictures. Try Redraw in a minute.");
}

// ----- the hook -------------------------------------------------------------

export function useMockupPictures(jobs: PictureJob[], device: Device, enabled = true) {
  const [pc, setPc] = useState<PcState>("checking");
  const [pictures, setPictures] = useState<Record<string, PictureState>>({});
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);
  const force = useRef(new Set<string>());

  // Is the drawer there? Re-asked while it isn't, so starting Pinokio mid-way
  // lights the pictures up without a reload.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const state = await probe();
      if (!alive) return;
      setPc(state);
      if (state === "off") timer = setTimeout(tick, RECHECK_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  const signature = jobs.map((j) => `${j.id}:${pictureKey(j.prompt, device)}`).join("|");

  useEffect(() => {
    if (!enabled || pc === "checking") return;
    const mine = ++run.current;
    const live = () => run.current === mine;
    const set = (id: string, s: PictureState) => {
      if (live()) setPictures((p) => ({ ...p, [id]: s }));
    };

    void (async () => {
      // Cached pictures show at once, even with the PC off.
      const todo: PictureJob[] = [];
      for (const j of jobs) {
        const key = pictureKey(j.prompt, device);
        const hit = force.current.has(j.id) ? null : await cacheGet(key);
        if (!live()) return;
        if (hit) set(j.id, { status: "done", ...hit });
        else todo.push(j);
      }
      if (pc === "off") {
        for (const j of todo) set(j.id, { status: "failed", error: "off" });
        return;
      }
      for (const j of todo) set(j.id, { status: "waiting" });
      await wait(SETTLE_MS);
      for (const j of todo) {
        if (!live()) return;
        set(j.id, { status: "drawing" });
        try {
          const got = await drawOne(pc, j.prompt, device);
          force.current.delete(j.id);
          await cachePut(pictureKey(j.prompt, device), got);
          set(j.id, { status: "done", ...got });
        } catch (e) {
          set(j.id, { status: "failed", error: e instanceof Error ? e.message : "The picture didn't draw." });
        }
      }
    })();
    // `signature` stands for `jobs` + `device`: a new array with the same
    // prompts must not restart the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, pc, enabled, nonce]);

  const redraw = useCallback((id: string) => {
    force.current.add(id);
    setNonce((n) => n + 1);
  }, []);

  return { pc, pictures, redraw };
}
