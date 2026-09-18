import { readFile } from "node:fs/promises";
import path from "node:path";

// The builder's side of the Game Creator API. Every call carries the owner's
// builder token; the site maps it to the owner and never lets it see anyone
// else's games.

export class HubClient {
  constructor({ hubUrl, token }) {
    if (!hubUrl) throw new Error("HUB_URL is not set. Put it in tools/unreal-builder/.env.");
    if (!token) throw new Error("BUILDER_TOKEN is not set. Create one in Game Creator › Setup and put it in .env.");
    this.base = `${hubUrl}/api/game-creator/builder`;
    this.token = token;
  }

  async post(route, body, { json = true, timeoutMs = 30_000 } = {}) {
    const res = await fetch(`${this.base}/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(body ?? {}) : body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`The hub redirected ${route} (HTTP ${res.status}). Is HUB_URL the site root, and is the builder path exempt from the login wall?`);
    }
    if (res.status === 401) throw new Error("The hub rejected the builder token. Create a new one in Game Creator › Setup.");
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${route} failed (HTTP ${res.status}): ${data.error ?? "unknown error"}`);
    return data;
  }

  /**
   * The oldest queued game, or null. Also tells the site this PC is online and
   * which game-building skills it offers ({skills, defaultSkill}).
   */
  async claim(skills) {
    const data = await this.post("claim", skills ?? {});
    return data?.game ?? null;
  }

  /** The owner's messages for this game that Claude has not seen yet (each returned once). */
  async messages(gameId) {
    const data = await this.post("messages", { gameId });
    return data?.messages ?? [];
  }

  progress(gameId, update) {
    return this.post("progress", { gameId, ...update });
  }

  fail(gameId, error) {
    return this.post("fail", { gameId, error });
  }

  async screenshot(gameId, file, caption) {
    const bytes = await readFile(file);
    const form = new FormData();
    form.set("gameId", gameId);
    form.set("name", path.basename(file));
    if (caption) form.set("caption", caption);
    form.set("file", new Blob([bytes], { type: "image/png" }), path.basename(file));
    return this.post("screenshot", form, { json: false, timeoutMs: 120_000 });
  }
}
