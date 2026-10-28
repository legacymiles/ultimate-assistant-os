import { describe, expect, it } from "vitest";
import {
  EMPTY_DOC,
  FINISHED_DAYS,
  INBOX,
  RequestError,
  addRequests,
  attachInput,
  inputKey,
  completeRequest,
  describeForAgent,
  inFolder,
  normalizeDoc,
  noteRequest,
  openCounts,
  prune,
  removeRequest,
  reopenRequest,
  splitRequests,
  startRequest,
} from "./requests";

const now = new Date("2026-10-19T02:00:00Z");
let n = 0;
const ids = () => `q-${++n}`;

describe("splitRequests", () => {
  it("splits a list into one request per item", () => {
    expect(splitRequests("- add dark mode\n- fix the login\n3. faster search")).toEqual([
      "add dark mode",
      "fix the login",
      "faster search",
    ]);
  });
  it("keeps a paragraph that spans lines as one request", () => {
    expect(splitRequests("make the boy wave at the start\nand jump at the end")).toEqual([
      "make the boy wave at the start\nand jump at the end",
    ]);
  });
  it("ignores blank input", () => {
    expect(splitRequests("  \n ")).toEqual([]);
  });
});

describe("addRequests", () => {
  it("files newest first, keeps a split list in order, and puts pictures on the first", () => {
    const pic = "data:image/jpeg;base64,AAAA";
    const { doc, added } = addRequests(EMPTY_DOC, { folder: "flow:x", text: "- one\n- two", images: [pic] }, now, ids);
    expect(added.map((a) => a.text)).toEqual(["one", "two"]);
    expect(added[0].images).toEqual([pic]);
    expect(added[1].images).toEqual([]);
    expect(inFolder(doc, "flow:x").map((r) => r.text)).toEqual(["one", "two"]);
    const later = addRequests(doc, { folder: "flow:x", text: "three" }, new Date(now.getTime() + 1000), ids).doc;
    expect(inFolder(later, "flow:x")[0].text).toBe("three");
  });
  it("defaults to the inbox and never files the same open request twice", () => {
    const a = addRequests(EMPTY_DOC, { text: "Story: a lost puppy" }, now, ids).doc;
    expect(a.requests[0].folder).toBe(INBOX);
    const b = addRequests(a, { text: "story:  a LOST puppy" }, now, ids);
    expect(b.added).toEqual([]);
    expect(b.doc.requests).toHaveLength(1);
  });
  it("refuses empty requests and non-image attachments", () => {
    expect(() => addRequests(EMPTY_DOC, { text: " " }, now, ids)).toThrow(RequestError);
    const r = addRequests(EMPTY_DOC, { text: "x", images: ["javascript:alert(1)"] }, now, ids);
    expect(r.added[0].images).toEqual([]);
  });
});

describe("the queue cleans itself", () => {
  const base = addRequests(EMPTY_DOC, { folder: "app:jarvis", text: "- a\n- b" }, now, ids).doc;
  const [a, b] = inFolder(base, "app:jarvis");

  it("a completed request leaves its folder and lands in the finished log", () => {
    const done = completeRequest(base, a.id, "claude-code", "Shipped in abc123", now);
    expect(inFolder(done, "app:jarvis").map((r) => r.id)).toEqual([b.id]);
    expect(done.finished[0]).toMatchObject({ id: a.id, by: "claude-code", result: "Shipped in abc123" });
    expect(() => completeRequest(done, a.id, "x")).toThrow(/already be finished/);
  });

  it("start, note and reopen keep the owner informed", () => {
    let d = startRequest(base, a.id, "vps", now);
    expect(d.requests.find((r) => r.id === a.id)?.status).toBe("working");
    d = noteRequest(d, a.id, "needs ffmpeg", "vps", now);
    expect(d.requests.find((r) => r.id === a.id)?.notes[0].text).toBe("needs ffmpeg");
    d = completeRequest(d, a.id, "vps", undefined, now);
    d = reopenRequest(d, a.id, now);
    expect(inFolder(d, "app:jarvis")[0].id).toBe(a.id);
    expect(d.finished.find((f) => f.id === a.id)).toBeUndefined();
  });

  it("forgets finished entries after the window", () => {
    const d = completeRequest(base, a.id, "you", undefined, now);
    const later = new Date(now.getTime() + (FINISHED_DAYS + 1) * 86_400_000);
    expect(prune(d, later).finished).toEqual([]);
  });

  it("removing is not finishing", () => {
    const d = removeRequest(base, b.id);
    expect(d.finished).toEqual([]);
    expect(openCounts(d)).toEqual({ "app:jarvis": 1 });
  });
});

