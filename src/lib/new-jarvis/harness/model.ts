// ---------------------------------------------------------------------------
// Folding a harness's event stream into turns.
//
// This is a pure reducer and it is tested, because three of the things it does
// are not obvious and all three were found by watching real threads rather
// than by reasoning about the protocol:
//
//   Text arrives as hundreds of deltas and must be concatenated, but the
//   FINISHED assistant message arrives too. Appending both prints the answer
//   twice — once a character at a time, then again whole.
//
//   dsh denies its own write before asking. Under the read-only sandbox the
//   first attempt comes back "file access denied … escalation available", the
//   model retries the identical call with sandbox_permissions set, and only
//   THAT retry raises the permission request. Drawn literally, every DeepSeek
//   edit shows a red failed step above the one that worked, which reads as a
//   harness that is broken rather than one that is asking. The denial is
//   folded into the retry as "escalating".
//
//   A reader can fall behind the bridge's ring. Quietly starting from the
//   oldest kept event leaves a hole mid-transcript that nothing afterwards
//   reveals, so `dropped` resets the view instead of patching it.
// ---------------------------------------------------------------------------

import {
  EMPTY_THREAD,
  type GateCard,
  type HarnessEvent,
  type ThreadView,
  type ToolKind,
  type ToolRow,
  type Turn,
  type Risk,
} from "./types";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** dsh's sandbox denial, which is a question in disguise. */
export function isEscalationNotice(output: string): boolean {
  return /sandbox: escalation available|file access denied under read-only/i.test(output);
}

function newTurn(init: Partial<Turn> & { id: string; at: number }): Turn {
  return {
    prompt: "",
    text: "",
    thinking: "",
    tools: [],
    gates: [],
    plan: [],
    notes: [],
    status: "running",
    ms: 0,
    usd: 0,
    error: "",
    ...init,
  };
}

function toolKind(v: unknown): ToolKind {
  return v === "read" || v === "write" || v === "run" ? v : "other";
}

function risk(v: unknown): Risk {
  return v === "read" || v === "grave" ? v : "act";
}

/**
 * Apply events to a view.
 *
 * Returns a new object whenever anything changed, and the SAME object when
 * nothing did — the poll runs every few hundred milliseconds and an empty
 * batch must not re-render a thread with a long transcript on screen.
 */
