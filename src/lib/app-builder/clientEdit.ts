// ---------------------------------------------------------------------------
// App Builder — client edits from Client Review (pure).
//
// The owner approves a batch of a client's edit requests in Client Review.
// That batch becomes an App Builder project in "edit mode": the purpose is
// already known (it's the client's own site), so the intake questions are
// skipped and every approved request arrives on the feature list already
// accepted, in the owner's wording, with the spot the client pointed at.
//
// The hand-off is different from a new app too. Claude Code doesn't start a
// project: it branches the client's repo, makes exactly these edits, checks
// each one at the pinned spot, opens a pull request (the owner merges to go
// live), waits for the Vercel preview and posts it back to the client's
// review link with the connector's `client_review_preview` tool. The client
// is told; the owner does nothing after Approve.
//
// The owner's rule still holds: felix and prompt-enhancer run on every build,
// and software-factory (super-board) takes over when a batch is bigger than
// one pull request.
// ---------------------------------------------------------------------------

import { CHECKLIST } from "../new-jarvis/felix";
import { baseBranchFor, branchFor, buildText, plainBrief } from "../client-review/logic";
import type { ClientProject, EditRequest } from "../client-review/types";
import type { BuilderProject, ClientEdit, ClientEditItem, Feature, Understanding } from "./types";

/** In Queue holds at most this many characters per request (same as engine.QUEUE_LIMIT). */
const LIMIT = 4000;

/** The checklist lines an edit to a live client site is held to. */
export const EDIT_CHECKLIST = ["R1", "R2", "U1", "U2", "U8", "P1", "P2", "S1", "O1", "C3", "C4"];

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function pinText(pin: ClientEditItem["pin"]): string {
  if (!pin) return "";
  const across = Math.round(pin.x * 100);
  const down = Math.round(pin.y * 100);
  return `pinned ${across}% across, ${down}% down the visible screen${pin.viewport ? ` on a ${pin.viewport}px-wide screen` : ""}`;
}

