import { NextResponse } from "next/server";

// Signalling proxy for a Realtime Lucy server that is not on localhost.
//
// The browser normally talks to the GPU server directly (Chrome treats
// http://localhost as a secure origin, so an https page may call it). When
// the server runs on another machine over plain http, the page cannot reach
// it from https — so the two small signalling calls (/health, /offer) go
// through here to LUCY_SERVER_URL instead. Media never touches this route:
// once the answer is back, WebRTC connects the browser to the GPU box
// directly.

export const runtime = "nodejs";

const ALLOWED = new Set(["health", "offer"]);

async function forward(req: Request, path: string[]) {
  const target = (process.env.LUCY_SERVER_URL ?? "").replace(/\/+$/, "");
  if (!target) {
    return NextResponse.json(
      { error: "LUCY_SERVER_URL is not set on this site. Enter the server's address directly instead." },
      { status: 503 },
    );
  }
  const leaf = path.join("/");
  if (!ALLOWED.has(leaf)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = req.headers.get("authorization") ?? (process.env.LUCY_TOKEN ? `Bearer ${process.env.LUCY_TOKEN}` : "");
  if (auth) headers.authorization = auth;
  try {
    const upstream = await fetch(`${target}/${leaf}`, {
      method: req.method,
      headers,
      body: req.method === "POST" ? await req.text() : undefined,
      cache: "no-store",
    });
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ error: `Lucy server unreachable: ${(err as Error).message}` }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(req, (await ctx.params).path);
}
