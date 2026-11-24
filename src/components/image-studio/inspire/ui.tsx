"use client";

// Inspire's small kit: the DNA chip, a modal, a popover menu, the collection
// picker, the tinted lazy image. Every screen builds from these, so a chip
// looks and behaves the same under an image, in the Builder and in the Library.

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, FolderPlus, X } from "lucide-react";
import { categoryOf, groupOf, hueOf } from "@/lib/image-studio/inspire/taxonomy";
import type { Chip, InspireImage, LibraryItem } from "@/lib/image-studio/inspire/types";
import { useInspire } from "./store";

// ----- chip ------------------------------------------------------------------

export function chipStyle(chip: Pick<Chip, "category">): CSSProperties {
  return { ["--h" as string]: String(hueOf(chip.category)) } as CSSProperties;
}

interface ChipProps {
  chip: Chip;
  pressed?: boolean;
  small?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  /** Hover explanation on/off (default on). */
  tip?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

/** One prompt ingredient. Glows in its group's hue; hover says what it does. */
export function DnaChip({ chip, pressed, small, onClick, onRemove, tip = true, className = "", style, children, ...drag }: ChipProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = () => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(window.innerWidth - 296, Math.max(8, r.left)), y: r.bottom + 8 > window.innerHeight - 120 ? r.top - 92 : r.bottom + 8 });
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`insp-chip ${small ? "insp-chip-sm" : ""} ${className}`}
        style={{ ...chipStyle(chip), ...style }}
        aria-pressed={pressed === undefined ? undefined : pressed}
        onClick={onClick}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        onFocus={show}
        onBlur={() => setPos(null)}
        {...drag}
      >
        <span>{chip.text}</span>
        {children}
        {onRemove && (
          <span
            role="button"
            tabIndex={-1}
            aria-label={`Remove ${chip.text}`}
            className="insp-chip-x"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <X size={11} />
          </span>
        )}
      </button>
      {pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="insp-tip" style={{ left: pos.x, top: pos.y }} role="tooltip">
            <span className="insp-kicker" style={{ color: `oklch(0.8 0.13 ${hueOf(chip.category)})` }}>
              {groupOf(chip.category).label} · {categoryOf(chip.category).label}
            </span>
            {chip.why || groupOf(chip.category).role}
          </div>,
          document.body,
        )}
    </>
  );
}

// ----- modal -----------------------------------------------------------------

