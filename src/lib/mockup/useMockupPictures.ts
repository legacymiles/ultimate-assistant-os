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

import { FLUX_SIZE, pictureKey, refKey } from "./flux";
import type { Device, MockupRef } from "./types";

const DRAWER = "http://127.0.0.1:3391";
const PROBE_MS = 2500;
const RECHECK_MS = 30_000;
/** Feature lists change while the owner clicks; wait for them to settle. */
const SETTLE_MS = 2500;
/** The drawer says 429 while it draws someone else's picture. */
const BUSY_WAIT_MS = 4000;
// A picture with a reference takes 1–3 minutes on the owner's laptop, and the chat
// command may be painting a board of three: wait up to ~16 minutes.
const BUSY_TRIES = 240;

export type PcState = "checking" | "direct" | "server" | "off";

export interface PictureJob {
  id: string;
  prompt: string;
  /** Pictures Flux starts from — a screenshot, a coded layout, a lane's own picture. */
  refs?: MockupRef[];
  /**
   * What to ask for when the drawer can't take references (an older drawer):
   * a prompt that doesn't say "edit image 1" about a picture it never got.
   * Without one, a reference job is skipped rather than drawn wrong.
   */
  plainPrompt?: string;
  /** Painted with this seed (default 7). Lanes that should differ get different ones. */
  seed?: number;
}

/** The cache key for one job: the prompt, the size and what it was drawn from. */
export function jobKey(j: PictureJob, device: Device): string {
  return pictureKey(j.prompt, device, `${refKey(j.refs)}${j.seed !== undefined ? `|s${j.seed}` : ""}`);
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

/**
 * Can the drawer start from a picture? An older drawer (before references)
 * ignores them, so the hub strips them rather than send a request it would
 * quietly half-honour.
 */
let drawerTakesRefs = false;

async function probe(): Promise<PcState> {
  try {
    const res = await fetch(`${DRAWER}/health`, { signal: AbortSignal.timeout(PROBE_MS), cache: "no-store" });
    if (res.ok) {
      const h = (await res.json()) as { ok?: boolean; hasWanGP?: boolean; refs?: boolean };
      drawerTakesRefs = Boolean(h.refs);
      if (h.ok && h.hasWanGP) return "direct";
    }
  } catch {
    /* not reachable from this page — try the server */
  }
  try {
    const res = await fetch("/api/mockup/draw", { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const h = res.ok ? ((await res.json()) as { up?: boolean; refs?: boolean }) : null;
    drawerTakesRefs = Boolean(h?.refs);
    if (h?.up) return "server";
  } catch {
    /* fall through */
  }
  return "off";
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function drawOne(
  pc: PcState,
  prompt: string,
  device: Device,
  refs: MockupRef[] = [],
  fresh = false,
  baseSeed = 7,
): Promise<{ image: string; ms: number }> {
  const size = FLUX_SIZE[device];
  const withRefs = drawerTakesRefs && refs.length ? refs : undefined;
  // Seed 7 everywhere, so the chat command and every app ask the drawer for
  // the SAME picture and its cache answers the second one at once. Redraw asks
  // for a new one: a fresh seed, and the drawer's cache skipped.
  const seed = fresh ? Math.floor(Math.random() * 1_000_000) + 100 : baseSeed;
  for (let attempt = 0; attempt < BUSY_TRIES; attempt += 1) {
    const res =
      pc === "direct"
        ? await fetch(`${DRAWER}/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, ...size, steps: 4, seed, fresh, refs: withRefs }),
          })
        : await fetch("/api/mockup/draw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, ...size, seed, refs: withRefs }),
          });
    if (res.status === 429) {
      await wait(BUSY_WAIT_MS);
      continue;
    }
    const data = (await res.json().catch(() => ({}))) as { image?: string; ms?: number; error?: string };
    if (!res.ok || !data.image) throw new Error(data.error || `The drawer answered ${res.status}.`);
    return { image: data.image, ms: data.ms ?? 0 };
  }
  throw new Error("Your PC's drawer stayed busy with other pictures for 16 minutes. Try Redraw.");
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

  const signature = jobs.map((j) => `${j.id}:${jobKey(j, device)}`).join("|");

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
        const key = jobKey(j, device);
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
          const usesRefs = Boolean(j.refs?.length);
          if (usesRefs && !drawerTakesRefs && !j.plainPrompt) {
            throw new Error("Your PC's drawer is an older one that can't start from a picture. Restart it: node tools/wangp-image/server.mjs");
          }
          const prompt = usesRefs && !drawerTakesRefs ? j.plainPrompt! : j.prompt;
          const got = await drawOne(pc, prompt, device, j.refs, force.current.has(j.id), j.seed);
          force.current.delete(j.id);
          await cachePut(jobKey(j, device), got);
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

// ----- the page as it is now ------------------------------------------------

/**
 * Photograph a live page on the owner's PC — the "before" of an edit.
 *
 * Direct to the drawer first (works from the hosted hub too), then through
 * this server. Returns "" when neither can, which simply means the board shows
 * no before picture; it never blocks the lanes.
 */
export async function photographPage(url: string, device: Device): Promise<string> {
  const size = device === "phone" ? { width: 390, height: 780 } : { width: 1280, height: 820 };
  const tries: (() => Promise<Response>)[] = [
    () =>
      fetch(`${DRAWER}/shot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, ...size }),
        signal: AbortSignal.timeout(45_000),
      }),
    () =>
      fetch("/api/mockup/draw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shot: { url, ...size } }),
        signal: AbortSignal.timeout(50_000),
      }),
  ];
  for (const go of tries) {
    try {
      const res = await go();
      const data = (await res.json().catch(() => ({}))) as { image?: string };
      if (res.ok && data.image) return data.image;
    } catch {
      /* try the next way */
    }
  }
  return "";
}
