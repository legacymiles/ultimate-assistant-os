// ---------------------------------------------------------------------------
// Every kind of work the 24/7 Queue can run. Adding a capability = write an
// Executor and add it here; the planner, the worker and the UI all read this
// list, so there is nothing else to register.
// ---------------------------------------------------------------------------

import type { Executor } from "./types";
import { researchExecutor } from "./research";
import { monitorExecutor } from "./monitor";
import { codeChangeExecutor } from "./codeChange";
import { appWebhookExecutor } from "./appWebhook";
import { mt4DiscoveryExecutor } from "./mt4Discovery";
import { h3RecreateExecutor } from "./h3Recreate";
import { rollupExecutor } from "./rollup";

export const EXECUTORS: Executor[] = [
  researchExecutor,
  h3RecreateExecutor,
  mt4DiscoveryExecutor,
  monitorExecutor,
  codeChangeExecutor,
  appWebhookExecutor,
  rollupExecutor,
];

/** Executors Jarvis may choose when planning (rollup is internal). */
export const PLANNABLE = EXECUTORS.filter((e) => e.id !== "rollup");

const BY_ID = new Map(EXECUTORS.map((e) => [e.id, e]));

export function executorFor(id: string): Executor | undefined {
  return BY_ID.get(id);
}

/** What the browser needs to label and configure executors — no functions. */
export function executorSummaries() {
  return EXECUTORS.map((e) => ({
    id: e.id,
    agent: e.agent,
    describe: e.describe,
    configHelp: e.configHelp,
    needs: e.needs,
    defaultKind: e.defaultKind,
  }));
}

export type ExecutorSummary = ReturnType<typeof executorSummaries>[number];
