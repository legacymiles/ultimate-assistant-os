"use client";

// Shared primitives for every lab section. Styles live in lab.css under .h3l.

import { useEffect, useState, type ReactNode } from "react";
import type { DimensionScore, Generation } from "@/lib/h3-lab/model";

export function SectionHead({ eyebrow, title, lede, actions }: { eyebrow: string; title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sec-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {lede ? <p>{lede}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function Panel({ title, meta, actions, children, className, bodyClass }: { title?: ReactNode; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`panel ${className ?? ""}`}>
      {title || actions ? (
        <div className="panel-head">
          {title ? <h2>{title}</h2> : null}
          {meta ? <span className="muted mono" style={{ fontSize: 11 }}>{meta}</span> : null}
          <span className="grow" />
          {actions}
        </div>
      ) : null}
      <div className={bodyClass ?? "panel-body"}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export type Tone = "amber" | "cyan" | "good" | "bad" | "warn" | undefined;

export function Chip({ tone, children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`chip ${tone ?? ""}`} title={title}>
      {children}
    </span>
  );
}

/** A 0..10 score bar coloured by value. */
export function ScoreBar({ value, width = 80 }: { value: number | null | undefined; width?: number }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="muted mono">—</span>;
  const color = value >= 7.5 ? "var(--good)" : value >= 5 ? "var(--warn)" : "var(--bad)";
  return (
    <span className="row" style={{ gap: 7, flexWrap: "nowrap" }}>
      <span className="bar" style={{ width }}>
        <i style={{ width: `${Math.max(0, Math.min(10, value)) * 10}%`, background: color }} />
      </span>
      <span className="mono" style={{ fontSize: 11.5, minWidth: 26 }}>{value.toFixed(1)}</span>
    </span>
  );
}

/** A signed delta with sign colour. */
export function Delta({ value, digits = 1 }: { value: number | null | undefined; digits?: number }) {
  if (value === null || value === undefined || Number.isNaN(value)) return <span className="muted mono">—</span>;
  const color = value > 0.05 ? "var(--good)" : value < -0.05 ? "var(--bad)" : "var(--ink-3)";
  return <span className="mono" style={{ color }}>{value > 0 ? "+" : ""}{value.toFixed(digits)}</span>;
}

export function ScoreSource({ s }: { s?: DimensionScore }) {
  if (!s) return null;
  const tone: Tone = s.source === "owner" ? "amber" : s.source === "vision" ? "cyan" : undefined;
  return <Chip tone={tone} title={s.evidence}>{s.source} {(s.confidence * 100).toFixed(0)}%</Chip>;
}

export function StatusChip({ status }: { status: Generation["status"] | string }) {
  const tone: Tone =
    status === "done" || status === "concluded" || status === "approved" ? "good"
      : status === "failed" || status === "rejected" || status === "cancelled" ? "bad"
        : status === "rendering" || status === "running" || status === "claimed" ? "cyan"
          : status === "pending" || status === "queued" || status === "evaluating" ? "warn"
            : undefined;
  return <Chip tone={tone}>{status}</Chip>;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Frames of a generation, fetched from their own doc. */
export function useFrames(genId: string | null | undefined, count: number | undefined): string[] {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    setFrames([]);
    if (!genId || !count) return;
    let alive = true;
    fetch(`/api/h3-lab/frames?gen=${encodeURIComponent(genId)}`)
      .then((r) => (r.ok ? r.json() : { frames: [] }))
      .then((j: { frames?: string[] }) => {
        if (alive) setFrames(j.frames ?? []);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [genId, count]);
  return frames;
}

/** URL that plays a generation's clip (redirects to a signed Storage URL, or streams from this PC). */
export function clipUrl(genId: string): string {
  return `/api/h3-lab/clip?gen=${encodeURIComponent(genId)}`;
}

/**
 * Tiny markdown renderer for the guide's own sections — headings, lists,
 * bold, code, fenced code, blockquotes and pipe tables. The guide is our own
 * text, but everything is still escaped before formatting.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

export function renderMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(buf.join("\n"))}</pre>`);
      continue;
    }
    if (/^\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^-+$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        `<table><thead><tr>${(head ?? []).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }
    if (/^#{1,3} /.test(line)) {
      out.push(`<h3>${inline(line.replace(/^#+ /, ""))}</h3>`);
      i++;
      continue;
    }
    if (/^> /.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^> ?/.test(lines[i])) buf.push(lines[i++].replace(/^> ?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(line)) {
      const ordered = /^\d+\. /.test(line);
      const buf: string[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) buf.push(lines[i++].replace(/^(- |\d+\. )/, ""));
      out.push(`<${ordered ? "ol" : "ul"}>${buf.map((b) => `<li>${inline(b)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|- |\d+\. |> |\||```)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("");
}

/** Word-level diff for the live compiler: returns HTML with <mark> for added and <del> for removed. */
export function diffWords(before: string, after: string): string {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const n = a.length;
  const m = b.length;
  // LCS table on tokens — prompts are a few thousand tokens at most.
  if (n * m > 4_000_000) return esc(after);
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(esc(b[j]));
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      if (a[i].trim()) out.push(`<del>${esc(a[i])}</del>`);
      i++;
    } else {
      out.push(b[j].trim() ? `<mark>${esc(b[j])}</mark>` : esc(b[j]));
      j++;
    }
  }
  while (j < m) out.push(b[j].trim() ? `<mark>${esc(b[j++])}</mark>` : esc(b[j++]));
  while (i < n) {
    if (a[i].trim()) out.push(`<del>${esc(a[i])}</del>`);
    i++;
  }
  return out.join("");
}
