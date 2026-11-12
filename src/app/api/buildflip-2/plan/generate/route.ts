import { nanoid } from "nanoid";
import { fail, guardRate, requireUser } from "@/lib/buildflip-2/api";
import { generatePlan, toProject, type Progress } from "@/lib/buildflip-2/ai/generate";
import {
  calibrationForBuildType,
  getProject,
  saveProject,
} from "@/lib/buildflip-2/db/projects";
import { entitlement, getAccount, saveAccount } from "@/lib/buildflip-2/db/account";
import { keys, userStore } from "@/lib/buildflip-2/db/store";
import { capabilities, STORAGE_BUCKET } from "@/lib/buildflip-2/flags";
import { log } from "@/lib/buildflip-2/log";
import { supabaseService } from "@/lib/buildflip-2/supabase/service";
import { generateInput, ownImagesOnly, readJson } from "@/lib/buildflip-2/validate";
import { buildTypeKey } from "@/lib/buildflip-2/calc";
import type { Project } from "@/lib/buildflip-2/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/plan/generate — the whole front door.
 *
 * Streams Server-Sent Events so the plan visibly assembles itself stage by
 * stage instead of spinning (R5). The project row is written BEFORE the
 * expensive work starts and updated as it lands, so closing the tab mid-build
 * never loses the work — reopening shows it finishing or offers Try again (R6).
 *
 * Checks in order: signed in · entitlement (the paywall, server-side) ·
 * rate limit (this costs money per call, S5) · input validation (S4).
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, account } = auth.ctx;

  const parsed = await readJson(req, generateInput);
  if (!parsed.ok) return fail(400, parsed.error);
  const input = parsed.data;

  /**
   * Retrying a plan that FAILED does not count against the free allowance —
   * the user shouldn't pay for our error. But a retry must be a retry:
   *  - the row has to exist, be owned by the caller, and actually be broken
   *  - the inputs come from the STORED row, never from the request body
   * Without both, "retry" is just a free unlimited-plan button: pass your own
   * plan id with a brand new prompt and the paywall never fires.
   */
  let existing: Project | null = null;
  if (input.projectId) {
    existing = await getProject(user.id, input.projectId);
    if (!existing) return fail(404, "We couldn't find that plan to retry.");
    if (!existing.error && !existing.generating) {
      return fail(
        409,
        "That plan finished successfully — there's nothing to retry. Start a new plan instead.",
        { paywall: false },
      );
    }
  }
  const retrying = Boolean(existing);

  // A retry re-runs the ORIGINAL idea. Anything else is a new plan.
  const effective = existing
    ? {
        prompt: existing.prompt,
        sourceUrl: existing.sourceUrl,
        images: existing.referenceImages,
      }
    : {
        prompt: input.prompt,
        sourceUrl: input.sourceUrl || null,
        images: ownImagesOnly(input.images ?? [], user.id),
      };

  if (!retrying) {
    const ent = entitlement(account);
    if (!ent.canGenerate) {
      return fail(402, ent.reason!, {
        paywall: true,
        moment: "secondPlan",
        plansRemaining: 0,
      });
    }
  }

  const limited = await guardRate(user.id, "generate", { costly: true });
  if (limited) return limited;

  // Idempotency: the same requestId never creates a second plan (D5).
  const store = await userStore(user.id);
  if (input.requestId && store) {
    const seen = await store.get<{ projectId: string }>(
      keys.request(input.requestId),
    );
    if (seen?.projectId) {
      const already = await getProject(user.id, seen.projectId);
      if (already) {
        return Response.json(
          { duplicate: true, projectId: seen.projectId },
          { status: 200 },
        );
      }
    }
  }

  const projectId = existing?.id ?? nanoid(12);
  const hourlyTarget = input.hourlyTarget ?? account.hourlyTarget ?? 25;

  // Write the placeholder first. If anything after this dies, the user still
  // has a row with a Try again button rather than a lost idea.
  const placeholder: Project = existing
    ? { ...existing, generating: true, error: null }
    : {
        id: projectId,
        ownerId: user.id,
        title: titleFromPrompt(effective.prompt),
        summary: "",
        prompt: effective.prompt,
        sourceUrl: effective.sourceUrl,
        sourceRead: null,
        referenceImages: effective.images,
        stage: "idea",
        dimensions: [],
        materials: [],
        steps: [],
        tools: [],
        safety: [],
        skillLevel: "intermediate",
        estimatedHours: 0,
        hourlyTarget,
        resale: null,
        askingPrice: null,
        receipts: [],
        shopping: [],
        share: null,
        buildType: buildTypeKey(effective.prompt),
        calibration: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        generating: true,
        error: null,
      };
  await saveProject(placeholder);

  if (input.requestId && store) {
    await store
      .set(keys.request(input.requestId), { projectId })
      .catch(() => {});
  }

  /**
   * Reserve the free plan BEFORE the expensive work, not after.
   *
   * Incrementing afterwards means N parallel requests all read
   * plansGenerated === 0, all pass the entitlement check, and all run a paid
   * generation. The count is refunded below if the generation fails, so a
   * user is never charged an allowance for our error.
   */
  let reserved = false;
  if (!retrying) {
    await saveAccount({ ...account, plansGenerated: account.plansGenerated + 1 });
    reserved = true;
  }

  const encoder = new TextEncoder();
  const imageUrls = await signImages(effective.images, user.id);

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      // The pipeline's own clock, independent of whether anyone is still
      // listening. Bounded so a wedged upstream can't run past maxDuration.
      const pipeline = new AbortController();
      const pipelineTimer = setTimeout(
        () => pipeline.abort(),
        (maxDuration - 15) * 1000,
      );
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      send("open", { projectId });

      try {
        const calibration = await calibrationForBuildType(placeholder.buildType);
        if (calibration) {
          send("progress", {
            stage: "sizing",
            label: `Calibrated from ${calibration.sampleSize} real receipts`,
            detail: `Estimates for this build type run ${(calibration.factor * 100).toFixed(0)}% of the first guess`,
            pct: 0.15,
          } satisfies Progress);
        }

        const result = await generatePlan({
          prompt: effective.prompt,
          sourceUrl: effective.sourceUrl,
          imageUrls,
          hourlyTarget,
          calibration,
          /**
           * DELIBERATELY NOT `req.signal`.
           *
           * The client aborts its fetch whenever the component unmounts — a
           * nav from /board to /settings, or just closing the tab. Forwarding
           * that aborted the upstream model call, so the plan was written as
           * FAILED and the user's free allowance was spent on nothing. Both
           * the board card and the plan page promise "it keeps going even if
           * you close the tab", and now that is true: the pipeline runs to
           * completion on its own clock, bounded by `maxDuration`, and
           * `req.signal` only stops us enqueuing SSE frames nobody is reading.
           */
          signal: pipeline.signal,
          onProgress: (p) => send("progress", p),
        });

        const project = toProject({
          id: projectId,
          ownerId: user.id,
          input: {
            prompt: effective.prompt,
            sourceUrl: effective.sourceUrl,
            images: effective.images,
          },
          result,
          hourlyTarget,
          createdAt: placeholder.createdAt,
        });

        const saved = await saveProject(project);

        await log({
          level: "info",
          event: "plan_generated",
          userId: user.id,
          meta: {
            buildType: saved.buildType,
            materials: saved.materials.length,
            steps: saved.steps.length,
            soldComps: saved.resale?.soldCount ?? 0,
            demo: result.demo,
            costUsd: Number(result.costUsd.toFixed(4)),
          },
        });

        send("done", { project: saved, demo: result.demo });
      } catch (err) {
        const message =
          (err as Error)?.message ??
          "Something went wrong building that plan.";
        await log({
          level: "error",
          event: "plan_generate_failed",
          userId: user.id,
          message,
          stack: (err as Error)?.stack,
        });
        await saveProject({
          ...placeholder,
          generating: false,
          error: friendly(message),
        }).catch(() => {});

        // Give the free plan back — the user should not pay an allowance for
        // our failure. Re-read first so a concurrent generation isn't clobbered.
        if (reserved) {
          try {
            const now = await getAccount(user.id, user.email);
            await saveAccount({
              ...now,
              plansGenerated: Math.max(0, now.plansGenerated - 1),
            });
          } catch {
            /* the plan is already marked failed; a stuck count is the lesser evil */
          }
        }

        send("error", { error: friendly(message), projectId });
      } finally {
        clearTimeout(pipelineTimer);
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function friendly(message: string) {
  if (/rate|429/i.test(message))
    return "The pricing search is busy right now. Give it a minute and hit Try again — your idea is saved.";
  if (/timeout|abort/i.test(message))
    return "That took too long to price. Hit Try again — it usually goes through on the second attempt.";
  if (/readable|JSON/i.test(message))
    return "The plan came back garbled. Hit Try again — this is almost always a one-off.";
  if (/credit|402/i.test(message))
    return "The live pricing service is out of credit, so we can't check real prices right now.";
  return "We couldn't finish that plan. Your idea is saved — hit Try again.";
}

function titleFromPrompt(prompt: string) {
  const first = prompt.trim().split(/[.\n]/)[0] ?? prompt;
  const clean = first.replace(/^(build|make|a|an|the)\s+/i, "").trim();
  return (clean.charAt(0).toUpperCase() + clean.slice(1)).slice(0, 80) || "New build";
}

/**
 * Keep only storage paths that live in THIS user's own folder.
 *
 * `/api/buildflip-2/upload` always writes to `<userId>/<nanoid>.<ext>`, but the paths come
 * back through the browser, so the server must not take them on trust: signing
 * is done with the service role, which bypasses RLS and every storage policy.
 * Without this filter, passing another user's path would mint a signed URL for
 * their private photo and feed it to the vision model.
 */
/**
 * Turn stored reference-photo paths into short-lived signed URLs the vision
 * model can read. The bucket is private — nothing is ever made public (S1).
 */
async function signImages(paths: string[], userId: string): Promise<string[]> {
  const own = ownImagesOnly(paths, userId);
  if (!own.length || !capabilities().storage) return [];
  const sb = supabaseService();
  if (!sb) return [];
  const out: string[] = [];
  for (const path of own.slice(0, 4)) {
    try {
      const { data } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(path, 600);
      if (data?.signedUrl) out.push(data.signedUrl);
    } catch {
      /* a photo we can't read is not a reason to fail the plan */
    }
  }
  return out;
}
