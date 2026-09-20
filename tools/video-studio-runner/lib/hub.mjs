import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";

const CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * The hub, as seen from the PC. Every call carries the runner token; nothing
 * here has a browser session and never will.
 */
export class Hub {
  constructor(cfg) {
    this.cfg = cfg;
  }

  async #post(path, body, extra = {}) {
    const res = await fetch(`${this.cfg.hubUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        ...(body === undefined || extra.raw ? {} : { "Content-Type": "application/json" }),
        ...(extra.headers ?? {}),
      },
      body: extra.raw ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) throw new Error(parsed?.error ?? `${res.status} ${text.slice(0, 200)}`);
    return parsed;
  }

  /** Ask for work. Also what marks this runner "online" in the app. */
  claim() {
    return this.#post("/api/video-studio/runner/claim", {});
  }

  progress(projectId, update) {
    return this.#post("/api/video-studio/runner/progress", { projectId, ...update }).catch(() => null);
  }

  fail(projectId, error, extra = {}) {
    return this.#post("/api/video-studio/runner/fail", { projectId, error, ...extra }).catch(() => null);
  }

  /**
   * Upload a rendered clip.
   *
   * Three routes, picked by what the hub can actually take: a signed Storage
   * link (deployed hub, any size), a chunked upload (local hub, any size), or
   * one multipart POST (small files). A rendered video is routinely far over
   * the 10 MB Next.js keeps of a body that passes through middleware, so the
   * plain POST is the last resort rather than the first choice.
   */
  async uploadClip(projectId, which, file, { jobId, renderedBy } = {}) {
    const bytes = await fs.readFile(file);

    const signed = await this.#post("/api/video-studio/runner/clip", { op: "sign", projectId, which });
    if (signed?.url) {
      const put = await fetch(signed.url, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "x-upsert": "true" },
        body: bytes,
      });
      if (!put.ok) throw new Error(`Storage upload failed (${put.status})`);
      return this.#post("/api/video-studio/runner/clip", {
        op: "done",
        projectId,
        which,
        key: signed.key,
        jobId,
        renderedBy,
      });
    }

    if (bytes.length <= CHUNK_BYTES) {
      const form = new FormData();
      form.set("projectId", projectId);
      form.set("which", String(which));
      form.set("file", new Blob([bytes], { type: "video/mp4" }), "clip.mp4");
      if (jobId) form.set("jobId", jobId);
      if (renderedBy) form.set("renderedBy", renderedBy);
      return this.#post("/api/video-studio/runner/clip", form, { raw: true });
    }

    const upload = createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 32);
    for (let index = 0; index * CHUNK_BYTES < bytes.length; index += 1) {
      const slice = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      const res = await fetch(
        `${this.cfg.hubUrl}/api/video-studio/runner/clip?projectId=${encodeURIComponent(projectId)}&upload=${upload}&index=${index}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.cfg.token}`, "Content-Type": "application/octet-stream" },
          body: slice,
        },
      );
      if (!res.ok) throw new Error(`Chunk ${index} refused (${res.status})`);
    }
    return this.#post("/api/video-studio/runner/clip", {
      op: "assemble",
      projectId,
      which,
      upload,
      bytes: bytes.length,
      jobId,
      renderedBy,
    });
  }
}
