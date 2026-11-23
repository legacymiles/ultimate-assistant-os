// ---------------------------------------------------------------------------
// Print-job state, the one place it changes.
//
// The station (tools/dtf-print-station) and the production dashboard both move
// print jobs through the same table below. Everything after "downloaded" is a
// person's click — the station only reports what the operator did; nothing in
// this file, or anywhere else, prints on its own.
//
//   file_ready ──queue──▶ queued ──station──▶ downloaded ──▶ opened ──▶ printed
//        ▲                  │  ▲                  │            │
//        └────unqueue───────┘  └──── re-queue ─── failed ◀─────┘
//
// The pure parts (canJobMove, applyJobStatus, suggestedFilename,
// stationJobView) are exported for tests; setJobStatus wraps them in the
// store's safe read-modify-write.
// ---------------------------------------------------------------------------

import "server-only";

import { JOB_LABEL, STATUS_LABEL, statusFromJobs } from "../pipeline";
import { getColor, getGarment, SIDE_LABEL, ZONES } from "../garments";
import type { Order, OrderEvent, PrintJob, PrintJobStatus } from "../types";
import { HttpError } from "./access";
import { listOrders, updateOrder } from "./store";

/** Job states the station is responsible for (it lists, downloads, shows them). */
export const STATION_ACTIVE: readonly PrintJobStatus[] = ["queued", "downloaded", "opened"];

/** Job states whose file the station may fetch. */
export const STATION_FILE_OK: readonly PrintJobStatus[] = ["queued", "downloaded", "opened", "printed"];

/** Statuses the station may report. */
export const STATION_REPORTABLE = ["downloaded", "opened", "printed", "failed"] as const;
export type StationReportable = (typeof STATION_REPORTABLE)[number];

const MOVES: Partial<Record<PrintJobStatus, readonly PrintJobStatus[]>> = {
  // "printed" straight from file_ready: the operator downloaded the file from
  // the dashboard and printed without the station. Still an operator's click.
  file_ready: ["queued", "printed"],
  queued: ["file_ready", "downloaded", "failed"],
  downloaded: ["opened", "printed", "failed"],
  opened: ["printed", "failed"],
  failed: ["queued"],
};

/** The whole transition table. Same → same is not a move. */
export function canJobMove(from: PrintJobStatus, to: PrintJobStatus): boolean {
  return (MOVES[from] ?? []).includes(to);
}

export interface JobExtra {
  /** Where the station saved the file (downloaded). */
  path?: string;
  /** What went wrong, in the operator's words (failed). */
  error?: string;
}

function jobName(job: PrintJob): string {
  const zone = ZONES[job.zoneId]?.label ?? job.zoneId;
  return `${SIDE_LABEL[job.side] ?? job.side} print (${zone})`;
}

const WHO: Record<OrderEvent["by"], string> = {
  customer: "the customer",
  owner: "the owner",
  station: "the print station",
  system: "the system",
  stripe: "Stripe",
};

function describe(job: PrintJob, from: PrintJobStatus, to: PrintJobStatus, by: OrderEvent["by"], extra: JobExtra): string {
  const name = jobName(job);
  switch (to) {
    case "queued":
      return from === "failed"
        ? `${name} was sent back to the print station queue by ${WHO[by]}.`
        : `${name} was added to the print station queue by ${WHO[by]}.`;
    case "file_ready":
      return `${name} was taken out of the print station queue by ${WHO[by]}.`;
    case "downloaded":
      return extra.path ? `${name} was saved on the print station at ${extra.path}.` : `${name} was saved on the print station.`;
    case "opened":
      return `${name} was opened in ColorboxRIP by the operator.`;
    case "printed":
      return `${name} was marked printed by the operator.`;
    case "failed":
      return extra.error ? `${name} was reported as a problem: ${extra.error}` : `${name} was reported as a problem.`;
    default:
      return `${name} moved from ${JOB_LABEL[from]} to ${JOB_LABEL[to]}.`;
  }
}

