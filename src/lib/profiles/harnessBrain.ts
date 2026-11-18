"use client";

// ---------------------------------------------------------------------------
// The Profiles chat, answered by the owner's Jarvis harness.
//
// The harness is the coding agent that lives in the local bridge
// (tools/jarvis-bridge): Claude through the Agent SDK, or DeepSeek through
// dsh, on the owner's own PC and subscription. Profiles keeps ONE thread for
// itself — "Profiles · Jarvis" — and reuses it across visits, so the cost of
// cutting a worktree is paid once, not per question, and the thread keeps the
// conversation's memory.
//
// The thread is started `strict` with trust "ask", which means the bridge
// parks EVERY tool call at a gate. Profiles never wants the agent touching
// files or running commands — the outline it needs is in the message — so
// this client refuses every gate the moment it appears, and the agent answers
// in words. Same protocol as the cloud and offline brains (see agent.ts).
//
// Events are polled with a cursor, like every other harness surface, because
// that survives a sleeping laptop and a reload; see the jarvis-harness skill.
// ---------------------------------------------------------------------------

import { BridgeError, call, probe } from "@/lib/new-jarvis/bridge";
import type { HarnessChoice, HarnessEvent } from "@/lib/new-jarvis/harness/types";

const THREAD_KEY = "profiles:harness-thread";
const TURN_LIMIT_MS = 150_000;

export interface HarnessStatus {
  ok: boolean;
  /** Which model is answering, e.g. "Claude". */
  label: string;
  /** In the owner's words, why not — shown verbatim, never hidden. */
  why: string;
}

/** Can the harness answer right now? Never throws. */
export async function harnessStatus(signal?: AbortSignal): Promise<HarnessStatus> {
  try {
    const h = await probe(signal);
    if (!h.up) return { ok: false, label: "", why: "Jarvis on your PC isn't running." };
    if (!h.paired) return { ok: false, label: "", why: h.problem ?? "This browser isn't paired with Jarvis on your PC yet." };
    const list = h.capabilities?.harnesses ?? [];
    const pick = list.find((x) => x.id === "claude" && x.available) ?? list.find((x) => x.available);
    if (!h.capabilities?.harness || !pick) return { ok: false, label: "", why: list.find((x) => x.why)?.why ?? "No harness is installed on this PC." };
    return { ok: true, label: pick.label, why: "" };
  } catch {
    return { ok: false, label: "", why: "Jarvis on your PC isn't reachable." };
  }
}

function readThread(): string {
  try {
    return window.localStorage.getItem(THREAD_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveThread(id: string): void {
  try {
    if (id) window.localStorage.setItem(THREAD_KEY, id);
    else window.localStorage.removeItem(THREAD_KEY);
  } catch {
    /* private mode: the thread is simply not reused next visit */
  }
}

interface Poll {
  events: HarnessEvent[];
  cursor: number;
  dropped: boolean;
  session: { id: string; status: string };
}

/** The Profiles thread, reused when the bridge still has it, started when not. */
async function ensureThread(): Promise<{ id: string; cursor: number }> {
  const known = readThread();
  if (known) {
    try {
      const p = await call<Poll>("harness/events", { id: known, since: 0 });
      if (p.session?.status !== "ended") return { id: known, cursor: p.cursor };
    } catch (e) {
      if (!(e instanceof BridgeError) || (e.status !== 404 && e.status !== 400)) throw e;
    }
    saveThread("");
  }
  const { harnesses } = await call<{ harnesses: HarnessChoice[] }>("harness/list");
  const pick = harnesses.find((h) => h.id === "claude" && h.available) ?? harnesses.find((h) => h.available);
  if (!pick) throw new Error(harnesses.find((h) => h.why)?.why ?? "No harness is available on this PC.");
  const { session } = await call<{ session: { id: string } }>("harness/start", {
    harness: pick.id,
    title: "Profiles · Jarvis",
    // Every tool call stops at a gate, and this client refuses them all.
    strict: true,
    trust: "ask",
  });
  saveThread(session.id);
  return { id: session.id, cursor: 0 };
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Stopped", "AbortError"));
    });
  });

/**
 * Say one message on the Profiles thread and wait for the answer's words.
 * `onText` gets the reply as it arrives, for the typing effect.
 */
export async function askHarness(message: string, opts: { signal?: AbortSignal; onText?: (sofar: string) => void } = {}): Promise<string> {
  const { id } = await ensureThread();
  // Start reading from where the thread is NOW, so earlier turns never leak in.
  let cursor = (await call<Poll>("harness/events", { id, since: 0 })).cursor;
  await call("harness/say", { id, text: message });

  let text = "";
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > TURN_LIMIT_MS) throw new Error("Jarvis on your PC took too long to answer.");
    await wait(text ? 350 : 500, opts.signal);
    const p = await call<Poll>("harness/events", { id, since: cursor });
    if (p.dropped) {
      // Fell behind the ring; whatever we had is incomplete. Read on from here.
      cursor = p.cursor;
      continue;
    }
    cursor = p.cursor;
    for (const e of p.events) {
      switch (e.kind) {
        case "text":
          if (typeof e.text === "string") {
            text += e.text;
            opts.onText?.(text);
          }
          break;
        case "gate":
          // Profiles never lets its agent act. Refuse, and it answers in words.
          if (typeof e.gateId === "string") await call("harness/decide", { id, gateId: e.gateId, allow: false }).catch(() => {});
          break;
        case "error":
          throw new Error(typeof e.message === "string" ? e.message : "Jarvis on your PC hit an error.");
        case "turn_end":
          if (typeof e.error === "string" && e.error) throw new Error(e.error);
          return text;
        case "status":
          if (e.status === "ended") {
            saveThread("");
            throw new Error("The Profiles thread ended on your PC. Ask again to start a new one.");
          }
          break;
        default:
          break;
      }
    }
  }
}

/** Forget the thread (Settings → "Start a fresh conversation"). */
export async function resetHarnessThread(): Promise<void> {
  const id = readThread();
  saveThread("");
  if (id) await call("harness/discard", { id }).catch(() => {});
}
