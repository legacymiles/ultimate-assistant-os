import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/provider";
import type { ActionResponse, LabAction, LabResponse } from "@/lib/h3-lab/api";
import type { Character, Environment, LabState, Production, Scenario, ShotSpec } from "@/lib/h3-lab/model";
import { approveChange, currentVersion, rejectChange, rollback, skillMarkdown, SKILL_NAME } from "@/lib/h3-lab/guide";
import {
  compileProduction,
  log,
  newId,
  queueExperiment,
  queueSingle,
  rateGeneration,
  recreate,
  renderProduction,
  previousGeneration,
  specOfGeneration,
} from "@/lib/h3-lab/state";
import { measuredIssues, sortIssues } from "@/lib/h3-lab/inspect";
import { cleanOverrides } from "@/lib/h3-lab/strategy";
import { DEFAULT_AGENT } from "@/lib/h3-lab/state";
import { loadBlueprint, loadLab, mintWorkerToken, mutateLab, storageKind, workerPaired } from "@/lib/h3-lab/server/store";
import { runStep } from "@/lib/h3-lab/server/steps";
import { bad, readJson, sessionUid } from "@/lib/h3-lab/server/http";
import { memoryContext } from "@/lib/jarvis/server/memory";
import { saveSkill } from "@/lib/jarvis/server/skills";

// GET  /api/h3-lab/lab  → the whole lab for the signed-in owner
// POST /api/h3-lab/lab  → one LabAction (see src/lib/h3-lab/api.ts)
// Owner-only in middleware.

export const runtime = "nodejs";
export const maxDuration = 120;

const now = () => new Date().toISOString();
const MAX_IMAGE = 1_500_000;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

async function meta(uid: string) {
  return {
    storage: storageKind(),
    aiConfigured: aiConfigured(),
    workerPaired: await workerPaired(uid),
    tickConfigured: Boolean(process.env.H3LAB_TICK_TOKEN),
  };
}

export async function GET() {
  const uid = await sessionUid();
  try {
    const state = await loadLab(uid);
    const body: LabResponse = { state, ...(await meta(uid)) };
    return NextResponse.json(body);
  } catch (e) {
    return bad(`Could not read the lab: ${e instanceof Error ? e.message : e}`, 500);
  }
}

function images(list: unknown): string[] {
  return (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === "string" && IMAGE.test(x) && x.length <= MAX_IMAGE).slice(0, 4);
}

function str(v: unknown, max = 4000): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function lines(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).map((x) => str(x, 400)).filter(Boolean).slice(0, 20);
}

function cleanSpec(raw: Partial<ShotSpec>): ShotSpec {
  const n = Number(raw.durationSec);
  return {
    genre: str(raw.genre, 60) || "movie-scene",
    title: str(raw.title, 160) || "Untitled",
    durationSec: Number.isFinite(n) ? Math.max(4, Math.min(15, n)) : 5,
    aspect: (["16:9", "9:16", "1:1"].includes(String(raw.aspect)) ? raw.aspect : "16:9") as ShotSpec["aspect"],
    framing: str(raw.framing, 200),
    camera: {
      move: (raw.camera?.move ?? "static") as ShotSpec["camera"]["move"],
      amount: (["small", "medium", "large"].includes(String(raw.camera?.amount)) ? raw.camera!.amount : "medium") as ShotSpec["camera"]["amount"],
      speed: (["slow", "medium", "fast"].includes(String(raw.camera?.speed)) ? raw.camera!.speed : "medium") as ShotSpec["camera"]["speed"],
      ...(raw.camera?.focus ? { focus: str(raw.camera.focus, 200) } : {}),
    },
    action: str(raw.action, 1200),
    beats: lines(raw.beats).slice(0, 6),
    characterIds: lines(raw.characterIds).slice(0, 6),
    environmentId: raw.environmentId ? str(raw.environmentId, 80) : null,
    dialogue: (Array.isArray(raw.dialogue) ? raw.dialogue : []).slice(0, 8).map((d) => ({ speaker: str(d.speaker, 80), line: str(d.line, 400), delivery: str(d.delivery, 200), ...(d.voiceover ? { voiceover: true } : {}) })),
    mood: str(raw.mood, 200),
    lighting: str(raw.lighting, 400),
    style: str(raw.style, 300),
    sound: str(raw.sound, 400),
    music: str(raw.music, 300),
    intentionalChanges: lines(raw.intentionalChanges).filter((x) => ["position", "lighting", "wardrobe", "environment", "framing", "props", "time"].includes(x)) as ShotSpec["intentionalChanges"],
  };
}