function clean(text: string | undefined, max: number): string | undefined {
  if (typeof text !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const t = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
  return t || undefined;
}

export interface JobMoveResult {
  order: Order;
  job: PrintJob;
  /** False when nothing needs saving: the job was already in that state (an idempotent retry). */
  changed: boolean;
}

/**
 * Pure: move one job, stamp it, log it, then let the order follow
 * (statusFromJobs). Throws HttpError 404/409 with a plain-English message.
 * Reporting the state a job is already in is accepted as a no-op so a station
 * that retries after a lost response does not see an error.
 */
export function applyJobStatus(
  order: Order,
  jobId: string,
  to: PrintJobStatus,
  by: OrderEvent["by"],
  extra: JobExtra = {},
  now: Date = new Date(),
): JobMoveResult {
  const job = order.jobs.find((j) => j.id === jobId);
  if (!job) throw new HttpError(404, `Order ${order.number} has no print job with that id.`);
  const from = job.status;
  const path = clean(extra.path, 400);
  const error = clean(extra.error, 500);

  if (from === to) {
    const moved = to === "downloaded" && Boolean(path) && job.stationPath !== path;
    if (moved) job.stationPath = path;
    return { order, job, changed: moved };
  }
  if (order.status === "cancelled" && to !== "failed" && to !== "file_ready") {
    throw new HttpError(409, `Order ${order.number} was cancelled — its print jobs are closed.`);
  }
  if (!canJobMove(from, to)) {
    throw new HttpError(
      409,
      `${jobName(job)} on ${order.number} is "${JOB_LABEL[from]}" and cannot move to "${JOB_LABEL[to]}".`,
    );
  }
  if (to === "queued" && !job.file) {
    throw new HttpError(409, `${jobName(job)} on ${order.number} has no print file yet — export and approve it first.`);
  }

  const at = now.toISOString();
  job.status = to;
  switch (to) {
    case "queued":
      // A re-queue starts the station's part over.
      job.error = undefined;
      job.openedAt = undefined;
      job.printedAt = undefined;
      break;
    case "downloaded":
      job.exportedAt = at;
      if (path) job.stationPath = path;
      job.error = undefined;
      break;
    case "opened":
      job.openedAt = at;
      break;
    case "printed":
      job.printedAt = at;
      job.error = undefined;
      break;
    case "failed":
      job.error = error ?? "Reported as a problem without details.";
      break;
    default:
      break;
  }

  order.history.push({ at, by, kind: `job_${to}`, message: describe(job, from, to, by, { path, error }) });

  const next = statusFromJobs(order);
  if (next && next !== order.status) {
    const before = order.status;
    order.status = next;
    order.history.push({
      at,
      by: "system",
      kind: "status",
      message: `Order moved from ${STATUS_LABEL[before]} to ${STATUS_LABEL[next]} because of print progress.`,
    });
  }
  return { order, job, changed: true };
}

/** Move a job and save the order. Throws HttpError (404 / 409) in plain English. */
export async function setJobStatus(
  orderId: string,
  jobId: string,
  to: PrintJobStatus,
  by: OrderEvent["by"],
  extra?: JobExtra,
): Promise<{ order: Order; job: PrintJob }> {
  const saved = await updateOrder(orderId, (o) => {
    const result = applyJobStatus(o, jobId, to, by, extra);
    return result.changed ? result.order : null;
  });
  if (!saved) throw new HttpError(404, "That order does not exist.");
  const job = saved.jobs.find((j) => j.id === jobId);
  if (!job) throw new HttpError(404, "That print job does not exist.");
  return { order: saved, job };
}

// ----- what the station sees ----------------------------------------------------

export interface StationJobView {
  orderId: string;
  jobId: string;
  orderNumber: string;
  orderCreatedAt: string;
  customerName: string;
  customerNote: string;
  garment: string;
  colorName: string;
  colorHex: string;
  size: string;
  quantity: number;
  side: PrintJob["side"];
  sideLabel: string;
  zone: PrintJob["zoneId"];
  zoneLabel: string;
  artworkWidthCm: number;
  artworkHeightCm: number;
  pressTopCm: number;
  pressCenterOffsetCm: number;
  file: {
    widthPx: number;
    heightPx: number;
    dpi: number;
    widthCm: number;
    heightCm: number;
    bytes: number;
    upsampled: boolean;
    minSourceDpi: number | null;
  } | null;
  status: PrintJobStatus;
  statusLabel: string;
  productionNotes: string;
  suggestedFilename: string;
  exportedAt: string | null;
  openedAt: string | null;
  printedAt: string | null;
  stationPath: string | null;
  error: string | null;
}

function baseFilename(order: Order, job: PrintJob): string {
  const w = job.file?.widthCm ?? job.artworkWidthCm;
  const h = job.file?.heightCm ?? job.artworkHeightCm;
  const dpi = job.file?.dpi ?? 300;
  const num = order.number.replace(/[^A-Za-z0-9-]/g, "");
  return `${num}_${job.side}_${w.toFixed(1)}x${h.toFixed(1)}cm_${Math.round(dpi)}dpi`;
}

/**
 * `DTF-24117_front_28.0x31.5cm_300dpi.png`. Two jobs on one order that would
 * share a name (same side and size on two items) get `_2`, `_3`… in job order,
 * so the export folder never overwrites one print with another.
 */
export function suggestedFilename(order: Order, job: PrintJob): string {
  const base = baseFilename(order, job);
  const twins = order.jobs.filter((j) => baseFilename(order, j) === base);
  if (twins.length < 2) return `${base}.png`;
  const n = twins.findIndex((j) => j.id === job.id) + 1;
  return `${base}_${n}.png`;
}

export function stationJobView(order: Order, job: PrintJob): StationJobView {
  const item = order.items.find((i) => i.id === job.itemId) ?? order.items[0];
  const garment = getGarment(item?.garmentId ?? "tee");
  const color = getColor(garment, item?.colorId ?? "");
  return {
    orderId: order.id,
    jobId: job.id,
    orderNumber: order.number,
    orderCreatedAt: order.createdAt,
    customerName: order.shipping?.name ?? "",
    customerNote: order.customerNote ?? "",
    garment: garment.name,
    colorName: color.name,
    colorHex: color.hex,
    size: item?.size ?? "",
    quantity: item?.quantity ?? 1,
    side: job.side,
    sideLabel: SIDE_LABEL[job.side] ?? job.side,
    zone: job.zoneId,
    zoneLabel: ZONES[job.zoneId]?.label ?? job.zoneId,
    artworkWidthCm: job.artworkWidthCm,
    artworkHeightCm: job.artworkHeightCm,
    pressTopCm: job.pressTopCm,
    pressCenterOffsetCm: job.pressCenterOffsetCm,
    file: job.file
      ? {
          widthPx: job.file.widthPx,
          heightPx: job.file.heightPx,
          dpi: job.file.dpi,
          widthCm: job.file.widthCm,
          heightCm: job.file.heightCm,
          bytes: job.file.bytes,
          upsampled: job.file.upsampled,
          minSourceDpi: job.file.minSourceDpi,
        }
      : null,
    status: job.status,
    statusLabel: JOB_LABEL[job.status],
    productionNotes: order.productionNotes ?? "",
    suggestedFilename: suggestedFilename(order, job),
    exportedAt: job.exportedAt ?? null,
    openedAt: job.openedAt ?? null,
    printedAt: job.printedAt ?? null,
    stationPath: job.stationPath ?? null,
    error: job.error ?? null,
  };
}

/** Pure: every station-active job across these orders, oldest order first. */
export function stationJobsFrom(orders: Order[]): StationJobView[] {
  return orders
    .filter((o) => o.status !== "cancelled")
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .flatMap((o) => o.jobs.filter((j) => STATION_ACTIVE.includes(j.status)).map((j) => stationJobView(o, j)));
}

/** Jobs that are queued / downloaded / opened, oldest order first. */
export async function listStationJobs(): Promise<StationJobView[]> {
  return stationJobsFrom(await listOrders({ limit: 1000 }));
}
