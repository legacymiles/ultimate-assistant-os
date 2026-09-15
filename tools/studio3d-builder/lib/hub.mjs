import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Next.js keeps only the first 10 MB of a request body that passes through the
 * hub's middleware, so a local hub gets large files in chunks under that.
 */
export const CHUNK_BYTES = 8 * 1024 * 1024;

/** [start, end) byte ranges covering `size` in `chunk`-sized pieces. */
export function chunkRanges(size, chunk = CHUNK_BYTES) {
  const out = [];
  for (let start = 0; start < size; start += chunk) out.push([start, Math.min(size, start + chunk)]);
  return out.length ? out : [[0, 0]];
}

// The builder's side of the 3D Studio API. Every call carries the owner's
// studio token; the site maps it to the owner and nothing else.

const TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime" };

export function contentTypeFor(file) {
  return TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

export class HubClient {
  constructor({ hubUrl, token }) {
    if (!hubUrl) throw new Error("HUB_URL is not set. Put it in tools/studio3d-builder/.env.");
    if (!token) throw new Error("BUILDER_TOKEN is not set. Create one in 3D Studio › Connect your studio PC and put it in .env.");
    this.base = `${hubUrl}/api/studio3d/builder`;
    this.token = token;
  }

  async post(route, body, { json = true, raw = false, timeoutMs = 30_000 } = {}) {
    const res = await fetch(`${this.base}/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(json ? { "Content-Type": "application/json" } : raw ? { "Content-Type": "application/octet-stream" } : {}),
      },
      body: json ? JSON.stringify(body ?? {}) : body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`The hub redirected ${route} (HTTP ${res.status}). Is HUB_URL the site root, and is the builder path exempt from the login wall?`);
    }
    if (res.status === 401) throw new Error("The hub rejected the studio token. Create a new one in 3D Studio › Connect your studio PC.");
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${route} failed (HTTP ${res.status}): ${data.error ?? "unknown error"}`);
    return data;
  }

  /** The oldest queued project, or null. Also reports this PC's capabilities. */
  async claim(capabilities) {
    const { paths: _paths, ...caps } = capabilities ?? {};
    const data = await this.post("claim", { capabilities: caps });
    return data?.project ?? null;
  }

  progress(projectId, update) {
    return this.post("progress", { projectId, ...update });
  }

  fail(projectId, error) {
    return this.post("fail", { projectId, error });
  }

  /**
   * Upload a still or the rendered video. Large files go straight to Storage
   * through a signed link when the hub has one; a local hub takes the bytes.
   */
  async uploadMedia(projectId, kind, file, { caption, sceneId } = {}) {
    const contentType = contentTypeFor(file);
    const name = path.basename(file);
    const bytes = await readFile(file);

    const target = await this.post("media", { op: "sign", projectId, kind, contentType });
    if (target?.url) {
      const put = await fetch(target.url, {
        method: "PUT",
        headers: { "Content-Type": contentType, "x-upsert": "true" },
        body: bytes,
        signal: AbortSignal.timeout(30 * 60_000),
      });
      if (!put.ok) throw new Error(`Storage upload failed (HTTP ${put.status}): ${(await put.text()).slice(0, 200)}`);
      return this.post("media", { op: "done", projectId, kind, key: target.key, bytes: (await stat(file)).size, contentType, name, caption, sceneId });
    }

    if (bytes.length > CHUNK_BYTES) {
      const upload = randomBytes(12).toString("hex");
      const ranges = chunkRanges(bytes.length);
      for (let index = 0; index < ranges.length; index++) {
        const [start, end] = ranges[index];
        const q = new URLSearchParams({ projectId, upload, index: String(index) });
        await this.post(`media?${q}`, bytes.subarray(start, end), { json: false, raw: true, timeoutMs: 5 * 60_000 });
      }
      return this.post("media", { op: "assemble", projectId, kind, upload, bytes: bytes.length, contentType, name, caption, sceneId }, { timeoutMs: 5 * 60_000 });
    }

    const form = new FormData();
    form.set("projectId", projectId);
    form.set("kind", kind);
    form.set("name", name);
    if (caption) form.set("caption", caption);
    if (sceneId) form.set("sceneId", sceneId);
    form.set("file", new Blob([bytes], { type: contentType }), name);
    return this.post("media", form, { json: false, timeoutMs: 30 * 60_000 });
  }
}
