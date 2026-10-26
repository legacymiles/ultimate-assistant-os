// ---------------------------------------------------------------------------
// One request into the owner's In Queue, from a button in a studio home.
//
// The same POST App Builder's "Build it" and Jarvis's queue_build make
// (src/lib/app-builder/queue.ts, NewJarvis.tsx): the request lands in its app's
// folder, Claude Code works it through the jarvis-memory connector, and
// completing it removes it. A request already waiting in that folder with the
// same words is not filed twice — the API says so and the caller shows it.
// ---------------------------------------------------------------------------

export type FiledState = "filed" | "already";

export async function fileRequest(folder: string, text: string): Promise<FiledState> {
  const res = await fetch("/api/new-jarvis/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "add", folder, text }),
  }).catch(() => null);
  const data = (await res?.json().catch(() => null)) as { added?: unknown[]; error?: string } | null;
  if (!res || !res.ok) throw new Error(data?.error ?? "In Queue didn't take it. Sign in to Jarvis and try again.");
  return data?.added?.length ? "filed" : "already";
}
