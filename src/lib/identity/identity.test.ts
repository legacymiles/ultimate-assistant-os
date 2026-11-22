import { describe, expect, it } from "vitest";
import { applyChanges } from "@/lib/profiles/changes";
import { emptyProfiles, ROOT } from "@/lib/profiles/seed";
import { libraryMediaFor, mirrorPlan } from "@/lib/profiles/recallBridge";
import type { Media, ProfilesData } from "@/lib/profiles/types";
import type { RecallData } from "@/lib/recall/types";
import type { Person, PhotoCategory, PhotosData } from "@/lib/recall/photos/types";
import { buildIdentities, findDuplicates, identityDigest, identityMemory, resolveMentions } from "./registry";
import { DEFAULT_FACE_SETTINGS, normalizeFaceSettings, splitHits } from "./settings";
import { carriedKey, carryPlan, linkPlan, recognitionPeople } from "./link";
import { configured, open, seal } from "./server/seal";

const PIC = "data:image/jpeg;base64,AAAA";
const photo = (id: string, extra: Partial<Media> = {}): Media => ({ id, kind: "photo", src: PIC, caption: id, ...extra });
const consent = { granted: true, at: "2026-11-22T00:00:00Z", by: "owner" as const };

/** Brandy (girlfriend, enrolled), Leo "My Son" (no consent), a business, an example person. */
function world(): ProfilesData {
  const r = applyChanges(emptyProfiles(), [
    { op: "add_node", ref: "b", parent: ROOT, name: "Brandy", kind: "person", label: "Girlfriend", sub: "Partner" },
    { op: "add_node", ref: "s", parent: ROOT, name: "My Son", kind: "person", label: "Person", sub: "Leo · 9" },
    { op: "add_node", ref: "t", parent: "s", name: "Ms. Lee", kind: "person", label: "Teacher" },
    { op: "add_node", ref: "x", parent: ROOT, name: "Northside Prints", kind: "thing" },
    { op: "add_item", node: "b", section: "Details", k: "Birthday", v: "Mar 4" },
    { op: "add_item", node: "b", section: "Details", k: "SSN", v: "123-45-6789", secret: true },
  ]);
  const d = r.data;
  const [b, s] = [r.created.b, r.created.s];
  d.nodes[b] = { ...d.nodes[b], aliases: ["bran", "babe"], faceConsent: consent, media: [photo("b1", { ref: true }), photo("b2"), photo("b3", { ref: true, fromRecall: true })] };
  d.nodes[s] = { ...d.nodes[s], aliases: ["leo", "son"], media: [photo("s1", { ref: true })] };
  return d;
}
const ids = (d: ProfilesData) => Object.fromEntries(Object.values(d.nodes).map((n) => [n.name, n.id]));

const person = (id: string, name: string, extra: Partial<Person> = {}): Person => ({ id, name, role: "other", refs: [], createdAt: "2026-01-01", ...extra });
const photos = (people: Person[], categories: PhotoCategory[] = []): PhotosData => ({ people, categories, settings: { driveBackup: false } });

