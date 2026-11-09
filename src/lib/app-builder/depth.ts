// ---------------------------------------------------------------------------
// App Builder — build depth, which is where the `commercial` skill enters the
// pipeline.
//
// The owner's rule: the four stages (spec → look → build → gate) always run,
// and a DEPTH expands them. Depth is not a fifth stage and it is not a feature
// — it is how far the build goes on the things nobody asks for and everybody
// notices: the Apple-standard look, logins and profiles, an owner admin, the
// onboarding that reaches "aha", growth and retention, the legal pages.
//
//   plain          a single-screen toy, visualiser or local single-user tool
//                  that saves only to the browser. No server, no second person.
//   commercial     the normal depth: anything with a second person or a server.
//                  `commercial` Steps 0, 2, 3, 4, 5, 6, 8. The app stays FREE —
//                  no prices, no paywalls, no upgrade prompts; billing is wired
//                  and switched off.
//   commercial     a landing page, marketing site or portfolio has no
//   (look+growth)  foundation to build, so only Steps 2, 4 and 6 run.
//   commercial-2x  only when the owner asks to charge, sell, monetize or price
//                  it. Adds Steps 1, 7 and 9 (business model, the money, a
//                  competitor teardown and a critic panel to 9/10 every axis).
//
// Everything here is pure, so the queue brief, the master prompt and the UI
// cannot disagree about which depth a build is running at.
// ---------------------------------------------------------------------------

import type { Answers, AppType, Depth, Understanding } from "./types";

export type { Depth };

export const DEPTH_LABEL: Record<Depth, string> = {
  plain: "Plain",
  commercial: "Commercial",
  "commercial-2x": "Commercial 2x",
};

/** What the owner is choosing between, in their words, on the depth control. */
export const DEPTH_BLURB: Record<Depth, string> = {
  plain: "Four stages only. For a one-screen tool that saves in the browser.",
  commercial: "Apple-standard look, logins, profiles, admin, onboarding, growth. Stays free.",
  "commercial-2x": "All of that plus pricing, paywalls and upgrade moments — and a critic panel to 9/10.",
};

export const DEPTHS: Depth[] = ["plain", "commercial", "commercial-2x"];

/** The `commercial` steps a depth runs, in order. */
export function depthSteps(depth: Depth, appType?: AppType): number[] {
  if (depth === "plain") return [];
  // A landing page or portfolio has no foundation, accounts or billing to
  // build, so the Foundation and Retention layers are not in scope.
  if (depth === "commercial" && appType === "website") return [2, 4, 6];
  if (depth === "commercial") return [0, 2, 3, 4, 5, 6, 8];
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
}

/** The scorecard axes this depth is judged on at the gate. */
export function depthAxes(depth: Depth, appType?: AppType): string[] {
  if (depth === "plain") return [];
  const steps = depthSteps(depth, appType);
  const axes = ["Look", "Feel", "First run"];
  if (steps.includes(3)) axes.push("Foundation");
  axes.push("Growth", "Trust");
  if (steps.includes(5)) axes.push("Retention");
  if (depth === "commercial-2x") axes.push("Money");
  return axes;
}

const MONEY_WORDS =
  /\b(commercial ?(2x|x2)|monetis|monetiz|charge (for|people|users)|paywall|pricing page|price it|sell (it|this|them)|subscription|subscribers|upgrade (tier|plan)|premium tier|take payments?)\b/i;

/**
 * The depth this build should run at, decided from the app itself.
 *
 * Deliberately conservative in one direction only: `commercial` is the normal
 * case, and `plain` has to be earned — a second person or a server anywhere
 * means the foundation has to exist, because retrofitting logins onto a shipped
 * app is the expensive mistake this whole rule exists to prevent.
 */
export function depthFor(idea: string, u: Understanding | undefined, answers: Answers = {}): { depth: Depth; why: string } {
  const words = `${idea} ${u?.model ?? ""} ${u?.endGoal ?? ""} ${u?.beyond ?? ""}`;
  if (MONEY_WORDS.test(words)) {
    return { depth: "commercial-2x", why: "you asked for it to make money, so the money layer is switched on" };
  }
  const touches = [answers.touches].flat().filter(Boolean).join("; ").toLowerCase();
  const audience = (u?.audience ?? [answers.audience].flat().join("; ") ?? "").toLowerCase();
  const justMe = /just me|my team/.test(audience);
  const shared = /public|business|client|customer|friend|famil|team|anyone|everyone/.test(audience) && !justMe;
  if (u?.appType === "website") {
    return { depth: "commercial", why: "a site people visit — Look, Growth and Honest product, no foundation to build" };
  }
  if (shared) return { depth: "commercial", why: `other people use it (${u?.audience ?? "shared"}), so it needs the full foundation` };
  if (/account|sign-in|payment|personal data/.test(touches)) {
    return { depth: "commercial", why: "it touches accounts or personal data, so logins and the foundation have to be real" };
  }
  if (u?.appType === "saas" || u?.appType === "marketplace") {
    return { depth: "commercial", why: `a ${u.appType} always has a second person in it` };
  }
  if (/\bai\b|other apps/.test(touches)) {
    return { depth: "commercial", why: "it calls a server, so it needs keys, rate limits and the honest-product layer" };
  }
  if (justMe && /works offline/.test(touches)) {
    return { depth: "plain", why: "just you, saved in the browser — nothing to put a foundation under" };
  }
  if (justMe && (u?.appType === "tool" || u?.appType === "webapp")) {
    return { depth: "plain", why: "a tool for you alone, so the four stages are enough" };
  }
  return { depth: "commercial", why: "the normal depth for anything with a second person or a server" };
}

/** The depth on a project, falling back to the one its app earns. */
export function depthOf(p: { idea: string; depth?: Depth; understanding?: Understanding; answers: Answers }): { depth: Depth; why: string } {
  const earned = depthFor(p.idea, p.understanding, p.answers);
  if (!p.depth || p.depth === earned.depth) return earned;
  return { depth: p.depth, why: "you chose this depth" };
}

/** The line the build brief carries, so Claude Code runs the right steps. */
export function depthBrief(depth: Depth, appType?: AppType): string {
  if (depth === "plain") {
    return "Depth: plain — the four stages only (spec, look, build, gate). No commercial foundation; say in one line at the end that `commercial` would add it.";
  }
  const steps = depthSteps(depth, appType).join(", ");
  if (depth === "commercial") {
    return `Depth: commercial — run the \`commercial\` skill, Steps ${steps}. The app stays COMPLETELY FREE: no prices, no pricing page, no paywalls, no upgrade prompts, no ads. Billing is wired and switched OFF. Close with one line that \`commercial 2x\` would switch it on. Score the axes ${depthAxes(
      depth,
      appType,
    ).join(" · ")} and fix anything under 8.5 before reporting.`;
  }
  return `Depth: commercial 2x — run the \`commercial\` skill, Steps ${steps}: everything in commercial PLUS the business model, the money switched on (pricing, paywalls, upgrade moments) and Step 9's competitor teardown and critic panel. Every axis (${depthAxes(
    depth,
    appType,
  ).join(" · ")}) must reach 9/10 before it ships.`;
}
