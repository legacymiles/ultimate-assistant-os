import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeNext, signInWithGoogle } from "./google";

function fakeWindow(framed: boolean) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const popup = { location: { href: "about:blank" }, close: vi.fn() };
  const win: Record<string, unknown> = {
    location: { origin: "https://bighomieai.com", href: "https://bighomieai.com/login?next=%2Fapps%2Fx" },
    open: vi.fn(() => popup),
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    removeEventListener: vi.fn(),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  };
  win.self = win;
  win.top = framed ? {} : win;
  vi.stubGlobal("window", win);
  return { win, popup, listeners };
}

function fakeSupabase(session: unknown = null) {
  const signInWithOAuth = vi.fn(async (_: unknown) => ({ data: { url: "https://x.supabase.co/auth/v1/authorize?provider=google" }, error: null }));
  const getSession = vi.fn(async () => ({ data: { session } }));
  return { client: { auth: { signInWithOAuth, getSession } } as unknown as SupabaseClient, signInWithOAuth, getSession };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("signing in with Google", () => {
  it("keeps the ordinary redirect on a page of its own", async () => {
    fakeWindow(false);
    const sb = fakeSupabase();
    await signInWithGoogle(sb.client, "/apps/x");
    const opts = (sb.signInWithOAuth.mock.calls[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.skipBrowserRedirect).toBeUndefined();
    expect(opts.redirectTo).toBe("https://bighomieai.com/auth/callback?next=%2Fapps%2Fx");
  });

  it("inside a frame, sends Google to a popup and brings the frame to `next` once signed in", async () => {
    vi.useFakeTimers();
    const { win, popup, listeners } = fakeWindow(true);
    const sb = fakeSupabase();
    await signInWithGoogle(sb.client, "/apps/personas-studio");

    expect(win.open).toHaveBeenCalledWith("about:blank", "jarvis-signin", expect.stringContaining("popup"));
    const opts = (sb.signInWithOAuth.mock.calls[0][0] as { options: Record<string, unknown> }).options;
    expect(opts.skipBrowserRedirect).toBe(true);
    expect(opts.redirectTo).toBe("https://bighomieai.com/auth/callback?next=%2Fauth%2Fpopup-done");
    expect(popup.location.href).toContain("authorize?provider=google");

    // The popup's message lands: the frame moves on, signed in.
    listeners.message({ origin: "https://evil.example", data: { type: "jarvis-auth:done" } });
    expect((win.location as { href: string }).href).toContain("/login");
    listeners.message({ origin: "https://bighomieai.com", data: { type: "jarvis-auth:done" } });
    expect((win.location as { href: string }).href).toBe("/apps/personas-studio");
  });

  it("inside a frame, notices the session by itself when no message arrives", async () => {
    vi.useFakeTimers();
    const { win } = fakeWindow(true);
    const sb = fakeSupabase({ user: { id: "u" } });
    await signInWithGoogle(sb.client, "/apps/x");
    await vi.advanceTimersByTimeAsync(1600);
    expect((win.location as { href: string }).href).toBe("/apps/x");
  });

  it("only ever returns to a path on this site", () => {
    expect(safeNext("/apps/x?y=1")).toBe("/apps/x?y=1");
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});
