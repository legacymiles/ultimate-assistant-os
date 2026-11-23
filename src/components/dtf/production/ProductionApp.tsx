"use client";

import { AlertTriangle, CheckCircle2, Copy, Download, FileSpreadsheet, LayoutGrid, Loader2, MonitorSmartphone, Plug, RefreshCw, Send, Settings2, Shirt, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { packGang, type GangLayout } from "@/lib/dtf/gang";
import { getColor, getGarment, SIDE_LABEL } from "@/lib/dtf/garments";
import { JOB_LABEL, STAGES } from "@/lib/dtf/pipeline";
import { withPhys } from "@/lib/dtf/png";
import { getPrinter, mmToPx, type ProductionSettings } from "@/lib/dtf/printers";
import { money } from "@/lib/dtf/pricing";
import type { Order, PrintJob } from "@/lib/dtf/types";
import FlatThumb from "../studio/FlatThumb";
import { admin, type Board } from "./api";
import OrderDrawer from "./OrderDrawer";

type Tab = "board" | "queue" | "bridge" | "settings";

export default function ProductionApp() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const load = useCallback(async () => {
    try {
      setBoard(await admin.board());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load production.");
    }
  }, []);
  useEffect(() => {
    void load();
    // The station reports progress on its own; keep the board current.
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = (text: string, tone: "ok" | "error" = "ok") => setToast({ text, tone });
  const replaceOrder = (o: Order) => setBoard((b) => (b ? { ...b, orders: b.orders.map((x) => (x.id === o.id ? o : x)) } : b));
  const open = board?.orders.find((o) => o.id === openId) ?? null;
  const printer = getPrinter(board?.settings.printerId);

  return (
    <div className="dtf dtf-stage min-h-[100dvh]">
      <header className="dtf-glass sticky top-0 z-30 border-x-0 border-t-0">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <a href="/apps/dtf-studio" className="flex items-baseline gap-1.5">
            <span className="serif text-[22px] italic text-white">DTF</span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--text-2)]">Production</span>
          </a>
          <span className="hidden rounded-full border border-[var(--line)] px-2.5 py-1 text-[11.5px] text-[var(--text-2)] md:inline">
            {printer.name} · {printer.rip} · <span className="mono">{board?.settings.safeWidthMm ?? printer.safeWidthMm} mm</span> safe
          </span>
          <StationPill station={board?.station} onClick={() => setTab("bridge")} />
          <nav className="ml-auto flex gap-0.5" aria-label="Production sections">
            {(
              [
                ["board", "Board", LayoutGrid],
                ["queue", "Print queue", Send],
                ["bridge", "Print bridge", Plug],
                ["settings", "Settings", Settings2],
              ] as const
            ).map(([id, label, I]) => (
              <button key={id} className="dtf-tab flex items-center gap-1.5" aria-selected={tab === id} onClick={() => setTab(id)}>
                <I className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>
          <a className="dtf-btn sm ghost" href="/apps/dtf-studio">
            <Shirt className="h-3.5 w-3.5" /> Studio
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6" data-standout="production-board">
        <h1 className="sr-only">DTF Production</h1>
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-[12px] border border-[rgba(255,122,122,0.35)] bg-[rgba(255,122,122,0.06)] p-3 text-[13px] text-[#ffd0d0]">
            <AlertTriangle className="h-4 w-4" /> {error}
            <button className="dtf-btn sm ml-auto" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}
        {!board ? (
          !error && (
            <div className="grid place-items-center py-32 text-[var(--text-3)]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )
        ) : (
          <>
            <Kpis board={board} />
            {tab === "board" && <BoardView board={board} onOpen={setOpenId} />}
            {tab === "queue" && <QueueView board={board} reload={load} notify={notify} />}
            {tab === "bridge" && <BridgeView notify={notify} storage={board.storage} />}
            {tab === "settings" && <SettingsView settings={board.settings} onSaved={(s) => setBoard({ ...board, settings: s })} notify={notify} />}
          </>
        )}
      </main>

      {board && open && <OrderDrawer order={open} settings={board.settings} onClose={() => setOpenId(null)} onChange={replaceOrder} notify={notify} />}

      {toast && (
        <div role="status" className={`dtf-glass fixed bottom-5 left-1/2 z-[60] flex max-w-[min(520px,calc(100vw-24px))] -translate-x-1/2 items-center gap-2 rounded-[14px] px-4 py-3 text-[12.5px] ${toast.tone === "error" ? "text-[#ffd0d0]" : "text-[#c9f5df]"}`}>
          {toast.tone === "error" ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
          {toast.text}
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-[var(--text-3)]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function StationPill({ station, onClick }: { station?: Board["station"]; onClick: () => void }) {
  const state = !station ? "…" : !station.paired ? "Station not paired" : station.online ? `Station online${station.host ? ` · ${station.host}` : ""}` : "Station offline — jobs wait in the queue";
  const dot = !station?.paired ? "bg-[var(--text-3)]" : station.online ? "bg-[var(--ok)]" : "bg-[var(--warn)]";
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11.5px] text-[var(--text-2)] hover:border-[var(--line-2)]">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {state}
    </button>
  );
}

function Kpis({ board }: { board: Board }) {
  const s = board.stats;
  const tiles: { label: string; value: string; sub: string; attention?: boolean }[] = [
    { label: "Awaiting review", value: String(s.awaitingReview), sub: s.awaitingPayment ? `${s.awaitingPayment} awaiting payment` : "All paid orders", attention: s.awaitingReview > 0 },
    { label: "In print queue", value: String(s.inQueue), sub: s.readyToQueue ? `${s.readyToQueue} file${s.readyToQueue === 1 ? "" : "s"} ready to send` : "Nothing waiting to send" },
    { label: "Pressing & QC", value: String(s.pressing), sub: "Heat transfer + quality control" },
    { label: "Paid this month", value: money(s.paidThisMonthCents), sub: new Date().toLocaleString("en-US", { month: "long", year: "numeric" }) },
  ];
  return (
    <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Today at a glance">
      {tiles.map((t) => (
        <div key={t.label} className="dtf-glass rounded-[16px] px-4 py-3.5">
          <div className="dtf-label">{t.label}</div>
          <div className="mono mt-1.5 text-[28px] leading-none text-white">{t.value}</div>
          <div className={`mt-1.5 flex items-center gap-1 text-[11.5px] ${t.attention ? "text-[var(--warn)]" : "text-[var(--text-3)]"}`}>
            {t.attention && <AlertTriangle className="h-3 w-3" />}
            {t.sub}
          </div>
        </div>
      ))}
    </section>
  );
}

function BoardView({ board, onOpen }: { board: Board; onOpen: (id: string) => void }) {
  const cancelled = board.orders.filter((o) => o.status === "cancelled");
  if (!board.orders.length) {
    return (
      <div className="dtf-glass rounded-[18px] px-6 py-16 text-center">
        <p className="serif text-[26px] text-white">No orders yet.</p>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-[var(--text-3)]">
          Orders placed in the studio land here in <b className="text-[var(--text-2)]">Incoming</b>. Each one moves left to right — review the artwork, make the print file, send it to the station, press, check, ship.
        </p>
        <a className="dtf-btn primary mt-5" href="/apps/dtf-studio">
          Open the studio
        </a>
      </div>
    );
  }
  return (
    <section aria-label="Orders by stage">
      <div className="dtf-scroll -mx-4 flex flex-col gap-5 px-4 pb-4 sm:-mx-6 sm:px-6 md:flex-row md:gap-3 md:overflow-x-auto">
        {STAGES.map((stage) => {
          const orders = board.orders.filter((o) => o.status === stage.id);
          return (
            <div key={stage.id} className={`w-full shrink-0 md:w-[272px] ${orders.length ? "" : "hidden md:block"}`}>
              <div className="mb-2 flex items-center justify-between px-1">
                <h2 className="text-[12.5px] font-semibold text-[var(--text)]">{stage.label}</h2>
                <span className="mono text-[11px] text-[var(--text-3)]">{orders.length}</span>
              </div>
              <div className="space-y-2">
                {orders.map((o) => (
                  <OrderCard key={o.id} o={o} onOpen={() => onOpen(o.id)} />
                ))}
                {!orders.length && <div className="rounded-[14px] border border-dashed border-[var(--line)] py-6 text-center text-[11.5px] text-[var(--text-3)]">Empty</div>}
              </div>
            </div>
          );
        })}
      </div>
      {!!cancelled.length && (
        <details className="mt-4 text-[12.5px] text-[var(--text-3)]">
          <summary className="cursor-pointer">Cancelled ({cancelled.length})</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {cancelled.map((o) => (
              <button key={o.id} className="dtf-btn sm" onClick={() => onOpen(o.id)}>
                {o.number}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function OrderCard({ o, onOpen }: { o: Order; onOpen: () => void }) {
  const first = o.items[0];
  const g = getGarment(first.garmentId);
  const age = Math.max(0, Math.round((Date.now() - Date.parse(o.createdAt)) / 3_600_000));
  const pending = o.jobs.filter((j) => j.status === "awaiting_approval").length;
  return (
    <button onClick={onOpen} className="dtf-glass group w-full rounded-[14px] p-3 text-left transition hover:border-[var(--line-2)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
      <div className="flex gap-3">
        <div className="dtf-stage grid h-[68px] w-[56px] shrink-0 place-items-center rounded-[9px]">
          <FlatThumb project={first.project} width={46} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="mono text-[13px] text-white">{o.number}</span>
            <span className="mono text-[10.5px] text-[var(--text-3)]">{age < 24 ? `${age}h` : `${Math.round(age / 24)}d`}</span>
          </div>
          <div className="truncate text-[12px] text-[var(--text-2)]">{o.shipping.name}</div>
          <div className="truncate text-[11.5px] text-[var(--text-3)]">
            {g.name} · {getColor(g, first.colorId).name}
            {o.items.length > 1 ? ` +${o.items.length - 1}` : ""}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {o.payment.state !== "paid" && <span className="rounded-full bg-[rgba(245,197,107,0.12)] px-2 py-0.5 text-[10.5px] text-[var(--warn)]">Unpaid</span>}
        {pending > 0 && <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10.5px] text-[var(--text-2)]">{pending} to approve</span>}
        {o.jobs
          .filter((j) => j.status !== "awaiting_approval")
          .slice(0, 3)
          .map((j) => (
            <span key={j.id} className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10.5px] text-[var(--accent)]">
              {SIDE_LABEL[j.side].replace(" sleeve", "")}: {JOB_LABEL[j.status]}
            </span>
          ))}
      </div>
    </button>
  );
}

// ----- Print queue ---------------------------------------------------------------------

interface Row {
  order: Order;
  job: PrintJob;
  qty: number;
}

function QueueView({ board, reload, notify }: { board: Board; reload: () => void; notify: (t: string, tone?: "ok" | "error") => void }) {
  const rows: Row[] = useMemo(
    () =>
      board.orders
        .filter((o) => o.status !== "cancelled")
        .flatMap((o) => o.jobs.filter((j) => j.file && j.status !== "awaiting_approval").map((j) => ({ order: o, job: j, qty: o.items.find((i) => i.id === j.itemId)?.quantity ?? 1 })))
        .sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt)),
    [board],
  );
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [gang, setGang] = useState(false);
  const chosen = rows.filter((r) => sel.has(r.job.id));
  const toggle = (id: string) => setSel((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s).add(id)));

  const send = async () => {
    setBusy("send");
    try {
      const r = await admin.moveJobs(chosen.filter((x) => x.job.status === "file_ready" || x.job.status === "failed").map((x) => ({ orderId: x.order.id, jobId: x.job.id, to: "queued" as const })));
      const bad = r.results.filter((x) => !x.ok);
      notify(bad.length ? `${r.results.length - bad.length} sent; ${bad.length} couldn't be: ${bad[0].error}` : `${r.results.length} file${r.results.length === 1 ? "" : "s"} sent to the print station.`, bad.length ? "error" : "ok");
      setSel(new Set());
      reload();
    } finally {
      setBusy(null);
    }
  };

  const download = async () => {
    setBusy("download");
    for (const r of chosen) {
      const a = document.createElement("a");
      a.href = admin.fileUrl(r.order, r.job);
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      await new Promise((res) => setTimeout(res, 450));
    }
    setBusy(null);
  };

  const sheet = () => {
    const head = ["order", "customer", "garment", "colour", "size", "qty", "side", "artwork_w_cm", "artwork_h_cm", "press_top_cm", "press_offset_cm", "dpi", "upsampled", "status", "notes"];
    const lines = chosen.map(({ order: o, job: j, qty }) => {
      const it = o.items.find((i) => i.id === j.itemId)!;
      const g = getGarment(it.garmentId);
      return [o.number, o.shipping.name, g.name, getColor(g, it.colorId).name, it.size, qty, SIDE_LABEL[j.side], j.file?.widthCm, j.file?.heightCm, j.pressTopCm, j.pressCenterOffsetCm, j.file?.dpi, j.file?.upsampled ? "yes" : "no", JOB_LABEL[j.status], o.productionNotes.replace(/\s+/g, " ")];
    });
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dtf-job-sheet-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!rows.length) {
    return (
      <div className="dtf-glass rounded-[18px] px-6 py-16 text-center">
        <p className="serif text-[24px] text-white">No print files yet.</p>
        <p className="mx-auto mt-2 max-w-md text-[13px] text-[var(--text-3)]">Open an order on the board and press Approve &amp; make print file. Approved files collect here, ready to send to the station, download or gang onto one sheet.</p>
      </div>
    );
  }

  return (
    <section>
      <div className="dtf-glass sticky top-[64px] z-20 mb-3 flex flex-wrap items-center gap-2 rounded-[14px] p-2">
        <label className="flex items-center gap-2 px-2 text-[12.5px] text-[var(--text-2)]">
          <input type="checkbox" checked={sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.job.id)) : new Set())} />
          {sel.size ? `${sel.size} selected` : "Select all"}
        </label>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button className="dtf-btn sm primary" disabled={!chosen.some((c) => c.job.status === "file_ready" || c.job.status === "failed") || !!busy} onClick={send}>
            <Send className="h-3.5 w-3.5" /> Send to station
          </button>
          <button className="dtf-btn sm" disabled={!chosen.length || !!busy} onClick={download}>
            <Download className="h-3.5 w-3.5" /> Download PNGs
          </button>
          <button className="dtf-btn sm" disabled={!chosen.length} onClick={sheet}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Job sheet
          </button>
          <button className="dtf-btn sm" disabled={!chosen.length} onClick={() => setGang(true)}>
            <LayoutGrid className="h-3.5 w-3.5" /> Gang sheet
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-[16px] border border-[var(--line)]">
        <table className="w-full min-w-[760px] text-left text-[12.5px]">
          <thead className="text-[11px] uppercase tracking-[0.08em] text-[var(--text-3)]">
            <tr className="border-b border-[var(--line)]">
              <th className="w-8 px-3 py-2.5" />
              <th className="px-3 py-2.5 font-semibold">Order</th>
              <th className="px-3 py-2.5 font-semibold">Garment</th>
              <th className="px-3 py-2.5 font-semibold">Side</th>
              <th className="px-3 py-2.5 text-right font-semibold">Transfer</th>
              <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ order: o, job: j, qty }) => {
              const it = o.items.find((i) => i.id === j.itemId)!;
              const g = getGarment(it.garmentId);
              return (
                <tr key={j.id} className={`border-b border-[var(--line)] last:border-0 ${sel.has(j.id) ? "bg-[var(--accent-soft)]" : "hover:bg-white/[0.02]"}`} onClick={() => toggle(j.id)}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={sel.has(j.id)} onChange={() => toggle(j.id)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${o.number} ${SIDE_LABEL[j.side]}`} />
                  </td>
                  <td className="mono px-3 py-2.5 text-white">{o.number}</td>
                  <td className="px-3 py-2.5 text-[var(--text-2)]">
                    {g.name} · {getColor(g, it.colorId).name} · {it.size}
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-2)]">{SIDE_LABEL[j.side]}</td>
                  <td className="mono px-3 py-2.5 text-right text-[var(--text)]">
                    {j.file!.widthCm.toFixed(1)} × {j.file!.heightCm.toFixed(1)} cm{j.file!.upsampled && <AlertTriangle className="ml-1 inline h-3 w-3 text-[var(--warn)]" aria-label="Enlarged from a low-resolution source" />}
                  </td>
                  <td className="mono px-3 py-2.5 text-right">{qty}</td>
                  <td className="px-3 py-2.5">
                    <span className={j.status === "printed" ? "text-[var(--ok)]" : j.status === "failed" ? "text-[var(--block)]" : "text-[var(--accent)]"}>{JOB_LABEL[j.status]}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {gang && <GangModal rows={chosen} settings={board.settings} onClose={() => setGang(false)} notify={notify} />}
    </section>
  );
}

function GangModal({ rows, settings, onClose, notify }: { rows: Row[]; settings: ProductionSettings; onClose: () => void; notify: (t: string, tone?: "ok" | "error") => void }) {
  const printer = getPrinter(settings.printerId);
  const [mode, setMode] = useState<string>("roll");
  const [busy, setBusy] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const sheet = printer.sheets.find((s) => s.id === mode);
  const layout: GangLayout = useMemo(
    () =>
      packGang(
        rows.map((r) => ({ id: r.job.id, label: `${r.order.number} ${SIDE_LABEL[r.job.side]}`, widthMm: r.job.file!.widthCm * 10, heightMm: r.job.file!.heightCm * 10, copies: r.qty })),
        { widthMm: sheet ? sheet.widthMm : settings.safeWidthMm, heightMm: sheet?.heightMm, maxLengthMm: printer.maxRollLengthMm, gapMm: settings.gangGapMm, marginMm: settings.gangMarginMm },
      ),
    [rows, sheet, settings, printer],
  );

  useEffect(() => {
    const c = preview.current;
    if (!c) return;
    const W = 300;
    const k = W / layout.widthMm;
    c.width = W;
    c.height = Math.max(60, Math.round(layout.lengthMm * k));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0f1114";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(0.5, 0.5, c.width - 1, c.height - 1);
    for (const p of layout.placed) {
      ctx.fillStyle = "rgba(94,225,255,0.14)";
      ctx.strokeStyle = "rgba(94,225,255,0.7)";
      ctx.fillRect(p.x * k, p.y * k, p.w * k, p.h * k);
      ctx.strokeRect(p.x * k + 0.5, p.y * k + 0.5, p.w * k - 1, p.h * k - 1);
      ctx.fillStyle = "#ECEEF2";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(p.label.split(" ")[0], p.x * k + 4, p.y * k + 13);
    }
  }, [layout]);

  const build = async () => {
    setBusy(true);
    try {
      const dpi = printer.targetDpi;
      const W = mmToPx(layout.widthMm, dpi);
      const H = mmToPx(layout.lengthMm, dpi);
      if (W * H > 200_000_000) throw new Error("That sheet is too large for a browser to build in one piece — select fewer files.");
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d")!;
      const images = new Map<string, HTMLImageElement>();
      for (const r of rows) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error(`Couldn't load the print file for ${r.order.number}.`));
          img.src = admin.fileUrl(r.order, r.job);
        });
        images.set(r.job.id, img);
      }
      for (const p of layout.placed) {
        const img = images.get(p.id)!;
        const x = mmToPx(p.x, dpi);
        const y = mmToPx(p.y, dpi);
        const w = mmToPx(p.w, dpi);
        const h = mmToPx(p.h, dpi);
        ctx.save();
        if (p.rotated) {
          // Turned 90° to fit the film: the PNG's own pixels, rotated, never resized.
          ctx.translate(x + w, y);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(img, 0, 0, h, w);
        } else {
          ctx.drawImage(img, x, y, w, h);
        }
        ctx.restore();
      }
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) throw new Error("The browser couldn't encode the sheet.");
      const out = new Blob([withPhys(new Uint8Array(await blob.arrayBuffer()), dpi) as BlobPart], { type: "image/png" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gang-${mode}-${layout.widthMm}x${Math.round(layout.lengthMm)}mm-${dpi}dpi.png`;
      a.click();
      URL.revokeObjectURL(url);
      notify(`Gang sheet saved: ${layout.placed.length} transfers on ${layout.widthMm} × ${Math.round(layout.lengthMm)} mm.`, "ok");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Couldn't build the sheet.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-label="Gang sheet">
      <div className="dtf-glass dtf-scroll max-h-[90dvh] w-full max-w-[760px] overflow-y-auto rounded-[18px]">
        <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <h2 className="serif text-[24px] text-white">Gang sheet</h2>
          <button className="dtf-icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-[1fr_300px]">
          <div className="space-y-4 text-[12.5px]">
            <div className="dtf-seg flex-wrap">
              <button className="dtf-tab" aria-selected={mode === "roll"} onClick={() => setMode("roll")}>
                Roll · {settings.safeWidthMm} mm
              </button>
              {printer.sheets.map((s) => (
                <button key={s.id} className="dtf-tab" aria-selected={mode === s.id} onClick={() => setMode(s.id)}>
                  {s.label}
                </button>
              ))}
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <div className="rounded-[12px] bg-white/[0.03] p-3">
                <dt className="dtf-label">Film</dt>
                <dd className="mono mt-1 text-[16px] text-white">
                  {layout.widthMm} × {Math.round(layout.lengthMm)} mm
                </dd>
              </div>
              <div className="rounded-[12px] bg-white/[0.03] p-3">
                <dt className="dtf-label">Used</dt>
                <dd className="mono mt-1 text-[16px] text-white">{Math.round(layout.efficiency * 100)}%</dd>
              </div>
            </dl>
            <p className="text-[var(--text-3)]">
              {layout.placed.length} transfers (quantities included), {settings.gangGapMm} mm apart with a {settings.gangMarginMm} mm edge. Pieces that only fit sideways are turned 90°. Nothing is scaled.
            </p>
            {!!layout.unplaced.length && (
              <ul className="space-y-1 text-[var(--warn)]">
                {layout.unplaced.map((u, i) => (
                  <li key={i}>
                    {u.label}: {u.reason}
                  </li>
                ))}
              </ul>
            )}
            <p className="rounded-[12px] bg-white/[0.03] p-3 text-[var(--text-3)]">
              Exported at {printer.targetDpi} DPI with the physical size written in, transparent, artwork only. Mirroring, white and colour are set in {printer.rip} as usual.
            </p>
            <button className="dtf-btn primary" disabled={busy || !layout.placed.length} onClick={build}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Build &amp; download PNG
            </button>
          </div>
          <canvas ref={preview} className="w-full rounded-[10px]" aria-label="Sheet layout preview" />
        </div>
      </div>
    </div>
  );
}

// ----- Print bridge ---------------------------------------------------------------------

function BridgeView({ notify, storage }: { notify: (t: string, tone?: "ok" | "error") => void; storage: string }) {
  const [st, setSt] = useState<Awaited<ReturnType<typeof admin.station>> | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const load = useCallback(() => admin.station().then(setSt).catch(() => setSt(null)), []);
  useEffect(() => {
    void load();
  }, [load]);
  const site = typeof window !== "undefined" ? window.location.origin : "";
  const config = token ? JSON.stringify({ siteUrl: site, token, exportDir: "C:\\DTF\\Print Jobs", colorboxRipPath: "", openMode: "reveal", pollSeconds: 15, port: 7316 }, null, 2) : "";
  return (
    <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="dtf-glass rounded-[18px] p-5">
        <div className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-[15px] font-semibold text-white">Print station</h2>
        </div>
        <p className="mt-1 text-[12.5px] text-[var(--text-3)]">The small Windows program on the PC next to the Lancelot. It collects approved print files into a folder by order number and lets the operator open them in ColorboxRIP.</p>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-[12.5px]">
          <div className="rounded-[12px] bg-white/[0.03] p-3">
            <dt className="dtf-label">Status</dt>
            <dd className="mt-1 text-white">{!st ? "…" : !st.paired ? "Not paired" : st.online ? "Online" : "Offline"}</dd>
          </div>
          <div className="rounded-[12px] bg-white/[0.03] p-3">
            <dt className="dtf-label">Last seen</dt>
            <dd className="mono mt-1 text-white">{st?.lastSeenAt ? new Date(st.lastSeenAt).toLocaleString() : "—"}</dd>
          </div>
          <div className="col-span-2 rounded-[12px] bg-white/[0.03] p-3">
            <dt className="dtf-label">Export folder</dt>
            <dd className="mono mt-1 break-all text-white">{st?.exportDir || "Reported by the station once it connects"}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="dtf-btn primary sm"
            onClick={async () => {
              if (st?.paired && !window.confirm("Pairing again disconnects the current station until it gets the new token. Continue?")) return;
              try {
                setToken((await admin.pair()).token);
                void load();
              } catch (e) {
                notify(e instanceof Error ? e.message : "Couldn't pair.", "error");
              }
            }}
          >
            <Plug className="h-3.5 w-3.5" /> {st?.paired ? "Pair a new station" : "Pair the print station"}
          </button>
          {st?.paired && (
            <button className="dtf-btn sm danger" onClick={async () => window.confirm("Unpair? The station stops receiving jobs until it is paired again.") && (await admin.unpair(), setToken(null), load())}>
              Unpair
            </button>
          )}
        </div>
        {token && (
          <div className="mt-4 rounded-[14px] border border-[rgba(94,225,255,0.35)] bg-[var(--accent-soft)] p-4">
            <p className="text-[12.5px] text-[var(--text)]">
              Save this as <span className="mono">station.config.json</span> next to the station program. The token is shown <b>once</b> — only its fingerprint is stored here.
            </p>
            <pre className="mono dtf-scroll mt-2 max-h-56 overflow-auto rounded-[10px] bg-black/50 p-3 text-[11.5px] text-[var(--text)]">{config}</pre>
            <button className="dtf-btn sm mt-2" onClick={() => navigator.clipboard.writeText(config).then(() => notify("Config copied.", "ok"))}>
              <Copy className="h-3.5 w-3.5" /> Copy config
            </button>
          </div>
        )}
      </div>
      <div className="dtf-glass rounded-[18px] p-5 text-[12.5px] leading-relaxed text-[var(--text-2)]">
        <h2 className="text-[15px] font-semibold text-white">Set up on the printer PC</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          <li>Install Node.js 22 or newer on the PC that runs ColorboxRIP.</li>
          <li>
            Copy the <span className="mono">tools/dtf-print-station</span> folder from the hub repository onto it.
          </li>
          <li>Pair here and save the config next to the program. Put the path to ColorboxRIP in <span className="mono">colorboxRipPath</span> if you want the Open button to launch it.</li>
          <li>
            Run <span className="mono">start-station.cmd</span>. It prints a local link — open it on that PC.
          </li>
        </ol>
        <h3 className="mt-5 text-[13px] font-semibold text-white">What it will never do</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Start a print. Printing is always the operator, in ColorboxRIP.</li>
          <li>Change RIP settings — profile, white, mirror and ink limits stay yours.</li>
          <li>Talk to the printer directly. There is no printer or ColorboxRIP API involved.</li>
        </ul>
        <p className="mt-4 text-[var(--text-3)]">If the PC is off, approved jobs wait in the queue here and the station picks them up when it reconnects. Files are stored in {storage === "cloud" ? "cloud storage" : "this computer's local data folder"}.</p>
      </div>
    </section>
  );
}

// ----- Settings -------------------------------------------------------------------------------

function SettingsView({ settings, onSaved, notify }: { settings: ProductionSettings; onSaved: (s: ProductionSettings) => void; notify: (t: string, tone?: "ok" | "error") => void }) {
  const [s, setS] = useState(settings);
  const printer = getPrinter(s.printerId);
  const num = (k: keyof ProductionSettings, label: string, unit: string, hint: string) => (
    <label className="block">
      <span className="mb-1 block text-[12px] text-[var(--text-2)]">{label}</span>
      <span className="relative block">
        <input className="dtf-input mono pr-10" inputMode="decimal" value={String(s[k])} onChange={(e) => setS({ ...s, [k]: e.target.value as unknown as number })} />
        <span className="mono absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[var(--text-3)]">{unit}</span>
      </span>
      <span className="mt-1 block text-[11.5px] text-[var(--text-3)]">{hint}</span>
    </label>
  );
  return (
    <section className="dtf-glass max-w-2xl rounded-[18px] p-5">
      <h2 className="text-[15px] font-semibold text-white">Production settings</h2>
      <p className="mt-1 text-[12.5px] text-[var(--text-3)]">
        {printer.name} · {printer.printhead} · {printer.inks} · up to {printer.maxWidthMm} mm wide · target {printer.targetDpi} DPI
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        {num("safeWidthMm", "Safe print width", "mm", `Up to the printer's ${printer.maxWidthMm} mm. Artwork wider than this is flagged.`)}
        {num("gangGapMm", "Gang sheet gap", "mm", "Space between transfers for cutting.")}
        {num("gangMarginMm", "Gang sheet edge", "mm", "Unprinted margin at the film edges.")}
        <label className="block">
          <span className="mb-1 block text-[12px] text-[var(--text-2)]">Shop name</span>
          <input className="dtf-input" value={s.shopName} onChange={(e) => setS({ ...s, shopName: e.target.value })} />
          <span className="mt-1 block text-[11.5px] text-[var(--text-3)]">On order emails.</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-[12px] text-[var(--text-2)]">Pickup note</span>
          <textarea className="dtf-input" rows={2} value={s.pickupNote} onChange={(e) => setS({ ...s, pickupNote: e.target.value })} />
        </label>
      </div>
      <div className="mt-5 rounded-[12px] bg-white/[0.03] p-3 text-[12px] text-[var(--text-3)]">
        Set in {printer.rip}, not here: {printer.ripOwns.join(" · ")}.
      </div>
      <button
        className="dtf-btn primary mt-5"
        onClick={async () => {
          try {
            const r = await admin.saveSettings(s);
            setS(r.settings);
            onSaved(r.settings);
            notify("Settings saved.", "ok");
          } catch (e) {
            notify(e instanceof Error ? e.message : "Couldn't save.", "error");
          }
        }}
      >
        Save settings
      </button>
    </section>
  );
}
