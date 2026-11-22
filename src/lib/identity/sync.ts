"use client";

// ---------------------------------------------------------------------------
// Identity sync — the one place Profiles' people are pushed to every other app.
//
//   Profiles (source of truth)
//     → Camera Autopilot / Photos tab   linked people, faces from the profile
//     → face templates                  sealed at rest, or memory only
//     → Jarvis Memory                   one `identity` card per person
//     → Images library                  (lib/profiles/recallBridge — folders
//                                        and copied profile photos carry the id)
//
// Called after every Profiles save, before every Camera Autopilot read, and on
// the Jarvis shell's mount. Idempotent and quiet: running it twice changes
// nothing the second time, and a failure in one target never blocks another.
// ---------------------------------------------------------------------------

import { loadLocal, saveLocal, saveSynced } from "@/lib/sync/appState";
import type { ProfilesData } from "@/lib/profiles/types";
import { ensureFaces, facesSnapshot, wipeFaces } from "./faces";
import { carriedKey, carryPlan, linkPlan, recognitionPeople } from "./link";
import { buildIdentities, identityMemory, type IdentityCard } from "./registry";
import { getFaceSettings } from "./settings";
import type { PhotoCategory, Person } from "@/lib/recall/photos/types";

export const PROFILES_KEY = "profiles:v1";
/** Fired after any identity change has been pushed out. */
export const IDENTITY_CHANGED = "jarvis:identity-changed";
/** Fired when this module wrote the Profiles blob, so an open Profiles page reloads it. */
export const PROFILES_EXTERNAL_CHANGE = "profiles:external-change";
const MEMORY_SENT_KEY = "identity-memory-sent:v1";

/** Settled against the account once per page; after that this tab's saves are the newest. */
let settled: Promise<void> | null = null;

/**
 * The Profiles blob as this device has it. The first call on a page settles it
 * against the account (so a new device sees the real profiles, not nothing);
 * later calls only read. Reconciling on every save would race the page's own
 * pushes and could put an older copy back over a fresh edit.
 */
export async function readProfiles(settle = true): Promise<ProfilesData | null> {
  if (typeof window === "undefined") return null;
  if (settle) {
    settled ??= import("@/lib/sync/appState")
      .then(({ reconcile }) => reconcile(PROFILES_KEY))
      .catch(() => undefined);
    await settled;
  }
  const d = loadLocal<ProfilesData | null>(PROFILES_KEY, null);
  return d && d.version === 1 && d.nodes?.root ? d : null;
}

/** Synchronous read for prompt builders (no settle). */
export function identityCardsNow(): IdentityCard[] {
  if (typeof window === "undefined") return [];
  const d = loadLocal<ProfilesData | null>(PROFILES_KEY, null);
  return d?.nodes ? buildIdentities(d) : [];
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

let lastTried = "";

/** Write the identity cards to Jarvis Memory when they changed since last time. */
export async function syncIdentityMemory(cards: IdentityCard[], force = false): Promise<void> {
  const payload = cards.map((c) => {
    const m = identityMemory(c);
    return { ...m, hash: hash(m.title + m.content) };
  });
  const sig = hash(payload.map((p) => p.externalId + p.hash).join("|"));
  if (!force && loadLocal<string>(MEMORY_SENT_KEY, "") === sig) return;
  // One try per set of cards per page: when memory is unavailable (signed
  // out, no Supabase) the same cards are not re-sent on every save.
  if (!force && lastTried === sig) return;
  lastTried = sig;
  try {
    const r = await fetch("/api/identity/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: payload }),
    });
    const j = (await r.json().catch(() => ({}))) as { available?: boolean };
    // Remember only a sync that landed, so a signed-out device retries later.
    if (r.ok && j.available) saveLocal(MEMORY_SENT_KEY, sig);
  } catch {
    /* next save retries */
  }
}

let running: Promise<SyncReport> | null = null;

export interface SyncReport {
  carried: number;
  linked: boolean;
  enrolled: number;
}

/**
 * Push Profiles' people everywhere. Concurrent calls share one run; a caller
 * handing in a NEWER blob (e.g. after deleting face data) waits for the
 * current run and then starts its own, so its change is never swallowed.
 */
