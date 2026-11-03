import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The same filesystem fallback the present-route tests use: no Supabase env
// vars, so the store writes to a real temp directory and the route runs end
// to end.
const dir = mkdtempSync(path.join(tmpdir(), "push-route-"));
process.env.RECALL_DATA_DIR = dir;

const { mintToken } = await import("@/lib/dashboard/inbox");
const { POST } = await import("./route");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
async function account() {
  const uid = `push-u${++n}`;
  return { uid, token: (await mintToken(uid)) ?? "" };
}

function post(token: string, fill: (form: FormData) => void) {
  const body = new FormData();
  fill(body);
  return POST(new Request(`https://x.test/api/dashboard/inbox/push?key=${encodeURIComponent(token)}`, { method: "POST", body }));
}

/*
 * The clean-up posting to the sending link is the mis-wiring that cost weeks.
 * Shortcuts fills a Get Contents of URL's URL box in by itself and often
 * picks the first URL action in the Shortcut, so the names list arrives here
 * instead of at /present. Both requests then look healthy from the phone —
 * photos keep arriving, and the 400 for the clean-up is never read.
 */
describe("POST /inbox/push — when the clean-up list arrives by mistake", () => {
  it("names the real problem instead of talking about the photo field", async () => {
    const { token } = await account();
    const res = await post(token, (f) => f.append("names", "IMG_0001.HEIC\nIMG_0002.HEIC"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/clean-up list/i);
    expect(body.error).toMatch(/\/present/);
    // The generic answer for a text field is to make it a File and point it at
    // the image. Following that here breaks the clean-up for good.
    expect(body.error).not.toMatch(/File field|Add new field/i);
  });

  it("still gives the File-field answer for a photo field sent as text", async () => {
    const { token } = await account();
    const res = await post(token, (f) => f.append("photos", "Converted Image"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/arrived as text/i);
    expect(body.error).toMatch(/File/);
    expect(body.error).not.toMatch(/clean-up/i);
  });

  it("says the request was empty when nothing came at all", async () => {
    const { token } = await account();
    const res = await post(token, () => {});
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/empty/i);
  });

  it("refuses a token it does not know before reading the form", async () => {
    const res = await post("not-a-real-token", (f) => f.append("names", "IMG_0001.HEIC"));
    expect(res.status).toBe(401);
  });
});
