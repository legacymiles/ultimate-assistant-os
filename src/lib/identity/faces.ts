"use client";

// ---------------------------------------------------------------------------
// Face templates — the biometric data recognition actually uses.
//
// A template is a 256px crop of one photo the owner flagged as a face reference
// INSIDE a person's profile, for a person whose face consent is on. Nothing
// else can become one: not an Images-library picture, not a Photos-tab upload.
//
// Storage:
//   · in memory while the page is open (what the matcher and Studio read);
//   · at rest ONLY as ciphertext — sealed by /api/identity/seal with
//     IDENTITY_ENC_KEY and synced as `identity-faces:v1` = { sealed };
//   · with no key, never at rest at all: each device rebuilds the templates
//     from the authorized profile photos when it needs them.
//
// Revoking consent, unflagging a photo or archiving the person drops their
// templates on the next ensureFaces(); wipeFaces() drops everyone's at once,
// on every device.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import type { ProfilesData } from "@/lib/profiles/types";
import { enrolledRefs, isIdentity } from "./registry";

export const FACES_KEY = "identity-faces:v1";
const TEMPLATE_PX = 256;

interface Template {
  mediaId: string;
  url: string;
}
type Faces = Record<string, Template[]>;

interface AtRest {
  v: 1;
  sealed?: string;
  wipedAt?: string;
}

let mem: Faces | null = null;
let sealing: boolean | null = null;
/** Bumped by wipeFaces(): a build that started before a wipe throws its result away. */
let generation = 0;

/** Is IDENTITY_ENC_KEY set on this deployment? Cached for the page's life. */
export async function sealConfigured(): Promise<boolean> {
  if (sealing !== null) return sealing;
  try {
    const r = await fetch("/api/identity/seal", { cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as { configured?: boolean };
    sealing = r.ok && j.configured === true;
  } catch {
    sealing = false;
  }
  return sealing;
}

async function loadAtRest(): Promise<Faces> {
  const rest = loadLocal<AtRest | null>(FACES_KEY, null);
  if (!rest?.sealed || !(await sealConfigured())) return {};
  try {
    const r = await fetch("/api/identity/seal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "open", sealed: rest.sealed }),
    });
    const j = (await r.json()) as { data?: string };
    const parsed = j.data ? (JSON.parse(j.data) as Faces) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function persist(faces: Faces): Promise<void> {
  if (!(await sealConfigured())) return;
  try {
    const r = await fetch("/api/identity/seal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "seal", data: JSON.stringify(faces) }),
    });
    const j = (await r.json()) as { sealed?: string };
    if (j.sealed) saveSynced(FACES_KEY, { v: 1, sealed: j.sealed } satisfies AtRest);
  } catch {
    /* memory copy still works; next change retries */
  }
}

async function template(src: string): Promise<string | null> {
  try {
    const blob = await (await fetch(src)).blob();
    const { toThumb } = await import("@/lib/recall/photos/vision");
    return (await toThumb(blob, TEMPLATE_PX, 0.9)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Bring the templates in line with the profiles: build what is missing, drop
 * what is no longer authorized. Returns identity id → template data URLs.
 */
export async function ensureFaces(
  profiles: ProfilesData | null,
  opts: { persist?: boolean } = {},
): Promise<Record<string, string[]>> {
  if (typeof window === "undefined") return {};
  const gen = generation;
  if (!mem) {
    const loaded = await loadAtRest();
    if (gen !== generation) return facesSnapshot();
    mem = mem ?? loaded;
  }
  // No profiles on this device yet: build nothing, drop nothing, store nothing.
  if (!profiles) return facesSnapshot();
  const next: Faces = {};
  let changed = false;
  for (const n of Object.values(profiles?.nodes ?? {})) {
    if (!isIdentity(n)) continue;
    const refs = enrolledRefs(n);
    if (!refs.length) continue;
    const have = new Map((mem[n.id] ?? []).map((t) => [t.mediaId, t]));
    const list: Template[] = [];
    for (const m of refs.slice(0, 6)) {
      const got = have.get(m.id);
      if (got) {
        list.push(got);
        continue;
      }
      const url = await template(m.src!);
      if (url) {
        list.push({ mediaId: m.id, url });
        changed = true;
      }
    }
    if (list.length) next[n.id] = list;
  }
  // A wipe happened while this was building: its result is already stale.
  if (gen !== generation) return facesSnapshot();
  // Anyone who lost consent, a reference, or their profile is dropped here.
  if (Object.keys(mem ?? {}).some((id) => !next[id] || next[id].length !== mem![id].length)) changed = true;
  mem = next;
  // Only the identity sync, reading a settled blob, writes the synced copy —
  // a screen holding an older blob must never overwrite every device's faces.
  if (changed && opts.persist) await persist(next);
  return facesSnapshot();
}

/** What is in memory right now, without building anything. */
export function facesSnapshot(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, list] of Object.entries(mem ?? {})) out[id] = list.map((t) => t.url);
  return out;
}

export function cachedFaces(identityId: string): string[] {
  return (mem?.[identityId] ?? []).map((t) => t.url);
}

/** Delete every face template, here and (via the synced tombstone) on every device. */
export async function wipeFaces(): Promise<void> {
  generation++;
  mem = {};
  saveSynced(FACES_KEY, { v: 1, wipedAt: new Date().toISOString() } satisfies AtRest);
}

/** For tests. */
export function resetFacesForTests(): void {
  mem = null;
  sealing = null;
}
