import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Same filesystem fallback the prune tests use: no Supabase env vars, so the
// store writes to a real temp directory and the route runs end to end.
const dir = mkdtempSync(path.join(tmpdir(), "present-route-"));
process.env.RECALL_DATA_DIR = dir;

const { mintToken, receive, pending } = await import("@/lib/dashboard/inbox");
const { POST } = await import("./route");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
async function account(names: string[]) {
  const uid = `present-u${++n}`;
  const token = await mintToken(uid);
  await receive(
    uid,
    names.map((name) => ({
      deviceId: `${uid}-${name}`,
      name: `${uid}_${name}.jpg`,
      contentType: "image/jpeg",
      takenAt: new Date().toISOString(),
      body: Buffer.from(`pixels-${uid}-${name}`),
    })),
  );
  return { uid, token: token ?? "" };
}

function post(token: string, form: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.append(k, v);
  return POST(new Request(`https://x.test/api/dashboard/inbox/present?key=${encodeURIComponent(token)}`, { method: "POST", body }));
}

describe("POST /inbox/present — the form field", () => {
  it("reads the names however the Shortcut's field got labelled", async () => {
    // The field name is typed by hand on a phone. This one said "combined
    // names" because that is what an older error message told the owner to
    // put there, and the whole clean-up silently did nothing.
    const { uid, token } = await account(["a", "b", "c", "d", "e", "f"]);
    const still = ["a", "b", "c", "d", "e"].map((s) => `${uid}_${s}.jpg`).join("\n");

    const res = await post(token, { "combined names": still });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removed: 1, checked: 5 });
    expect((await pending(uid)).map((e) => e.name)).not.toContain(`${uid}_f.jpg`);
  });

  it("still prefers a field actually called names", async () => {
    const { uid, token } = await account(["a", "b", "c", "d", "e", "f"]);
    const still = ["a", "b", "c", "d", "e"].map((s) => `${uid}_${s}.jpg`).join("\n");

    const res = await post(token, { names: still, other: "ignore me" });
    expect(await res.json()).toMatchObject({ removed: 1, checked: 5 });
  });

  it("says which variable is missing when nothing came through", async () => {
    const { token } = await account(["a"]);
    const res = await post(token, { names: "" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Combined Text/);
  });

  it("does not mistake days for the photo names", async () => {
    const { token } = await account(["a"]);
    const res = await post(token, { days: "30" });
    expect(res.status).toBe(400);
  });
});
