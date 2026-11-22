// ---------------------------------------------------------------------------
// Profiles → Camera Autopilot: one identity per person, pure planning.
//
// Camera Autopilot used to keep its own people (Photos tab, `recall-photos:v1`)
// with their own reference faces. Now Profiles owns every person, so:
//
//   carryPlan  ONCE per legacy Photos person who still has hand-uploaded
//              reference faces and no identity: bring those faces into Profiles
//              as flagged reference photos (consent marked "carried"), into the
//              profile of the same name or a new person profile. Recognition
//              keeps working, and from then on the profile is where it is edited.
//
//   linkPlan   every enrolled identity has exactly one Photos person, linked by
//              `identityId`, named like the profile, holding NO reference
//              faces of its own — the faces are supplied from the profile at
//              match time. A legacy person whose name matches is adopted
//              rather than duplicated.
//
//   recognitionPeople  the cast the contact sheet is drawn from: linked and
//              enrolled people with the profile's faces, nobody else. Album
//              reference pictures of a person's own folder are ignored, because
//              those are Images-library pictures, never identity references.
// ---------------------------------------------------------------------------

import type { Change, ProfilesData } from "@/lib/profiles/types";
import type { PhotoCategory, Person, PhotosData } from "@/lib/recall/photos/types";
import { buildIdentities, enrolledRefs, isIdentity, matchName, roleOf, ROOT_ID, type IdentityCard } from "./registry";

/** Marker in `ProfilesData.imported` so a legacy person is carried over once. */
export const carriedKey = (personId: string) => `photos-person:${personId}`;

/**
 * The profile a Photos person IS — exact name or nickname only (a shared first
 * name is not enough to move someone's face). The owner's own Photos person is
 * their own profile, whatever either is called.
 */
function matchFor(p: Person, cards: IdentityCard[]): { card: IdentityCard | null; ambiguous: boolean } {
  if (p.role === "self") {
    const me = cards.find((c) => c.role === "self");
    if (me) return { card: me, ambiguous: false };
  }
  return matchName(p.name, cards);
}

/** A profile called "My Profile" is still "Jack" in the Photos tab and in prompts. */
function nameFor(card: IdentityCard, existing: Person | undefined): string {
  if (card.role === "self") return existing?.name || "Me";
  return card.name;
}

export function carryPlan(profiles: ProfilesData, photos: PhotosData): { changes: Change[]; carried: string[] } {
  const cards = buildIdentities(profiles);
  const imported = new Set(profiles.imported ?? []);
  const changes: Change[] = [];
  const carried: string[] = [];
  let k = 0;
  for (const p of photos.people) {
    if (p.identityId && isIdentity(profiles.nodes[p.identityId])) continue;
    if (!p.refs.length || imported.has(carriedKey(p.id))) continue;
    const { card: match, ambiguous } = matchFor(p, cards);
    // Two profiles fit the name: leave it for the owner rather than guess or
    // make a third. Not marked, so it is offered again once they decide.
    if (ambiguous) continue;
    // The owner's own face waits for their real My Profile rather than
    // becoming a second "you" next to the example one.
    if (!match && p.role === "self") continue;
    const media = p.refs.map((src, i) => ({
      id: `m-carried-${p.id}-${i}`,
      kind: "photo" as const,
      src,
      caption: `Reference face from the Photos tab`,
      origin: "upload" as const,
      ref: true,
    }));
    if (match) {
      const node = profiles.nodes[match.id];
      // The owner already decided for this profile — their choice stands and
      // the old Photos-tab faces are simply superseded.
      if (node.faceConsent || node.media.some((m) => m.ref)) {
        carried.push(p.id);
        continue;
      }
      changes.push({ op: "add_media", node: match.id, media });
      changes.push({ op: "patch_node", node: match.id, patch: { faceConsent: { granted: true, at: new Date().toISOString(), by: "carried" } } });
    } else {
      const ref = `new:carry${k++}`;
      changes.push({ op: "add_node", ref, parent: ROOT_ID, name: p.name, kind: "person", label: p.role === "self" ? "You" : "Person", sub: p.notes ?? "" });
      changes.push({ op: "add_media", node: ref, media });
      changes.push({ op: "patch_node", node: ref, patch: { faceConsent: { granted: true, at: new Date().toISOString(), by: "carried" } } });
    }
    carried.push(p.id);
  }
  return { changes, carried };
}

