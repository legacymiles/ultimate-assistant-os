import { NextResponse } from "next/server";
import { podServerUrl, podState, startPod } from "@/lib/music-creator/pod";

// ---------------------------------------------------------------------------
// Proxy to the Music Creator GPU server (tools/music-creator).
//
// YuE2 wants 24 GB of VRAM and AuK about 25 GB, so the models never run on the
// machine serving this site — they run on a box you point MUSIC_SERVER_URL at,
// which is usually rented by the hour and usually speaks plain http. Both facts
// argue for proxying rather than calling it from the browser: the address and
// token stay server-side, and an https page can reach an http GPU box without a
// mixed-content error.
//
// The allow-list is the whole security model of this route. Without it, setting
// MUSIC_SERVER_URL would turn this site into an open relay to any path on that
// host, so a new server endpoint must be added here deliberately before the
// browser can reach it.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const maxDuration = 300;

/** Exact paths, plus prefixes for the id-bearing ones. */
const EXACT = new Set(["health", "voices", "mix", "jobs/song", "jobs/transcribe", "jobs/speak", "jobs/separate"]);
const PREFIXES = ["jobs/", "files/", "voices/"];

function allowed(leaf: string): boolean {
  if (EXACT.has(leaf)) return true;
  // A single id segment only: "files/abc" yes, "files/../secrets" no.
  return PREFIXES.some((p) => leaf.startsWith(p) && /^[A-Za-z0-9_.-]+$/.test(leaf.slice(p.length)));
}

async function target(): Promise<string> {
  // MUSIC_SERVER_URL wins; otherwise the managed RunPod pod's proxy address
  // (looked up by name, since a replaced pod gets a new id).
  return (process.env.MUSIC_SERVER_URL || (await podServerUrl())).replace(/\/+$/, "");
}

async function forward(req: Request, path: string[]) {
  const leaf = path.join("/");

  // The GPU pod itself, answered here rather than forwarded: GET is its state,
  // POST wakes it. This is what lets a Render press start a stopped GPU.
  if (leaf === "gpu") {
    if (req.method === "POST") return NextResponse.json(await startPod());
    return NextResponse.json(await podState());
  }
  if (!allowed(leaf)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const base = await target();

  if (!base) {
    // Not an error to be fixed in code: the studio is designed to be used with
    // no server at all, so this message is written to be read by the user in
    // the tool that asked for it.
    return NextResponse.json(
      {
        error:
          "No music GPU server is configured. Set MUSIC_SERVER_URL to a machine running " +
          "tools/music-creator (a 24 GB NVIDIA GPU), or set MUSIC_POD_ID + RUNPOD_API_KEY for a RunPod pod the " +
          "site can wake on demand. Writing, planning and the Voice Library work without it.",
        code: "no-server",
      },
      { status: 503 },
    );
  }

  const headers: Record<string, string> = {};
  const contentType = req.headers.get("content-type");
  if (contentType) headers["content-type"] = contentType;
  if (process.env.MUSIC_TOKEN) headers.authorization = `Bearer ${process.env.MUSIC_TOKEN}`;

  try {
    const upstream = await fetch(`${base}/${leaf}`, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
      cache: "no-store",
      // 95 seconds, because of where the server usually lives.
      //
      // RunPod exposes a pod's HTTP port through Cloudflare, which closes any
      // connection at 100 seconds with a 524. Waiting longer than that would
      // only ever surface Cloudflare's error page instead of ours, so we give
      // up first and say something useful.
      //
      // Nothing here needs longer: generation is submit-then-poll, and every
      // call through this route returns immediately. A file download is the one
      // case that streams for a while, and the 524 ceiling applies to it too —
      // it is well under, since a song is tens of megabytes.
      signal: AbortSignal.timeout(95_000),
    });

    // Audio comes back as bytes — stream it rather than reading it into memory.
    const type = upstream.headers.get("content-type") ?? "application/json";
    if (!type.includes("json")) {
      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": type,
          "cache-control": "private, max-age=3600",
          ...(upstream.headers.get("content-length") ? { "content-length": upstream.headers.get("content-length") as string } : {}),
        },
      });
    }
    return new NextResponse(await upstream.text(), { status: upstream.status, headers: { "content-type": type } });
  } catch (err) {
    const message =
      (err as Error).name === "TimeoutError"
        ? "the server did not answer within 95 seconds. If it is on RunPod, check the pod is RUNNING and the server process is up."
        : (err as Error).message;
    return NextResponse.json({ error: `Music server unreachable: ${message}`, code: "unreachable" }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function PATCH(req: Request, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
