import "server-only";
import type { Brief, DirectorPlan } from "../types";
import { directHeuristic } from "./heuristic";
import { directWithAI } from "./llm";

/** Plan a video: the AI director when a key is configured, the offline director otherwise. */
export async function direct(
  prompt: string,
  brief: Brief,
  opts: { note?: string; previous?: DirectorPlan } = {},
): Promise<DirectorPlan> {
  const ai = await directWithAI(prompt, brief, opts);
  if (ai) return ai;
  const plan = directHeuristic(opts.note ? `${prompt}. ${opts.note}` : prompt, brief);
  return plan;
}
