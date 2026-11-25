import { describe, expect, it, vi } from "vitest";
import { LiveTalking, isOk } from "./livetalking";

const okJson = (body: unknown) => ({ ok: true, json: async () => body });

describe("isOk", () => {
  it("accepts code 0 and rejects everything else", () => {
    expect(isOk({ code: 0, msg: "ok" })).toBe(true);
    expect(isOk({ code: -1, msg: "no session" })).toBe(false);
    expect(isOk(null)).toBe(false);
    expect(isOk({})).toBe(false);
  });
});

describe("LiveTalking.offer", () => {
  it("posts sdp and type as JSON to /offer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ sdp: "answer-sdp", type: "answer", sessionid: 0 }));
    const answer = await new LiveTalking("http://127.0.0.1:8010", fetchMock).offer({ sdp: "my-sdp", type: "offer" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8010/offer");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ sdp: "my-sdp", type: "offer" });
    expect(answer.sessionid).toBe(0);
  });

  it("throws when the handshake is refused", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    await expect(new LiveTalking("http://x", fetchMock).offer({ sdp: "s", type: "offer" })).rejects.toThrow();
  });
});

describe("LiveTalking.speak", () => {
  it("posts the wav as multipart with sessionid and file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ code: 0, msg: "ok" }));
    const sent = await new LiveTalking("http://127.0.0.1:8010", fetchMock).speak(
      "0",
      new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }),
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8010/humanaudio");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("sessionid")).toBe("0");
    expect((init.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(sent).toBe(true);
  });

  it("never sets Content-Type by hand, so FormData can supply the boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ code: 0 }));
    await new LiveTalking("http://x", fetchMock).speak("0", new Blob([]));
    const headers = (fetchMock.mock.calls[0][1].headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers)).not.toContain("Content-Type");
  });

  it("reports false when LiveTalking rejects it, or is down", async () => {
    const rejecting = vi.fn().mockResolvedValue(okJson({ code: -1, msg: "no session" }));
    expect(await new LiveTalking("http://x", rejecting).speak("9", new Blob([]))).toBe(false);
    const down = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await new LiveTalking("http://x", down).speak("0", new Blob([]))).toBe(false);
  });
});

describe("LiveTalking.isSpeaking / interrupt / reachable", () => {
  it("reads whether the avatar is still talking", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ code: 0, data: false }));
    const lt = new LiveTalking("http://127.0.0.1:8010", fetchMock);
    expect(await lt.isSpeaking("0")).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8010/is_speaking");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sessionid: "0" });
  });

  it("assumes still speaking when it cannot tell, so turns never overlap", async () => {
    const down = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await new LiveTalking("http://x", down).isSpeaking("0")).toBe(true);
  });

  it("posts the sessionid to /interrupt_talk", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ code: 0 }));
    await new LiveTalking("http://127.0.0.1:8010", fetchMock).interrupt("0");
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8010/interrupt_talk");
  });

  it("reports unreachable instead of throwing", async () => {
    const down = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await new LiveTalking("http://x", down).reachable()).toBe(false);
  });
});

describe("LiveTalking.say (its own voice, when the hub's is down)", () => {
  it("posts the text as an echo for that session, with an optional voice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ code: 0, msg: "ok" }));
    const lt = new LiveTalking("http://127.0.0.1:8010", fetchMock);
    expect(await lt.say("7", "Hello there", "en-US-AndrewNeural")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8010/human");
    expect(JSON.parse(init.body)).toEqual({ sessionid: "7", type: "echo", text: "Hello there", interrupt: false, tts: { voice: "en-US-AndrewNeural" } });
    await lt.say("7", "Hi");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("tts");
  });
  it("reports false when refused or down, never throws", async () => {
    expect(await new LiveTalking("x", vi.fn().mockResolvedValue(okJson({ code: -1 }))).say("1", "x")).toBe(false);
    expect(await new LiveTalking("x", vi.fn().mockRejectedValue(new Error("down"))).say("1", "x")).toBe(false);
  });
});

describe("LiveTalking.act", () => {
  it("asks /set_audiotype for the action clip", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson({ code: 0, msg: "ok" }));
    expect(await new LiveTalking("http://127.0.0.1:8010", fetchMock).act("3", 4)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8010/set_audiotype");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ sessionid: "3", audiotype: 4 });
  });

  it("answers false instead of throwing when LiveTalking is gone", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("down"));
    expect(await new LiveTalking("http://x", fetchMock).act("3", 2)).toBe(false);
  });
});
