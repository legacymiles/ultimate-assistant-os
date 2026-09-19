import { NextResponse } from "next/server";
import { listModels } from "@/lib/ai/models";

// GET /api/ai/models: the LLMs the hub's model picker offers (OpenRouter's
// catalogue, text-answering models only, newest first). Cached an hour.

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ models: await listModels() });
}