export async function POST(req: Request) {
  const uid = await sessionUid();
  const body = await readJson<LabAction>(req);
  if (!body || typeof body.action !== "string") return bad("Send a JSON action.");
  const t = now();

  if (body.action === "agent.tick") {
    const { step, state } = await runStep(uid, "owner");
    return NextResponse.json({ state, step } satisfies ActionResponse);
  }

  if (body.action === "worker.token") {
    const token = await mintWorkerToken(uid);
    if (!token) return bad("Could not save the token. On a deployed host this needs SUPABASE_SERVICE_ROLE_KEY.", 500);
    const { state } = await mutateLab(uid, (s) => log(s, "owner", "worker", "Created a new worker token (any older token stopped working).", undefined, t));
    return NextResponse.json({ state, token, notice: "Token created — it is shown once." } satisfies ActionResponse);
  }

  if (body.action === "guide.publish") {
    const ctx = await memoryContext();
    if (!ctx.available) return bad(`Cannot reach the skill store: ${ctx.reason}`, 503);
    const snapshot = await loadLab(uid);
    const v = currentVersion(snapshot.guide);
    const examples = snapshot.generations
      .filter((g) => g.status === "done" && (g.overall ?? 0) >= 8 && g.guideVersion === v.version)
      .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
      .slice(0, 3)
      .map((g) => g.prompt);
    try {
      const r = await saveSkill(ctx, { name: SKILL_NAME, body: skillMarkdown(v, { examples }), origin: "h3-prompt-lab" });
      const { state } = await mutateLab(uid, (s) => {
        s.guide.publishedVersion = v.version;
        s.guide.publishedAt = t;
        log(s, "owner", "publish", `Published Master Guide v${v.version} to the ${SKILL_NAME} skill${r.changed ? "" : " (unchanged)"}. Every device picks it up on its next skill sync.`, undefined, t);
      });
      return NextResponse.json({ state, notice: `Published v${v.version} to ${SKILL_NAME}.` } satisfies ActionResponse);
    } catch (e) {
      return bad(`Publishing failed: ${e instanceof Error ? e.message : e}`, 500);
    }
  }

  try {
    const { state, value } = await mutateLab(uid, async (s): Promise<Partial<ActionResponse> | string> => {
      switch (body.action) {
        case "agent.control": {
          if (!["running", "paused", "stopped"].includes(body.mode)) return "Unknown mode.";
          const was = s.agent.mode;
          s.agent.mode = body.mode;
          if (body.mode === "stopped") {
            // Stop = cancel what has not started; a render already on the GPU finishes.
            let n = 0;
            for (const g of s.generations) if (g.status === "queued" && g.pairKey.includes(":v")) {
              g.status = "cancelled";
              n++;
            }
            for (const j of s.think) if (j.state === "queued") j.state = "failed";
            log(s, "owner", "control", `Stopped the agent (was ${was}); cancelled ${n} queued experiment render${n === 1 ? "" : "s"}.`, undefined, t);
          } else log(s, "owner", "control", `${body.mode === "running" ? (was === "paused" ? "Resumed" : "Started") : "Paused"} the agent.`, undefined, t);
          return {};
        }
        case "agent.settings": {
          const p = body.patch ?? {};
          const a = s.agent;
          const num = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
          if (p.promotion) a.promotion = p.promotion === "auto" ? "auto" : "manual";
          if (p.minPairs !== undefined) a.minPairs = Math.round(num(p.minPairs, 1, 50, DEFAULT_AGENT.minPairs));
          if (p.minLowerBound !== undefined) a.minLowerBound = num(p.minLowerBound, -2, 5, DEFAULT_AGENT.minLowerBound);
          if (p.rendersPerDay !== undefined) a.rendersPerDay = Math.round(num(p.rendersPerDay, 0, 500, DEFAULT_AGENT.rendersPerDay));
          if (p.aiCallsPerDay !== undefined) a.aiCallsPerDay = Math.round(num(p.aiCallsPerDay, 0, 5000, DEFAULT_AGENT.aiCallsPerDay));
          if (p.maxConcurrentExperiments !== undefined) a.maxConcurrentExperiments = Math.round(num(p.maxConcurrentExperiments, 1, 10, DEFAULT_AGENT.maxConcurrentExperiments));
          if (p.brain) a.brain = p.brain === "claude-code" ? "claude-code" : "hub-ai";
          if (p.model) a.model = str(p.model, 120);
          if (p.quality) a.quality = p.quality === "hi" ? "hi" : "turbo";
          if (p.testSeconds !== undefined) a.testSeconds = num(p.testSeconds, 4, 15, DEFAULT_AGENT.testSeconds);
          if (p.priorities) a.priorities = lines(p.priorities).slice(0, 12);
          if (p.mode && ["running", "paused", "stopped"].includes(p.mode)) a.mode = p.mode;
          log(s, "owner", "control", `Changed agent settings: ${Object.keys(p).join(", ")}.`, undefined, t);
          return { notice: "Settings saved." };
        }
        case "experiment.create": {
          const e = body.experiment;
          const codes = new Set(s.experiments.map((x) => x.code));
          let code = "";
          for (let i = 0; i < 702 && !code; i++) {
            const c = i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
            if (!codes.has(c)) code = c;
          }
          const id = newId("exp");
          s.experiments.push({
            id,
            code,
            name: str(e.name, 120) || `Experiment ${code}`,
            version: 1,
            hypothesis: str(e.hypothesis, 1000),
            intendedImprovement: str(e.intendedImprovement, 600),
            overrides: cleanOverrides(e.overrides),
            instructions: str(e.instructions, 1000),
            targets: (e.targets ?? []).slice(0, 11),
            scenarioIds: (e.scenarioIds ?? []).filter((x) => s.scenarios.some((sc) => sc.id === x)),
            baseVersion: s.guide.current,
            status: "draft",
            createdBy: "owner",
            createdAt: t,
            updatedAt: t,
            strengths: [],
            weaknesses: [],
            conclusion: "",
          });
          log(s, "owner", "design-experiment", `Created experiment ${code} "${str(e.name, 120)}".`, { type: "experiment", id }, t);
          return { id };
        }
        case "experiment.update": {
          const e = s.experiments.find((x) => x.id === body.id);
          if (!e) return "No such experiment.";
          const p = body.patch;
          const changesTest = p.overrides !== undefined || p.instructions !== undefined;
          if (p.name !== undefined) e.name = str(p.name, 120);
          if (p.hypothesis !== undefined) e.hypothesis = str(p.hypothesis, 1000);
          if (p.intendedImprovement !== undefined) e.intendedImprovement = str(p.intendedImprovement, 600);
          if (p.overrides !== undefined) e.overrides = cleanOverrides(p.overrides);
          if (p.instructions !== undefined) e.instructions = str(p.instructions, 1000);
          if (p.targets !== undefined) e.targets = p.targets.slice(0, 11);
          if (p.scenarioIds !== undefined) e.scenarioIds = p.scenarioIds.filter((x) => s.scenarios.some((sc) => sc.id === x));
          // Changing what is tested makes a new version; old results stay filed under the old pairs.
          if (changesTest && e.status !== "draft") {
            e.version++;
            e.status = "draft";
          }
          e.updatedAt = t;
          return { notice: `Saved ${e.code}${changesTest ? ` (v${e.version})` : ""}.` };
        }
        case "experiment.queue": {
          const e = s.experiments.find((x) => x.id === body.id);
          if (!e) return "No such experiment.";
          if (e.status !== "draft") e.status = "draft";
          const r = queueExperiment(s, e.id, t);
          log(s, "owner", "queue-render", `Queued ${r.queued} render${r.queued === 1 ? "" : "s"} for ${e.code}${r.reused ? `, re-using ${r.reused} master render(s)` : ""}${r.skipped.length ? `; skipped (no difference): ${r.skipped.join(", ")}` : ""}.`, { type: "experiment", id: e.id }, t);
          return { notice: r.queued + r.reused ? `Queued ${r.queued} render(s).` : "Nothing to queue: this experiment changes nothing for its scenarios, or they are already queued." };
        }
        case "experiment.archive": {
          const e = s.experiments.find((x) => x.id === body.id);
          if (!e) return "No such experiment.";
          e.status = "archived";
          e.updatedAt = t;
          for (const g of s.generations) if (g.status === "queued" && g.pairKey.startsWith(`${e.id}:`)) g.status = "cancelled";
          return {};
        }
        case "scenario.save": {
          const spec = cleanSpec(body.scenario.spec ?? {});
          const existing = body.scenario.id ? s.scenarios.find((x) => x.id === body.scenario.id) : null;
          if (existing) {
            existing.title = str(body.scenario.title, 160) || spec.title;
            existing.spec = spec;
            return { id: existing.id };
          }
          const sc: Scenario = { id: newId("sc"), title: str(body.scenario.title, 160) || spec.title, spec, createdAt: t, source: "owner" };
          s.scenarios.push(sc);
          return { id: sc.id };
        }
        case "scenario.delete": {
          s.scenarios = s.scenarios.filter((x) => x.id !== body.id);
          for (const e of s.experiments) e.scenarioIds = e.scenarioIds.filter((x) => x !== body.id);
          return {};
        }
        case "generation.rate": {
          const g = rateGeneration(s, body.id, body.verdict, body.note, body.scores);
          if (!g) return "No such render.";
          log(s, "owner", "evaluate", `Rated a render ${body.verdict ?? "unrated"}${body.scores ? ` and set ${Object.keys(body.scores).length} score(s)` : ""}.`, { type: "generation", id: g.id }, t);
          return {};
        }
        case "generation.cancel": {
          const g = s.generations.find((x) => x.id === body.id);
          if (!g) return "No such render.";
          if (g.status === "queued") g.status = "cancelled";
          else return "Only a queued render can be cancelled — one on the GPU finishes.";
          return {};
        }
        case "generation.retry": {
          const g = s.generations.find((x) => x.id === body.id);
          if (!g || (g.status !== "failed" && g.status !== "cancelled")) return "Only a failed or cancelled render can be retried.";
          g.status = "queued";
          g.error = undefined;
          g.queuedAt = t;
          return {};
        }
        case "render.single": {
          const g = queueSingle(s, cleanSpec(body.spec), body.strategy, body.experimentId ?? null, t, str(body.instructions, 1000));
          log(s, "owner", "queue-render", `Queued a single test render (${g.genre}).`, { type: "generation", id: g.id }, t);
          return { id: g.id, notice: "Queued one render." };
        }
        case "change.approve": {
          const { guide, version } = approveChange(s.guide, body.id, t, body.note);
          if (!version) return "That change is not pending.";
          s.guide = guide;
          log(s, "owner", "approve", `Approved "${guide.changes.find((c) => c.id === body.id)?.title}" → Master Guide v${version}.`, { type: "change", id: body.id }, t);
          return { notice: `Master Guide is now v${version}.` };
        }
        case "change.reject": {
          s.guide = rejectChange(s.guide, body.id, t, body.note);
          log(s, "owner", "reject", `Rejected "${s.guide.changes.find((c) => c.id === body.id)?.title}"${body.note ? `: ${body.note}` : ""}.`, { type: "change", id: body.id }, t);
          return {};
        }
        case "change.propose": {
          const c = body.change;
          const id = newId("change");
          s.guide.changes.push({
            id,
            kind: c.patch.sections?.length && !c.patch.genreStrategy?.length && !c.patch.strategy ? "section" : "technique",
            title: str(c.title, 200),
            why: str(c.why, 2000),
            problem: str(c.problem, 1000),
            experimentIds: c.experimentIds ?? [],
            evidence: [],
            patch: {
              strategy: c.patch.strategy ? cleanOverrides(c.patch.strategy) : undefined,
              genreStrategy: c.patch.genreStrategy?.map((g) => ({ genre: str(g.genre, 60), set: cleanOverrides(g.set) })),
              sections: c.patch.sections?.map((x) => ({ id: str(x.id, 80), title: str(x.title, 160), body: str(x.body, 20000), ...(x.genre ? { genre: str(x.genre, 60) } : {}) })),
            },
            status: "pending",
            proposedBy: "owner",
            createdAt: t,
          });
          log(s, "owner", "propose", `Proposed a guide change: ${str(c.title, 200)}.`, { type: "change", id }, t);
          return { id };
        }
        case "guide.rollback": {
          const id = newId("change");
          const before = s.guide.current;
          s.guide = rollback(s.guide, body.version, str(body.why, 1000), id, t);
          if (s.guide.current === before) return "Cannot roll back to that version.";
          log(s, "owner", "rollback", `Rolled back to v${body.version} as new v${s.guide.current}${body.why ? `: ${body.why}` : ""}.`, { type: "change", id }, t);
          return { notice: `Now on v${s.guide.current} (a copy of v${body.version}).` };
        }
        case "character.save": {
          const c = body.character;
          const prev = c.id ? s.characters.find((x) => x.id === c.id) : undefined;
          const next: Character = {
            id: prev?.id ?? newId("char"),
            name: str(c.name, 80),
            identity: str(c.identity, 600),
            face: str(c.face, 600),
            hair: str(c.hair, 300),
            wardrobe: str(c.wardrobe, 600),
            body: str(c.body, 300),
            accessories: str(c.accessories, 300),
            relationships: str(c.relationships, 600),
            referenceImages: c.referenceImages ? images(c.referenceImages) : prev?.referenceImages ?? [],
            continuityRules: c.continuityRules ? lines(c.continuityRules) : prev?.continuityRules ?? [],
            createdAt: prev?.createdAt ?? t,
            updatedAt: t,
          };
          if (!next.name) return "A character needs a name.";
          if (prev) Object.assign(prev, next);
          else s.characters.push(next);
          return { id: next.id };
        }
        case "character.delete": {
          s.characters = s.characters.filter((x) => x.id !== body.id);
          return {};
        }
        case "environment.save": {
          const e = body.environment;
          const prev = e.id ? s.environments.find((x) => x.id === e.id) : undefined;
          const next: Environment = {
            id: prev?.id ?? newId("env"),
            name: str(e.name, 80),
            description: str(e.description, 800),
            architecture: str(e.architecture, 600),
            furniture: str(e.furniture, 600),
            doorsWindows: str(e.doorsWindows, 400),
            lighting: str(e.lighting, 400),
            objects: str(e.objects, 400),
            cameraPerspectives: str(e.cameraPerspectives, 400),
            spatial: str(e.spatial, 400),
            referenceImages: e.referenceImages ? images(e.referenceImages) : prev?.referenceImages ?? [],
            continuityRules: e.continuityRules ? lines(e.continuityRules) : prev?.continuityRules ?? [],
            createdAt: prev?.createdAt ?? t,
            updatedAt: t,
          };
          if (!next.name) return "A set needs a name.";
          if (prev) Object.assign(prev, next);
          else s.environments.push(next);
          return { id: next.id };
        }
        case "environment.delete": {
          s.environments = s.environments.filter((x) => x.id !== body.id);
          return {};
        }
        case "production.save": {
          const p = body.production;
          const prev = p.id ? s.productions.find((x) => x.id === p.id) : undefined;
          const scenes = Array.isArray(p.scenes)
            ? p.scenes.slice(0, 60).map((sc, i) => ({ id: sc.id || newId("scene"), order: i, spec: cleanSpec(sc.spec ?? {}), generationIds: (prev?.scenes.find((x) => x.id === sc.id)?.generationIds) ?? [], compiled: prev?.scenes.find((x) => x.id === sc.id)?.compiled }))
            : prev?.scenes ?? [];
          const next: Production = {
            id: prev?.id ?? newId("prod"),
            title: str(p.title, 160),
            genre: str(p.genre, 60) || prev?.genre || "short-film",
            logline: str(p.logline ?? prev?.logline, 600),
            style: str(p.style ?? prev?.style, 400),
            story: str(p.story ?? prev?.story, 6000),
            characterIds: p.characterIds ? lines(p.characterIds) : prev?.characterIds ?? [],
            environmentIds: p.environmentIds ? lines(p.environmentIds) : prev?.environmentIds ?? [],
            cameraLanguage: str(p.cameraLanguage ?? prev?.cameraLanguage, 600),
            continuityRules: p.continuityRules ? lines(p.continuityRules) : prev?.continuityRules ?? [],
            scenes,
            blueprintId: prev?.blueprintId ?? null,
            createdAt: prev?.createdAt ?? t,
            updatedAt: t,
          };
          if (!next.title) return "A production needs a title.";
          if (prev) Object.assign(prev, next);
          else s.productions.push(next);
          return { id: next.id };
        }
        case "production.delete": {
          s.productions = s.productions.filter((x) => x.id !== body.id);
          return {};
        }
        case "production.compile": {
          const p = compileProduction(s, body.id, t);
          if (!p) return "No such production.";
          return { notice: `Compiled ${p.scenes.length} scene prompt(s) against Master Guide v${s.guide.current}.` };
        }
        case "production.render": {
          const n = renderProduction(s, body.id, body.sceneIds, t);
          if (!n) return "Nothing to render.";
          log(s, "owner", "queue-render", `Queued ${n} production scene render${n === 1 ? "" : "s"}.`, { type: "production", id: body.id }, t);
          return { notice: `Queued ${n} render(s).` };
        }
        case "blueprint.recreate": {
          const b = await loadBlueprint(uid, body.id);
          if (!b) return "That blueprint is gone.";
          const p = recreate(s, b, str(body.title, 160), body.castMap ?? {}, body.envMap ?? {}, t);
          log(s, "owner", "analyze-reference", `Recreated "${b.sourceName}" as production "${p.title}" with ${p.characterIds.length} new character(s).`, { type: "production", id: p.id }, t);
          return { id: p.id };
        }
        case "blueprint.delete": {
          s.blueprints = s.blueprints.filter((x) => x.id !== body.id);
          return {};
        }
        case "repo.save": {
          const r = body.repo;
          if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(str(r.url, 300)) && !/^https?:\/\//.test(str(r.url, 300))) return "Give a full https URL.";
          const prev = r.id ? s.repos.find((x) => x.id === r.id) : undefined;
          const row = {
            id: prev?.id ?? newId("repo"),
            name: str(r.name, 120),
            url: str(r.url, 300),
            description: str(r.description ?? prev?.description, 600),
            capabilities: r.capabilities ? lines(r.capabilities) : prev?.capabilities ?? [],
            license: str(r.license ?? prev?.license, 120) || "unknown",
            compatibility: (r.compatibility ?? prev?.compatibility ?? "unknown") as LabState["repos"][number]["compatibility"],
            compatibilityNote: str(r.compatibilityNote ?? prev?.compatibilityNote, 600),
            reusable: r.reusable ? lines(r.reusable) : prev?.reusable ?? [],
            recommendation: (r.recommendation ?? prev?.recommendation ?? "review") as LabState["repos"][number]["recommendation"],
            integration: (r.integration ?? prev?.integration ?? "not-integrated") as LabState["repos"][number]["integration"],
            reviewedAt: t.slice(0, 10),
            discoveredBy: prev?.discoveredBy ?? ("owner" as const),
            notes: str(r.notes ?? prev?.notes, 2000),
          };
          if (prev) Object.assign(prev, row);
          else s.repos.push(row);
          return { id: row.id };
        }
        case "repo.delete": {
          s.repos = s.repos.filter((x) => x.id !== body.id);
          return {};
        }
        case "inspect.run": {
          const g = s.generations.find((x) => x.id === body.generationId);
          if (!g || !g.metrics) return "That render has no measurements to inspect yet.";
          const spec = specOfGeneration(s, g);
          if (!spec) return "That render's shot spec is gone.";
          const prev = body.previousId ? s.generations.find((x) => x.id === body.previousId) : previousGeneration(s, g);
          const measured = measuredIssues(g.metrics, spec, g.strategy.structure, prev?.metrics ?? null);
          g.issues = sortIssues([...measured, ...(g.issues ?? []).filter((i) => i.source === "vision")]);
          return { notice: `${g.issues.length} issue(s) after re-inspection.` };
        }
        default:
          return `Unknown action ${(body as { action: string }).action}.`;
      }
    });
    if (typeof value === "string") return bad(value);
    return NextResponse.json({ state, ...value } satisfies ActionResponse);
  } catch (e) {
    return bad(`That did not save: ${e instanceof Error ? e.message : e}`, 500);
  }
}
