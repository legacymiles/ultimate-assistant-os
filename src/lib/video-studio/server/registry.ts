import "server-only";
import { METHODS, methodById } from "../registry";
import type { Capability } from "../types";
import type { MethodServer } from "./types";

import { server as remotion } from "../methods/remotion/server";
import { server as hyperframes } from "../methods/hyperframes/server";
import { server as unreal } from "../methods/unreal/server";
import { server as blender } from "../methods/blender/server";
import { server as h3 } from "../methods/h3/server";

// ---------------------------------------------------------------------------
// The method registry — server half.
//
// Adding a sixth method means adding one import and one entry here, plus the
// matching pair in ../registry.ts. Nothing else in the app changes.
// ---------------------------------------------------------------------------

const SERVERS: MethodServer[] = [remotion, hyperframes, unreal, blender, h3];

export function serverFor(id: string): MethodServer | null {
  return SERVERS.find((s) => s.id === id) ?? null;
}

/**
 * Every method's real state, run concurrently.
 *
 * A probe that throws reports as "failed" with its message rather than taking
 * the whole endpoint down — one broken detector must not hide the other four.
 */
export async function capabilities(uid: string): Promise<Record<string, Capability>> {
  const entries = await Promise.all(
    METHODS.map(async ({ meta }) => {
      const impl = serverFor(meta.id);
      if (!impl) {
        return [
          meta.id,
          {
            state: "not-connected" as const,
            summary: "No server implementation is registered for this method.",
            requirements: [],
          },
        ] as const;
      }
      try {
        return [meta.id, await impl.detect(uid)] as const;
      } catch (err) {
        return [
          meta.id,
          {
            state: "failed" as const,
            summary: "Could not check this method's dependencies.",
            requirements: [],
            error: err instanceof Error ? err.message : String(err),
          },
        ] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/** One method's state, for the render gate. */
export async function capabilityOf(uid: string, methodId: string): Promise<Capability | null> {
  const impl = serverFor(methodId);
  if (!impl || !methodById(methodId)) return null;
  try {
    return await impl.detect(uid);
  } catch (err) {
    return {
      state: "failed",
      summary: "Could not check this method's dependencies.",
      requirements: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