describe("identity registry", () => {
  it("makes one identity per live person profile — not things, not examples", () => {
    const d = world();
    const cards = buildIdentities(d);
    expect(cards.map((c) => c.name).sort()).toEqual(["Brandy", "Ms. Lee", "My Son"]);
    expect(cards.every((c) => d.nodes[c.id].kind === "person")).toBe(true);
  });

  it("keeps private rows out of every card and every memory", () => {
    const brandy = buildIdentities(world()).find((c) => c.name === "Brandy")!;
    expect(brandy.facts).toEqual(["Birthday: Mar 4"]);
    const mem = identityMemory(brandy);
    expect(mem.externalId).toBe(`identity:${brandy.id}`);
    expect(mem.content).not.toContain("123-45-6789");
    expect(mem.content).not.toMatch(/data:image/);
  });

  it("is enrolled only with consent AND a reference photo in the profile itself", () => {
    const cards = buildIdentities(world());
    const brandy = cards.find((c) => c.name === "Brandy")!;
    const son = cards.find((c) => c.name === "My Son")!;
    // b3 is a library read-back: never a reference, even when flagged.
    expect(brandy.refCount).toBe(1);
    expect(brandy.enrolled).toBe(true);
    expect(son.refCount).toBe(1);
    expect(son.enrolled).toBe(false); // no consent
    expect(brandy.role).toBe("partner");
  });

  it("works out who a sentence means — name, nickname, relationship — and flags ambiguity", () => {
    const d = world();
    const cards = buildIdentities(d);
    const n = ids(d);
    expect(resolveMentions("what did bran want for her birthday?", cards).mentions[0].id).toBe(n.Brandy);
    expect(resolveMentions("Is Brandy free Friday", cards).mentions[0]).toMatchObject({ id: n.Brandy, score: 1 });
    expect(resolveMentions("when is my son's dentist visit", cards).mentions[0].id).toBe(n["My Son"]);
    expect(resolveMentions("Leo needs new cleats", cards).mentions[0].id).toBe(n["My Son"]);

    const twice = applyChanges(d, [{ op: "add_node", parent: ROOT, name: "Brandy Cole", kind: "person" }]).data;
    const r = resolveMentions("call brandy", buildIdentities(twice));
    expect(r.mentions).toHaveLength(0);
    expect(r.ambiguous[0].ids).toHaveLength(2);
    // The full name settles it.
    expect(resolveMentions("call Brandy Cole", buildIdentities(twice)).mentions[0].name).toBe("Brandy Cole");
  });

  it("puts the people a message names first in the prompt block, and asks about ambiguous ones", () => {
    const d = applyChanges(world(), [{ op: "add_node", parent: ROOT, name: "Brandy Cole", kind: "person" }]).data;
    const block = identityDigest(buildIdentities(d), "is leo at school? and text brandy");
    expect(block.indexOf("Mentioned in this message")).toBeLessThan(block.indexOf("Everyone else"));
    expect(block).toContain("My Son [identity");
    expect(block).toMatch(/Ambiguous[\s\S]*"brandy" could be/);
    expect(block).not.toMatch(/data:image/);
  });

  it("spots the same person filed twice", () => {
    const d = applyChanges(world(), [{ op: "add_node", parent: ROOT, name: "Brandy", kind: "person" }]).data;
    expect(findDuplicates(buildIdentities(d)).some((x) => x.key === "brandy" && x.ids.length === 2)).toBe(true);
  });
});

describe("confidence thresholds", () => {
  it("files sure matches, asks about middling ones, drops weak ones", () => {
    const s = normalizeFaceSettings({ autoAssign: 0.8, suggestFloor: 0.6 });
    const r = splitHits(
      [
        { personId: "a", confidence: 0.93 },
        { personId: "b", confidence: 0.7 },
        { personId: "c", confidence: 0.52 },
        { personId: "a", confidence: 0.4 },
      ],
      s,
    );
    expect(r.confirmed.map((h) => h.personId)).toEqual(["a"]);
    expect(r.uncertain.map((h) => h.personId)).toEqual(["b"]);
    expect(r.dropped).toBe(1);
  });

  it("recognises nobody when switched off, and keeps the floor under the auto-assign line", () => {
    expect(splitHits([{ personId: "a", confidence: 0.99 }], { ...DEFAULT_FACE_SETTINGS, enabled: false }).confirmed).toHaveLength(0);
    const s = normalizeFaceSettings({ autoAssign: 0.7, suggestFloor: 0.95 });
    expect(s.suggestFloor).toBeLessThanOrEqual(s.autoAssign);
    expect(normalizeFaceSettings({ suggestFloor: 0.1 }).suggestFloor).toBe(0.5);
  });
});

