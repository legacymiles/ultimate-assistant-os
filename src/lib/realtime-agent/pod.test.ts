import { afterEach, describe, expect, it, vi } from "vitest";
import * as podModule from "./pod";
import {
  PodError,
  getPod,
  isBilling,
  isConfigured,
  isPending,
  missingSetup,
  podEndpoint,
  startPod,
  stopPod,
  type Pod,
} from "./pod";

const json = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const pod = (over: Partial<Pod> = {}): Pod => ({
  id: "pod123",
  name: "livetalking-musetalk",
  status: "RUNNING",
  cost: 0.44,
  ports: ["8010/http"],
  runtime: { ports: [{ private: 8010, public: 41234, type: "http", ip: "213.0.0.9" }] },
  ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the destructive call is simply absent", () => {
  it("exports no terminate, delete or destroy", () => {
    const names = Object.keys(podModule).map((n) => n.toLowerCase());
    for (const banned of ["terminate", "destroy", "deletepod", "remove"]) {
      expect(names.some((n) => n.includes(banned))).toBe(false);
    }
  });
});

describe("isBilling", () => {
  it("counts every state that costs compute", () => {
    expect(isBilling("RUNNING")).toBe(true);
    expect(isBilling("STARTING")).toBe(true);
    expect(isBilling("PROVISIONING")).toBe(true);
  });

  it("does not count a stopped or dead pod", () => {
    expect(isBilling("EXITED")).toBe(false);
    expect(isBilling("TERMINATED")).toBe(false);
    expect(isBilling("ERROR")).toBe(false);
  });
});

describe("isPending", () => {
  it("is true only while coming up", () => {
    expect(isPending("STARTING")).toBe(true);
    expect(isPending("PROVISIONING")).toBe(true);
    expect(isPending("RUNNING")).toBe(false);
    expect(isPending("EXITED")).toBe(false);
  });
});

describe("podEndpoint", () => {
  it("uses the address RunPod actually reports", () => {
    expect(podEndpoint(pod(), 8010)).toBe("http://213.0.0.9:41234");
  });

  it("answers null rather than inventing a proxy hostname when there is no mapping", () => {
    expect(podEndpoint(pod({ runtime: null }), 8010)).toBeNull();
    expect(podEndpoint(pod({ runtime: { ports: [] } }), 8010)).toBeNull();
  });

  it("answers null when the port is declared but not yet published", () => {
    const half = pod({ runtime: { ports: [{ private: 8010, public: null, type: "http", ip: null }] } });
    expect(podEndpoint(half, 8010)).toBeNull();
  });

  it("does not hand back another service's port", () => {
    expect(podEndpoint(pod(), 22)).toBeNull();
  });
});

describe("configuration", () => {
  it("needs both the key and the pod id", () => {
    vi.stubEnv("RUNPOD_API_KEY", "k");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
    expect(isConfigured()).toBe(true);
    expect(missingSetup()).toBeNull();
  });

  it("names what is missing instead of failing silently", () => {
    vi.stubEnv("RUNPOD_API_KEY", "");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
    expect(isConfigured()).toBe(false);
    expect(missingSetup()).toContain("RUNPOD_API_KEY");

    vi.stubEnv("RUNPOD_API_KEY", "k");
    vi.stubEnv("RUNPOD_POD_ID", "");
    expect(missingSetup()).toContain("RUNPOD_POD_ID");
  });
});

describe("start and stop", () => {
  it("starts with the documented action, on the documented path", async () => {
    vi.stubEnv("RUNPOD_API_KEY", "secret");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
    const fetchFn = vi.fn().mockResolvedValue(json({}));
    await startPod(fetchFn as unknown as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.runpod.io/v2/pods/pod123/action");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "start" });
    expect(init.headers.Authorization).toBe("Bearer secret");
  });

  it("stops rather than terminates", async () => {
    vi.stubEnv("RUNPOD_API_KEY", "secret");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
    const fetchFn = vi.fn().mockResolvedValue(json({}));
    await stopPod(fetchFn as unknown as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "stop" });
    // A DELETE here would destroy the volume and the weights on it.
    expect(init.method).not.toBe("DELETE");
    expect(url).not.toMatch(/\/pods\/pod123$/);
  });

  it("refuses to call RunPod at all with no pod id", async () => {
    vi.stubEnv("RUNPOD_API_KEY", "secret");
    vi.stubEnv("RUNPOD_POD_ID", "");
    const fetchFn = vi.fn();
    await expect(startPod(fetchFn as unknown as typeof fetch)).rejects.toThrow(PodError);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("getPod", () => {
  it("reads the fields the UI needs", async () => {
    vi.stubEnv("RUNPOD_API_KEY", "secret");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
    const fetchFn = vi.fn().mockResolvedValue(json(pod()));
    const got = await getPod(fetchFn as unknown as typeof fetch);
    expect(got?.status).toBe("RUNNING");
    expect(got?.cost).toBe(0.44);
  });

  it("defaults a missing rate to 0 so the meter shows 'rate unknown', not NaN", async () => {
    vi.stubEnv("RUNPOD_API_KEY", "secret");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
    const fetchFn = vi.fn().mockResolvedValue(json({ id: "pod123", status: "EXITED" }));
    const got = await getPod(fetchFn as unknown as typeof fetch);
    expect(got?.cost).toBe(0);
    expect(got?.ports).toEqual([]);
  });

  it("answers null on a body that is not a pod", async () => {
    vi.stubEnv("RUNPOD_API_KEY", "secret");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
    const fetchFn = vi.fn().mockResolvedValue(json({ unexpected: true }));
    expect(await getPod(fetchFn as unknown as typeof fetch)).toBeNull();
  });
});

describe("errors the owner has to understand", () => {
  const stub = () => {
    vi.stubEnv("RUNPOD_API_KEY", "secret");
    vi.stubEnv("RUNPOD_POD_ID", "pod123");
  };

  it("explains a rejected key without echoing it", async () => {
    stub();
    const fetchFn = vi.fn().mockResolvedValue(json({}, 401));
    await expect(getPod(fetchFn as unknown as typeof fetch)).rejects.toThrow(/rejected the API key/);
  });

  it("explains an unknown pod id", async () => {
    stub();
    const fetchFn = vi.fn().mockResolvedValue(json({}, 404));
    await expect(getPod(fetchFn as unknown as typeof fetch)).rejects.toThrow(/RUNPOD_POD_ID/);
  });

  it("explains the 400 that means the host ran out of GPUs", async () => {
    stub();
    const fetchFn = vi.fn().mockResolvedValue(json({}, 400));
    await expect(startPod(fetchFn as unknown as typeof fetch)).rejects.toThrow(/no free GPU/);
  });

  it("explains a network failure rather than leaking the thrown error", async () => {
    stub();
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(getPod(fetchFn as unknown as typeof fetch)).rejects.toThrow(/Could not reach RunPod/);
  });
});