export interface LinkResult {
  people: Person[];
  changed: boolean;
  /** Identity ids whose recognition data must be deleted (consent revoked / gone). */
  revoked: string[];
}

function personFor(card: IdentityCard, existing: Person | undefined, now: string, wasLinked = Boolean(existing?.identityId)): Person {
  return {
    id: existing?.id ?? `per_${card.id}`,
    name: nameFor(card, existing),
    role: existing?.role ?? card.role,
    refs: [],
    notes: existing?.notes,
    // A description written before this person was linked was built partly
    // from Images-library photos; it may not steer recognition. Only one the
    // owner wrote by hand survives adoption.
    sheet: wasLinked ? (existing?.sheet ?? null) : existing?.sheet?.edited ? existing.sheet : null,
    identityId: card.id,
    createdAt: existing?.createdAt ?? now,
  };
}

export function linkPlan(profiles: ProfilesData, photos: PhotosData, now = new Date().toISOString()): LinkResult {
  const cards = buildIdentities(profiles);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const people = photos.people.map((p) => ({ ...p }));
  const revoked: string[] = [];
  const taken = new Set(people.map((p) => p.identityId).filter(Boolean) as string[]);

  // Adopt legacy people by name before anything is created, so the same person
  // never exists twice in Autopilot.
  for (const p of people) {
    if (p.identityId) continue;
    const { card } = matchFor(p, cards);
    if (card && !taken.has(card.id)) {
      p.identityId = card.id;
      taken.add(card.id);
    }
  }

  const out: Person[] = [];
  for (const p of people) {
    if (!p.identityId) {
      // Unlinked and not a profile: kept so filed photos still name them, but
      // its own faces are no longer a source of recognition.
      out.push(p);
      continue;
    }
    const card = byId.get(p.identityId);
    if (!card) {
      // The profile was archived, hidden or removed: stop recognising them.
      if (p.refs.length || p.sheet) revoked.push(p.identityId);
      out.push({ ...p, refs: [], sheet: null });
      continue;
    }
    const wasLinked = Boolean(photos.people.find((x) => x.id === p.id)?.identityId);
    const next = personFor(card, p, now, wasLinked);
    // Hand-uploaded faces of a person adopted just now are only dropped once
    // Profiles provably holds them (the carry marker is in the saved blob);
    // until then they stay here, unused by recognition, so nothing is lost.
    if (p.refs.length && !(profiles.imported ?? []).includes(carriedKey(p.id))) next.refs = p.refs;
    if (!card.consent) {
      // No permission: no description written from their face either.
      if (p.sheet || p.refs.length) revoked.push(card.id);
      next.sheet = null;
    }
    out.push(next);
  }
  for (const card of cards) {
    if (taken.has(card.id) || !card.enrolled) continue;
    out.push(personFor(card, undefined, now));
  }

  const changed = JSON.stringify(out) !== JSON.stringify(photos.people);
  return { people: out, changed, revoked: [...new Set(revoked)] };
}

/** The people (with faces) and folders the contact sheet may be drawn from. */
export function recognitionPeople(
  profiles: ProfilesData | null,
  photos: PhotosData,
  faces: Record<string, string[]>,
  enabled: boolean,
): { people: Person[]; albums: PhotoCategory[] } {
  const linkedPersonIds = new Set(photos.people.filter((p) => p.identityId).map((p) => p.id));
  const cards = profiles ? buildIdentities(profiles) : [];
  const albums = photos.categories.map((c) => {
    // A folder about a PERSON is taught by their profile, never by pictures
    // uploaded to it in the Images library: their own solo/pair folder, any
    // rule naming them, and a hand-made album called by their name.
    const aboutPerson =
      (c.personId && linkedPersonIds.has(c.personId)) ||
      c.requires.some((id) => linkedPersonIds.has(id)) ||
      (cards.length > 0 && (matchName(c.name, cards).card !== null || matchName(c.name, cards).ambiguous));
    return aboutPerson && (c.refs ?? []).length ? { ...c, refs: [] } : c;
  });
  if (!enabled || !profiles) return { people: [], albums };
  const people: Person[] = [];
  for (const p of photos.people) {
    if (!p.identityId) continue;
    const node = profiles.nodes[p.identityId];
    if (!isIdentity(node) || !enrolledRefs(node).length) continue;
    const refs = faces[p.identityId] ?? [];
    if (!refs.length) continue;
    people.push({ ...p, role: p.role ?? roleOf(node), refs });
  }
  return { people, albums };
}
