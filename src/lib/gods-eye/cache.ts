import "server-only";

// In-memory feed cache shared by the God's Eye View feeds.

type Entry = { at: number; value: unknown; pending?: Promise<unknown> };
const cache = new Map<string, Entry>();

/** Serve `key` from cache for `ttlMs`, coalescing concurrent refreshes; fall back to stale data on error. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T & { stale?: boolean }> {
  type Out = T & { stale?: boolean };
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Out;
  if (hit?.pending) return hit.pending as Promise<Out>;

  const pending: Promise<Out> = load()
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value as Out;
    })
    .catch((err) => {
      if (hit?.value !== undefined) {
        cache.set(key, { at: hit.at, value: hit.value });
        return { ...(hit.value as T), stale: true } as Out;
      }
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: hit?.at ?? 0, value: hit?.value, pending });
  return pending;
}
