import { errorResponse, HttpError, requireOwner } from "@/lib/dtf/server/access";
import { signedDownload, signedUploadFor } from "@/lib/dtf/server/ingest";
import { suggestedFilename } from "@/lib/dtf/server/jobs";
import { sendStatusUpdate } from "@/lib/dtf/server/mail";
import { assetBytesByKey, getOrder, getSettings, putBytesByKey, updateOrder } from "@/lib/dtf/server/store";
import { readPngInfo } from "@/lib/dtf/png";
import { getPrinter } from "@/lib/dtf/printers";
import type { Order, PrintFile } from "@/lib/dtf/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ID = /^[A-Za-z0-9_-]{4,80}$/;

function keyOf(orderId: string, jobId: string) {
  // Production files have their own prefix; they are never mixed with a
  // customer's originals, AI art or mockups.
  return `production/${orderId}/${jobId}.png`;
}

async function findJob(orderId: string, jobId: string) {
  if (!ID.test(orderId) || !ID.test(jobId)) throw new HttpError(400, "Bad order or job id.");
  const order = await getOrder(orderId);
  if (!order) throw new HttpError(404, "That order does not exist.");
  const job = order.jobs.find((j) => j.id === jobId);
  if (!job) throw new HttpError(404, "That print job does not exist.");
  return { order, job };
}

