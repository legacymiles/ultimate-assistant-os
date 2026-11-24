import { aiEnhance, aiExtract, aiReverse, aiTranslate } from "@/lib/image-studio/inspire/server/ai";
import { errorResponse, HttpError, readJson, str } from "@/lib/image-studio/inspire/server/access";
import { spendGate } from "@/lib/image-studio/inspire/server/quota";
import * as v from "@/lib/image-studio/inspire/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_REVERSE_IMAGES = 4;

// POST /api/image-studio/inspire/ai
//   { action: "extract",   prompt }                         → { chips }
//   { action: "reverse",   images: [dataUrl], instructions?, previous? } → { prompt, chips, analysis }
//   { action: "enhance",   prompt, deliverable? }           → { prompt, chips, added }
//   { action: "translate", idea }                           → { chips }
// Each answers with `offline: true` when no AI key is set rather than failing.
export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const action = body.action;

    if (action === "extract") {
      const prompt = v.prompt(body.prompt);
      if (!prompt) throw new HttpError(400, "There's no prompt to break down.");
      const gate = await spendGate("extract");
      const out = await aiExtract(prompt);
      if (!out.offline) await gate.charge();
      return Response.json(out);
    }

    if (action === "reverse") {
      const images = (Array.isArray(body.images) ? body.images : []).filter(
        (x): x is string => typeof x === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(x),
      );
      if (!images.length) throw new HttpError(400, "Add an image to analyse.");
      if (images.length > MAX_REVERSE_IMAGES) throw new HttpError(400, `Use up to ${MAX_REVERSE_IMAGES} reference images at once.`);
      const gate = await spendGate("reverse");
      const out = await aiReverse(images, str(body.instructions, 800), v.prompt(body.previous));
      if (!out.offline) await gate.charge();
      return Response.json(out);
    }

    if (action === "enhance") {
      const prompt = v.prompt(body.prompt);
      if (!prompt) throw new HttpError(400, "There's no prompt to improve.");
      const gate = await spendGate("enhance");
      const out = await aiEnhance(prompt, str(body.deliverable, 20));
      if (!out.offline) await gate.charge();
      return Response.json(out);
    }

    if (action === "translate") {
      const idea = str(body.idea, 1200);
      if (!idea) throw new HttpError(400, "Describe your idea first.");
      const gate = await spendGate("translate");
      const out = await aiTranslate(idea);
      if (!out.offline) await gate.charge();
      return Response.json(out);
    }

    throw new HttpError(400, "Unknown action.");
  } catch (err) {
    return errorResponse(err);
  }
}
