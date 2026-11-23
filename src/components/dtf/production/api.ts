"use client";

import { loadDesignFonts } from "@/lib/dtf/fonts";
import { renderPrintFile } from "@/lib/dtf/export";
import { getPrinter, type ProductionSettings } from "@/lib/dtf/printers";
import type { Order, OrderStatus, PrintJob, PrintJobStatus } from "@/lib/dtf/types";

export interface Board {
  orders: Order[];
  settings: ProductionSettings;
  storage: "cloud" | "local";
  station: { paired: boolean; online: boolean; lastSeenAt: string | null; host: string | null };
  stats: { awaitingReview: number; awaitingPayment: number; inQueue: number; readyToQueue: number; pressing: number; paidThisMonthCents: number };
}

async function json<T>(r: Response): Promise<T> {
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((b as { error?: string }).error ?? `Request failed (${r.status}).`);
  return b as T;
}

export const admin = {
  board: () => fetch("/api/dtf/admin/orders", { cache: "no-store" }).then((r) => json<Board>(r)),
  patch: (id: string, body: { status?: OrderStatus; productionNotes?: string; trackingNumber?: string; markPaid?: boolean }) =>
    fetch(`/api/dtf/admin/orders/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => json<{ order: Order }>(r)),
  moveJobs: (moves: { orderId: string; jobId: string; to: PrintJobStatus; error?: string }[]) =>
    fetch("/api/dtf/admin/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moves }) }).then((r) =>
      json<{ results: { jobId: string; ok: boolean; error?: string }[] }>(r),
    ),
  saveSettings: (s: Partial<ProductionSettings>) =>
    fetch("/api/dtf/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) }).then((r) => json<{ settings: ProductionSettings }>(r)),
  station: () => fetch("/api/dtf/admin/station", { cache: "no-store" }).then((r) => json<{ paired: boolean; pairedAt: string | null; lastSeenAt: string | null; host: string | null; exportDir: string | null; online: boolean }>(r)),
  pair: () => fetch("/api/dtf/admin/station", { method: "POST" }).then((r) => json<{ token: string }>(r)),
  unpair: () => fetch("/api/dtf/admin/station", { method: "DELETE" }).then((r) => json<unknown>(r)),
  fileUrl: (o: Order, j: PrintJob) => `/api/dtf/admin/print-file?order=${encodeURIComponent(o.id)}&job=${encodeURIComponent(j.id)}`,
};

/**
 * Approve a job: render its artwork-only PNG at the printer's DPI in this
 * browser (the same renderer the customer saw), then hand it to the server,
 * which checks the PNG's size and DPI before storing it as the print file.
 */
export async function approveAndExport(order: Order, job: PrintJob, settings: ProductionSettings, acknowledged: boolean): Promise<Order> {
  const item = order.items.find((i) => i.id === job.itemId);
  if (!item) throw new Error("This job's design is missing from the order.");
  await loadDesignFonts();
  const printer = getPrinter(settings.printerId);
  const r = await renderPrintFile(item.project, job.side, printer.targetDpi);
  const meta = {
    orderId: order.id,
    jobId: job.id,
    dpi: r.dpi,
    widthCm: r.widthCm,
    heightCm: r.heightCm,
    pressTopCm: r.pressTopCm,
    pressCenterOffsetCm: r.pressCenterOffsetCm,
    upsampled: r.upsampled,
    minSourceDpi: r.minSourceDpi,
    acknowledged,
  };
  if (r.upsampled && !acknowledged) {
    throw new UpsampleNeeded(r.minSourceDpi ?? 0);
  }
  const sign = await fetch("/api/dtf/admin/print-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: "sign", orderId: order.id, jobId: job.id }) }).then((x) =>
    json<{ mode: "signed" | "direct"; uploadUrl?: string }>(x),
  );
  if (sign.mode === "signed" && sign.uploadUrl) {
    const put = await fetch(sign.uploadUrl, { method: "PUT", body: r.blob, headers: { "Content-Type": "image/png", "x-upsert": "true" } });
    if (!put.ok) throw new Error("The print file didn't upload. Try again.");
    return (await fetch("/api/dtf/admin/print-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phase: "confirm", ...meta }) }).then((x) => json<{ order: Order }>(x))).order;
  }
  const fd = new FormData();
  fd.append("file", r.blob, `${order.number}-${job.side}.png`);
  fd.append("meta", JSON.stringify(meta));
  return (await fetch("/api/dtf/admin/print-file", { method: "POST", body: fd }).then((x) => json<{ order: Order }>(x))).order;
}

export class UpsampleNeeded extends Error {
  constructor(public dpi: number) {
    super(`Part of this artwork is only ${dpi} DPI at print size and has to be enlarged to 300 DPI.`);
  }
}
