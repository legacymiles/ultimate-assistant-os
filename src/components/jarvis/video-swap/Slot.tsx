"use client";

// A placeholder an upload lands in: click to choose, drop a file on it, or
// paste while it has focus. Shows the picture once it's there, with a remove
// button. Every image slot in Custom Video Swap is one of these.

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "../../icons";

export function Slot({
  src,
  label,
  hint,
  icon,
  tag,
  accept = "image/*",
  onFile,
  onClear,
  className = "",
  ariaLabel,
}: {
  src?: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  tag?: string;
  accept?: string;
  onFile: (file: File) => void;
  onClear?: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pickFrom = (list: FileList | null | undefined) => {
    const f = Array.from(list ?? []).find((x) => accept === "*" || x.type.startsWith(accept.replace("/*", "/")));
    if (f) onFile(f);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ?? (src ? `${label} — replace` : label)}
      className={`vs-slot ${src ? "is-full" : ""} ${over ? "is-over" : ""} ${className}`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pickFrom(e.dataTransfer.files);
      }}
      onPaste={(e) => pickFrom(e.clipboardData.files)}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          pickFrom(e.target.files);
          e.target.value = "";
        }}
      />
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local data URL
        <img src={src} alt={label} draggable={false} />
      ) : (
        <span className="vs-slot__empty">
          {icon ?? <Icon.Plus width={18} height={18} aria-hidden />}
          <span className="text-[12px] font-medium text-[var(--vs-ink-2)]">{label}</span>
          {hint && <span>{hint}</span>}
        </span>
      )}
      {tag && src && <span className="vs-slot__tag">{tag}</span>}
      {src && onClear && (
        <button
          type="button"
          className="vs-slot__x"
          aria-label={`Remove ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          <Icon.Close width={11} height={11} />
        </button>
      )}
    </div>
  );
}
