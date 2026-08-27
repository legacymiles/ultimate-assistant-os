"use client";

/** A tag label. Clickable pills toggle the tag filter; plain ones just read. */
export function TagPill({
  tag,
  active = false,
  onClick,
}: {
  tag: string;
  active?: boolean;
  onClick?: (tag: string) => void;
}) {
  const cls =
    "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition " +
    (active
      ? "bg-brand/20 text-brand"
      : "bg-elevated text-ink-faint" + (onClick ? " hover:bg-brand/15 hover:text-brand" : ""));

  if (!onClick) return <span className={cls}>{tag}</span>;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(tag);
      }}
      className={cls}
      aria-pressed={active}
    >
      {tag}
    </button>
  );
}
