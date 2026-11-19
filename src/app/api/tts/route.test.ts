// What /api/tts actually puts on the wire, per backend. The Phonon server
// itself is exercised for real by tools/phonon-tts; what is easy to get wrong
// here is the shape sent to it, and the fallback when it is not running.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const REAL_ENV = process.env;

/** A clean env, so the machine's own .env.local cannot steer a test. */
function setEnv(vars: Record<string, string>) {
  process.env = { ...vars } as NodeJS.ProcessEnv;
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function audioResponse(type = "audio/wav"): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "Content-Type": type },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  process.env = REAL_ENV;
  vi.unstubAllGlobals();
});

describe("GET /api/tts", () => {
  it("reports the phonon backend without offering cloning", async () => {
    setEnv({ TTS_BACKEND: "phonon" });
    await expect((await GET()).json()).resolves.toEqual({ mode: "phonon", cloning: false });
  });

  it("reports browser mode when nothing is configured", async () => {
    setEnv({});
    await expect((await GET()).json()).resolves.toEqual({ mode: "browser", cloning: false });
  });
});

describe("POST /api/tts — phonon", () => {
  beforeEach(() => setEnv({ TTS_BACKEND: "phonon", PHONON_VOICE: "Easton" }));

  it("sends plain JSON to the local server and passes its audio back", async () => {
    fetchMock.mockResolvedValue(audioResponse());

    const res = await POST(post({ text: "  Hello Jarvis  " }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8123/v1/tts");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      text: "Hello Jarvis",
      format: "mp3",
      speed: 1,
      voice: "Easton",
    });
  });

  it("names the voice the caller asked for over the configured default", async () => {
    fetchMock.mockResolvedValue(audioResponse());
    await POST(post({ text: "hi", voiceId: "Hadley" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).voice).toBe("Hadley");
  });

  it("treats the default-voice sentinel as 'use the configured one'", async () => {
    fetchMock.mockResolvedValue(audioResponse());
    await POST(post({ text: "hi", voiceId: "default" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).voice).toBe("Easton");
  });

  it("clamps speed into the range the server will accept", async () => {
    fetchMock.mockResolvedValue(audioResponse());
    await POST(post({ text: "hi", speed: 9 }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).speed).toBe(2);
  });

  it("trusts the Content-Type the server served over the one requested", async () => {
    // Asked for mp3; Phonon has no ffmpeg and serves WAV. Labelling that
    // audio/mpeg gives a silent <audio> element, which reads as a dead voice.
    fetchMock.mockResolvedValue(audioResponse("audio/wav"));
    const res = await POST(post({ text: "hi", format: "mp3" }));
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
  });

  it("sends no Authorization header unless PHONON_KEY is set", async () => {
    // A fresh Response per call: a body can only be read once.
    fetchMock.mockImplementation(async () => audioResponse());
    await POST(post({ text: "hi" }));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();

    fetchMock.mockClear();
    setEnv({ TTS_BACKEND: "phonon", PHONON_KEY: "secret" });
    await POST(post({ text: "hi" }));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer secret");
  });
});

describe("POST /api/tts — falling back", () => {
  it("retries on fish.audio when the local server is not running", async () => {
    setEnv({ TTS_BACKEND: "phonon", FISH_API_KEY: "k" });
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(audioResponse("audio/mpeg"));

    const res = await POST(post({ text: "hi" }));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.fish.audio/v1/tts");
    expect(fetchMock.mock.calls[1][1].headers["Content-Type"]).toBe("application/msgpack");
  });

  it("502s when the local server is down and there is no fish key", async () => {
    setEnv({ TTS_BACKEND: "phonon" });
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await POST(post({ text: "hi" }));

    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("unreachable"),
    });
  });

  it("does not retry a backend that answered with an error", async () => {
    // A 429 from fish is an answer, not an outage — retrying would double the
    // spend and still fail.
    setEnv({ TTS_BACKEND: "phonon", FISH_API_KEY: "k" });
    fetchMock.mockResolvedValue(new Response("rate limited", { status: 429 }));

    const res = await POST(post({ text: "hi" }));

    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/tts — fish stays as it was", () => {
  beforeEach(() => setEnv({ FISH_API_KEY: "k", FISH_MODEL: "s2.1-pro-free" }));

  it("still sends msgpack with the model header", async () => {
    fetchMock.mockResolvedValue(audioResponse("audio/mpeg"));

    const res = await POST(post({ text: "hi", format: "mp3" }));

    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.fish.audio/v1/tts");
    expect(init.headers["Content-Type"]).toBe("application/msgpack");
    expect(init.headers.model).toBe("s2.1-pro-free");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(init.body).toBeInstanceOf(ArrayBuffer);
  });
});

describe("POST /api/tts — guards", () => {
  it("tells the client to use browser voices when nothing is configured", async () => {
    setEnv({});
    await expect((await POST(post({ text: "hi" }))).json()).resolves.toEqual({ fallback: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects empty, missing and oversized text before calling a backend", async () => {
    setEnv({ TTS_BACKEND: "phonon" });

    expect((await POST(post({ text: "   " }))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ text: "x".repeat(5001) }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    setEnv({ TTS_BACKEND: "phonon" });
    const res = await POST(
      new Request("http://localhost/api/tts", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});