describe("Profiles → Camera Autopilot", () => {
  it("carries a legacy Photos person's hand-picked faces into the profile of the same name, once", () => {
    const d = world();
    const n = ids(d);
    // No reference marked in the profile yet (one marked there would supersede the old faces).
    d.nodes[n["My Son"]].media = [];
    // Leo is "My Son" in Profiles; the Photos tab called him Leo.
    const legacy = photos([person("per_leo", "Leo", { role: "child", refs: [PIC, PIC] }), person("per_gran", "Grandma June", { role: "relative", refs: [PIC] })]);
    const { changes, carried } = carryPlan(d, legacy);
    expect(carried).toEqual(["per_leo", "per_gran"]);
    const after = applyChanges(d, changes).data;
    const son = after.nodes[n["My Son"]];
    // My Son had no consent decision yet, so the old faces come over with consent marked "carried".
    expect(son.media.filter((m) => m.ref && m.id.startsWith("m-carried"))).toHaveLength(2);
    expect(son.faceConsent).toMatchObject({ granted: true, by: "carried" });
    // Nobody called Grandma June existed: one new person profile, not a duplicate.
    const june = Object.values(after.nodes).filter((x) => x.name === "Grandma June");
    expect(june).toHaveLength(1);
    expect(june[0].kind).toBe("person");
    // Marked as done, it never carries again.
    const marked = { ...after, imported: carried.map(carriedKey) };
    expect(carryPlan(marked, legacy).carried).toEqual([]);
  });

  it("waits for the owner's real My Profile instead of making a second 'you'", () => {
    const { changes, carried } = carryPlan(world(), photos([person("per_me", "Jack", { role: "self", refs: [PIC] })]));
    expect(changes).toEqual([]);
    expect(carried).toEqual([]);
  });

  it("leaves an ambiguous or first-name-only match for the owner instead of guessing", () => {
    const d = applyChanges(world(), [
      { op: "add_node", parent: ROOT, name: "Chris", kind: "person", label: "Friend" },
      { op: "add_node", parent: ROOT, name: "Chris", kind: "person", label: "Coworker" },
      { op: "add_node", parent: ROOT, name: "Sam Ortiz", kind: "person" },
    ]).data;
    const before = Object.keys(d.nodes).length;
    const { changes, carried } = carryPlan(d, photos([person("per_c", "Chris", { refs: [PIC] })]));
    expect(changes).toEqual([]);
    expect(carried).toEqual([]); // not marked: offered again once the owner decides
    // "Sam" alone never moves a face into Sam Ortiz's profile — it becomes its own profile.
    const sam = carryPlan(d, photos([person("per_s", "Sam", { refs: [PIC] })]));
    expect(sam.changes.some((c) => c.op === "add_node")).toBe(true);
    expect(Object.keys(applyChanges(d, sam.changes).data.nodes).length).toBe(before + 1);
  });

  it("keeps hand-uploaded faces in the Photos tab until Profiles provably holds them", () => {
    const d = world();
    const n = ids(d);
    const legacy = photos([person("per_b", "Brandy", { refs: [PIC], sheet: { appearance: "from library photos", identifiers: [], builtFrom: 5, builtAt: "t" } })]);
    const pending = linkPlan(d, legacy).people[0];
    expect(pending.identityId).toBe(n.Brandy);
    expect(pending.refs).toEqual([PIC]); // carry not saved yet
    // A description written before linking (partly from the library) never steers recognition.
    expect(pending.sheet).toBeNull();
    const done = linkPlan({ ...d, imported: [carriedKey("per_b")] }, legacy).people[0];
    expect(done.refs).toEqual([]);
  });

  it("strips library reference pictures from any album about a person", () => {
    const d = world();
    const n = ids(d);
    const p = photos(
      [person("per_b", "Brandy", { identityId: n.Brandy })],
      [
        { id: "pair", name: "Us", requires: ["per_b"], exact: true, minPeople: 2, order: 20, builtIn: false, refs: [PIC] },
        { id: "named", name: "Brandy", requires: [], exact: false, minPeople: 0, order: 60, builtIn: false, refs: [PIC] },
        { id: "truck", name: "My Truck", requires: [], exact: false, minPeople: 0, order: 60, builtIn: false, refs: [PIC] },
      ],
    );
    const albums = recognitionPeople(d, p, {}, true).albums;
    expect(albums.find((c) => c.id === "pair")?.refs).toEqual([]);
    expect(albums.find((c) => c.id === "named")?.refs).toEqual([]);
    expect(albums.find((c) => c.id === "truck")?.refs).toEqual([PIC]);
  });

  it("keeps pixels out of identity cards", () => {
    const d = world();
    const n = ids(d);
    const r = applyChanges(d, [{ op: "add_item", node: n.Brandy, section: "Details", k: "Badge", v: "data:image/png;base64,QUJDRA==" }]).data;
    const card = buildIdentities(r).find((c) => c.id === n.Brandy)!;
    expect(card.facts.join(" ")).not.toMatch(/data:image/);
    expect(identityMemory(card).content).toContain("[image]");
  });

  it("never overrides a consent decision the owner already made", () => {
    const d = world();
    const n = ids(d);
    d.nodes[n["My Son"]].faceConsent = { granted: false, at: "x", by: "owner" };
    const { changes } = carryPlan(d, photos([person("per_leo", "Leo", { refs: [PIC] })]));
    expect(changes).toEqual([]);
  });

  it("links one Photos person per identity, holding no faces of its own", () => {
    const d = world();
    const n = ids(d);
    const before = photos([person("per_b", "Brandy", { refs: [PIC], role: "partner" }), person("per_x", "Stranger", { refs: [PIC] })]);
    // Her old faces were already carried into Profiles (marker saved).
    const plan = linkPlan({ ...d, imported: [carriedKey("per_b")] }, before);
    const brandy = plan.people.find((p) => p.identityId === n.Brandy)!;
    expect(brandy.id).toBe("per_b"); // adopted, not duplicated
    expect(brandy.refs).toEqual([]); // faces come from the profile at match time
    expect(plan.people.filter((p) => p.identityId === n.Brandy)).toHaveLength(1);
    // Not enrolled (no consent) → no Photos person is created for My Son.
    expect(plan.people.some((p) => p.identityId === n["My Son"])).toBe(false);
    // Someone with no profile stays listed, unlinked.
    expect(plan.people.find((p) => p.id === "per_x")?.identityId).toBeUndefined();
  });

  it("follows a rename, and deletes the description when consent is withdrawn", () => {
    const d = world();
    const n = ids(d);
    const linked = photos([person("per_b", "Brandy", { identityId: n.Brandy, sheet: { appearance: "a", identifiers: ["x"], builtFrom: 1, builtAt: "t" } })]);
    d.nodes[n.Brandy] = { ...d.nodes[n.Brandy], name: "Brandy Lee", faceConsent: { granted: false, at: "t", by: "owner" } };
    const plan = linkPlan(d, linked);
    expect(plan.people[0].name).toBe("Brandy Lee");
    expect(plan.people[0].sheet).toBeNull();
    expect(plan.revoked).toContain(n.Brandy);
  });

  it("matches only enrolled identities, with profile faces, and ignores a person-folder's library pictures", () => {
    const d = world();
    const n = ids(d);
    const p = photos(
      [person("per_b", "Brandy", { identityId: n.Brandy, refs: ["data:image/jpeg;base64,FOLDER"] }), person("per_s", "My Son", { identityId: n["My Son"] }), person("per_x", "Stranger", { refs: [PIC] })],
      [
        { id: "cat_solo_per_b", name: "Brandy", requires: ["per_b"], exact: true, minPeople: 1, order: 10, builtIn: true, personId: "per_b", refs: ["data:image/jpeg;base64,FOLDERPIC"] },
        { id: "truck", name: "My Truck", requires: [], exact: false, minPeople: 0, order: 60, builtIn: false, refs: [PIC] },
      ],
    );
    const cast = recognitionPeople(d, p, { [n.Brandy]: ["data:image/jpeg;base64,TEMPLATE"] }, true);
    expect(cast.people.map((x) => x.id)).toEqual(["per_b"]);
    expect(cast.people[0].refs).toEqual(["data:image/jpeg;base64,TEMPLATE"]);
    expect(cast.albums.find((c) => c.id === "cat_solo_per_b")?.refs).toEqual([]);
    expect(cast.albums.find((c) => c.id === "truck")?.refs).toEqual([PIC]); // things still sort by example
    expect(recognitionPeople(d, p, { [n.Brandy]: [PIC] }, false).people).toEqual([]);
  });
});

