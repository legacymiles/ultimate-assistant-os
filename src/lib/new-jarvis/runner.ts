import type { ContentPart } from "./chatMedia";
// ---------------------------------------------------------------------------
// The loop, on the client, because only the client can reach the machine.
//
// One round is: ask the route what to do next → classify it → gate it if it
// cannot be undone → run it against the bridge → append the result → ask again.
// The block on screen is updated at every one of those points, which is what
// makes a run readable while it is still running rather than after.
//
// The care in this file is almost all about what travels BACK to the model.
// A screenshot is 200 KB of base64 and a page read is twenty thousand
// characters; sending either one verbatim, twice, ends the run with a context
// error three steps before the job was done. So results are rendered in full
// for the owner and summarised for the model, and the two are different
// values on purpose.
// ---------------------------------------------------------------------------

import { classify } from "./actions";
import { routeFor, toolByName } from "./agentTools";
import type { Block, Gate, Mode, Step } from "./types";

/** Rounds before the loop gives up. A browse job legitimately takes a dozen. */
export const MAX_ROUNDS = 14;

export interface WireMessage {
  role: "user" | "assistant" | "tool";
  /** A user turn may carry pictures and sound as parts (see chatMedia.ts). */
  content: string | ContentPart[];
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

export interface StepResponse {
  toolCall?: { id: string; name: string; args: Record<string, unknown> } | null;
  /**
   * The provider's own assistant message, echoed back untouched next round.
   *
   * Rebuilding this from the tool name and arguments is what breaks a
   * Responses-API provider: the message carries an item id and, on a reasoning
   * model, its reasoning block, and without them the tool result that follows
   * is rejected as belonging to no call. See the route's clean().
   */
  assistant?: WireMessage | null;
  text?: string;
  error?: string;
  malformed?: { id: string; name: string; raw: string } | null;
}

export interface RunnerDeps {
  /** One call to /api/new-jarvis/agent. */
  think: (messages: WireMessage[]) => Promise<StepResponse>;
  /** One call to the bridge. Throws with a readable message on failure. */
  runTool: (route: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** Put the gate in front of the owner. Resolves true on a yes. */
  askGate: (gate: Gate) => Promise<boolean>;
  /** Merge a patch into the block on screen. Called many times per round. */
  update: (patch: Partial<Block>) => void;
  /** Cancelled by the owner, or the page going away. */
  signal?: AbortSignal;
}

/**
 * Everything the model is allowed to see of a tool result.
 *
 * Images never go back. The model asked for the screenshot and the OWNER is
 * the one who needed to see it; feeding it back costs the whole context window
 * and buys a description of a picture that is already on screen.
 */
export function forModel(result: Record<string, unknown>): string {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(result)) {
    if (k === "png") {
      copy.screenshot = "taken, and shown to the owner";
      continue;
    }
    // Field values from page_fields. The page hands them to this tab so the
    // owner can capture them; the model is given keys, labels and masked
    // previews and never the values themselves. The tab strips these before
    // they ever reach a step result, and this is the second lock on that door.
    if (k === "values") {
      copy.values = "held in your browser, not shown to the model";
      continue;
    }
    if (typeof v === "string" && v.length > 12_000) {
      copy[k] = `${v.slice(0, 12_000)}\n… (${v.length - 12_000} more characters not shown)`;
      continue;
    }
    if (k === "ok" || k === "ms") continue;
    copy[k] = v;
  }
  const json = JSON.stringify(copy);
  return json.length > 16_000 ? `${json.slice(0, 16_000)}…` : json;
}

/**
 * The assistant turn to replay before a tool result.
 *
 * The provider's own message when we were given one; a faithful reconstruction
 * only as a fallback, for a provider that sent none.
 */
function echo(next: StepResponse, id: string, name: string, args: Record<string, unknown>): WireMessage {
  if (next.assistant) return next.assistant;
  return { role: "assistant", content: "", tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] };
}

/** The label a click or type step shows, preferring what the model named. */
function nameFor(args: Record<string, unknown>): string {
  return String(args.name ?? args.text ?? args.ref ?? "");
}

function stepId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface RunInput {
  command: string;
  mode: Mode;
  /** Earlier blocks, flattened into conversation, so follow-ups work. */
  history?: WireMessage[];
  /** The turn with its attachments, when there are any. Defaults to `command`. */
  content?: string | ContentPart[];
}

