"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, ExternalLink, Loader2, Minus, PackageCheck, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, loadBag, saveBag, type BagLine, hydrateDraft, serializeDraft } from "@/lib/dtf/client";
import { getColor, getGarment } from "@/lib/dtf/garments";
import { STAGES, STATUS_LABEL, stageIndex } from "@/lib/dtf/pipeline";
import { FREE_SHIPPING_FROM_CENTS, money, quote, shippingFor } from "@/lib/dtf/pricing";
import { newProject } from "@/lib/dtf/project";
import type { CustomerOrderView, DesignProject, ShippingDetails } from "@/lib/dtf/types";
import FlatThumb from "./FlatThumb";
import { useStudio } from "./useStudio";

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex justify-end" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
          <motion.aside
            role="dialog"
            aria-label={title}
            className={`dtf-glass relative m-0 flex h-full w-full flex-col sm:m-3 sm:h-[calc(100%-24px)] sm:rounded-[var(--r-lg)] ${wide ? "sm:w-[560px]" : "sm:w-[440px]"}`}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
          >
            <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
              <h2 className="serif text-[24px] text-white">{title}</h2>
              <button className="dtf-icon" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="dtf-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ----- Bag + checkout --------------------------------------------------------------

export function useBag() {
  const [lines, setLines] = useState<BagLine[]>([]);
  useEffect(() => {
    (async () => {
      const raw = loadBag();
      const hydrated = await Promise.all(raw.map(async (l) => ({ ...l, project: (await hydrateDraft(JSON.stringify(l.project))) ?? l.project })));
      setLines(hydrated);
    })();
  }, []);
  const update = (next: BagLine[]) => {
    setLines(next);
    saveBag(next);
  };
  return { lines, update };
}

const EMPTY_SHIP: ShippingDetails = { method: "ship", name: "", line1: "", city: "", region: "", postal: "", country: "US" };

