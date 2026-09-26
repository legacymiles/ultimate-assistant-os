"use client";

// ---------------------------------------------------------------------------
// The Tools tab: the handful of models the owner actually runs their work on.
//
// Not a catalogue — AI Rankings is the catalogue. This is the short list:
// what each model is FOR in the owner's workflows and the exact id to call it
// by, so "which model do I use for video?" has one answer.
//
// The first-run list is not invented. Each entry is a model the hub's own code
// calls by default today (the file is named on the row), so it starts true
// and the owner edits from there. Synced through app_state like the rest.
// ---------------------------------------------------------------------------

import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { nowIso, uid } from "@/lib/utils";

export const TOOLKIT_KEY = "jarvis:toolkit:v1";

export interface KitModel {
  id: string;
  name: string;
  /** What the owner uses it for — the column that matters. */
  role: string;
  /** Exact id to call it by, e.g. "anthropic/claude-opus-5". */
  modelId: string;
  /** Where it is called through: OpenRouter, RunPod, fish.audio… */
  via: string;
  /** Where in the hub it is wired in, or the owner's own note. */
  note: string;
  url?: string;
}

export interface Toolkit {
  models: KitModel[];
  updatedAt: string;
}

const SEED: Omit<KitModel, "id">[] = [
  {
    name: "Claude Opus 5",
    role: "Main brain — coding, reasoning, every agent",
    modelId: "anthropic/claude-opus-5",
    via: "OpenRouter",
    note: "Default for every AI call in the hub (src/lib/ai/provider.ts) and for Jarvis.",
    url: "https://openrouter.ai/anthropic/claude-opus-5",
  },
  {
    name: "Claude Sonnet 5",
    role: "Fast rewriting and prompt polish",
    modelId: "anthropic/claude-sonnet-5",
    via: "OpenRouter",
    note: "Rewrites prompts in Image Studio (src/lib/image-studio/agents.ts).",
    url: "https://openrouter.ai/anthropic/claude-sonnet-5",
  },
  {
    name: "Gemini 3.8 Flash",
    role: "Watches video, listens to audio; first fallback",
    modelId: "google/gemini-3.8-flash",
    via: "OpenRouter",
    note: "Social link import, Music Classified listening, fallback when Opus fails (src/lib/ai/models.ts).",
    url: "https://openrouter.ai/google/gemini-3.8-flash",
  },
  {
    name: "Gemini 3.1 Flash Image",
    role: "Image generation and editing",
    modelId: "google/gemini-3.1-flash-image",
    via: "OpenRouter",
    note: "Default image model in Image Studio.",
    url: "https://openrouter.ai/google/gemini-3.1-flash-image",
  },
  {
    name: "MiniMax H3",
    role: "Cinematic AI video",
    modelId: "minimax/minimax-h3",
    via: "RunPod endpoint",
    note: "Jarvis Studio, Smart Shot Videos, Video Studio Arena.",
  },
  {
    name: "Seedance 2.0",
    role: "Timeline-driven video",
    modelId: "bytedance/seedance-2.0",
    via: "Vercel AI Gateway",
    note: "Seedance Studio.",
  },
  {
    name: "text-embedding-3-small",
    role: "Memory search (embeddings)",
    modelId: "openai/text-embedding-3-small",
    via: "OpenRouter",
    note: "Jarvis's memory — tied to 1536-dim vectors, so don't swap it casually.",
  },
];

function seed(): Toolkit {
  return { models: SEED.map((m) => ({ ...m, id: uid("kit") })), updatedAt: nowIso() };
}

export function loadToolkit(): Toolkit {
  const t = loadLocal<Toolkit | null>(TOOLKIT_KEY, null);
  return t && Array.isArray(t.models) ? t : seed();
}

export function saveToolkit(models: KitModel[]): Toolkit {
  const next = { models, updatedAt: nowIso() };
  saveSynced(TOOLKIT_KEY, next);
  return next;
}

export function blankModel(): KitModel {
  return { id: uid("kit"), name: "", role: "", modelId: "", via: "", note: "" };
}
