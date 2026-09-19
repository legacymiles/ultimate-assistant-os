import { NextResponse } from "next/server";
import { saveSettings, type BuilderRoute, type ProviderChoice } from "@/lib/ai/settings";

// PUT /api/ai/settings { choice?, fallback?, builder?, builderFallback? }
// The hub's AI switch. Unknown values are ignored rather than rejected.

export const runtime = "nodejs";

const CHOICES: ProviderChoice[] = ["auto", "openrouter", "vercel-gateway"];
const BUILDERS: BuilderRoute[] = ["plan", "openrouter"];

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Parameters<typeof saveSettings>[0] = {};
  if (CHOICES.includes(body.choice as ProviderChoice)) patch.choice = body.choice as ProviderChoice;
  if (typeof body.fallback === "boolean") patch.fallback = body.fallback;
  if (BUILDERS.includes(body.builder as BuilderRoute)) patch.builder = body.builder as BuilderRoute;
  if (typeof body.builderFallback === "boolean") patch.builderFallback = body.builderFallback;
  const saved = await saveSettings(patch);
  if (!saved) return NextResponse.json({ error: "Could not save the AI settings (storage unavailable)." }, { status: 503 });
  const { choice, fallback, builder, builderFallback } = saved;
  return NextResponse.json({ settings: { choice, fallback, builder, builderFallback } });
}
