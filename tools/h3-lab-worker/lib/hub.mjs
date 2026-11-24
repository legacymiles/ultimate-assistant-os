// The hub, as seen from the PC. Every call carries the worker token (Bearer);
// these routes are session-exempt by exact path. Shapes mirror
// src/lib/h3-lab/api.ts — change both together.

export class HubError extends Error {
  /** status 0 = the hub could not be reached at all. */
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
  get unreachable() {
    return this.status === 0 || this.status >= 500;
  }
  get unauthorized() {
    return this.status === 401 || this.status === 403;
  }
}

export class Hub {
  constructor(cfg) {
    this.cfg = cfg;
  }

  async #post(path, body, timeoutMs = 30_000) {
    let res;
    try {
      res = await fetch(`${this.cfg.hubUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const why = err?.cause?.code || err?.name || err?.message || String(err);
      throw new HubError(`Hub unreachable at ${this.cfg.hubUrl} (${why}).`, 0);
    }
    if (res.status === 204) return null;
    const text = await res.text().catch(() => "");
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const msg = parsed?.error ?? `${res.status} ${text.slice(0, 200)}`;
      throw new HubError(res.status === 401 || res.status === 403 ? `Hub refused the token (${res.status}): ${msg}` : `Hub ${path} → ${msg}`, res.status);
    }
    return parsed;
  }

  /** ClaimRequest → ClaimResponse | null (204 = nothing to do). Also the heartbeat. */
  claim(req) {
    return this.#post("/api/h3-lab/worker/claim", req);
  }

  /** ProgressRequest. Best effort: a lost progress line is not worth failing a render over. */
  progress(generationId, status, detail) {
    return this.#post("/api/h3-lab/worker/progress", { generationId, status, detail }).catch(() => null);
  }

  /** UploadRequest → UploadResponse { url, key } (url null = keep the clip local). */
  upload(generationId) {
    return this.#post("/api/h3-lab/worker/upload", { generationId });
  }

  /** ResultRequest. */
  result(req) {
    return this.#post("/api/h3-lab/worker/result", req, 120_000);
  }

  /** ThinkResultRequest. */
  think(req) {
    return this.#post("/api/h3-lab/worker/think", req, 60_000);
  }

  /** Advance the lab's agent one step. */
  tick() {
    return this.#post("/api/h3-lab/worker/tick", {}, 120_000);
  }

  /** PUT the clip bytes to a signed Storage URL. */
  async putClip(url, bytes) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "x-upsert": "true" },
      body: bytes,
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status}) ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
}
