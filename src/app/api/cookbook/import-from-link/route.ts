import { NextResponse } from "next/server";
import { aiEndpoint } from "@/lib/ai/provider";
import {
  MAX_IMAGES,
  MAX_IMAGES_CHARS,
  MAX_IMAGE_CHARS,
  type Reading,
  readingBrief,
} from "@/lib/cook-connect/compose";
import {
  RECIPE_JSON_SCHEMA,
  normalizeRecipe,
  recipeFromCaption,
  recipeFromStructured,
} from "@/lib/cookbook/recipe";
import { dedupeByTitle, recipeEntries } from "@/lib/cook-connect/found";
import { findByType } from "@/lib/social-import/jsonld";
import { PLATFORM_LABEL, parseLink } from "@/lib/social-import/platform";
import { NotALinkError, emptyPost, resolveSocialPost, type SocialPost } from "@/lib/social-import/resolve";
import { BlockedUrlError, fetchImageDataUrl } from "@/lib/social-import/safeFetch";
import { understandPost } from "@/lib/social-import/understand";
import { VideoUnavailableError, downloadVideo } from "@/lib/social-import/videoDownload";

export const runtime = "nodejs";
export const maxDuration = 300;

/** ~20 MB of video once base64'd. */
const MAX_DATA_URL_CHARS = 28_000_000;
/** What the video model accepts; base64 inflates it by a third on the way out. */
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

const SYSTEM =
  "You turn cooking videos, food photos and food posts into accurate, cookable recipes. You " +
  "watch the video — visuals, speech and on-screen text — look closely at every photo, and " +
  "read the caption and any linked recipe. Respond ONLY with minified JSON, no prose.";

