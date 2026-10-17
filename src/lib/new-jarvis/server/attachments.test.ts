import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseServerClient: async () => null }));

const blobs = new Map<string, Buffer>();
vi.mock("@/lib/server/blobStore", () => ({
  isRemoteConfigured: () => false,
  ensureBucket: async () => true,
  signedBlobUrl: async () => null,
  signedUploadUrl: async () => null,
  putBlob: async (_b: string, key: string, _d: string, body: Buffer) => (blobs.set(key, body), true),
  getBlob: async (_b: string, key: string) => blobs.get(key) ?? null,
}));

const mod = await import("./attachments");

describe("keys", () => {
  it("issues keys under the caller and only accepts their own", () => {
    const key = mod.attachmentKey("user-1", "My Clip (final).mp4");
    expect(key).toMatch(/^user-1\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{12}-My-Clip-final-\.mp4$/);
    expect(mod.ownsKey("user-1", key)).toBe(true);
    expect(mod.ownsKey("user-2", key)).toBe(false);
    expect(mod.ownsKey("user-1", "user-1/../user-2/x")).toBe(false);
    expect(mod.ownsKey("user-1", 42)).toBe(false);
  });

  it("points a local hub's upload at its own route, and refuses oversize files", async () => {
    const t = await mod.uploadTarget("local", "a.mp4", 1000);
    expect(t.url).toBe(`/api/new-jarvis/attachments?key=${encodeURIComponent(t.key)}`);
    await expect(mod.uploadTarget("local", "a.mp4", 60 * 1024 * 1024)).rejects.toThrow(/50 MB/);
    await expect(mod.uploadTarget("local", "a.mp4", 0)).rejects.toThrow(/empty/);
  });
});

describe("cleanPart", () => {
  it("keeps the shapes the page sends and drops everything else", () => {
    expect(mod.cleanPart({ type: "text", text: "hi" })).toEqual({ type: "text", text: "hi" });
    expect(mod.cleanPart({ type: "image_url", image_url: { url: "data:image/png;base64,AA" } })).not.toBeNull();
    expect(mod.cleanPart({ type: "image_url", image_url: { url: "http://evil/x.png" } })).toBeNull();
    expect(mod.cleanPart({ type: "image_url", image_url: { url: "file:///etc/passwd" } })).toBeNull();
    expect(mod.cleanPart({ type: "file", file: { filename: "a", file_data: "data:text/html;base64,AA" } })).toBeNull();
    expect(mod.cleanPart({ type: "input_audio", input_audio: { data: "QUJD", format: "mp3" } })).not.toBeNull();
    expect(mod.cleanPart({ type: "tool_result", x: 1 })).toBeNull();
    expect(mod.cleanPart({ type: "stored", stored: { key: "k", kind: "exe" } })).toBeNull();
  });
});

describe("resolveContent", () => {
  it("swaps an uploaded file for what the model reads", async () => {
    const audioKey = mod.attachmentKey("local", "voice.mp3");
    const pdfKey = mod.attachmentKey("local", "plan.pdf");
    const clipKey = mod.attachmentKey("local", "clip.mp4");
    blobs.set(audioKey, Buffer.from("ABC"));
    blobs.set(pdfKey, Buffer.from("%PDF"));
    blobs.set(clipKey, Buffer.from("MP4"));

    const out = await mod.resolveContent(
      [
        { type: "text", text: "listen" },
        { type: "stored", stored: { key: audioKey, name: "voice.mp3", mime: "audio/mpeg", kind: "audio" } },
        { type: "stored", stored: { key: pdfKey, name: "plan.pdf", mime: "application/pdf", kind: "pdf" } },
        { type: "stored", stored: { key: clipKey, name: "clip.mp4", mime: "video/mp4", kind: "video" } },
      ],
      "local",
    );
    expect(out).toEqual([
      { type: "text", text: "listen" },
      { type: "input_audio", input_audio: { data: Buffer.from("ABC").toString("base64"), format: "mp3" } },
      { type: "file", file: { filename: "plan.pdf", file_data: `data:application/pdf;base64,${Buffer.from("%PDF").toString("base64")}` } },
      { type: "video_url", video_url: { url: `data:video/mp4;base64,${Buffer.from("MP4").toString("base64")}` } },
    ]);
  });

  it("never opens someone else's file, and says what is missing", async () => {
    const theirs = mod.attachmentKey("someone-else", "secret.pdf");
    blobs.set(theirs, Buffer.from("%PDF"));
    const out = (await mod.resolveContent(
      [{ type: "stored", stored: { key: theirs, name: "secret.pdf", mime: "application/pdf", kind: "pdf" } }],
      "local",
    )) as { type: string; text?: string }[];
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("text");
    expect(out[0].text).toMatch(/secret\.pdf could not be loaded/);
  });

  it("passes a plain string through, capped", async () => {
    expect(await mod.resolveContent("hello", null)).toBe("hello");
  });
});
