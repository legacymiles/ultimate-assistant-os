// The films already on this machine, and the bytes of any one of them.
//
// Renders live in the studio bridge's output folder, so the lab reads them from
// there rather than asking anyone to copy files around. On a deploy that folder
// does not exist, and the route says so plainly instead of failing — the lab is
// still useful as a ledger with no local footage attached.
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILMS = join(process.cwd(), "tools", "studio-bridge", "out", "films");

/**
 * `film/clip.mp4` under FILMS, and nothing else. The path comes off the wire, so
 * it is normalised and then checked to still start at FILMS — a `..` segment
 * would otherwise read any file on the machine.
 */
function resolveInside(rel: string): string | null {
  if (!rel || !/\.(mp4|webm|mov)$/i.test(rel)) return null;
  const full = normalize(join(FILMS, rel));
  return full.startsWith(FILMS + sep) ? full : null;
}

export async function GET(req: NextRequest) {
  const rel = req.nextUrl.searchParams.get("file");

  // ---- one film's bytes, with range support so scrubbing works -------------
  if (rel) {
    const full = resolveInside(rel);
    if (!full) return NextResponse.json({ error: "bad path" }, { status: 400 });
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    // Without 206 the browser downloads the whole file before it will seek, and
    // the point of this app is scrubbing.
    const range = req.headers.get("range");
    const m = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream;
      return new NextResponse(stream, {
        status: 206,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }
    const stream = Readable.toWeb(createReadStream(full)) as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  // ---- the catalogue of what is on disk ------------------------------------
  let dirs: string[];
  try {
    dirs = await readdir(FILMS);
  } catch {
    return NextResponse.json({ films: [], local: false });
  }
  const films = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await readdir(join(FILMS, dir));
    } catch {
      continue;
    }
    const clips = files.filter((f) => /^shot-\d+\.mp4$/.test(f));
    // film-cut.mp4 is the finished edit; without one the film never completed,
    // which is worth seeing rather than hiding.
    const cut = files.includes("film-cut.mp4") ? `${dir}/film-cut.mp4` : null;
    let mtime = 0;
    try {
      mtime = (await stat(join(FILMS, dir))).mtimeMs;
    } catch { /* keep 0 */ }
    films.push({
      id: dir,
      cut,
      shots: clips.length,
      clips: clips
        .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))
        .map((f) => `${dir}/${f}`),
      modified: new Date(mtime).toISOString(),
      complete: Boolean(cut),
    });
  }
  films.sort((a, b) => b.modified.localeCompare(a.modified));
  return NextResponse.json({ films, local: true });
}