export interface RunOutcome {
  answer: string;
  steps: Step[];
  status: Block["status"];
  error?: string;
}

/**
 * Run one block to completion.
 *
 * Never throws. A run that fails is a block that says why it failed, because a
 * thrown error here would take the whole stack down with it and lose every
 * other block on screen.
 */
export async function runBlock(input: RunInput, deps: RunnerDeps): Promise<RunOutcome> {
  const messages: WireMessage[] = [...(input.history ?? []), { role: "user", content: input.content ?? input.command }];
  const steps: Step[] = [];
  const startedAt = Date.now();

  const finish = (status: Block["status"], answer: string, error?: string): RunOutcome => {
    deps.update({ status, answer, error, steps: [...steps], ms: Date.now() - startedAt, gate: null });
    return { status, answer, error, steps };
  };

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    if (deps.signal?.aborted) return finish("stopped", "", "Stopped.");

    let next: StepResponse;
    try {
      next = await deps.think(messages);
    } catch (e) {
      return finish("failed", "", e instanceof Error ? e.message : "The agent could not be reached.");
    }
    if (next.error) return finish("failed", "", next.error);

    if (next.malformed) {
      // Tell the model rather than guessing at the arguments. A click built
      // from {} lands on whatever happens to match nothing.
      messages.push(echo(next, next.malformed.id, next.malformed.name, {}));
      messages.push({
        role: "tool",
        tool_call_id: next.malformed.id,
        name: next.malformed.name,
        content: "That call's arguments were not valid JSON, so nothing ran. Send it again, correctly.",
      });
      continue;
    }

    if (!next.toolCall) return finish("done", (next.text ?? "").trim());

    const { id, name, args } = next.toolCall;
    const route = routeFor(name);
    const known = toolByName(name);

    if (!known || !route) {
      messages.push(echo(next, id, name, args));
      messages.push({ role: "tool", tool_call_id: id, name, content: `There is no tool called ${name}. Use one of the tools you were given.` });
      continue;
    }

    const verdict = classify({ route, args: { ...args, name: nameFor(args) } });
    const step: Step = {
      id: stepId(),
      n: steps.length + 1,
      tool: name,
      route,
      args,
      summary: verdict.summary,
      status: verdict.confirm ? "waiting" : "running",
    };
    steps.push(step);
    deps.update({ steps: [...steps] });

    if (verdict.confirm) {
      const gate: Gate = { stepId: step.id, summary: verdict.summary, why: verdict.why, risk: verdict.risk };
      deps.update({ status: "waiting", gate, steps: [...steps] });
      let allowed = false;
      try {
        allowed = await deps.askGate(gate);
      } catch {
        allowed = false;
      }
      deps.update({ status: "running", gate: null });
      if (!allowed) {
        step.status = "refused";
        step.error = "You said no.";
        deps.update({ steps: [...steps] });
        messages.push(echo(next, id, name, args));
        messages.push({
          role: "tool",
          tool_call_id: id,
          name,
          content: "The owner declined this step. Do not try it again or work around it. Say what you could not do and stop.",
        });
        continue;
      }
      step.status = "running";
      deps.update({ steps: [...steps] });
    }

    const at = Date.now();
    try {
      const result = await deps.runTool(route, args);
      step.status = "ok";
      step.ms = Date.now() - at;
      step.result = result;
      deps.update({ steps: [...steps] });
      messages.push(echo(next, id, name, args));
      messages.push({ role: "tool", tool_call_id: id, name, content: forModel(result) });
    } catch (e) {
      const why = e instanceof Error ? e.message : "It failed.";
      step.status = "failed";
      step.ms = Date.now() - at;
      step.error = why;
      deps.update({ steps: [...steps] });
      messages.push(echo(next, id, name, args));
      // The model gets the real failure so it can choose another route; it is
      // not told to retry, because a retry loop on a dead bridge is the whole
      // budget spent on the same error fourteen times.
      messages.push({ role: "tool", tool_call_id: id, name, content: `That step failed: ${why}` });
    }
  }

  return finish(
    "failed",
    "",
    `Gave up after ${MAX_ROUNDS} steps without finishing. What it did is above.`,
  );
}