/** Download a print file (signed redirect on cloud storage). */
export async function GET(req: Request) {
  try {
    await requireOwner();
    const url = new URL(req.url);
    const { order, job } = await findJob(url.searchParams.get("order") ?? "", url.searchParams.get("job") ?? "");
    if (!job.file) throw new HttpError(404, "That job has no print file yet.");
    const name = suggestedFilename(order, job);
    const signed = await signedDownload(job.file.key, name, 600);
    if (signed) return Response.redirect(signed, 302);
    const bytes = await assetBytesByKey(job.file.key);
    if (!bytes) throw new HttpError(404, "The print file is missing from storage — generate it again.");
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

interface Meta {
  orderId: string;
  jobId: string;
  dpi: number;
  widthCm: number;
  heightCm: number;
  pressTopCm: number;
  pressCenterOffsetCm: number;
  upsampled: boolean;
  minSourceDpi: number | null;
  /** The operator ticked "I've reviewed the low-resolution warning". */
  acknowledged: boolean;
}

/**
 * Store an approved print file. The browser renders it (same renderer as the
 * studio, at the profile's DPI); the server refuses anything that is not a
 * PNG with the declared physical size and resolution written into it, or that
 * is wider than the printer can take.
 *
 *   JSON {phase:"sign", orderId, jobId}  → { mode:"signed", uploadUrl } | { mode:"direct" }
 *   JSON {phase:"confirm", ...meta}      → register the uploaded file
 *   multipart file + meta (JSON field)   → local: upload and register in one go
 */
export async function POST(req: Request) {
  try {
    const owner = await requireOwner();
    const type = req.headers.get("content-type") ?? "";
    let meta: Meta;
    let bytes: Buffer | null = null;
    if (type.includes("application/json")) {
      const body = (await req.json()) as Meta & { phase: string };
      const { order, job } = await findJob(body.orderId, body.jobId);
      if (body.phase === "sign") {
        const url = await signedUploadFor(keyOf(order.id, job.id));
        return Response.json(url ? { mode: "signed", uploadUrl: url } : { mode: "direct" });
      }
      if (body.phase !== "confirm") throw new HttpError(400, "Bad request.");
      meta = body;
      bytes = await assetBytesByKey(keyOf(order.id, job.id));
      if (!bytes) throw new HttpError(404, "The upload didn't arrive. Try again.");
    } else {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob)) throw new HttpError(400, "No file was sent.");
      meta = JSON.parse(String(form.get("meta") ?? "{}"));
      bytes = Buffer.from(await file.arrayBuffer());
    }

    const { order, job } = await findJob(meta.orderId, meta.jobId);
    if (order.status === "cancelled") throw new HttpError(409, "That order was cancelled.");
    const info = readPngInfo(new Uint8Array(bytes));
    if (!info) throw new HttpError(415, "A print file must be a PNG.");
    if (!info.hasAlpha) throw new HttpError(415, "A print file must keep its transparency — this PNG has none.");
    if (info.dpi !== meta.dpi) throw new HttpError(422, `The file says ${info.dpi ?? "no"} DPI but ${meta.dpi} was expected — it would open at the wrong size in ColorboxRIP.`);
    const widthCm = (info.width / meta.dpi) * 2.54;
    const heightCm = (info.height / meta.dpi) * 2.54;
    if (Math.abs(widthCm - meta.widthCm) > 0.1 || Math.abs(heightCm - meta.heightCm) > 0.1) throw new HttpError(422, "The file's pixel size doesn't match its stated physical size.");
    const settings = await getSettings();
    const printer = getPrinter(settings.printerId);
    if (Math.min(widthCm, heightCm) * 10 > printer.maxWidthMm) throw new HttpError(422, `This artwork is ${Math.round(Math.min(widthCm, heightCm) * 10)} mm across its narrow side — wider than the ${printer.maxWidthMm} mm the ${printer.name} can print.`);
    if (meta.upsampled && !meta.acknowledged) throw new HttpError(409, "Part of this artwork is below the export resolution and was enlarged. Review it and tick the acknowledgement before approving.");

    if (type.includes("application/json") === false) await putBytesByKey(keyOf(order.id, job.id), bytes, "image/png");

    const file: PrintFile = {
      key: keyOf(order.id, job.id),
      widthPx: info.width,
      heightPx: info.height,
      dpi: meta.dpi,
      widthCm: Math.round(widthCm * 100) / 100,
      heightCm: Math.round(heightCm * 100) / 100,
      bytes: bytes.byteLength,
      createdAt: new Date().toISOString(),
      upsampled: Boolean(meta.upsampled),
      minSourceDpi: meta.minSourceDpi === null ? null : Math.round(Number(meta.minSourceDpi)),
    };
    let advanced = false;
    const saved = await updateOrder(order.id, (o: Order) => {
      const j = o.jobs.find((x) => x.id === job.id);
      if (!j) return null;
      if (!["awaiting_approval", "file_ready", "failed"].includes(j.status)) {
        throw new HttpError(409, "That job is already with the print station. Take it back out of the queue before replacing its file.");
      }
      const replaced = Boolean(j.file);
      j.file = file;
      j.status = "file_ready";
      j.error = undefined;
      j.artworkWidthCm = file.widthCm;
      j.artworkHeightCm = file.heightCm;
      j.pressTopCm = Math.round(meta.pressTopCm * 10) / 10;
      j.pressCenterOffsetCm = Math.round(meta.pressCenterOffsetCm * 10) / 10;
      o.history.push({
        at: file.createdAt,
        by: "owner",
        kind: "print-file",
        message: `${replaced ? "Print file replaced" : "Artwork approved — print file made"} for the ${j.side.replace("-", " ")}: ${file.widthCm} × ${file.heightCm} cm at ${file.dpi} DPI${file.upsampled ? ` (low-res source ${file.minSourceDpi} DPI, reviewed by ${owner.email || "the shop"})` : ""}.`,
      });
      if ((o.status === "incoming" || o.status === "artwork_review") && o.payment.state === "paid" && o.jobs.every((x) => x.file && x.status !== "awaiting_approval")) {
        if (o.status === "incoming") o.status = "artwork_review";
        o.history.push({ at: new Date().toISOString(), by: "system", kind: "status", message: "Every print file is approved → Print ready." });
        o.status = "print_ready";
        advanced = true;
      }
      return o;
    });
    if (saved && advanced) await sendStatusUpdate(saved, settings.shopName);
    return Response.json({ order: saved });
  } catch (e) {
    return errorResponse(e);
  }
}