export function reduceEvents(prev: ThreadView, events: HarnessEvent[]): ThreadView {
  if (!events.length) return prev;

  const turns = [...prev.turns];
  let notes = prev.notes;
  let liveGate = prev.liveGate;
  let usd = prev.usd;
  let used = prev.used;
  let size = prev.size;
  let detail = prev.detail;

  const current = (): Turn | null => (turns.length ? turns[turns.length - 1] : null);
  const patch = (fn: (t: Turn) => Turn): void => {
    const t = current();
    if (!t) return;
    turns[turns.length - 1] = fn(t);
  };

  for (const e of events) {
    switch (e.kind) {
      case "user": {
        turns.push(newTurn({ id: `t${e.seq}`, at: e.at, prompt: str(e.text), status: "running" }));
        break;
      }

      case "text": {
        const text = str(e.text);
        if (!text) break;
        if (!current()) turns.push(newTurn({ id: `t${e.seq}`, at: e.at }));
        patch((t) => ({ ...t, text: t.text + text }));
        break;
      }

      case "thinking": {
        const text = str(e.text);
        if (!text || !current()) break;
        patch((t) => ({ ...t, thinking: t.thinking + text }));
        break;
      }

      case "tool": {
        if (!current()) turns.push(newTurn({ id: `t${e.seq}`, at: e.at }));
        const row: ToolRow = {
          callId: str(e.callId),
          name: str(e.name),
          title: str(e.title) || str(e.name),
          kindOf: toolKind(e.kindOf),
          path: str(e.path),
          command: str(e.command),
          status: "running",
          output: "",
          at: e.at,
        };
        patch((t) => {
          // The escalation retry: dsh re-issues the identical call after its
          // own denial. Replace the denied row rather than stacking a second.
          const i = t.tools.findIndex(
            (x) => x.status === "escalating" && x.name === row.name && x.title === row.title,
          );
          if (i >= 0) {
            const tools = [...t.tools];
            tools[i] = { ...row, callId: row.callId };
            return { ...t, tools };
          }
          return { ...t, tools: [...t.tools, row] };
        });
        break;
      }

      case "tool_end": {
        const callId = str(e.callId);
        const output = str(e.output);
        const ok = e.ok !== false;
        patch((t) => {
          const i = t.tools.findIndex((x) => x.callId === callId);
          if (i < 0) return t;
          const tools = [...t.tools];
          tools[i] = {
            ...tools[i],
            status: ok ? "ok" : isEscalationNotice(output) ? "escalating" : "failed",
            output,
          };
          return { ...t, tools };
        });
        break;
      }

      case "gate": {
        const card: GateCard = {
          gateId: str(e.gateId),
          name: str(e.name),
          title: str(e.title),
          why: str(e.why),
          risk: risk(e.risk),
          patch: str(e.patch),
          command: str(e.command),
          path: str(e.path),
          askedAt: num(e.askedAt) || e.at,
        };
        liveGate = card;
        if (!current()) turns.push(newTurn({ id: `t${e.seq}`, at: e.at }));
        patch((t) => ({ ...t, gates: [...t.gates, card], status: "waiting" }));
        break;
      }

      case "gate_done": {
        const gateId = str(e.gateId);
        const allow = Boolean(e.allow);
        const how = str(e.how);
        if (liveGate?.gateId === gateId) liveGate = null;
        patch((t) => ({
          ...t,
          status: t.status === "waiting" ? "running" : t.status,
          gates: t.gates.map((g) => (g.gateId === gateId ? { ...g, answered: true, allowed: allow, how } : g)),
          // A refusal is reported as a refused step too, so the ledger explains
          // the gap rather than just skipping a number.
          tools: allow
            ? t.tools
            : t.tools.map((x) => (x.status === "running" || x.status === "escalating" ? { ...x, status: "refused" } : x)),
        }));
        break;
      }

      case "turn_end": {
        const error = str(e.error);
        usd += num(e.usd);
        patch((t) => ({
          ...t,
          status: error ? "failed" : "done",
          ms: num(e.ms),
          usd: num(e.usd),
          error,
        }));
        break;
      }

      case "plan": {
        const entries = Array.isArray(e.entries)
          ? (e.entries as { text?: unknown; status?: unknown }[]).map((x) => ({
              text: str(x?.text),
              status: str(x?.status),
            }))
          : [];
        if (!entries.length || !current()) break;
        patch((t) => ({ ...t, plan: entries }));
        break;
      }

      case "usage": {
        used = num(e.used);
        size = num(e.size);
        break;
      }

      case "note": {
        const text = str(e.text);
        if (!text) break;
        if (current()) patch((t) => ({ ...t, notes: [...t.notes, text] }));
        else notes = [...notes, text];
        break;
      }

      case "error": {
        const message = str(e.message);
        if (current()) patch((t) => ({ ...t, status: "failed", error: message }));
        else notes = [...notes, message];
        break;
      }

      case "status": {
        if (str(e.detail)) detail = str(e.detail);
        if (e.status === "ended") {
          liveGate = null;
          patch((t) => (t.status === "running" || t.status === "waiting" ? { ...t, status: "failed" } : t));
        }
        break;
      }

      default:
        break;
    }
  }

  return { turns, notes, liveGate, usd, used, size, detail };
}

/** A fresh view, for a new thread or after the reader fell behind the ring. */
export function emptyThread(): ThreadView {
  return { ...EMPTY_THREAD, turns: [], notes: [] };
}

/**
 * How many of the thread's steps actually touched anything.
 *
 * Reads are most of a run's steps and none of its risk, so a header that
 * counted every step would read as frantic for a thread that opened forty
 * files and changed one.
 */
export function countActions(view: ThreadView): { reads: number; changes: number; refused: number } {
  let reads = 0;
  let changes = 0;
  let refused = 0;
  for (const t of view.turns) {
    for (const x of t.tools) {
      if (x.status === "refused") refused += 1;
      else if (x.kindOf === "read") reads += 1;
      else if (x.status === "ok") changes += 1;
    }
  }
  return { reads, changes, refused };
}
