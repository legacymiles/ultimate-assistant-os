// ---------------------------------------------------------------------------
// Free recipe image generation via Pollinations.ai.
//
// Pollinations serves AI-generated images straight from a URL with NO API key
// and NO cost — perfect for the demo and for a hobby portfolio. The <img> tag
// simply loads the URL and the image is generated on demand. The result URL is
// a normal https URL, so it can be stored directly as a recipe's image_url in
// both local-demo and Supabase modes (no upload step needed).
// ---------------------------------------------------------------------------

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 1_000_000;
}

/** Build a free Pollinations image URL for a recipe. */
export function recipeImageUrl(
  title: string,
  description = "",
  plating = "",
  lighting = "",
  seed?: number,
): string {
  const styleBits = [plating, lighting].filter(Boolean).join(", ");
  const prompt =
    `professional food photography of ${title}. ${description} ${styleBits}. ` +
    `appetizing, beautifully plated, shallow depth of field, soft natural light, ` +
    `high detail, magazine quality, no text`;
  const s = seed ?? hash(title);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=768&height=576&nologo=true&seed=${s}`;
}
