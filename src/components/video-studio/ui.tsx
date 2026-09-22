"use client";

import type { ReactNode } from "react";
import { CAPABILITY_LABEL, type Capability, type CapabilityState } from "@/lib/video-studio/types";

// Small shared pieces. Everything here is presentational — no fetching, no
// state — so the four screens stay readable.

/** The dot + word that says what a method's dependencies really are. */
export function CapabilityBadge({ capability }: { capability: Capability | undefined }) {
  const state: CapabilityState = capability?.state ?? "not-connected";
  return (
    <span className={`vsa-cap is-${state}`}>
      <i aria-hidden />
      {CAPABILITY_LABEL[state]}
    </span>
  );
}

export function Panel({
  title,
  hint,
  actions,
  children,
  className = "",
}: {
  title?: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`vsa-panel ${className}`}>
      {(title || actions) && (
        <header className="vsa-panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {hint && <p>{hint}</p>}
          </div>
          {actions && <div className="vsa-panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="vsa-field">
      <span className="vsa-field-label">
        {label}
        {hint && <em>{hint}</em>}
      </span>
      {children}
    </label>
  );
}

/** A row of mutually exclusive choices. Used for aspect, narration and mode. */
export function Choices<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { id: T; label: string; blurb?: string }[];
  onChange: (value: T) => void;
  name: string;
}) {
  return (
    <div className="vsa-choices" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={`vsa-choice ${value === option.id ? "is-on" : ""}`}
          onClick={() => onChange(option.id)}
        >
          <strong>{option.label}</strong>
          {option.blurb && <span>{option.blurb}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="vsa-empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** The animated mark on a method card. Two hues, no image assets. */
export function MethodMark({ hue, size = 44 }: { hue: [number, number]; size?: number }) {
  const [a, b] = hue;
  return (
    <span
      className="vsa-mark"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(from 210deg, hsl(${a} 85% 60%), hsl(${b} 85% 62%), hsl(${a} 85% 60%))`,
      }}
      aria-hidden
    >
      <i style={{ background: `radial-gradient(circle at 34% 30%, hsl(${b} 90% 72% / 0.9), transparent 62%)` }} />
    </span>
  );
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
