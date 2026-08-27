import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/cookbook/generate-recipe-image
// Body: { title, description, plating_style, lighting_style }
// Returns: { image_data: "data:image/...;base64,..." } or { error }
//
// When AI_GATEWAY_API_KEY is set and an image model is configured, this calls
// the Vercel AI Gateway image API. Otherwise it returns a deterministic SVG
// placeholder so the editor stays fully usable offline.
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = String(body.title ?? "Dish");
  const description = String(body.description ?? "");
  const plating = String(body.plating_style ?? "modern minimalist");
  const lighting = String(body.lighting_style ?? "bright natural daylight");

  const apiKey = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  const imageModel = process.env.AI_IMAGE_MODEL; // e.g. "openai/gpt-image-1"

  if (apiKey && imageModel) {
    try {
      const prompt =
        `Professional food photography of ${title}. ${description}. ` +
        `Plating style: ${plating}. Lighting: ${lighting}. ` +
        `Appetizing, high detail, shallow depth of field, magazine quality.`;
      const res = await fetch("https://ai-gateway.vercel.sh/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: imageModel, prompt, size: "1024x1024", response_format: "b64_json" }),
        signal: AbortSignal.timeout(50_000),
      });
      if (res.ok) {
        const json = await res.json();
        const b64 = json?.data?.[0]?.b64_json;
        if (b64) return NextResponse.json({ image_data: `data:image/png;base64,${b64}` });
      }
    } catch (err) {
      console.error("Image generation failed, using placeholder:", err);
    }
  }

  // Deterministic SVG placeholder — a warm gradient "plate" with the dish name.
  const svg = placeholderSvg(title, plating, lighting);
  const b64 = Buffer.from(svg).toString("base64");
  return NextResponse.json({ image_data: `data:image/svg+xml;base64,${b64}` });
}

function placeholderSvg(title: string, plating: string, lighting: string): string {
  // Hue derived from the title so each dish gets a distinct but stable color.
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = (hash * 31 + title.charCodeAt(i)) % 360;
  const h1 = hash;
  const h2 = (hash + 40) % 360;
  const safe = title.length > 28 ? title.slice(0, 27) + "…" : title;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="70%">
      <stop offset="0%" stop-color="hsl(${h1}, 55%, 30%)"/>
      <stop offset="100%" stop-color="hsl(${h2}, 45%, 12%)"/>
    </radialGradient>
    <radialGradient id="plate" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="hsl(${h1}, 40%, 78%)"/>
      <stop offset="70%" stop-color="hsl(${h1}, 35%, 62%)"/>
      <stop offset="100%" stop-color="hsl(${h1}, 30%, 48%)"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <circle cx="512" cy="470" r="300" fill="#000" opacity="0.25"/>
  <circle cx="512" cy="450" r="300" fill="url(#plate)"/>
  <circle cx="512" cy="450" r="210" fill="hsl(${h2}, 45%, 40%)" opacity="0.85"/>
  <circle cx="470" cy="410" r="60" fill="hsl(${h1}, 60%, 65%)" opacity="0.9"/>
  <circle cx="560" cy="470" r="48" fill="hsl(${h2}, 60%, 60%)" opacity="0.9"/>
  <circle cx="510" cy="510" r="40" fill="hsl(${h1}, 55%, 72%)" opacity="0.9"/>
  <text x="512" y="850" font-family="Georgia, serif" font-size="52" font-weight="bold" fill="#fff" text-anchor="middle">${escapeXml(safe)}</text>
  <text x="512" y="905" font-family="system-ui, sans-serif" font-size="26" fill="#fff" opacity="0.65" text-anchor="middle">${escapeXml(plating)} · ${escapeXml(lighting)}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] || c));
}