export function syncIdentity(profiles?: ProfilesData | null): Promise<SyncReport> {
  if (running) return profiles ? running.then(() => syncIdentity(profiles)) : running;
  running = (async () => {
    const report: SyncReport = { carried: 0, linked: false, enrolled: 0 };
    let data = profiles ?? (await readProfiles());
    if (!data) return report;
    const photosMod = await import("@/lib/recall/photos/store");

    // 1. Legacy Photos-tab faces come into Profiles once.
    try {
      const { changes, carried } = carryPlan(data, photosMod.getPhotos());
      if (carried.length) {
        const { applyChanges, newId } = await import("@/lib/profiles/changes");
        const r = changes.length ? applyChanges(data, changes) : { data, undo: [], done: [] as string[] };
        const next: ProfilesData = {
          ...r.data,
          imported: [...new Set([...(r.data.imported ?? []), ...carried.map(carriedKey)])],
          log: r.done.length
            ? [{ id: newId("log"), at: Date.now(), text: `Brought ${carried.length} ${carried.length === 1 ? "person's" : "people's"} reference faces over from the Photos tab`, where: "", hue: 34, undo: r.undo }, ...r.data.log].slice(0, 80)
            : r.data.log,
        };
        saveSynced(PROFILES_KEY, next);
        // Only rely on the carry if it really landed (a full localStorage
        // fails quietly). If it did not, `data` keeps the old blob, the carry
        // markers are absent, and linkPlan leaves the Photos-tab faces alone.
        const stored = loadLocal<ProfilesData | null>(PROFILES_KEY, null);
        const landed = carried.every((id) => (stored?.imported ?? []).includes(carriedKey(id)));
        if (landed) {
          window.dispatchEvent(new Event(PROFILES_EXTERNAL_CHANGE));
          data = next;
          report.carried = carried.length;
        }
      }
    } catch {
      /* carrying is a nicety; linking below still runs */
    }

    // 2. One Photos person per identity, faces from the profile only.
    try {
      const plan = linkPlan(data, photosMod.getPhotos());
      if (plan.changed) {
        photosMod.setLinkedPeople(plan.people);
        report.linked = true;
      }
    } catch {
      /* leave Photos as it was */
    }

    // 3. Templates: build what is new, drop what lost consent.
    const faces = await ensureFaces(data, { persist: true }).catch(() => ({}) as Record<string, string[]>);
    report.enrolled = Object.keys(faces).length;
    const { invalidateContactSheet } = await import("@/lib/recall/photos/vision");
    invalidateContactSheet();

    // 4. Jarvis Memory. A blob that is still only the examples has no people
    // yet — it must not read as "delete every identity card".
    const cards = buildIdentities(data);
    const real = Object.values(data.nodes).some((n) => n.id !== "root" && !n.example);
    if (cards.length || real) await syncIdentityMemory(cards);

    window.dispatchEvent(new Event(IDENTITY_CHANGED));
    return report;
  })().finally(() => {
    running = null;
  });
  return running;
}

/**
 * The cast Camera Autopilot may match against right now: enrolled identities
 * with their profile faces, and photo folders minus any person-folder pictures.
 */
export async function recognitionCast(): Promise<{ people: Person[]; albums: PhotoCategory[] }> {
  await readProfiles();
  await syncIdentity();
  const fresh = await readProfiles(false);
  const { getPhotos } = await import("@/lib/recall/photos/store");
  const settings = await getFaceSettings();
  return recognitionPeople(fresh, getPhotos(), facesSnapshot(), settings.enabled);
}

/** Delete every face template and turn face recognition consent off for everyone. */
export async function deleteAllFaceData(): Promise<number> {
  const data = await readProfiles();
  let revoked = 0;
  if (data) {
    const at = new Date().toISOString();
    const nodes = { ...data.nodes };
    for (const [id, n] of Object.entries(nodes))
      if (n.faceConsent?.granted) {
        nodes[id] = { ...n, faceConsent: { granted: false, at, by: "owner" } };
        revoked++;
      }
    const next = { ...data, nodes };
    saveSynced(PROFILES_KEY, next);
    window.dispatchEvent(new Event(PROFILES_EXTERNAL_CHANGE));
  }
  await wipeFaces();
  // Every face and description the Photos tab still holds goes too — linked or
  // not, carried or not. Names and filed photos stay.
  const photosMod = await import("@/lib/recall/photos/store");
  const people = photosMod.getPhotos().people;
  if (people.some((p) => p.refs.length || p.sheet)) photosMod.setLinkedPeople(people.map((p) => ({ ...p, refs: [], sheet: null })));
  const { invalidateContactSheet } = await import("@/lib/recall/photos/vision");
  invalidateContactSheet();
  if (data) await syncIdentity(await readProfiles(false));
  return revoked;
}
