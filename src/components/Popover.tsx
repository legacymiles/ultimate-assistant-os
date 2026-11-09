"use client";

// ---------------------------------------------------------------------------
// One anchored popover layer for every dropdown on the site.
//
// Why this exists: a dropdown written as `absolute … z-30` inside the thing it
// drops out of is at the mercy of its ancestors. One `backdrop-filter`, one
// `transform`, one `overflow: hidden` anywhere above it and the panel is
// trapped in that stacking context — so the page's own chips, banners and
// hint rows paint straight over it, and the panel looks see-through. The chat
// composer does exactly that (it is a blurred glass bar), which is why the
// model picker read as a ghost.
//
// The cure is to stop nesting. This renders the panel in a portal on <body>,
// positions it `fixed` against the trigger's rect, and flips it above when
// there is no room below. Being outside the HUD skin it also picks up the
// opaque base tokens instead of the skin's translucent ones, so a dropdown is
// always solid ground — see .popover-panel in globals.css.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Smallest panel worth opening downward before we flip it up instead. */
const MIN_ROOM = 220;
/** Breathing room between the trigger and the panel, and from the viewport. */
const GAP = 6;
const EDGE = 8;

export type PopoverAlign = "start" | "end";
export type PopoverPlacement = "auto" | "up" | "down";

interface Pos {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  width?: number;
}

export interface PopoverProps {
  open: boolean;
  /** The element the panel hangs off — usually the button that opened it. */
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  /** Which edge of the trigger the panel lines up with. */
  align?: PopoverAlign;
  /** "auto" flips the panel above the trigger when the page runs out of room. */
  placement?: PopoverPlacement;
  /** A pixel width, or "anchor" to match the trigger. Omit to size to content. */
  width?: number | "anchor";
  /** Extra classes for the panel itself; .popover-panel is always applied. */
  className?: string;
  /** Label for assistive tech when the panel is a menu or listbox. */
  label?: string;
  role?: "menu" | "listbox" | "dialog";
}

export function Popover({
  open,
  anchor,
  onClose,
  children,
  align = "start",
  placement = "auto",
  width,
  className = "",
  label,
  role = "dialog",
}: PopoverProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [skin, setSkin] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const a = anchor.current;
    const p = panel.current;
    if (!a || !p) return;
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const wanted = p.scrollHeight;
    const up =
      placement === "up" ||
      (placement === "auto" && below < Math.min(wanted, MIN_ROOM) && above > below);

    const room = vw - EDGE * 2;
    const asked = width === "anchor" ? r.width : typeof width === "number" ? width : p.offsetWidth;
    const w = Math.min(asked, room);
    let left = align === "end" ? r.right - w : r.left;
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - w - EDGE));

    setPos({
      left,
      top: up ? undefined : r.bottom + GAP,
      bottom: up ? vh - r.top + GAP : undefined,
      maxHeight: Math.max(160, up ? above : below),
      width: width === undefined ? undefined : w,
    });
  }, [anchor, align, placement, width]);

  // Inherit the surrounding skin (the cyan HUD, say) so a portalled panel still
  // belongs to the page it came from. Classes only — the tokens that decide
  // opacity live on .popover-panel.
  useLayoutEffect(() => {
    if (!open) return;
    const themed = anchor.current?.closest<HTMLElement>("[data-skin]");
    setSkin(themed?.dataset.skin ?? null);
  }, [open, anchor]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => place()) : null;
    if (panel.current && ro) ro.observe(panel.current);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      ro?.disconnect();
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [open, onClose, anchor]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="popover-layer" data-skin={skin ?? undefined}>
      <div
        ref={panel}
        role={role}
        aria-label={label}
        className={`popover-panel ${className}`}
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top,
          bottom: pos?.bottom,
          maxHeight: pos?.maxHeight,
          width: pos?.width,
          // Hidden for the first paint only — we need a measurement before we
          // know whether the panel opens up or down.
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
