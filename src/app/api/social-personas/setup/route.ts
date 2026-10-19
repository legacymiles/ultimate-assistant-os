import { config, keys } from "@/lib/social-personas/server/connectors";
import { body, fail, publicOrigin } from "@/lib/social-personas/server/http";
import { checkKey, clearKey, saveKey } from "@/lib/social-personas/server/platformKeys";
import { CONNECTABLE, isConnectable } from "@/lib/social-personas/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Connect setup — the one-time developer-app keys per platform, saved here
// instead of in the hosting dashboard (no redeploy). Owner-only: every /api
// path not listed as public in hubAccess.ts is behind the owner gate.

// GET → per platform: ready?, where the keys come from, the last 4 of the id,
// and the exact URLs the developer portal asks for.
export async function GET(req: Request) {
  const origin = publicOrigin(req);
  const platforms = await Promise.all(
    CONNECTABLE.map(async (p) => {
      const k = await keys(p);
      const c = config(p);
      return {
        platform: p,
        ready: k.source !== null,
        source: k.source,
        idHint: k.id ? `…${k.id.slice(-4)}` : null,
        setupUrl: c.setupUrl,
        redirectUri: `${origin}/api/social-personas/oauth/${p}/callback`,
        scopes: `${c.scopes},${c.postScopes}`,
      };
    }),
  );
  return Response.json(
    {
      platforms,
      urls: {
        site: origin,
        privacy: `${origin}/legal/privacy`,
        terms: `${origin}/legal/terms`,
        dataDeletion: `${origin}/legal/data-deletion`,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// POST { platform, id, secret } — save (or replace) that platform's keys.
export async function POST(req: Request) {
  const b = await body(req);
  const p = typeof b?.platform === "string" ? b.platform : "";
  if (!isConnectable(p)) return fail(400, "Pick TikTok, Instagram or Facebook.");
  const id = typeof b?.id === "string" ? b.id.trim() : "";
  const secret = typeof b?.secret === "string" ? b.secret.trim() : "";
  const bad = checkKey(p, id, secret);
  if (bad) return fail(400, bad);
  if ((await keys(p)).source === "env") return fail(409, "This platform's keys are set in the site's environment, which wins over keys saved here. Remove them there first if you want to change them here.");
  if (!(await saveKey(p, id, secret))) return fail(503, "Couldn't save the keys — the live site needs SUPABASE_SERVICE_ROLE_KEY to keep them.");
  return Response.json({ ok: true });
}

// DELETE ?platform=… — forget saved keys (Connect stops working until new ones are saved).
export async function DELETE(req: Request) {
  const p = new URL(req.url).searchParams.get("platform") ?? "";
  if (!isConnectable(p)) return fail(400, "Pick TikTok, Instagram or Facebook.");
  await clearKey(p);
  return Response.json({ ok: true });
}
