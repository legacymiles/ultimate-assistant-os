import { heuristicAnalysis, normalizeAnalysis } from "@/lib/social-personas/logic";
import { aiReady } from "@/lib/social-personas/server/ai";
import { body, fail } from "@/lib/social-personas/server/http";
import { NotALinkError, emptyPost, resolveSocialPost, type SocialPost } from "@/lib/social-import/resolve";
import { BlockedUrlError, fetchImageDataUrl } from "@/lib/social-import/safeFetch";
import { understandPost } from "@/lib/social-import/understand";

export const runtime = "nodejs";
export const maxDuration = 300;

const SYSTEM =
  "You study a creator's own social media posts so an assistant can help them make more of what works. " +
  "Watch the video (visuals, speech, music, on-screen text) and read the caption. Respond ONLY with minified JSON.";

const TASK = (niche: string) => `This post belongs to a creator whose niche is: ${niche || "unknown"}.
Describe it:
- title: what the video actually is, in a few words (not the caption's hashtags)
- format: e.g. "music video", "talking-head explainer", "month-by-month montage", "skit", "slideshow", "tutorial"
- topic: the subject in 2-5 words
- hook: the opening line or visual that grabs attention in the first 2 seconds, as seen/heard
- summary: 1-2 sentences on what happens and what makes it work (or not)
JSON: {"title":"","format":"","topic":"","hook":"","summary":""}`;

// POST { link?, caption?, niche? } → { analysis, post: {url, platform, caption, thumbnail, author}, watched, trail }
export async function POST(req: Request) {
  const b = await body(req);
  const link = typeof b?.link === "string" ? b.link.trim() : "";
  const caption = typeof b?.caption === "string" ? b.caption.trim() : "";
  const niche = typeof b?.niche === "string" ? b.niche.slice(0, 200) : "";
  if (!link && !caption) return fail(400, "Paste a post link or its caption.");

  let post: SocialPost;
  try {
    post = link ? await resolveSocialPost(link, { followLinks: 0 }) : emptyPost();
  } catch (err) {
    if (err instanceof NotALinkError || err instanceof BlockedUrlError) return fail(400, err.message);
    post = emptyPost(link, "web");
    post.trail.push("Couldn't open that link.");
  }
  if (caption) post.caption = post.caption ? `${post.caption}\n\n${caption}` : caption;

  const out = { url: post.url || link, platform: post.platform, caption: post.caption, thumbnail: post.thumbnailUrl, author: post.author };
  if (!post.caption && !post.video && !post.pageText) {
    return fail(422, "That platform hid the post (private or login-walled). Paste its caption instead.", { needsHelp: true, trail: post.trail });
  }

  if (aiReady()) {
    try {
      const u = await understandPost({ post, system: SYSTEM, task: TASK(niche), imageDataUrl: await fetchImageDataUrl(post.thumbnailUrl) });
      return Response.json({ analysis: normalizeAnalysis(u.data), post: out, watched: u.watchedVideo, trail: post.trail });
    } catch (err) {
      console.error("[social-personas/analyze] AI failed, using caption:", err);
      post.trail.push("The AI step failed, so this was read from the caption only.");
    }
  }
  return Response.json({ analysis: heuristicAnalysis(post.caption || post.title), post: out, watched: false, trail: post.trail });
}