function titleOf(text: string): string {
  const first = oneLine(text).replace(/^(please|can you|could you|i want to|i'd like to|we need to)\s+/i, "");
  const t = first.charAt(0).toUpperCase() + first.slice(1);
  return t.length > 64 ? `${t.slice(0, 63).trimEnd()}…` : t;
}

function understandingFor(edit: ClientEdit): Understanding {
  const who = edit.clientName || "The client";
  const n = edit.items.length;
  return {
    name: edit.siteName.slice(0, 48),
    oneLiner: `${n} approved client edit${n === 1 ? "" : "s"} → ${edit.version}`,
    appType: "website",
    purpose: `Make the edits ${who} asked for on their own site and put them in front of them as ${edit.version}.`,
    audience: `${who}, and the people who visit their site`,
    endGoal: `${who} sees exactly the edits they asked for on a preview of their site, without anyone pasting links or touching code by hand.`,
    beyond: "Every round makes the site better: each edit checked at the spot the client pointed to, versioned, and one merge away from live.",
    model: "Client website (built for a client)",
    designSkill: "interactive-web-studio",
    designWhy: "match the site's existing look — edits should feel native to it, never a redesign",
    judge: [
      "Each edit is visible at the spot the client pointed to, shown with before/after screenshots at their screen width",
      "Nothing else on the site changed (screenshot diff of every page the edits don't touch)",
      "The preview opens without a login and its main content shows in under 1 s on a phone (Lighthouse mobile)",
      "Build and typecheck pass; no new console errors",
    ],
  };
}

/**
 * The App Builder project for an approved batch. Throws a plain-English Error
 * when the batch can't be built yet.
 */
export function clientEditProject(
  p: ClientProject,
  batchId: string,
  now = new Date(),
  id = `ab_${Math.random().toString(36).slice(2, 10)}`,
): BuilderProject {
  const batch = p.batches.find((b) => b.id === batchId);
  if (!batch) throw new Error("That batch no longer exists.");
  if (batch.status !== "approved" || !batch.nextVersionId) throw new Error("Approve the batch before building it.");
  const version = p.versions.find((v) => v.id === batch.nextVersionId);
  if (!version) throw new Error("The version this batch opened no longer exists.");
  if (version.status !== "building") throw new Error(`${version.number} isn't being built any more.`);
  const from = p.versions.find((v) => v.id === batch.versionId);

  // Every batch that opened this version is built together.
  const ids = new Set(p.batches.filter((b) => b.nextVersionId === version.id).flatMap((b) => b.requestIds));
  const reqs = p.requests.filter((r): r is EditRequest => ids.has(r.id) && (r.status === "approved" || r.status === "done"));
  if (!reqs.length) throw new Error("Every request in this batch was dropped — there's nothing to build.");

  const items: ClientEditItem[] = reqs.map((r, i) => ({
    featureId: `f${i + 1}`,
    requestId: r.id,
    text: buildText(r),
    ...(r.adminText ? { clientText: r.text } : {}),
    ...(r.pin ? { pin: r.pin } : {}),
  }));

  const edit: ClientEdit = {
    reviewId: p.id,
    batchId: batch.id,
    siteName: p.name,
    clientName: p.clientName,
    fromVersion: from?.number ?? "",
    fromUrl: from?.siteUrl ?? "",
    version: version.number,
    versionId: version.id,
    ...(p.repo ? { repo: p.repo } : {}),
    ...(p.vercelProject ? { vercelProject: p.vercelProject } : {}),
    baseBranch: baseBranchFor(p),
    branch: branchFor(p, version.number),
    // The plain brief (no AI) only repeats the list, so it isn't carried twice.
    brief: batch.brief && batch.brief.trim() !== plainBrief(p, batch).trim() ? batch.brief : "",
    items,
  };

  const features: Feature[] = items.map((it) => ({
    id: it.featureId,
    title: titleOf(it.text),
    why: it.clientText ? `${edit.clientName || "The client"} asked: “${oneLine(it.clientText)}”` : `${edit.clientName || "The client"} asked for it.`,
    detail: `${it.text}${it.pin ? ` (${pinText(it.pin)})` : ""}`,
    kind: "experience",
    impact: 3,
    effort: "S",
    status: "accepted",
    source: "you",
    checklist: ["U1", "U2"],
  }));

  const at = now.toISOString();
  const u = understandingFor(edit);
  return {
    id,
    createdAt: at,
    updatedAt: at,
    idea: `Client edits for ${p.name}${edit.fromVersion ? ` (${edit.fromVersion} → ${edit.version})` : ` (${edit.version})`}: ${items.map((it) => oneLine(it.text)).join("; ")}`.slice(0, 2000),
    stage: "features",
    questions: [],
    answers: { audience: u.audience, touches: [] },
    understanding: u,
    features,
    chat: [
      {
        id: `m_${id}`,
        role: "agent",
        at,
        text:
          `From Client Review: ${items.length} approved edit${items.length === 1 ? "" : "s"} from ${edit.clientName || "the client"} for ${edit.version}, all accepted in your wording. ` +
          (edit.repo
            ? `Build it sends them to Claude Code for ${edit.repo}; when the preview is up it goes straight to ${edit.clientName || "the client"}'s review link.`
            : "Add the client's GitHub repo in Client Review so Claude Code knows where to build."),
      },
    ],
    origin: "client-review",
    edit,
  };
}

/** The skills an edit runs, in order. */
export function editPipeline(): { skill: string; role: string }[] {
  return [
    { skill: "felix", role: "Quick pass: the end goal is the client seeing exactly these edits; set the judge before touching code." },
    { skill: "prompt-enhancer", role: "Turn each edit into a precise change (which file, which element, what it becomes); resolve vague ones from the site itself." },
    { skill: "interactive-web-studio", role: "Match the site's existing design system — fonts, colours, spacing — so edits look native. No redesign." },
    { skill: "software-factory", role: "Only when the batch is bigger than one pull request (~400 lines): split it into Backlog cards; the owner approves every merge." },
    { skill: "claude-security", role: "Scan the diff before the pull request; fix anything high or critical." },
    { skill: "website-build-checklist", role: `Hold the changed pages to ${EDIT_CHECKLIST.join(" ")}.` },
  ];
}

function editsBlock(edit: ClientEdit, detail = Infinity): string[] {
  return edit.items.map((it, i) => {
    const t = oneLine(it.text);
    const text = t.length > detail ? `${t.slice(0, Math.max(0, detail - 1))}…` : t;
    const pin = it.pin ? ` [${pinText(it.pin)}]` : "";
    const client = it.clientText && detail > 120 ? ` (client wrote: “${oneLine(it.clientText).slice(0, 160)}”)` : "";
    return `${i + 1}. ${text}${pin}${client}`;
  });
}

function whereLine(edit: ClientEdit): string {
  return [
    edit.repo ? `Repo: ${edit.repo}` : "Repo: NOT SET — queue_note the owner to add the client's GitHub repo in Client Review, then stop",
    edit.vercelProject ? `Vercel project: ${edit.vercelProject}` : "Vercel project: the one linked to that repo",
    `Branch: ${edit.branch} off ${edit.baseBranch}${edit.baseBranch === "main" ? "" : ` (if ${edit.baseBranch} is already merged or gone, branch off main)`}`,
  ].join(" · ");
}

function finishSteps(edit: ClientEdit): string[] {
  return [
    `1. Before/after screenshots at each pin (Playwright at the client's screen width; ${edit.fromUrl || "the current site"} is "before").`,
    `2. Push ${edit.branch}; open a pull request into main titled "${edit.siteName}: ${edit.version} client edits". Never merge it — the owner merges to go live.`,
    "3. Wait for the Vercel preview of the branch (gh pr checks / the deployment status). It must open without a Vercel login — if it asks for one, queue_note the owner to turn off Vercel Authentication for previews (Vercel › Settings › Deployment Protection) and stop.",
    `4. Call client_review_preview with review_id=${edit.reviewId}, version_id=${edit.versionId}, preview_url, pr_url, branch, and a plain-English summary (one line per edit). That puts it on ${edit.clientName || "the client"}'s link and notifies them.`,
    "5. queue_complete with the preview and PR links.",
  ];
}

/** The short brief Claude Code picks up from In Queue. Always under LIMIT. */
export function editQueueText(p: BuilderProject): string {
  const edit = p.edit!;
  const u = p.understanding;
  const head = [
    `Client edit (Client Review → App Builder): ${edit.siteName} for ${edit.clientName || "a client"}, ${edit.fromVersion ? `${edit.fromVersion} → ` : ""}${edit.version}.`,
    whereLine(edit),
    edit.fromUrl ? `Site the client is looking at: ${edit.fromUrl}` : "",
    `Run skills: felix → prompt-enhancer → match the site's existing design (interactive-web-studio rules, no redesign) → claude-security on the diff; software-factory only if it's more than one PR (~400 lines). Held to website-build-checklist ${EDIT_CHECKLIST.join(" ")}.`,
    "Edits — approved by the owner; build exactly these, the owner's wording wins, change nothing else:",
  ].filter(Boolean);
  const tail = [
    "Then:",
    ...finishSteps(edit),
    u ? `Judge: ${u.judge.join("; ")}.` : "",
  ].filter(Boolean);
  const declined = p.features.filter((f) => f.status === "denied").map((f) => f.title);
  const added = p.features.filter((f) => f.status === "accepted" && !edit.items.some((it) => it.featureId === f.id));
  const extra = [
    ...(added.length ? [`Also (added in App Builder): ${added.map((f) => oneLine(f.detail || f.title)).join("; ")}`] : []),
    ...(declined.length ? [`Left out by the owner in App Builder: ${declined.join("; ")}.`] : []),
  ];
  const kept = edit.items.filter((it) => p.features.find((f) => f.id === it.featureId)?.status !== "denied");
  const keptEdit = { ...edit, items: kept };

  for (const [detail, brief] of [
    [Infinity, 900],
    [400, 600],
    [240, 300],
    [140, 0],
    [70, 0],
  ] as const) {
    const b = oneLine(edit.brief);
    const briefLine = brief && b ? [`Owner's brief: ${b.length > brief ? `${b.slice(0, brief - 1)}…` : b}`] : [];
    const text = [...head, ...editsBlock(keptEdit, detail), ...extra, ...briefLine, ...tail].join("\n");
    if (text.length <= LIMIT) return text;
  }
  const text = [...head, ...editsBlock(keptEdit, 50), ...tail].join("\n");
  return text.length <= LIMIT ? text : `${text.slice(0, LIMIT - 1)}…`;
}

/** The full prompt (Copy master prompt / View prompt) for an edit. */
export function editMasterPrompt(p: BuilderProject): string {
  const edit = p.edit!;
  const u = p.understanding ?? understandingFor(edit);
  const accepted = p.features.filter((f) => f.status === "accepted");
  const lines = CHECKLIST.filter((c) => EDIT_CHECKLIST.includes(c.id));
  return [
    `<role>\nA senior web developer who maintains client sites for a small agency: careful, fast, and allergic to changing what wasn't asked for.\n</role>`,
    `<goal>\n${u.endGoal}\nThe goal beyond the goal: ${u.beyond}\n</goal>`,
    `<context>\n- Site: ${edit.siteName} for ${edit.clientName || "a client"}\n- ${whereLine(edit)}\n- The client is looking at ${edit.fromVersion || "the current version"}${edit.fromUrl ? ` (${edit.fromUrl})` : ""}; this build becomes ${edit.version}.\n- Pins are where the client tapped on their screen, as fractions of the visible area (the page may have been scrolled). Use them with the text to find the element.\n</context>`,
    `<edits>\nApproved by the owner — build exactly these, in the owner's wording:\n${accepted
      .map((f, i) => {
        const it = edit.items.find((x) => x.featureId === f.id);
        return `${i + 1}. ${oneLine(f.detail)}${it?.clientText ? `\n   The client wrote: “${oneLine(it.clientText)}”` : ""}`;
      })
      .join("\n")}\n</edits>`,
    edit.brief ? `<brief>\n${edit.brief.trim()}\n</brief>` : "",
    `<skills_pipeline>\n${editPipeline()
      .map((s, i) => `${i + 1}. ${s.skill} — ${s.role}`)
      .join("\n")}\n</skills_pipeline>`,
    `<standard>\nChange only what the edits ask for. Keep the site's look, copy voice and structure everywhere else. Hold the changed pages to:\n${lines.map((c) => `- ${c.id} (${c.level}): ${c.text}`).join("\n")}\n</standard>`,
    `<finish>\n${finishSteps(edit).join("\n")}\n</finish>`,
    `<success_criteria>\n${u.judge.map((j) => `- ${j}`).join("\n")}\nReport honestly against these with real numbers, including anything that missed.\n</success_criteria>`,
    `<constraints>\nAct freely on the branch. Never merge or push to main, never change DNS, domains or billing, and never post the preview if a check failed — queue_note the owner with what failed instead.\n</constraints>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