// POST /api/cookbook/import-from-link
// Body: { link?, caption?, videoDataUrl?, videoUrl?, images?, note?, readings? }
//   — at least one of them. They COMBINE: a link and photos and a note are one
//     request about one dish, not three competing ones.
//   images:   data:image/… URLs. A photo of the finished dish, or a picture of
//             writing (a recipe card, a cookbook page, a screenshot).
//   readings: how to read each image, positional and parallel to `images`
//             ("dish" | "written" | "auto"). Built by lib/cook-connect/compose.
//   note:     the cook's own words. Always honoured, and it outranks the rest
//             wherever they disagree — it is the only part a person typed.
// Returns { recipes, recipe, source, coverDataUrl, evidence, confidence, assumptions, trail }
// or { error, needsHelp?, trail? } when nothing usable could be read.
//   recipes: every separate dish the source shows — a "3 easy dinners" video is
//            three — each { recipe, confidence, assumptions }. `recipe`,
//            `confidence` and `assumptions` repeat the first, for older callers.
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
  const note = str(body.note).slice(0, 4000);

  if (videoDataUrl && (!videoDataUrl.startsWith("data:video/") || videoDataUrl.length > MAX_DATA_URL_CHARS)) {
    return fail(400, "That upload isn't a video under 20 MB.");
  }

  const images = Array.isArray(body.images)
    ? body.images.filter((v): v is string => typeof v === "string" && v.startsWith("data:image/")).slice(0, MAX_IMAGES)
    : [];
  if (images.length !== (Array.isArray(body.images) ? Math.min(body.images.length, MAX_IMAGES) : 0)) {
    return fail(400, "One of those photos didn't arrive as an image.");
  }
  if (images.some((i) => i.length > MAX_IMAGE_CHARS) || images.join("").length > MAX_IMAGES_CHARS) {
    return fail(400, "Those photos are too large. Attach fewer, or smaller ones.");
  }
  const readings: Reading[] = images.map((_, i) => {
    const r = Array.isArray(body.readings) ? body.readings[i] : undefined;
    return r === "dish" || r === "written" ? r : "auto";
  });

  if (!link && !caption && !videoDataUrl && !videoUrl && !images.length && !note) {
    return fail(400, "Paste a link, attach a photo, or say what you want to cook.");
  }

  // Photos are the one input with no text behind them: without a provider
  // there is nothing to look at them with, and a heuristic would invent a
  // recipe out of a filename. Say so instead, and name the way out.
  if (images.length && !aiEndpoint()) {
    return fail(
      422,
      "Reading a photo needs an AI key (OPENROUTER_API_KEY). Describe the dish in words instead and a draft gets written without one.",
      { needsHelp: true, needsKey: true },
    );
  }

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
  if (images.length) {
    post.trail.push(`Looked at ${images.length === 1 ? "the photo" : `all ${images.length} photos`} you attached.`);
  }
  // The note stays OUT of the caption: a caption is evidence about the dish,
  // while the note is an instruction about the recipe ("make it for six", "no
  // dairy"). Blurring them makes the model treat "no dairy" as an ingredient
  // the post mentioned.
  if (note) post.trail.push("Followed your note.");
  if (videoUrl) {
    post.video = { kind: "file", url: videoUrl };
    post.durationSec = null;
  }
  if (videoUrl || videoDataUrl) post.trail.push("Used the video you uploaded.");

  const structured =
    findByType(post.jsonLd, "Recipe") ??
    post.linked.map((l) => findByType(l.jsonLd, "Recipe")).find(Boolean) ??
    null;

  // Facebook, Instagram, X and Pinterest hand an anonymous page fetch no video
  // at all, and Facebook routinely hands it nothing whatsoever — which is why a
  // pasted Facebook link used to come back empty. So when the page alone didn't
  // produce the video, ask the real downloader, which knows how to ask each site
  // properly (yt-dlp → cobalt → the page's own video tag). Its bytes then reach
  // the model by the same door as a video the user uploaded.
  //
  // Only when it would otherwise be guessing: a creator's own schema.org recipe
  // is authoritative, so a blog that published one is already answered and pays
  // nothing for this.
  let upload = videoDataUrl;
  let videoProblem: { message: string; needsLogin: boolean } | null = null;
  const parsed = link ? parseLink(link) : null;
  const worthDownloading = Boolean(parsed) && !upload && !post.video && !structured
    && (parsed!.platform !== "web" || post.pageText.length < 400);
  if (worthDownloading) {
    try {
      const got = await downloadVideo(parsed!.url, parsed!.platform, { maxBytes: MAX_VIDEO_BYTES });
      upload = `data:${got.contentType};base64,${got.bytes.toString("base64")}`;
      post.trail.push(...got.trail);
      post.title ||= got.title;
      post.author ||= got.author;
      post.thumbnailUrl ??= got.thumbnailUrl;
      post.durationSec ??= got.durationSec;
      if (got.caption && !post.caption) {
        post.caption = got.caption;
        post.trail.push("Read the caption off the download.");
      }
    } catch (err) {
      if (err instanceof VideoUnavailableError) {
        post.trail.push(...err.trail);
        videoProblem = { message: err.message, needsLogin: err.needsLogin };
      } else {
        console.error("[import-from-link] video download failed:", err);
        post.trail.push("Couldn't download the video from that link.");
      }
    }
  }

  const label = post.platform === "upload" ? "your upload" : PLATFORM_LABEL[post.platform];
  // Photos and a note are evidence of their own, so a link that gave nothing
  // back is no longer the end of the request — it is one source among several
  // that came up empty.
  if (!images.length && !note && !post.caption && !post.pageText && !post.video && !upload && !structured) {
    return fail(
      422,
      videoProblem
        ? videoProblem.message
        : `${label} didn't let us see that post — it's probably private or needs a login. Paste the caption or upload the video instead.`,
      {
        needsHelp: true,
        trail: post.trail,
        // Lets the page offer "Connect Facebook" right there, then try again.
        ...(videoProblem?.needsLogin && parsed ? { needsLogin: true, site: parsed.platform } : {}),
      }
    );
  }

  const cover = await fetchImageDataUrl(post.thumbnailUrl ?? imageOf(structured));
  const source = { url: post.url, platform: post.platform, platformLabel: label, author: post.author };

  if (aiEndpoint()) {
    try {
      const u = await understandPost({
        post,
        system: SYSTEM,
        task: buildTask(structured, readingBrief(readings), note),
        uploadDataUrl: upload || undefined,
        imageDataUrl: cover,
        images,
      });
      if (u.data?.is_recipe === false && !recipeEntries(u.data).some((r) => Array.isArray(r?.ingredients) && r.ingredients.length)) {
        return fail(
          422,
          images.length
            ? "Nothing in that photo looks like food or a recipe. Try another photo, or describe the dish in words."
            : "That post doesn't seem to show a recipe. Try a different link.",
          { trail: post.trail },
        );
      }
      const found = dedupeByTitle(
        recipeEntries(u.data)
          .map((raw) => ({
            recipe: normalizeRecipe(raw),
            confidence: pickConfidence(raw?.confidence ?? u.data?.confidence),
            assumptions: Array.isArray(raw?.assumptions) ? raw.assumptions.map(String).slice(0, 12) : [],
          }))
          .filter((f) => f.recipe.ingredients.length && f.recipe.instructions.length),
        (f) => f.recipe.title,
      );
      if (found.length) {
        if ((post.video || upload) && !u.watchedVideo) {
          post.trail.push("Couldn't watch the video, so this was built from the caption.");
        }
        if (found.length > 1) post.trail.push(`Found ${found.length} separate recipes in it.`);
        const first = found[0];
        return NextResponse.json({
          recipes: found,
          recipe: first.recipe,
          source,
          coverDataUrl: cover,
          evidence: {
            watchedVideo: u.watchedVideo,
            readCaption: Boolean(post.caption),
            creatorPage: Boolean(structured),
            sawCover: u.sawImage,
            sawPhotos: images.length,
            usedNote: Boolean(note),
          },
          confidence: first.confidence,
          assumptions: first.assumptions,
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
    // The note is last, not first: it is an instruction, and only worth
    // reading as evidence when nothing else said anything at all.
    : recipeFromCaption(post.caption || post.pageText || note, post.title);
  if (!structured && fallback.ingredients.length < 2) {
    return fail(
      422,
      aiEndpoint()
        ? "Couldn't find a recipe in that post. Paste the caption or upload the video and try again."
        : "The caption doesn't list the ingredients, and watching the video needs an AI key (OPENROUTER_API_KEY).",
      { needsHelp: true, trail: post.trail }
    );
  }
  const fallbackConfidence = structured ? "high" : "low";
  const fallbackAssumptions = structured ? [] : ["Built from the caption text only — amounts and steps may be incomplete."];
  return NextResponse.json({
    recipes: [{ recipe: fallback, confidence: fallbackConfidence, assumptions: fallbackAssumptions }],
    recipe: fallback,
    source,
    coverDataUrl: cover,
    evidence: {
      watchedVideo: false,
      readCaption: Boolean(post.caption),
      creatorPage: Boolean(structured),
      sawCover: false,
      sawPhotos: 0,
      usedNote: Boolean(note),
    },
    confidence: fallbackConfidence,
    assumptions: fallbackAssumptions,
    trail: post.trail,
  });
}

function buildTask(structured: any, photos: string, note: string): string {
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
  // The cook's own words come LAST and are labelled as overriding, because
  // everything above them is something a stranger made: a post's caption, a
  // creator's schema, a model's reading of a photo. The one person whose
  // instruction must survive all of it is the one who typed.
  const asked = note
    ? `\n\nWHAT THE COOK ASKED FOR (their own words — this OVERRIDES the sources above wherever they disagree; `
      + `if they ask for a change, apply it to the amounts and the steps, don't just mention it):\n${note}\n`
    : "";

  return `${creator}${photos ? `${photos}\n\n` : ""}Write down every recipe these sources show.
- HOW MANY RECIPES: usually one. Return SEVERAL only when the sources really show separate dishes, each made on its own — "3 dinners under $10", "what I eat in a day", a full spread where the main, the side and the dessert are each cooked start to finish, a cookbook page with two recipes on it. One recipe per dish, in the order they appear.
- A component of one dish is NOT its own recipe: a burger with its sauce, tacos with their salsa, a cake with its frosting stay ONE recipe with all their parts — unless the video presents that part as a separate recipe of its own (its own name, its own ingredient list).
- The same dish shown twice (a recap, a "full recipe" at the end) is still one recipe.
- For each recipe, combine the sources: the video or photos show what it looks like and how it's made, the caption and written recipe give the amounts, and a photo of writing gives both. Never mix one dish's ingredients into another's.
- title: the dish's real name (e.g. "Baked Feta Pasta"), never the caption's hook or joke. Max 60 characters.
- description: one appetizing sentence in your own words.
- ingredients: every ingredient seen, said, or written — including oil, seasoning and garnish. Use amounts stated in speech, on-screen text, the caption, a photo of writing, or the creator's written recipe. If an amount is never stated, estimate a sensible one and say so in "assumptions".
- instructions: complete and in order, with temperatures (°F), times, pan sizes and doneness cues. Fill small gaps a home cook would need.
- times, servings and calories: stated values when given, otherwise realistic estimates.
- Set "is_recipe": false ONLY if none of the sources has anything to do with food. A photo of a finished dish with no text is still a recipe worth writing.${asked}

Return JSON matching:
{
  "is_recipe": boolean,
  "recipes": [ one object per separate dish (at most 8), each:
${RECIPE_JSON_SCHEMA.replace(/\n}$/, `,
  "confidence": "high" | "medium" | "low" (how completely the post showed THIS recipe),
  "assumptions": string[] (each amount or step you had to guess for THIS recipe)
}`)}
  ]
}`;
}

function pickConfidence(v: unknown): "high" | "medium" | "low" | null {
  return v === "high" || v === "medium" || v === "low" ? v : null;
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