describe("normalizeDoc and the agent view", () => {
  it("survives garbage", () => {
    expect(normalizeDoc(null)).toEqual(EMPTY_DOC);
    expect(normalizeDoc({ requests: [{ id: "q-1", text: "hi" }, 3] }).requests[0]).toMatchObject({
      folder: INBOX,
      status: "open",
      images: [],
      notes: [],
    });
  });
  it("lists requests with folder names and picture links, never bytes", () => {
    const d = addRequests(EMPTY_DOC, { folder: "flow:animate-my-character", text: "lost kite", images: ["data:image/png;base64,AA"] }, now, () => "q-abc").doc;
    const text = describeForAgent(d, () => "Animate my character", (id, k) => `https://hub/api/x?id=${id}&n=${k}`);
    expect(text).toContain("q-abc · Animate my character (flow:animate-my-character) · open");
    expect(text).toContain("picture 1: GET https://hub/api/x?id=q-abc&n=0");
    expect(text).not.toContain("base64");
    expect(describeForAgent(EMPTY_DOC, String, String)).toBe("The queue is empty.");
  });
});

describe("videos sent back for a request", async () => {
  const { attachVideo, videoKey } = await import("./requests");
  it("derive their key, attach to open or finished requests, and travel into the finished log", () => {
    expect(videoKey("u-1", "q-abc")).toBe("queue/u-1/q-abc.mp4");
    expect(videoKey("../x", "q-a/../b")).toBe("queue/x/q-ab.mp4");
    const d = addRequests(EMPTY_DOC, { folder: "flow:animate-my-character", text: "kite" }, now, () => "q-v").doc;
    const withVideo = attachVideo(d, "q-v", videoKey("u", "q-v"), "pc", now);
    expect(withVideo.requests[0].video?.key).toBe("queue/u/q-v.mp4");
    const done = completeRequest(withVideo, "q-v", "pc", "Rendered 45 s", now);
    expect(done.finished[0].video?.key).toBe("queue/u/q-v.mp4");
    expect(attachVideo(done, "q-v", "k2", "pc", now).finished[0].video?.key).toBe("k2");
    expect(() => attachVideo(done, "q-nope", "k", "pc")).toThrow(RequestError);
  });
});

describe("input clips (Custom Video Swap's driving video)", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("keys the clip by account and request, never by a caller's path", () => {
    expect(inputKey("u-1/../x", "q-ab../c")).toBe("inputs/u-1x/q-abc.mp4");
  });
  it("records the clip on the open request, lists it for the agent, and keeps it when finished", () => {
    let d = addRequests(EMPTY_DOC, { folder: "flow:custom-video-swap", text: "swap" }, now, () => "q-in").doc;
    d = attachInput(d, "q-in", inputKey("u", "q-in"), "this browser", now);
    expect(d.requests[0].input?.key).toBe("inputs/u/q-in.mp4");
    const text = describeForAgent(d, () => "Custom Video Swap", String, undefined, (id) => `https://hub/input?id=${id}`);
    expect(text).toContain("driving clip: GET https://hub/input?id=q-in");
    const done = completeRequest(d, "q-in", "claude-code", undefined, now);
    expect(done.finished[0].input?.key).toBe("inputs/u/q-in.mp4");
  });
  it("refuses a clip for a request that isn't open", () => {
    expect(() => attachInput(EMPTY_DOC, "q-none", "k", "x")).toThrow(/No open request/);
  });
});
