import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The same filesystem fallback the present-route tests use: no Supabase env
// vars, so the store writes to a real temp directory and the route runs end
// to end.
const dir = mkdtempSync(path.join(tmpdir(), "push-route-"));
process.env.RECALL_DATA_DIR = dir;

const { mintToken, receive, pending } = await import("@/lib/dashboard/inbox");
const { POST } = await import("./route");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
async function account(photos: string[] = []) {
  const uid = `push-u${++n}`;
  const token = (await mintToken(uid)) ?? "";
  if (photos.length)
    await receive(
      uid,
      photos.map((name) => ({
        deviceId: `${uid}-${name}`,
        name,
        contentType: "image/jpeg",
        takenAt: new Date().toISOString(),
        body: Buffer.from(`pixels-${uid}-${name}`),
      })),
    );
  return { uid, token };
}

function post(token: string, fill: (form: FormData) => void) {
  const body = new FormData();
  fill(body);
  return POST(new Request(`https://x.test/api/dashboard/inbox/push?key=${encodeURIComponent(token)}`, { method: "POST", body }));
}

/*
 * The clean-up posting here instead of to /present is the mis-wiring that cost
 * weeks: Shortcuts fills a Get Contents of URL's URL box in by itself and
 * usually picks the first URL action in the Shortcut. Running it rather than
 * refusing it is what lets the setup hand out ONE link for both jobs.
 */
describe("POST /inbox/push — a clean-up list arriving at the sending link", () => {
  it("runs the clean-up, so one link does both jobs", async () => {
    const { uid, token } = await account(["a.jpg", "b.jpg", "c.jpg"]);
    const res = await post(token, (f) => f.append("names", "a.jpg\nb.jpg"));
    const body = (await res.json()) as { removed: number; checked: number };

    expect(res.status).toBe(200);
    expect(body).toEqual({ removed: 1, checked: 2 });
    expect((await pending(uid)).map((p) => p.name).sort()).toEqual(["a.jpg", "b.jpg"]);
  });

  it("takes the field however the Shortcut labelled it", async () => {
    const { uid, token } = await account(["x.jpg", "y.jpg"]);
    const res = await post(token, (f) => f.append("combined names", "x.jpg"));
    const body = (await res.json()) as { removed: number; checked: number };

    expect(body).toEqual({ removed: 1, checked: 1 });
    expect((await pending(uid)).map((p) => p.name)).toEqual(["x.jpg"]);
  });

  it("never reads a photo field sent as text as the list of names", async () => {
    // Reading "Converted Image" as the photos still on the phone would delete
    // every other one in the queue — so only a field that says it holds names
    // counts, and this stays the File-field answer.
    const { uid, token } = await account(["keep.jpg"]);
    const res = await post(token, (f) => f.append("photos", "Converted Image"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/arrived as text/i);
    expect(body.error).toMatch(/File/);
    expect((await pending(uid)).map((p) => p.name)).toEqual(["keep.jpg"]);
  });

  it("says the request was empty when nothing came at all", async () => {
    const { token } = await account();
    const res = await post(token, () => {});
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/empty/i);
  });

  it("refuses a token it does not know before touching the queue", async () => {
    const res = await post("not-a-real-token", (f) => f.append("names", "a.jpg"));
    expect(res.status).toBe(401);
  });
});
