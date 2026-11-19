"use client";

// ---------------------------------------------------------------------------
// Coded mockups for the bake-off lanes — Claude writes each one as HTML.
//
// Who writes, tried in this order for every lane:
//
//   plan  — Claude on the owner's own plan, through the PC helper's one-shot
//           brain (`brain/claude`, the same Claude Code the harness runs),
//           with the model picked in the chat model menu when that pick is a
//           plan model. Free.
//   hub   — the hub's own model (/api/mockup/code), same prompt, when the PC
//           is off, unpaired or out of plan.
//
// Neither → the lane keeps its instant layout drawing (look mode) or says why
// (edit mode). All lanes are written AT ONCE — there is no GPU queue any more —
// and each lands as it is done. Every mockup is cached in IndexedDB by its
// request, so reopening a board shows it at once instead of writing it again.
//
// Replaces useMockupPictures (Flux 2 on the PC), 18 Nov 2026.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";

import { SUBSCRIPTION_PREFIX } from "@/lib/client-review/models";
import { readChatModel } from "@/lib/new-jarvis/useChatModel";
import { cleanMockupHtml, CODED_SYSTEM, codedKey, codedUser, trimMarkup, type CodedRequest } from "./coded";
import type { Device } from "./types";

export interface CodedJob {
  id: string;
  request: CodedRequest;
  /** A screenshot of the page as it is (data URL), for Claude to look at. Not part of the cache key. */
  image?: string;
}

export interface CodedState {
  status: "waiting" | "writing" | "done" | "failed";
  html?: string;
  ms?: number;
  /** Who wrote it, for the line under the board. */
  by?: string;
  error?: string;
}

/** Lanes write side by side; a tweak waits for the lane it changes. */
const PARALLEL = 3;
/** A page of HTML is a long answer. */
const PLAN_TIMEOUT_MS = 240_000;
const HUB_TIMEOUT_MS = 290_000;

// ----- the cache ------------------------------------------------------------

const DB = "mockup-coded";
const STORE = "docs";

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

async function cacheGet(key: string): Promise<{ html: string; ms: number; by: string } | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      r.onsuccess = () => {
        const v = r.result as { html?: string; ms?: number; by?: string } | undefined;
        resolve(v?.html ? { html: v.html, ms: v.ms ?? 0, by: v.by ?? "" } : null);
        db.close();
      };
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePut(key: string, value: { html: string; ms: number; by: string }): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const t = db.transaction(STORE, "readwrite");
    t.objectStore(STORE).put({ ...value, at: Date.now() }, key);
    t.oncomplete = () => db.close();
  } catch {
    /* a mockup that can't be cached is still on screen */
  }
}

// ----- the writers ----------------------------------------------------------

/** The plan model to ask for: the menu's pick when it is one, else the plan's default. */
function planModel(): string {
  const pick = readChatModel();
  return pick.startsWith(SUBSCRIPTION_PREFIX) ? pick.slice(SUBSCRIPTION_PREFIX.length) : "";
}

/** Is Claude on the plan reachable from this page? Asked once per board, then remembered. */
let planUp: Promise<boolean> | null = null;
async function planReachable(): Promise<boolean> {
  planUp ??= (async () => {
    try {
      const { autoPair, probe } = await import("@/lib/new-jarvis/bridge");
      const h = await probe(AbortSignal.timeout(4000));
      if (h.up && h.paired) return true;
      // Up but this tab isn't paired yet: the helper pairs with the hub's own
      // origin by itself, no token to copy.
      if (h.up && (await autoPair(AbortSignal.timeout(4000)))) {
        const again = await probe(AbortSignal.timeout(4000));
        return Boolean(again.up && again.paired);
      }
      return false;
    } catch {
      return false;
    }
  })();
  const up = await planUp;
  // Not up now doesn't mean not up in a minute: ask again next board.
  if (!up) planUp = null;
  return up;
}

async function onPlan(job: CodedJob): Promise<string> {
  if (!(await planReachable())) return "";
  try {
    const { call } = await import("@/lib/new-jarvis/bridge");
    const text = codedUser(job.request);
    const content = [
      { type: "text", text: job.image ? `${text}\n\nA screenshot of the page as it is now is attached.` : text },
      ...(job.image ? [{ type: "image_url", image_url: { url: job.image } }] : []),
    ];
    const model = planModel();
    const out = await call<{ text?: string }>(
      "brain/claude",
      {
        system: `${CODED_SYSTEM}\n\nYour final answer is the complete HTML document.`,
        messages: [{ role: "user", content }],
        ...(model ? { model } : {}),
      },
      { signal: AbortSignal.timeout(PLAN_TIMEOUT_MS) },
    );
    return cleanMockupHtml(out.text ?? "");
  } catch {
    return "";
  }
}

async function onHub(job: CodedJob): Promise<string> {
  try {
    const res = await fetch("/api/mockup/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: job.request, image: job.image || undefined }),
      signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => ({}))) as { html?: string };
    return res.ok && data.html ? cleanMockupHtml(data.html) : "";
  } catch {
    return "";
  }
}

/** Write one mockup: Claude on the plan, else the hub's model. */
export async function writeMockup(job: CodedJob): Promise<{ html: string; by: string } | null> {
  const plan = await onPlan(job);
  if (plan) return { html: plan, by: "Claude on your plan" };
  const hub = await onHub(job);
  if (hub) return { html: hub, by: "the hub's AI" };
  return null;
}

// ----- the hook -------------------------------------------------------------

