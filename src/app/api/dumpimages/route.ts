import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const b = (await req.json()) as { panels: string[]; sheets: { name: string; sheet: string }[]; baby: string };
  const dir = path.join(process.cwd(), "public", "__dump");
  await mkdir(dir, { recursive: true });
  const save = async (name: string, dataUrl: string) => {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl || "");
    if (!m) return null;
    const f = `${name}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    await writeFile(path.join(dir, f), Buffer.from(m[2], "base64"));
    return f;
  };
  const out: string[] = [];
  for (let i = 0; i < b.panels.length; i++) { const f = await save(`cut-${i + 1}`, b.panels[i]); if (f) out.push(f); }
  for (const s of b.sheets) { const f = await save(`cast-${s.name.toLowerCase()}`, s.sheet); if (f) out.push(f); }
  const f = await save("cast-baby", b.baby); if (f) out.push(f);
  return NextResponse.json({ saved: out });
}
