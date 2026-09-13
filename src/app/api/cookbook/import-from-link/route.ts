import { NextResponse } from "next/server";
import { aiEndpoint } from "@/lib/ai/provider";
import {
  RECIPE_JSON_SCHEMA,
  normalizeRecipe,
  recipeFromCaption,
  recipeFromStructured,
} from "@/lib/cookbook/recipe";
import { findByType } from "@/lib/social-import/jsonld";
import { PLATFORM_LABEL } from "@/lib/social-import/platform";
import { NotALinkError, emptyPost, resolveSocialPost, type SocialPost } from "@/lib/social-import/resolve";
import { BlockedUrlError, fetchImageDataUrl } from "@/lib/social-import/safeFetch";
import { understandPost } from "@/lib/social-import/understand";

export const runtime = "nodejs";
export const maxDuration = 300;

/** ~20 MB of video once base64'd. */
const MAX_DATA_URL_CHARS = 28_000_000;

const SYSTEM =
  "You turn cooking videos and food posts into accurate, cookable recipes. You watch the " +
  "video — visuals, speech and on-screen text — and read the caption and any linked recipe. " +
  "Respond ONLY with minified JSON, no prose.";

// POST /api/cookbook/import-from-link
// Body: { link?, caption?, videoDataUrl?, videoUrl? } — at least one.
// Returns { recipe, source, coverDataUrl, evidence, confidence, assumptions, trail }
// or { error, needsHelp?, trail? } when nothing usable could be read.
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, "Invalid request body");
  }
  const link = str(body.link);
  const caption = str(body.caption);
  const videoUrl = str(body.videoUrl);
  const videoDataUrl = str(body.videoDataUrl);

  if (videoDataUrl && (!videoDataUrl.startsWith("data:video/") || videoDataUrl.length > MAX_DATA_URL_CHARS)) {
    return fail(400, "That upload isn't a video under 20 MB.");
  }
  if (!link && !caption && !videoDataUrl && !videoUrl) return fail(400, "Paste a link to a video or post.");

  let post: SocialPost;
  try {
    post = link ? await resolveSocialPost(link) : emptyPost();
  } catch (err) {
    if (err instanceof NotALinkError || err instanceof BlockedUrlError) return fail(400, err.message);
    console.error("[import-from-link] resolve failed:", err);
    post = emptyPost(link, "web");
    post.trail.push("Couldn't open that link.");
  }

  if (caption) {
    post.caption = post.caption ? `${post.caption}\n\n${caption}` : caption;
    post.trail.push("Used the caption you pasted.");
  }
  if (videoUrl) {
    post.video = { kind: "file", url: videoUrl };
    post.durationSec = null;
  }
  if (videoUrl || videoDataUrl) post.trail.push("Used the video you uploaded.");

  const structured =
    findByType(post.jsonLd, "Recipe") ??
    post.linked.map((l) => findByType(l.jsonLd, "Recipe")).find(Boolean) ??
    null;

  const label = post.platform === "upload" ? "your upload" : PLATFORM_LABEL[post.platform];
  if (!post.caption && !post.pageText && !post.video && !videoDataUrl && !structured) {
    return fail(
      422,
      `${label} didn't let us see that post — it's probably private or needs a login. Paste the caption or upload the video instead.`,
      { needsHelp: true, trail: post.trail }
    );
  }

  const cover = await fetchImageDataUrl(post.thumbnailUrl ?? imageOf(structured));
  const source = { url: post.url, platform: post.platform, platformLabel: label, author: post.author };

  if (aiEndpoint()) {
    try {
      const u = await understandPost({
        post,
        system: SYSTEM,
        task: buildTask(structured),
        uploadDataUrl: videoDataUrl || undefined,
        imageDataUrl: cover,
      });
      if (u.data?.is_recipe === false) {
        return fail(422, "That post doesn't seem to show a recipe. Try a different link.", { trail: post.trail });
      }
      const recipe = normalizeRecipe(u.data);
      if (recipe.ingredients.length && recipe.instructions.length) {
        if ((post.video || videoDataUrl) && !u.watchedVideo) {
          post.trail.push("Couldn't watch the video, so this was built from the caption.");
        }
        return NextResponse.json({
          recipe,
          source,
          coverDataUrl: cover,
          evidence: {
            watchedVideo: u.watchedVideo,
            readCaption: Boolean(post.caption),
            creatorPage: Boolean(structured),
            sawCover: u.sawImage,
          },
          confidence: ["high", "medium", "low"].includes(u.data?.confidence) ? u.data.confidence : null,
          assumptions: Array.isArray(u.data?.assumptions) ? u.data.assumptions.map(String).slice(0, 12) : [],
          trail: post.trail,
        });
      }
      post.trail.push("The AI couldn't find a full recipe, so this was built from the text.");
    } catch (err) {
      console.error("[import-from-link] AI step failed, using text fallback:", err);
      post.trail.push("The AI step failed, so this was built from the text.");
    }
  }

  const fallback = structured
    ? recipeFromStructured(structured)
    : recipeFromCaption(post.caption || post.pageText, post.title);
  if (!structured && fallback.ingredients.length < 2) {
    return fail(
      422,
      aiEndpoint()
        ? "Couldn't find a recipe in that post. Paste the caption or upload the video and try again."
        : "The caption doesn't list the ingredients, and watching the video needs an AI key (OPENROUTER_API_KEY).",
      { needsHelp: true, trail: post.trail }
    );
  }
  return NextResponse.json({
    recipe: fallback,
    source,
    coverDataUrl: cover,
    evidence: { watchedVideo: false, readCaption: Boolean(post.caption), creatorPage: Boolean(structured), sawCover: false },
    confidence: structured ? "high" : "low",
    assumptions: structured ? [] : ["Built from the caption text only — amounts and steps may be incomplete."],
    trail: post.trail,
  });
}

function buildTask(structured: any): string {
  const creator = structured
    ? `THE CREATOR'S OWN WRITTEN RECIPE (schema.org data from their page — its amounts are authoritative):\n${JSON.stringify(
        {
          name: structured.name,
          description: structured.description,
          recipeIngredient: structured.recipeIngredient,
          recipeInstructions: structured.recipeInstructions,
          recipeYield: structured.recipeYield,
          prepTime: structured.prepTime,
          cookTime: structured.cookTime,
          totalTime: structured.totalTime,
          calories: structured.nutrition?.calories,
        }
      ).slice(0, 8000)}\n\n`
    : "";
  return `${creator}Write down the recipe this post shows.
- title: the dish's real name (e.g. "Baked Feta Pasta"), never the caption's hook or joke. Max 60 characters.
- description: one appetizing sentence in your own words.
- ingredients: every ingredient seen, said, or written — including oil, seasoning and garnish. Use amounts stated in speech, on-screen text, the caption, or the creator's written recipe. If an amount is never stated, estimate a sensible one and say so in "assumptions".
- instructions: complete and in order, with temperatures (°F), times, pan sizes and doneness cues. Fill small gaps a home cook would need.
- times, servings and calories: stated values when given, otherwise realistic estimates.
- If the post does not show a dish or recipe, set "is_recipe": false.

Return JSON matching:
${RECIPE_JSON_SCHEMA.replace(/\n}$/, `,
  "is_recipe": boolean,
  "confidence": "high" | "medium" | "low" (how completely the post showed the recipe),
  "assumptions": string[] (each amount or step you had to guess)
}`)}`;
}

function imageOf(recipe: any): string | null {
  const img = recipe?.image;
  const first = Array.isArray(img) ? img[0] : img;
  if (typeof first === "string") return first;
  return typeof first?.url === "string" ? first.url : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}
