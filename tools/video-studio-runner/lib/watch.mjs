import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Watch a job's `out/` folder and hand each finished clip over exactly once.
 *
 * Polling rather than fs.watch: a render writes its file in pieces, and a
 * watcher fires on the first byte. Waiting for the size to stop changing is
 * what makes "uploaded" mean "finished", which is the difference between a
 * real status list and a decorative one.
 */
export function watchOutput(dir, onClip, { intervalMs = 4000 } = {}) {
  const seen = new Map(); // file -> { size, stableFor }
  const uploaded = new Set();
  let stopped = false;

  const tick = async () => {
    let entries = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return; // the folder does not exist yet
    }
    for (const name of entries) {
      if (uploaded.has(name)) continue;
      const which = parse(name);
      if (which === null) continue;
      const file = path.join(dir, name);
      let size;
      try {
        size = (await fs.stat(file)).size;
      } catch {
        continue;
      }
      if (size === 0) continue;
      const previous = seen.get(name);
      if (previous && previous.size === size) {
        // Two consecutive polls at the same size: the writer is done.
        uploaded.add(name);
        seen.delete(name);
        try {
          await onClip(which, file);
        } catch (err) {
          uploaded.delete(name); // let the next tick try again
          seen.set(name, { size: -1 });
          throw err;
        }
      } else {
        seen.set(name, { size });
      }
    }
  };

  const timer = setInterval(() => {
    if (!stopped) void tick().catch(() => undefined);
  }, intervalMs);

  return {
    /** One last sweep after the job exits, so a clip written at the end is not lost. */
    async flush() {
      // Two passes: the first records the size, the second confirms it settled.
      await tick().catch(() => undefined);
      await tick().catch(() => undefined);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    uploaded,
  };
}

/** `scene-3.mp4` → 3, `final.mp4` → "final", anything else → null. */
export function parse(name) {
  if (name === "final.mp4") return "final";
  const match = /^scene-(\d+)\.mp4$/.exec(name);
  return match ? Number(match[1]) : null;
}
