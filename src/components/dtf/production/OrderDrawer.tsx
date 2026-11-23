"use client";

import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Download, Info, Loader2, Send, Undo2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getColor, getGarment, SIDE_LABEL, ZONES } from "@/lib/dtf/garments";
import { JOB_LABEL, STAGES, STATUS_LABEL, stageIndex } from "@/lib/dtf/pipeline";
import { money } from "@/lib/dtf/pricing";
import { analyzeLayer } from "@/lib/dtf/export";
import { getPrinter, type ProductionSettings } from "@/lib/dtf/printers";
import { checkProject, type PixelStats } from "@/lib/dtf/readiness";
import type { Order, PrintJob, ReadinessIssue } from "@/lib/dtf/types";
import FlatThumb from "../studio/FlatThumb";
import { Sheet } from "../studio/sheets";
import { admin, approveAndExport, UpsampleNeeded } from "./api";

const TONE = { ok: CheckCircle2, info: Info, warn: AlertTriangle, block: XCircle } as const;

export default function OrderDrawer({ order, settings, onClose, onChange, notify }: { order: Order | null; settings: ProductionSettings; onClose: () => void; onChange: (o: Order) => void; notify: (t: string, tone?: "ok" | "error") => void }) {
  const [notes, setNotes] = useState("");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    setNotes(order?.productionNotes ?? "");
    setTracking(order?.trackingNumber ?? "");
  }, [order?.id, order?.productionNotes, order?.trackingNumber]);

  if (!order) return null;
  const at = stageIndex(order.status);
  const prev = at > 0 ? STAGES[at - 1] : null;
  const next = at >= 0 && at < STAGES.length - 1 ? STAGES[at + 1] : null;

  const act = async (label: string, fn: () => Promise<Order>) => {
    setBusy(label);
    try {
      onChange(await fn());
    } catch (e) {
      notify(e instanceof Error ? e.message : "That didn't work.", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open onClose={onClose} title={order.number} wide>
      <div className="space-y-6 p-5">
        {/* Stage */}
        <section>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[15px] font-semibold text-white">{STATUS_LABEL[order.status]}</div>
              <div className="text-[12px] text-[var(--text-3)]">
                {order.shipping.name} · {order.email} · placed {new Date(order.createdAt).toLocaleString()}
              </div>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11.5px] ${order.payment.state === "paid" ? "bg-[rgba(91,227,164,0.12)] text-[var(--ok)]" : "bg-[rgba(245,197,107,0.12)] text-[var(--warn)]"}`}>
              {order.payment.state === "paid" ? `Paid ${money(order.payment.amountCents)}` : `Awaiting ${money(order.payment.amountCents)}`}
            </span>
          </div>
          {order.status !== "cancelled" && (
            <ol className="mt-3 grid grid-cols-8 gap-1">
              {STAGES.map((s, i) => (
                <li key={s.id} title={s.label} className={`h-1.5 rounded-full ${i <= at ? "bg-[var(--accent)]" : "bg-white/[0.08]"}`} />
              ))}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {prev && order.status !== "cancelled" && (
              <button className="dtf-btn sm" disabled={!!busy} onClick={() => act("move", async () => (await admin.patch(order.id, { status: prev.id })).order)}>
                <ArrowLeft className="h-3.5 w-3.5" /> {prev.label}
              </button>
            )}
            {next && order.status !== "cancelled" && (
              <button className="dtf-btn sm primary" disabled={!!busy} onClick={() => act("move", async () => (await admin.patch(order.id, { status: next.id })).order)}>
                {next.label} <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
            {order.payment.state !== "paid" && order.status !== "cancelled" && (
              <button className="dtf-btn sm" disabled={!!busy} onClick={() => act("paid", async () => (await admin.patch(order.id, { markPaid: true })).order)}>
                <Check className="h-3.5 w-3.5" /> Payment received
              </button>
            )}
            {order.status !== "shipped" && order.status !== "cancelled" && (
              <button
                className="dtf-btn sm danger ml-auto"
                disabled={!!busy}
                onClick={() => {
                  if (window.confirm(`Cancel ${order.number}? The customer keeps their order history; nothing is refunded automatically.`)) void act("cancel", async () => (await admin.patch(order.id, { status: "cancelled" })).order);
                }}
              >
                Cancel order
              </button>
            )}
            {order.status === "cancelled" && (
              <button className="dtf-btn sm" onClick={() => act("reopen", async () => (await admin.patch(order.id, { status: "incoming" })).order)}>
                <Undo2 className="h-3.5 w-3.5" /> Reopen
              </button>
            )}
          </div>
        </section>

        {/* Items + jobs */}
        {order.items.map((it) => {
          const g = getGarment(it.garmentId);
          const c = getColor(g, it.colorId);
          const jobs = order.jobs.filter((j) => j.itemId === it.id);
          return (
            <section key={it.id} className="rounded-[16px] border border-[var(--line)] bg-white/[0.02]">
              <div className="flex gap-4 p-4">
                <div className="flex gap-2">
                  {it.mockups.front && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/dtf/assets/${it.mockups.front}`} alt="Customer's mockup" className="h-[120px] w-[96px] rounded-[10px] bg-black/30 object-cover" />
                  )}
                  <div className="dtf-stage grid h-[120px] w-[96px] place-items-center rounded-[10px]">
                    <FlatThumb project={it.project} side="front" width={78} />
                  </div>
                  {it.project.layers.some((l) => l.side === "back") && (
                    <div className="dtf-stage grid h-[120px] w-[96px] place-items-center rounded-[10px]">
                      <FlatThumb project={it.project} side="back" width={78} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 text-[12.5px]">
                  <div className="serif text-[19px] text-white">{g.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[var(--text-2)]">
                    <span className="h-3 w-3 rounded-full border border-white/20" style={{ background: c.hex }} /> {c.name} · {it.size} · ×{it.quantity}
                  </div>
                  <div className="mt-1 text-[var(--text-3)]">{it.project.name}</div>
                  {!!it.project.references.length && (
                    <div className="mt-2">
                      <div className="dtf-label mb-1">Customer references</div>
                      <div className="flex gap-1.5">
                        {it.project.references.map((r) => (
                          <a key={r.id} href={r.url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={r.url} alt="Reference" className="h-10 w-10 rounded-[6px] object-cover" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
                {jobs.map((j) => (
                  <JobRow key={j.id} order={order} job={j} settings={settings} onChange={onChange} notify={notify} />
                ))}
              </div>
            </section>
          );
        })}

        {order.customerNote && (
          <section>
            <div className="dtf-label mb-1">Customer note</div>
            <p className="rounded-[12px] bg-white/[0.03] p-3 text-[13px] text-[var(--text)]">{order.customerNote}</p>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2">
          <div>
            <div className="dtf-label mb-1">{order.shipping.method === "pickup" ? "Local pickup" : "Ship to"}</div>
            <p className="text-[12.5px] leading-relaxed text-[var(--text-2)]">
              {order.shipping.name}
              {order.shipping.method === "ship" && (
                <>
                  <br />
                  {order.shipping.line1}
                  {order.shipping.line2 ? `, ${order.shipping.line2}` : ""}
                  <br />
                  {order.shipping.city} {order.shipping.region} {order.shipping.postal} {order.shipping.country}
                </>
              )}
              {order.shipping.phone && (
                <>
                  <br />
                  {order.shipping.phone}
                </>
              )}
            </p>
          </div>
          <label className="block">
            <span className="dtf-label mb-1 block">Tracking number</span>
            <input className="dtf-input mono" value={tracking} onChange={(e) => setTracking(e.target.value)} onBlur={() => tracking !== (order.trackingNumber ?? "") && act("tracking", async () => (await admin.patch(order.id, { trackingNumber: tracking })).order)} />
          </label>
        </section>

        <section>
          <label className="block">
            <span className="dtf-label mb-1 block">Production notes (shop only)</span>
            <textarea className="dtf-input" rows={3} value={notes} placeholder="Press time, temperature, peel, anything the next shift should know" onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== order.productionNotes && act("notes", async () => (await admin.patch(order.id, { productionNotes: notes })).order)} />
          </label>
        </section>

        <section>
          <div className="dtf-label mb-2">History</div>
          <ol className="space-y-1.5 border-l border-[var(--line-2)] pl-4">
            {[...order.history].reverse().map((h, i) => (
              <li key={i} className="relative text-[12px] leading-relaxed">
                <span className="absolute -left-[19px] top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--text-3)]" />
                <span className="text-[var(--text)]">{h.message}</span>
                <span className="mono ml-2 text-[10.5px] text-[var(--text-3)]">
                  {h.by} · {new Date(h.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </section>
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-3)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
          </div>
        )}
      </div>
    </Sheet>
  );
}

function JobRow({ order, job, settings, onChange, notify }: { order: Order; job: PrintJob; settings: ProductionSettings; onChange: (o: Order) => void; notify: (t: string, tone?: "ok" | "error") => void }) {
  const [busy, setBusy] = useState(false);
  const [needsAck, setNeedsAck] = useState<number | null>(null);
  const [ack, setAck] = useState(false);
  const [stats, setStats] = useState<Record<string, PixelStats | undefined>>({});
  const item = order.items.find((i) => i.id === job.itemId)!;

  // A fresh pixel-level readiness pass in the operator's browser.
  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, PixelStats | undefined> = {};
      for (const l of item.project.layers) if (l.kind === "image" && l.side === job.side && l.mime !== "image/svg+xml") out[l.id] = (await analyzeLayer(l).catch(() => null)) ?? undefined;
      if (alive) setStats(out);
    })();
    return () => {
      alive = false;
    };
  }, [item.project, job.side]);
  const report = useMemo(() => checkProject({ project: item.project, printer: getPrinter(settings.printerId), safeWidthMm: settings.safeWidthMm, stats }), [item.project, settings, stats]);
  const issues: ReadinessIssue[] = report.issues.filter((i) => (!i.side || i.side === job.side) && i.severity !== "ok");

  const approve = async () => {
    setBusy(true);
    try {
      onChange(await approveAndExport(order, job, settings, ack));
      setNeedsAck(null);
      notify(`Print file made for ${order.number} · ${SIDE_LABEL[job.side]}.`, "ok");
    } catch (e) {
      if (e instanceof UpsampleNeeded) setNeedsAck(e.dpi);
      else notify(e instanceof Error ? e.message : "Export failed.", "error");
    } finally {
      setBusy(false);
    }
  };
  const move = async (to: PrintJob["status"], error?: string) => {
    setBusy(true);
    try {
      const r = await admin.moveJobs([{ orderId: order.id, jobId: job.id, to, error }]);
      if (!r.results[0]?.ok) throw new Error(r.results[0]?.error);
      const b = await admin.board();
      const o = b.orders.find((x) => x.id === order.id);
      if (o) onChange(o);
    } catch (e) {
      notify(e instanceof Error ? e.message : "That didn't work.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-white">{SIDE_LABEL[job.side]}</span>
        <span className="text-[12px] text-[var(--text-3)]">{ZONES[job.zoneId]?.label}</span>
        <span className="mono text-[12px] text-[var(--text-2)]">
          {job.artworkWidthCm.toFixed(1)} × {job.artworkHeightCm.toFixed(1)} cm
        </span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] ${job.status === "printed" ? "bg-[rgba(91,227,164,0.12)] text-[var(--ok)]" : job.status === "failed" ? "bg-[rgba(255,122,122,0.12)] text-[var(--block)]" : job.status === "awaiting_approval" ? "bg-[rgba(245,197,107,0.12)] text-[var(--warn)]" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>
          {JOB_LABEL[job.status]}
        </span>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-3)]">
        Press: top edge <span className="mono text-[var(--text-2)]">{job.pressTopCm.toFixed(1)} cm</span> below the collar
        {Math.abs(job.pressCenterOffsetCm) > 0.2 && (
          <>
            , centre <span className="mono text-[var(--text-2)]">{Math.abs(job.pressCenterOffsetCm).toFixed(1)} cm</span> to the {job.pressCenterOffsetCm > 0 ? "viewer's right" : "viewer's left"}
          </>
        )}
      </p>
      {job.file && (
        <p className="mono mt-1 text-[11.5px] text-[var(--text-3)]">
          {job.file.widthPx}×{job.file.heightPx} px · {job.file.dpi} DPI · {(job.file.bytes / 1e6).toFixed(1)} MB{job.file.upsampled ? ` · enlarged from ${job.file.minSourceDpi} DPI` : ""}
          {job.stationPath ? ` · ${job.stationPath}` : ""}
        </p>
      )}
      {job.error && <p className="mt-1 text-[12px] text-[var(--block)]">{job.error}</p>}
      {!!issues.length && (
        <ul className="mt-2 space-y-1">
          {issues.map((i, n) => {
            const I = TONE[i.severity];
            return (
              <li key={n} className="flex gap-2 text-[12px] text-[var(--text-2)]">
                <I className={`mt-0.5 h-3.5 w-3.5 shrink-0 tone-${i.severity}`} />
                {i.message}
              </li>
            );
          })}
        </ul>
      )}
      {needsAck !== null && (
        <label className="mt-2 flex items-start gap-2 rounded-[10px] border border-[rgba(245,197,107,0.35)] bg-[rgba(245,197,107,0.06)] p-2.5 text-[12px] text-[var(--warn)]">
          <input type="checkbox" className="mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          Part of this artwork is only {needsAck} DPI at print size and will be enlarged to 300 DPI. I&apos;ve looked at it and it&apos;s acceptable to print.
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(job.status === "awaiting_approval" || job.status === "failed" || job.status === "file_ready") && (
          <button className={`dtf-btn sm ${job.status === "file_ready" ? "" : "primary"}`} disabled={busy || order.status === "cancelled" || (needsAck !== null && !ack)} onClick={approve}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {job.status === "file_ready" ? "Regenerate file" : "Approve & make print file"}
          </button>
        )}
        {job.file && (
          <a className="dtf-btn sm" href={admin.fileUrl(order, job)}>
            <Download className="h-3.5 w-3.5" /> PNG
          </a>
        )}
        {(job.status === "file_ready" || job.status === "failed") && job.file && (
          <button className="dtf-btn sm" disabled={busy} onClick={() => move("queued")}>
            <Send className="h-3.5 w-3.5" /> Send to station
          </button>
        )}
        {job.status === "queued" && (
          <button className="dtf-btn sm" disabled={busy} onClick={() => move("file_ready")}>
            <Undo2 className="h-3.5 w-3.5" /> Take back
          </button>
        )}
        {(job.status === "file_ready" || job.status === "downloaded" || job.status === "opened") && (
          <button className="dtf-btn sm" disabled={busy} onClick={() => window.confirm("Mark this transfer as printed?") && move("printed")}>
            Mark printed
          </button>
        )}
        {(job.status === "queued" || job.status === "downloaded" || job.status === "opened") && (
          <button
            className="dtf-btn sm danger"
            disabled={busy}
            onClick={() => {
              const why = window.prompt("What went wrong? (shown in the order history)");
              if (why) void move("failed", why);
            }}
          >
            Report problem
          </button>
        )}
      </div>
    </div>
  );
}
