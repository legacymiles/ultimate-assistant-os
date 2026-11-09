// ---------------------------------------------------------------------------
// "These are the photos still on my phone."
//
// The step that deletes here what was deleted there. It lives apart from the
// route because two endpoints run it: /inbox/present, which is what the guide
// has always taught, and /inbox/push, which receives it whenever the clean-up
// is pointed at the sending link.
//
// That second case is not an edge: Shortcuts fills a Get Contents of URL's URL
// box in by itself and usually picks the first URL action in the Shortcut. It
// cost weeks of silent failure, because photos kept arriving from the loop
// above while the clean-up collected a 400 nobody reads. Answering it properly
// is also what lets the setup ask for one link instead of two — there is no
// longer a wrong box to put it in.
// ---------------------------------------------------------------------------

import { noteCheckIn, noteSweep, prune } from "@/lib/dashboard/inbox";

export interface Sweep {
  status: number;
  body: { removed?: number; checked?: number; error?: string };
}

/**
 * The names as the Shortcut sends them: one Combine Text output, separated by
 * new lines or commas depending on what iOS offered, or a JSON array.
 */
export function readNames(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,\n]/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** 1–90 days; what the phone looked at, and so what may be pruned. */
export function readWindow(days: unknown): number {
  return Math.min(90, Math.max(1, Number(days) || 30));
}

export async function stillOnPhone(uid: string, raw: unknown, days: unknown): Promise<Sweep> {
  const names = readNames(raw);
  if (!names.length)
    return {
      status: 400,
      body: {
        error:
          "No photo names came through. In the last Get Contents of URL, the form field's value must be the blue Combined Text variable — picked off the bar above the keyboard, not typed in.",
      },
    };

  await noteCheckIn(uid).catch(() => undefined);
  const { removed, refused } = await prune(uid, names, readWindow(days));
  // Camera Autopilot says this in words, so a run can be checked without
  // reading the Shortcut's result box on a phone.
  await noteSweep(uid, names.length, removed).catch(() => undefined);
  // `refused` is the interesting case and it is read on a phone, in the
  // Shortcut's own result box, so it goes at the top as plain prose.
  if (refused) return { status: 200, body: { error: refused, removed: 0, checked: names.length } };
  return { status: 200, body: { removed, checked: names.length } };
}
