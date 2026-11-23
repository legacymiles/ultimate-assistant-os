// ---------------------------------------------------------------------------
// The production pipeline: the order statuses in the order the shop works
// them, what each means to the customer, and which moves are allowed.
// ---------------------------------------------------------------------------

import type { Order, OrderStatus, PrintJob, PrintJobStatus } from "./types";

export interface Stage {
  id: OrderStatus;
  label: string;
  /** What the customer reads on their tracking page. */
  customer: string;
}

export const STAGES: Stage[] = [
  { id: "incoming", label: "Incoming", customer: "Order received" },
  { id: "artwork_review", label: "Artwork review", customer: "Checking your artwork" },
  { id: "print_ready", label: "Print ready", customer: "Approved for print" },
  { id: "printing", label: "Printing", customer: "Printing your transfer" },
  { id: "heat_transfer", label: "Heat transfer", customer: "Pressing onto your garment" },
  { id: "quality_control", label: "Quality control", customer: "Final inspection" },
  { id: "completed", label: "Completed", customer: "Ready" },
  { id: "shipped", label: "Shipped", customer: "On its way" },
];

export const STATUS_LABEL: Record<OrderStatus, string> = {
  ...(Object.fromEntries(STAGES.map((s) => [s.id, s.label])) as Record<OrderStatus, string>),
  cancelled: "Cancelled",
};

export function stageIndex(status: OrderStatus): number {
  return STAGES.findIndex((s) => s.id === status);
}

/**
 * Which status an order may move to. Forward one step, back one step (a
 * failed QC goes back to printing), cancel from anywhere before shipping.
 * Skipping ahead is allowed only from completed → shipped and for pickup
 * orders, which never ship.
 */
export function canMove(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  if (to === "cancelled") return from !== "shipped" && from !== "cancelled";
  if (from === "cancelled") return to === "incoming";
  const a = stageIndex(from);
  const b = stageIndex(to);
  if (a < 0 || b < 0) return false;
  return Math.abs(b - a) === 1;
}

export const JOB_LABEL: Record<PrintJobStatus, string> = {
  awaiting_approval: "Awaiting approval",
  file_ready: "File ready",
  queued: "In station queue",
  downloaded: "In export folder",
  opened: "Opened in RIP",
  printed: "Printed",
  failed: "Failed",
};

/** True when every print job on the order has a print file the operator approved. */
export function allJobsReady(order: Order): boolean {
  return order.jobs.length > 0 && order.jobs.every((j) => j.status !== "awaiting_approval" && j.status !== "failed" && Boolean(j.file));
}

/** The order status the station's progress implies, or null to leave it alone. */
export function statusFromJobs(order: Order): OrderStatus | null {
  const jobs: PrintJob[] = order.jobs;
  if (!jobs.length) return null;
  if (jobs.every((j) => j.status === "printed")) {
    return stageIndex(order.status) < stageIndex("heat_transfer") ? "heat_transfer" : null;
  }
  if (jobs.some((j) => j.status === "opened" || j.status === "printed")) {
    return stageIndex(order.status) < stageIndex("printing") ? "printing" : null;
  }
  return null;
}

/** DTF-24117 style. `seq` is a monotonically increasing counter. */
export function orderNumber(seq: number): string {
  return `DTF-${String(24000 + seq).padStart(5, "0")}`;
}
