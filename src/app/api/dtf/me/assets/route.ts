import { errorResponse, HttpError, requireUser } from "@/lib/dtf/server/access";
import { confirmCustomerUpload, ingestBytes, MAX_UPLOAD_BYTES, signCustomerUpload } from "@/lib/dtf/server/ingest";
import { listAssets } from "@/lib/dtf/server/store";
import type { AssetKind, StoredAsset } from "@/lib/dtf/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** What a customer may upload. Production files come only from the owner's export. */
const CUSTOMER_KINDS: AssetKind[] = ["original", "reference", "ai", "processed", "mockup"];

const pub = ({ key: _k, userId: _u, ...a }: StoredAsset) => a;

/** The customer's uploads (metadata only). */
export async function GET() {
  try {
    const user = await requireUser();
    const assets = await listAssets(user.id);
    return Response.json({ assets: assets.filter((a) => a.kind !== "production").map(pub) });
  } catch (e) {
    return errorResponse(e);
  }
}

function kindOf(v: unknown): AssetKind {
  const k = String(v ?? "original") as AssetKind;
  if (!CUSTOMER_KINDS.includes(k)) throw new HttpError(400, "Unknown upload type.");
  return k;
}

/**
 * Three ways in, one judge (lib/dtf/server/ingest.ts):
 *   multipart `file`                       → small files, straight through this route
 *   JSON {phase:"sign", kind, mime, size}  → a signed URL to PUT a large file to storage
 *   JSON {phase:"confirm", staging, …}     → inspect what arrived and register it
 * The type is decided by the bytes, never the name. SVGs are sanitised.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) throw new HttpError(400, "Bad request.");
      const kind = kindOf(body.kind);
      if (body.phase === "sign") {
        if (Number(body.size) > MAX_UPLOAD_BYTES) throw new HttpError(413, "That file is over 25 MB. Export a smaller PNG.");
        const signed = await signCustomerUpload(user.id, kind, String(body.mime ?? ""));
        return Response.json(signed ? { mode: "signed", ...signed } : { mode: "direct" });
      }
      if (body.phase === "confirm") {
        const asset = await confirmCustomerUpload(user.id, String(body.staging ?? ""), String(body.assetId ?? ""), kind, String(body.name ?? "upload"), typeof body.sourceAssetId === "string" ? body.sourceAssetId : undefined);
        return Response.json({ asset: pub(asset) });
      }
      throw new HttpError(400, "Bad request.");
    }
    const form = await req.formData().catch(() => null);
    if (!form) throw new HttpError(400, "No file was sent.");
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new HttpError(400, "No file was sent.");
    const kind = kindOf(form.get("kind"));
    const source = form.get("sourceAssetId");
    const name = file instanceof File ? file.name : `${kind}.png`;
    const asset = await ingestBytes(user.id, new Uint8Array(await file.arrayBuffer()), kind, name, { sourceAssetId: typeof source === "string" ? source : undefined });
    return Response.json({ asset: pub(asset) });
  } catch (e) {
    return errorResponse(e);
  }
}
