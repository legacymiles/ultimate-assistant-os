import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A real data directory. With no Supabase env vars set, docStore and blobStore
// fall back to the filesystem, so prune runs the same code paths it does in
// production — blob deletes included.
const dir = mkdtempSync(path.join(tmpdir(), "prune-test-"));
process.env.RECALL_DATA_DIR = dir;

const { mintToken, receive, prune, pending } = await import("./inbox");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

await mintToken("local");

/*
 * Every test owns its own uid and its own photo names.
 *
 * The document is shared — one file, one `seen` ring — so wiping it between
 * tests would race the writes the previous test is still finishing, and a
 * photo that came back as "already seen" would make a later assertion fail for
 * a reason that has nothing to do with the behaviour under test. Separate uids
 * cost nothing and make the order irrelevant.
 */
let n = 0;
function scope() {
  const uid = `u${++n}`;
  return {
    uid,
    photo: (name: string) => ({
      deviceId: `${uid}-${name}`,
      name: `${uid}_${name}.jpg`,
      contentType: "image/jpeg",
      takenAt: new Date().toISOString(),
      body: Buffer.from(`pixels-${uid}-${name}`),
    }),
    named: (...names: string[]) => names.map((s) => `${uid}_${s}.jpg`),
  };
}

describe("prune — the guard", () => {
  it("refuses when one name would delete the whole queue", async () => {
    // Exactly the shape that cost 45 photos: a Shortcut wired to a single
    // image reports one name, which read literally means "all the rest are
    // gone". It must not be read literally.
    const s = scope();
    await receive(s.uid, ["a", "b", "c", "d", "e", "f"].map(s.photo));
    expect(await pending(s.uid)).toHaveLength(6);

    const r = await prune(s.uid, s.named("a"), 30);
    expect(r.removed).toBe(0);
    expect(r.refused).toMatch(/would have deleted/i);
    expect(await pending(s.uid)).toHaveLength(6);
  });

  it("still deletes when the list is long enough to be evidence", async () => {
    const s = scope();
    await receive(s.uid, ["a", "b", "c", "d", "e", "f"].map(s.photo));
    // Five reported present, one absent — a believable report, so `f` goes.
    const r = await prune(s.uid, s.named("a", "b", "c", "d", "e"), 30);
    expect(r.removed).toBe(1);
    expect(r.refused).toBeUndefined();
    expect((await pending(s.uid)).map((e) => e.name)).not.toContain(`${s.uid}_f.jpg`);
  });

  it("allows a short list that is not deleting more than it reports", async () => {
    const s = scope();
    await receive(s.uid, ["a", "b"].map(s.photo));
    const r = await prune(s.uid, s.named("a"), 30);
    expect(r.removed).toBe(1);
    expect(r.refused).toBeUndefined();
  });

  it("deletes nothing when no names arrive", async () => {
    const s = scope();
    await receive(s.uid, ["a", "b"].map(s.photo));
    expect(await prune(s.uid, [], 30)).toMatchObject({ removed: 0 });
    expect(await pending(s.uid)).toHaveLength(2);
  });
});

describe("prune — reversibility", () => {
  it("forgets a pruned photo so sending it again brings it back", async () => {
    const s = scope();
    await receive(s.uid, ["a", "b", "c", "d", "e", "f"].map(s.photo));
    expect((await prune(s.uid, s.named("a", "b", "c", "d", "e"), 30)).removed).toBe(1);
    expect(await pending(s.uid)).toHaveLength(5);

    // `receive` skips anything still in `seen`. Without prune clearing those
    // keys, a photo deleted here — including one deleted in error, still
    // sitting in the camera roll — could never be sent again.
    expect(await receive(s.uid, [s.photo("f")])).toMatchObject({ accepted: 1, skipped: 0 });
    expect((await pending(s.uid)).map((e) => e.name)).toContain(`${s.uid}_f.jpg`);
  });
});