describe("one-way images", () => {
  const empty: RecallData = { folders: [], items: [], profiles: [] };

  it("copies profile uploads into the library tagged with the identity, and never reads the library back", () => {
    const d = world();
    const n = ids(d);
    d.nodes[n.Brandy].media = [photo("up1")];
    const plan = mirrorPlan(d, empty);
    const copied = plan.recall.items.find((i) => i.kind === "image")!;
    expect(copied.identityIds).toEqual([n.Brandy]);
    const folder = plan.recall.folders.find((f) => f.id === plan.links[n.Brandy].folderId)!;
    expect(folder.identityId).toBe(n.Brandy);

    // A picture filed into her library folder (e.g. by Camera Autopilot).
    const lib: RecallData = {
      ...plan.recall,
      items: [...plan.recall.items, { id: "auto1", title: "Beach", body: "", summary: "", kind: "image", source: "manual", folderId: null, identityIds: [n.Brandy], tags: [], attachment: { name: "b", type: "image/jpeg", size: 1, url: PIC, category: "image" }, createdAt: "t", updatedAt: "t" }],
    };
    const node = { ...d.nodes[n.Brandy], recall: plan.links[n.Brandy], media: [{ ...d.nodes[n.Brandy].media[0], recallItemId: plan.media.up1 }] };
    const offered = libraryMediaFor(node, lib);
    expect(offered.map((m) => m.caption)).toEqual(["Beach"]);
    // Offered for picking only: the profile itself is unchanged and nothing in it is a reference.
    expect(node.media.map((m) => m.id)).toEqual(["up1"]);
    expect(buildIdentities({ ...d, nodes: { ...d.nodes, [n.Brandy]: node } }).find((c) => c.id === n.Brandy)!.refCount).toBe(0);
  });

  it("refuses to flag a library read-back as a face reference", () => {
    const d = world();
    const n = ids(d);
    const r = applyChanges(d, [{ op: "patch_media", node: n.Brandy, media: "b3", patch: { ref: true } }]);
    expect(r.done).toHaveLength(0);
    expect(r.skipped[0]).toMatch(/Images library/);
  });

  it("flags a profile photo as a reference with an undo, and the profile picture goes with its photo", () => {
    const d = world();
    const n = ids(d);
    const r = applyChanges(d, [{ op: "patch_media", node: n.Brandy, media: "b2", patch: { ref: true } }]);
    expect(r.data.nodes[n.Brandy].media.find((m) => m.id === "b2")?.ref).toBe(true);
    const undone = applyChanges(r.data, r.undo);
    expect(undone.data.nodes[n.Brandy].media.find((m) => m.id === "b2")?.ref).toBeUndefined();

    const withPic = applyChanges(d, [{ op: "patch_node", node: n.Brandy, patch: { primaryMediaId: "b1", avatar: PIC } }]).data;
    const gone = applyChanges(withPic, [{ op: "remove_media", node: n.Brandy, ids: ["b1"] }]).data;
    expect(gone.nodes[n.Brandy].avatar).toBeUndefined();
    expect(gone.nodes[n.Brandy].primaryMediaId).toBeUndefined();
  });
});

describe("face data at rest", () => {
  const KEY = Buffer.alloc(32, 7).toString("base64");

  it("seals and opens for the same account only", () => {
    const sealed = seal('{"x":["data:image/jpeg;base64,AAAA"]}', "user-1", KEY);
    expect(sealed).not.toContain("AAAA");
    expect(open(sealed, "user-1", KEY)).toContain("AAAA");
    expect(() => open(sealed, "user-2", KEY)).toThrow();
    expect(() => open(sealed, "user-1", Buffer.alloc(32, 9).toString("base64"))).toThrow();
  });

  it("reports unconfigured without a 32-byte key, and refuses to seal", () => {
    expect(configured("")).toBe(false);
    expect(configured(Buffer.alloc(16).toString("base64"))).toBe(false);
    expect(configured(KEY)).toBe(true);
    expect(() => seal("x", "u", "")).toThrow(/IDENTITY_ENC_KEY/);
  });
});
