import { describe, expect, it } from "vitest";
import {
  audioFormat,
  historyText,
  INLINE_BUDGET_BYTES,
  INLINE_FILE_BYTES,
  kindOf,
  MAX_UPLOAD_BYTES,
  needsUpload,
  refusal,
  shown,
  toParts,
  type ChatAttachment,
} from "./attachments";

const att = (p: Partial<ChatAttachment>): ChatAttachment => ({
  id: "a",
  name: "x",
  kind: "image",
  mime: "image/jpeg",
  size: 1000,
  state: "ready",
  ...p,
});

describe("kindOf", () => {
  it("sorts media, PDFs and text, and turns away what no model reads", () => {
    expect(kindOf("image/png", "a.png")).toBe("image");
    expect(kindOf("video/quicktime", "a.mov")).toBe("video");
    expect(kindOf("audio/mpeg", "a.mp3")).toBe("audio");
    expect(kindOf("application/pdf", "a.pdf")).toBe("pdf");
    expect(kindOf("", "report.PDF")).toBe("pdf");
    expect(kindOf("", "HFT_Secret_v2.mq4")).toBe("text");
    expect(kindOf("application/json", "x.json")).toBe("text");
    expect(kindOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBeNull();
    expect(kindOf("application/octet-stream", "EA.ex4")).toBeNull();
  });

  it("explains a refusal in words the owner can act on", () => {
    expect(refusal("a.docx", 10, null)).toMatch(/PDF/);
    expect(refusal("big.mp4", MAX_UPLOAD_BYTES + 1, "video")).toMatch(/limit/);
    expect(refusal("ok.mp4", 10, "video")).toBeNull();
  });
});

describe("needsUpload", () => {
  it("never uploads pictures or text — only shrunk pixels and words travel", () => {
    expect(needsUpload("image", 40 * 1024 * 1024, 0)).toBe(false);
    expect(needsUpload("text", 40 * 1024 * 1024, 0)).toBe(false);
  });

  it("keeps small media inline and sends big media to Storage", () => {
    expect(needsUpload("audio", 500_000, 0)).toBe(false);
    expect(needsUpload("video", INLINE_FILE_BYTES + 1, 0)).toBe(true);
    expect(needsUpload("pdf", 1_000_000, INLINE_BUDGET_BYTES - 500_000)).toBe(true);
  });
});

describe("audioFormat", () => {
  it("names the format input_audio expects", () => {
    expect(audioFormat("audio/mpeg", "a")).toBe("mp3");
    expect(audioFormat("audio/x-wav", "a")).toBe("wav");
    expect(audioFormat("audio/mp4", "voice.m4a")).toBe("m4a");
    expect(audioFormat("", "song.flac")).toBe("flac");
  });
});

describe("toParts", () => {
  it("is plain text when nothing is attached", () => {
    expect(toParts("hi", [])).toEqual([{ type: "text", text: "hi" }]);
  });

  it("leads with a numbered list and gives each file the part a model perceives", () => {
    const parts = toParts("what is in these?", [
      att({ id: "1", name: "cat.jpg", picture: "data:image/jpeg;base64,AAA" }),
      att({ id: "2", name: "clip.mp4", kind: "video", mime: "video/mp4", key: "u/2026-10-16/abcdefabcdef-clip.mp4", durationSec: 12 }),
      att({ id: "3", name: "note.mp3", kind: "audio", mime: "audio/mpeg", inline: "data:audio/mpeg;base64,QUJD", note: "Tempo 120 BPM" }),
      att({ id: "4", name: "plan.pdf", kind: "pdf", mime: "application/pdf", inline: "data:application/pdf;base64,JVBE" }),
      att({ id: "5", name: "ea.mq4", kind: "text", mime: "", text: "int OnInit(){}" }),
      att({ id: "6", name: "broken.mp4", kind: "video", state: "failed" }),
    ]);
    const text = parts[0];
    expect(text.type).toBe("text");
    const t = (text as { text: string }).text;
    expect(t).toMatch(/^what is in these\?/);
    expect(t).toMatch(/Attached \(5\)/);
    expect(t).toMatch(/2\. clip\.mp4 — video, 12s/);
    expect(t).toMatch(/Measured: Tempo 120 BPM/);
    expect(t).toMatch(/--- ea\.mq4 ---[\s\S]*int OnInit/);
    expect(t).not.toMatch(/broken/);

    expect(parts.slice(1)).toEqual([
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAA" } },
      { type: "stored", stored: { key: "u/2026-10-16/abcdefabcdef-clip.mp4", name: "clip.mp4", mime: "video/mp4", kind: "video" } },
      { type: "input_audio", input_audio: { data: "QUJD", format: "mp3" } },
      { type: "file", file: { filename: "plan.pdf", file_data: "data:application/pdf;base64,JVBE" } },
    ]);
  });

  it("sends a clip's frame, and says so, when the clip itself could not go", () => {
    const parts = toParts("", [att({ name: "big.mov", kind: "video", picture: "data:image/jpeg;base64,F" })]);
    expect((parts[0] as { text: string }).text).toMatch(/Look at what I attached[\s\S]*only a still frame/);
    expect(parts[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,F" } });
  });
});

describe("history and display", () => {
  it("names earlier attachments without resending them", () => {
    expect(historyText("do it", undefined)).toBe("do it");
    expect(historyText("do it", [{ name: "a.mp4", kind: "video" }])).toMatch(/not resent: a\.mp4 \(video\)/);
  });

  it("keeps only what a saved block needs", () => {
    expect(shown([att({ name: "a.jpg", thumb: "t", picture: "big" }), att({ state: "failed" })])).toEqual([
      { name: "a.jpg", kind: "image", thumb: "t" },
    ]);
  });
});