export function Modal({ open, onClose, children, wide, label }: { open: boolean; onClose: () => void; children: ReactNode; wide?: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => ref.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="insp">
      <div className="insp-overlay" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={`insp-modal ${wide ? "insp-modal-wide" : ""}`} style={{ outline: "none" }}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ----- popover menu ----------------------------------------------------------

/** A button that opens a small menu. `children` gets a close function. */
export function Menu({ trigger, children, align = "right", label }: { trigger: (open: () => void, expanded: boolean) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const w = 240;
    const left = align === "right" ? Math.max(8, r.right - w) : Math.min(window.innerWidth - w - 8, r.left);
    const top = r.bottom + 6 + 320 > window.innerHeight ? Math.max(8, r.top - 6 - Math.min(320, menu.current?.offsetHeight ?? 200)) : r.bottom + 6;
    setPos({ top, left });
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setOpen(false);
        return;
      }
      if (!menu.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);
  return (
    <span ref={anchor} style={{ display: "inline-flex" }} aria-controls={open ? id : undefined}>
      {trigger(() => setOpen((o) => !o), open)}
      {open &&
        createPortal(
          <div className="insp">
            <div ref={menu} id={id} role="menu" aria-label={label} className="insp-menu" style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: 240, maxHeight: 340, overflow: "auto" }}>
              {children(() => setOpen(false))}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}

// ----- collections -----------------------------------------------------------

/** Tick-box list of collections plus "New collection". Calls onChange with the full set. */
export function CollectionChecklist({ selected, onChange, onCreated }: { selected: string[]; onChange: (ids: string[]) => void; onCreated?: (id: string) => void }) {
  const { lib, createCollection } = useInspire();
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const c = await createCollection(n);
    if (c) {
      setName("");
      setAdding(false);
      onChange([...selected, c.id]);
      onCreated?.(c.id);
    }
  };
  return (
    <div>
      <div className="insp-kicker" style={{ padding: "6px 10px 4px" }}>
        Collections
      </div>
      {lib.collections.length === 0 && !adding && <div className="insp-faint" style={{ padding: "2px 10px 8px", fontSize: 12.5 }}>No collections yet.</div>}
      {lib.collections.map((c) => {
        const on = selected.includes(c.id);
        return (
          <button key={c.id} type="button" role="menuitemcheckbox" aria-checked={on} className="insp-menu-item" onClick={() => toggle(c.id)}>
            <span style={{ width: 16, height: 16, borderRadius: 5, border: "1px solid var(--line-2)", display: "grid", placeItems: "center", background: on ? "var(--ink)" : "transparent", color: "#0a0a0c" }}>
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
          </button>
        );
      })}
      <div className="insp-menu-sep" />
      {adding ? (
        <form
          style={{ display: "flex", gap: 6, padding: 4 }}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input autoFocus className="insp-input" style={{ height: 32 }} value={name} onChange={(e) => setName(e.target.value)} placeholder="T-shirt Ideas" maxLength={60} aria-label="Collection name" />
          <button className="insp-btn insp-btn-sm insp-btn-primary" type="submit">
            Add
          </button>
        </form>
      ) : (
        <button type="button" className="insp-menu-item" onClick={() => setAdding(true)}>
          <FolderPlus size={15} /> New collection
        </button>
      )}
    </div>
  );
}

/** "Add to collection" menu for any saved library item. */
export function CollectionMenu({ item, children }: { item: LibraryItem; children: (open: () => void) => ReactNode }) {
  const { setItemCollections } = useInspire();
  return (
    <Menu label="Collections" trigger={(open) => children(open)}>
      {() => <CollectionChecklist selected={item.collectionIds} onChange={(ids) => void setItemCollections(item, ids)} />}
    </Menu>
  );
}

// ----- images ------------------------------------------------------------------

/** A tinted, lazy, fade-in image that never shifts layout. */
export function Shot({ img, full, className = "", style, alt, fit = "cover" }: { img: Pick<InspireImage, "src" | "thumb" | "tint" | "width" | "height" | "title">; full?: boolean; className?: string; style?: CSSProperties; alt?: string; fit?: "cover" | "contain" }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth) setLoaded(true);
  }, []);
  return (
    <img
      ref={ref}
      src={full ? img.src : img.thumb}
      alt={alt ?? img.title}
      loading={full ? "eager" : "lazy"}
      decoding="async"
      width={img.width}
      height={img.height}
      data-loaded={loaded}
      onLoad={() => setLoaded(true)}
      className={className}
      style={{ background: img.tint || "var(--raise)", objectFit: fit, transition: "opacity .5s", opacity: loaded ? 1 : 0.001, ...style }}
    />
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="insp-spin" style={{ width: size, height: size }} aria-hidden />;
}

export function Empty({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="insp-empty">
      {icon && <div style={{ opacity: 0.7 }}>{icon}</div>}
      <div className="insp-h2" style={{ fontSize: 18 }}>
        {title}
      </div>
      {body && <p style={{ maxWidth: 420, margin: 0, fontSize: 13.5 }}>{body}</p>}
      {action}
    </div>
  );
}

/** Masonry columns: places each item in the shortest column by aspect ratio. */
export function useColumns(ref: React.RefObject<HTMLElement | null>, min = 236): number {
  const [n, setN] = useState(4);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      setN(w < 520 ? 2 : Math.max(2, Math.min(6, Math.floor((w + 14) / (min + 14)))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, min]);
  return n;
}

export function layoutMasonry<T extends { width: number; height: number }>(items: T[], cols: number): T[][] {
  const out: T[][] = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);
  for (const it of items) {
    let k = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[k] - 0.01) k = i;
    out[k].push(it);
    heights[k] += it.height / Math.max(1, it.width) + 0.06;
  }
  return out;
}