export function BagSheet({ open, onClose, bag }: { open: boolean; onClose: () => void; bag: ReturnType<typeof useBag> }) {
  const s = useStudio();
  const [ship, setShip] = useState<ShippingDetails>(EMPTY_SHIP);
  const [note, setNote] = useState("");
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CustomerOrderView | null>(null);
  const subtotal = bag.lines.reduce((sum, l) => sum + quote(l.project).unitCents * l.quantity, 0);
  const shipping = shippingFor(subtotal, ship.method);
  const signedIn = Boolean(s.caps?.signedIn);

  const place = async () => {
    setError(null);
    setPlacing("Uploading your artwork…");
    try {
      // Every image the order needs must be a stored file first.
      const lines = [];
      for (const line of bag.lines) {
        const p: DesignProject = JSON.parse(serializeDraft(line.project));
        const live = (await hydrateDraft(JSON.stringify(p))) ?? p;
        const layers = [];
        for (const l of live.layers) {
          if (l.kind === "image" && !l.src.startsWith("/api/dtf/assets/")) {
            const blob = await fetch(l.src).then((r) => r.blob());
            const { asset } = await api.upload(blob, l.origin === "ai" ? "ai" : l.origin === "processed" ? "processed" : "original", `${l.name}.png`);
            layers.push({ ...l, assetId: asset.id, src: asset.url });
          } else layers.push(l);
        }
        const mockups: Record<string, string> = {};
        if (line.thumb) {
          const blob = await fetch(line.thumb).then((r) => r.blob());
          const { asset } = await api.upload(blob, "mockup", "mockup-front.png");
          mockups.front = asset.id;
        }
        lines.push({ project: { ...live, layers }, quantity: line.quantity, mockups, readiness: line.readiness });
      }
      setPlacing("Placing your order…");
      const { order, checkoutUrl } = await api.checkout({ lines, shipping: ship, note });
      bag.update([]);
      if (checkoutUrl) {
        setPlacing("Opening secure checkout…");
        window.location.href = checkoutUrl;
        return;
      }
      setDone(order);
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Something went wrong placing the order.");
    } finally {
      setPlacing(null);
    }
  };

  const field = (k: keyof ShippingDetails, label: string, opts: { half?: boolean; auto?: string } = {}) => (
    <label className={opts.half ? "col-span-1" : "col-span-2"}>
      <span className="mb-1 block text-[11px] text-[var(--text-3)]">{label}</span>
      <input className="dtf-input" autoComplete={opts.auto} value={(ship[k] as string) ?? ""} onChange={(e) => setShip({ ...ship, [k]: e.target.value })} />
    </label>
  );

  return (
    <Sheet open={open} onClose={onClose} title={done ? "Order placed" : "Your bag"}>
      {done ? (
        <div className="p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-[rgba(91,227,164,0.12)] text-[var(--ok)]">
              <PackageCheck className="h-5 w-5" />
            </span>
            <div>
              <div className="mono text-[18px] text-white">{done.number}</div>
              <div className="text-[12.5px] text-[var(--text-2)]">{money(done.payment.amountCents)} · {done.items.length} design{done.items.length > 1 ? "s" : ""}</div>
            </div>
          </div>
          <p className="mt-4 text-[13px] leading-relaxed text-[var(--text-2)]">
            {done.payment.state === "paid"
              ? "Paid. A person checks every design before it prints — you'll see each step on the tracking page."
              : "Card payments aren't connected to this shop yet, so nothing was charged. The shop will contact you to arrange payment before your order prints."}
          </p>
          <button className="dtf-btn primary mt-5 w-full" onClick={() => (onClose(), (window.location.search = `?order=${done.id}`))}>
            Track this order
          </button>
        </div>
      ) : !bag.lines.length ? (
        <div className="grid place-items-center px-6 py-20 text-center">
          <ShoppingBag className="h-6 w-6 text-[var(--text-3)]" />
          <p className="mt-3 text-[14px] text-white">Your bag is empty.</p>
          <p className="mt-1 text-[12.5px] text-[var(--text-3)]">Design something, then Add to bag — each design keeps its own size and colour.</p>
        </div>
      ) : (
        <div className="pb-6">
          <ul className="divide-y divide-[var(--line)]">
            {bag.lines.map((l) => {
              const g = getGarment(l.project.garmentId);
              const q = quote(l.project);
              return (
                <li key={l.id} className="flex gap-3 px-5 py-4">
                  <div className="grid h-[92px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-black/30">
                    {l.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <FlatThumb project={l.project} width={64} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold text-white">{l.project.name}</div>
                    <div className="text-[12px] text-[var(--text-2)]">
                      {g.name} · {getColor(g, l.project.colorId).name} · {l.project.size}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[var(--text-3)]">{q.printed.length} print location{q.printed.length === 1 ? "" : "s"}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="dtf-seg items-center">
                        <button className="dtf-icon !h-7 !w-7" aria-label="One fewer" onClick={() => bag.update(bag.lines.map((x) => (x.id === l.id ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x)))}>
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="mono w-6 text-center text-[12.5px]">{l.quantity}</span>
                        <button className="dtf-icon !h-7 !w-7" aria-label="One more" onClick={() => bag.update(bag.lines.map((x) => (x.id === l.id ? { ...x, quantity: Math.min(50, x.quantity + 1) } : x)))}>
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <button className="dtf-icon !h-7 !w-7" aria-label="Remove from bag" onClick={() => bag.update(bag.lines.filter((x) => x.id !== l.id))}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <span className="mono ml-auto text-[13px] text-white">{money(q.unitCents * l.quantity)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="space-y-4 border-t border-[var(--line)] px-5 pt-5">
            <div className="dtf-seg w-full">
              {(["ship", "pickup"] as const).map((m) => (
                <button key={m} className="dtf-tab flex-1" aria-selected={ship.method === m} onClick={() => setShip({ ...ship, method: m })}>
                  {m === "ship" ? "Ship to me" : "Local pickup"}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {field("name", "Full name", { auto: "name" })}
              {ship.method === "ship" && (
                <>
                  {field("line1", "Street address", { auto: "address-line1" })}
                  {field("line2", "Apartment, suite (optional)", { auto: "address-line2" })}
                  {field("city", "City", { half: true, auto: "address-level2" })}
                  {field("region", "State / region", { half: true, auto: "address-level1" })}
                  {field("postal", "Postcode", { half: true, auto: "postal-code" })}
                  {field("country", "Country (2 letters)", { half: true, auto: "country" })}
                </>
              )}
              {field("phone", "Phone (optional)", { auto: "tel" })}
            </div>
            {ship.method === "pickup" && s.caps?.pickupNote && <p className="text-[12px] text-[var(--text-3)]">{s.caps.pickupNote}</p>}
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--text-3)]">Note for the print shop (optional)</span>
              <textarea className="dtf-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} />
            </label>

            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between text-[var(--text-2)]">
                <dt>Subtotal</dt>
                <dd className="mono">{money(subtotal)}</dd>
              </div>
              <div className="flex justify-between text-[var(--text-2)]">
                <dt>{ship.method === "pickup" ? "Pickup" : subtotal >= FREE_SHIPPING_FROM_CENTS ? "Shipping (free over $75)" : "Shipping"}</dt>
                <dd className="mono">{shipping ? money(shipping) : "Free"}</dd>
              </div>
              <div className="flex justify-between pt-1 text-[15px] text-white">
                <dt>Total</dt>
                <dd className="mono">{money(subtotal + shipping)}</dd>
              </div>
            </dl>

            {s.caps?.payments === "manual" && <p className="rounded-[10px] bg-white/[0.04] p-3 text-[12px] leading-relaxed text-[var(--text-2)]">Card payments aren&apos;t connected to this shop yet. Placing the order charges nothing — the shop confirms payment with you before printing.</p>}
            {s.caps?.payments === "stripe-test" && <p className="rounded-[10px] bg-[rgba(245,197,107,0.08)] p-3 text-[12px] text-[var(--warn)]">Stripe is in test mode — no real money moves.</p>}
            {error && <p className="text-[12.5px] text-[var(--block)]">{error}</p>}

            {signedIn ? (
              <button className="dtf-btn primary h-11 w-full text-[14px]" disabled={Boolean(placing)} onClick={place}>
                {placing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {placing}
                  </>
                ) : s.caps?.payments === "manual" ? (
                  "Place order"
                ) : (
                  <>
                    Continue to payment <ExternalLink className="h-3.5 w-3.5" />
                  </>
                )}
              </button>
            ) : (
              <a className="dtf-btn primary h-11 w-full text-[14px]" href="/login?next=/apps/dtf-studio">
                Sign in to check out
              </a>
            )}
            <p className="text-center text-[11px] text-[var(--text-3)]">
              Custom prints are made to order. <a className="underline" href="/legal/dtf-terms">Terms of sale &amp; artwork rights</a>
            </p>
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ----- Saved designs -------------------------------------------------------------------

export function DesignsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStudio();
  const [projects, setProjects] = useState<DesignProject[] | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  useEffect(() => {
    if (!open || !s.caps?.signedIn) return;
    api.projects()
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
  }, [open, s.caps?.signedIn]);
  return (
    <Sheet open={open} onClose={onClose} title="Your designs" wide>
      <div className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[12.5px] text-[var(--text-3)]">{s.caps?.signedIn ? "Saved to your account automatically." : "Saved on this device. Sign in to keep designs across devices."}</p>
          <button
            className="dtf-btn sm"
            onClick={() => {
              s.loadProject(newProject(s.project.garmentId, s.project.colorId));
              onClose();
            }}
          >
            <Plus className="h-3.5 w-3.5" /> New design
          </button>
        </div>
        {!s.caps?.signedIn ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <DesignCard p={s.project} current onOpen={onClose} />
          </div>
        ) : projects === null ? (
          <div className="grid place-items-center py-16 text-[var(--text-3)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !projects.length ? (
          <p className="py-12 text-center text-[13px] text-[var(--text-3)]">No saved designs yet — the one you&apos;re working on saves itself as soon as it has artwork.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {projects.map((p) => (
              <DesignCard
                key={p.id}
                p={p}
                current={p.id === s.project.id}
                onOpen={() => {
                  s.loadProject(p);
                  onClose();
                }}
                onDelete={async () => {
                  await api.deleteProject(p.id).catch(() => null);
                  setProjects((x) => x?.filter((y) => y.id !== p.id) ?? null);
                }}
              />
            ))}
          </div>
        )}
        {s.caps?.signedIn && !s.caps.local && (
          <div className="mt-8 border-t border-[var(--line)] pt-5">
            <div className="dtf-label">Your data</div>
            {!confirmWipe ? (
              <button className="dtf-btn sm danger mt-2" onClick={() => setConfirmWipe(true)}>
                Delete my designs and uploads
              </button>
            ) : (
              <div className="mt-2 rounded-[12px] border border-[rgba(255,122,122,0.3)] p-3 text-[12.5px] text-[var(--text-2)]">
                This permanently deletes every saved design and uploaded file. Files on orders the shop still has to make are kept with those orders.
                <div className="mt-2 flex gap-2">
                  <button
                    className="dtf-btn sm danger"
                    onClick={async () => {
                      const r = await api.deleteAccountData().catch((e) => (s.notify(e.message, "error"), null));
                      if (r) s.notify(`Deleted ${r.projects} designs and ${r.files} files${r.keptForOrders ? ` (${r.keptForOrders} kept for orders)` : ""}.`, "ok");
                      setProjects([]);
                      setConfirmWipe(false);
                    }}
                  >
                    Delete permanently
                  </button>
                  <button className="dtf-btn sm ghost" onClick={() => setConfirmWipe(false)}>
                    Keep everything
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function DesignCard({ p, current, onOpen, onDelete }: { p: DesignProject; current?: boolean; onOpen: () => void; onDelete?: () => void }) {
  const g = getGarment(p.garmentId);
  return (
    <div className={`group overflow-hidden rounded-[14px] border ${current ? "border-[rgba(94,225,255,0.45)]" : "border-[var(--line)]"} bg-white/[0.02]`}>
      <button className="dtf-stage grid aspect-[4/5] w-full place-items-center" onClick={onOpen} aria-label={`Open ${p.name}`}>
        <FlatThumb project={p} width={120} />
      </button>
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] text-white">{p.name}</div>
          <div className="truncate text-[11px] text-[var(--text-3)]">
            {g.name} · {new Date(p.updatedAt).toLocaleDateString()}
          </div>
        </div>
        {current && <Check className="h-3.5 w-3.5 text-[var(--accent)]" />}
        {onDelete && !current && (
          <button className="dtf-icon !h-7 !w-7 opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${p.name}`} onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ----- Orders ------------------------------------------------------------------------------

export function OrdersSheet({ open, onClose, focus }: { open: boolean; onClose: () => void; focus: { id: string; session: string | null } | null }) {
  const s = useStudio();
  const [orders, setOrders] = useState<CustomerOrderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !s.caps?.signedIn) return;
    (async () => {
      try {
        if (focus) await api.order(focus.id, focus.session).catch(() => null);
        const r = await api.orders();
        setOrders(r.orders);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load your orders.");
        setOrders([]);
      }
    })();
  }, [open, s.caps?.signedIn, focus]);
  return (
    <Sheet open={open} onClose={onClose} title="Your orders" wide>
      <div className="p-5">
        {!s.caps?.signedIn ? (
          <div className="py-10 text-center">
            <p className="text-[13px] text-[var(--text-2)]">Sign in to see your orders.</p>
            <a className="dtf-btn primary mt-3" href="/login?next=/apps/dtf-studio">
              Sign in
            </a>
          </div>
        ) : orders === null ? (
          <div className="grid place-items-center py-16 text-[var(--text-3)]">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-[13px] text-[var(--block)]">{error}</p>
        ) : !orders.length ? (
          <p className="py-12 text-center text-[13px] text-[var(--text-3)]">No orders yet.</p>
        ) : (
          <div className="space-y-4">
            {orders.map((o) => (
              <OrderCard key={o.id} o={o} highlight={focus?.id === o.id} />
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function OrderCard({ o, highlight }: { o: CustomerOrderView; highlight: boolean }) {
  const at = stageIndex(o.status);
  return (
    <article className={`rounded-[16px] border p-4 ${highlight ? "border-[rgba(94,225,255,0.45)] bg-[var(--accent-soft)]" : "border-[var(--line)] bg-white/[0.02]"}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mono text-[15px] text-white">{o.number}</div>
          <div className="text-[12px] text-[var(--text-3)]">
            {new Date(o.createdAt).toLocaleDateString()} · {money(o.payment.amountCents)} · {o.payment.state === "paid" ? "Paid" : o.payment.state === "refunded" ? "Refunded" : "Awaiting payment"}
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11.5px] ${o.status === "cancelled" ? "bg-[rgba(255,122,122,0.12)] text-[var(--block)]" : "bg-white/[0.06] text-[var(--text)]"}`}>{o.status === "cancelled" ? "Cancelled" : (STAGES[at]?.customer ?? STATUS_LABEL[o.status])}</span>
      </div>
      {o.status !== "cancelled" && (
        <ol className="mt-4 grid grid-cols-8 gap-1" aria-label="Progress">
          {STAGES.map((st, i) => (
            <li key={st.id} title={st.customer} className={`h-1.5 rounded-full ${i <= at ? "bg-[var(--accent)]" : "bg-white/[0.08]"}`} />
          ))}
        </ol>
      )}
      <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
        {o.items.map((it) => (
          <div key={it.id} className="w-[92px] shrink-0">
            <div className="dtf-stage grid aspect-[4/5] place-items-center rounded-[10px]">
              <FlatThumb project={it.project} width={70} />
            </div>
            <div className="mt-1 truncate text-[11px] text-[var(--text-2)]">
              {getGarment(it.garmentId).name} · {it.size} × {it.quantity}
            </div>
          </div>
        ))}
      </div>
      {o.trackingNumber && (
        <p className="mt-3 text-[12px] text-[var(--text-2)]">
          Tracking: <span className="mono text-white">{o.trackingNumber}</span>
        </p>
      )}
      <details className="mt-3 text-[12px] text-[var(--text-3)]">
        <summary className="cursor-pointer text-[var(--text-2)]">History</summary>
        <ul className="mt-2 space-y-1">
          {o.history.map((h, i) => (
            <li key={i}>
              <span className="mono">{new Date(h.at).toLocaleString()}</span> — {h.message}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}
