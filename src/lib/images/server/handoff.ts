import "server-only";

// ---------------------------------------------------------------------------
// When nothing could draw the picture, hand it to a 24/7 agent.
//
// The owner's rule: Flux only runs when their PC is open, and asking for a
// picture from a phone must not be a dead end. So the moment every lane has
// failed -- PC asleep, no key, nothing free that is allowed to carry their
// name -- the request stops being a failure and becomes a standing goal.
// The next time any machine with Pinokio wakes up it draws it for nothing.
//
// Only filed when the picture could NOT be made. If a paid model drew it the
// owner already has what they asked for, and a 24/7 agent to draw it again
// would be a second copy nobody asked for and a second bill of GPU time.
// ---------------------------------------------------------------------------

import { add, newAgent, type AgentsDoc } from "@/lib/new-jarvis/agents/agents";
import { updateAgents } from "@/lib/new-jarvis/server/agentsStore";

export interface HandoffRequest {
  /** The account to file it under. No account, no agent. */
  uid: string;
  /** The prompt as the drawer would have received it. */
  prompt: string;
  width: number;
  height: number;
  /** Where the request came from, for the goal's wording. */
  app: string;
}

export interface HandoffResult {
  id: string;
  /** One sentence for the owner, in their language (R3). */
  note: string;
}

/** Short enough to read on a row, long enough to recognise. */
function shortGoal(prompt: string, app: string): string {
  const first = prompt.split("\n")[0].trim().slice(0, 120);
  return `Draw "${first}" for ${app} with Flux on Pinokio`;
}

/**
 * File the picture as a 24/7 agent, unless one just like it is already there.
 *
 * Returns null when it could not be filed — signed out, or no store on this
 * host. A failure here must never turn into a failure of the picture request
 * that triggered it, so every caller treats null as "say nothing extra".
 */
export async function handOffPicture(req: HandoffRequest): Promise<HandoffResult | null> {
  if (!req.uid || !req.prompt.trim()) return null;

  const goal = shortGoal(req.prompt, req.app);
  let filed = "";

  try {
    await updateAgents(req.uid, (d): AgentsDoc => {
      // Asking twice for the same picture is one agent, not two (D5). Only
      // live agents count: a finished one means they have it already and are
      // asking for another.
      const already = d.agents.find((a) => a.status !== "done" && a.goal === goal);
      if (already) {
        filed = already.id;
        return d;
      }
      const agent = newAgent({
        goal,
        needs: ["pinokio"],
        steps: [
          `Start the picture drawer if it isn't up: node tools/wangp-image/server.mjs`,
          `Draw it at ${req.width}x${req.height} with Flux 2 Klein, from the prompt on this agent`,
          "Put the picture on this agent with agent_done, saying where it is saved",
        ],
        from: "image-lane",
        at: new Date().toISOString(),
      });
      // The full prompt goes in the log, where it is not truncated -- the
      // runner needs it exactly, not the shortened goal.
      agent.log.push({
        at: agent.createdAt,
        by: "image-lane",
        text: `Prompt: ${req.prompt}`,
        kind: "filed",
      });
      filed = agent.id;
      return add(d, agent);
    });
  } catch {
    // The store is the owner's; a picture request is not the place to shout
    // about it failing. The lane above already has a plain answer for them.
    return null;
  }

  if (!filed) return null;
  return {
    id: filed,
    note: "Your PC is asleep, so this is now a 24/7 agent — it'll be drawn free on your own card as soon as the laptop's open.",
  };
}