export function useCodedMockups(jobs: CodedJob[], enabled = true) {
  const [docs, setDocs] = useState<Record<string, CodedState>>({});
  const [nonce, setNonce] = useState(0);
  const run = useRef(0);
  const force = useRef(new Set<string>());
  /** Jobs already being written, by cache key — a re-render never starts one twice. */
  const inFlight = useRef(new Map<string, Promise<{ html: string; by: string; ms: number } | null>>());

  const signature = jobs.map((j) => `${j.id}:${codedKey(j.request)}`).join("|");

  useEffect(() => {
    if (!enabled) return;
    const mine = ++run.current;
    const live = () => run.current === mine;
    const set = (id: string, s: CodedState) => {
      if (live()) setDocs((d) => ({ ...d, [id]: s }));
    };

    void (async () => {
      const todo: CodedJob[] = [];
      for (const j of jobs) {
        const key = codedKey(j.request);
        const hit = force.current.has(j.id) ? null : await cacheGet(key);
        if (!live()) return;
        if (hit) set(j.id, { status: "done", ...hit });
        else todo.push(j);
      }
      for (const j of todo) set(j.id, { status: "waiting" });

      let next = 0;
      const worker = async () => {
        while (next < todo.length) {
          const j = todo[next++];
          if (!live()) return;
          const key = codedKey(j.request);
          set(j.id, { status: "writing" });
          let p = inFlight.current.get(key);
          if (!p) {
            const started = Date.now();
            p = writeMockup(j).then(async (got) => {
              if (!got) return null;
              const value = { ...got, ms: Date.now() - started };
              await cachePut(key, value);
              return value;
            });
            inFlight.current.set(key, p);
            void p.finally(() => inFlight.current.delete(key));
          }
          const got = await p;
          force.current.delete(j.id);
          if (got) set(j.id, { status: "done", ...got });
          else
            set(j.id, {
              status: "failed",
              error: "Claude couldn't write this one — your PC's Claude isn't reachable and the hub's AI didn't answer. Press Rewrite to try again.",
            });
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    })();
    // `signature` stands for `jobs`: a new array with the same requests must not restart them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled, nonce]);

  const rewrite = useCallback((id: string) => {
    force.current.add(id);
    setNonce((n) => n + 1);
  }, []);

  return { docs, rewrite };
}

// ----- the page as it is now ------------------------------------------------

/** The screenshot helper on the owner's PC (tools/wangp-image — headless Chrome, no image model). */
const HELPER = "http://127.0.0.1:3391";

/**
 * Start the screenshot helper on the owner's PC through the Jarvis helper,
 * when it is off. Silent and harmless anywhere the helper isn't paired.
 */
let wokeAt = 0;
async function wakeHelper(): Promise<boolean> {
  if (Date.now() - wokeAt < 90_000) return true;
  try {
    const { call, knownFolder, probe } = await import("@/lib/new-jarvis/bridge");
    const h = await probe();
    const folder = knownFolder();
    if (!h.up || !h.paired || !folder) return false;
    const root = folder.replace(/[\\/]+$/, "").replace(/[\\/]tools[\\/]jarvis-bridge$/i, "");
    const script = `${root}/tools/wangp-image/server.mjs`.replace(/\//g, "\\");
    await call("shell", {
      command: `Start-Process -WindowStyle Hidden -FilePath node -ArgumentList '"${script}"'`,
      timeoutMs: 20_000,
    });
    wokeAt = Date.now();
    return true;
  } catch {
    return false;
  }
}

async function shotOnce(body: Record<string, unknown>): Promise<string> {
  const tries: (() => Promise<Response>)[] = [
    () =>
      fetch(`${HELPER}/shot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      }),
    ...(typeof body.url === "string"
      ? [
          () =>
            fetch("/api/mockup/shot", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(50_000),
            }),
        ]
      : []),
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

async function shot(body: Record<string, unknown>): Promise<string> {
  const first = await shotOnce(body);
  if (first || !(await wakeHelper())) return first;
  // Just started: give it a few seconds to come up, then ask once more.
  for (let i = 0; i < 5; i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const again = await shotOnce(body);
    if (again) return again;
  }
  return "";
}

const SHOT_SIZE: Record<Device, { width: number; height: number }> = {
  desktop: { width: 1280, height: 820 },
  phone: { width: 390, height: 780 },
};

/**
 * Photograph a live page on the owner's PC — the "before" of an edit, and
 * what Claude looks at to recreate it. "" when it can't, which only means the
 * board shows no before picture; it never blocks the lanes.
 */
export function photographPage(url: string, device: Device): Promise<string> {
  return shot({ url, ...SHOT_SIZE[device] });
}

/** A picture of a written mockup, for a builder that wants an image to hold to. "" when the PC can't take one. */
export function photographMockup(html: string, device: Device): Promise<string> {
  return shot({ html, base: typeof window === "undefined" ? undefined : window.location.origin, ...SHOT_SIZE[device], height: device === "phone" ? 1600 : 1400 });
}

/**
 * The live page's markup, trimmed for the writer. A page on the hub's own
 * origin is read straight from the browser (the server refuses private
 * addresses); anything else through /api/mockup/page.
 */
export async function readPageMarkup(url: string): Promise<string> {
  try {
    const u = new URL(url);
    if (typeof window !== "undefined" && u.origin === window.location.origin) {
      const res = await fetch(u.href, { credentials: "include", signal: AbortSignal.timeout(20_000) });
      return res.ok ? trimMarkup(await res.text(), u.href) : "";
    }
    const res = await fetch("/api/mockup/page", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as { markup?: string };
    return res.ok ? (data.markup ?? "") : "";
  } catch {
    return "";
  }
}
