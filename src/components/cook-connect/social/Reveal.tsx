"use client";

// Scroll-reveal for feeds and grids: each item rises in as it scrolls into
// view, staggered a little by position. Reduced motion (device or the app's own
// setting) shows everything at once — see .cc-reveal in cook-connect.css.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "../ui";

export function Reveal({
  children, index = 0, className, as: Tag = "div",
}: { children: ReactNode; index?: number; className?: string; as?: "div" | "li" | "article" }) {
  const ref = useRef<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      data-seen={seen ? "" : undefined}
      className={cx("cc-reveal", className)}
      style={{ ["--cc-delay" as string]: `${Math.min(index % 6, 5) * 55}ms` }}
    >
      {children}
    </Tag>
  );
}
