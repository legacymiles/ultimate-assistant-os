// ---------------------------------------------------------------------------
// Blueprint — client helpers. Typed wrappers around /api/blueprint plus the
// mapping that turns a finished Overview into a real Projects Timeline project.
// ---------------------------------------------------------------------------

"use client";

import { getRepo } from "@/lib/repo";
import type { Feature } from "@/lib/types";
import { nowIso, uid } from "@/lib/utils";
import { heuristicClarify, heuristicClarify2, heuristicSynthesize } from "./heuristics";
import { assemblePrompt } from "./prompt-template";
import type {
  Brief,
  Clarify2Result,
  ClarifyingQuestion,
  Engine,
  GeneratedPrompt,
  Overview,
} from "./types";

async function post<T>(body: unknown, fallback: () => T): Promise<T> {
  try {
    const res = await fetch("/api/blueprint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Blueprint API ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    // Network / server failure: degrade to the offline heuristic so the flow
    // never dead-ends. Callers still get a usable result.
    console.error("Blueprint request failed, using local heuristic:", err);
    return fallback();
  }
}

export function requestClarify(brief: Brief): Promise<ClarifyingQuestion[]> {
  return post<ClarifyingQuestion[]>({ stage: "clarify", brief }, () =>
    heuristicClarify(brief),
  );
}

export function requestClarify2(brief: Brief): Promise<Clarify2Result> {
  return post<Clarify2Result>({ stage: "clarify2", brief }, () =>
    heuristicClarify2(brief),
  );
}

export async function requestSynthesize(
  brief: Brief,
): Promise<{ overview: Overview; engine: Engine }> {
  const data = await post<Overview & { engine?: Engine }>(
    { stage: "synthesize", brief },
    () => ({ ...heuristicSynthesize(brief), engine: "heuristic" }),
  );
  const { engine = "heuristic", ...overview } = data;
  return { overview, engine };
}

export function requestPrompt(
  overview: Overview,
  brief: Brief,
  portable = false,
): Promise<GeneratedPrompt> {
  return post<GeneratedPrompt>({ stage: "prompt", overview, brief, portable }, () => ({
    prompt: assemblePrompt(overview, brief, { portable }),
    engine: "heuristic",
  }));
}

// ----- Save to Projects Timeline -------------------------------------------

function toFeature(
  projectId: string,
  f: { title: string; description: string },
  group: "core" | "supporting",
): Feature {
  return {
    id: uid("f"),
    project_id: projectId,
    title: f.title,
    description: f.description,
    group,
    created_at: nowIso(),
  };
}

/**
 * Creates a Projects Timeline project from the overview and stores the
 * generated prompt in its Knowledge Inbox. Returns the new project id.
 */
export async function saveToTimeline(
  overview: Overview,
  prompt: string,
): Promise<string> {
  const repo = getRepo();
  const name = (overview.one_liner.trim() || "Untitled idea").slice(0, 60);

  const project = await repo.createProject({
    name,
    one_liner: overview.one_liner.trim(),
    overview: overview.purpose.trim(),
  });

  await repo.setFeatures(project.id, [
    ...overview.core_features.map((f) => toFeature(project.id, f, "core")),
    ...overview.supporting_features.map((f) => toFeature(project.id, f, "supporting")),
  ]);

  await repo.addKnowledge(project.id, {
    kind: "idea",
    title: "Claude Code build prompt",
    content: prompt,
  });

  return project.id;
}

// ----- Small browser helpers -----------------------------------------------

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
