import { STATUS_LABEL, type ProjectStatus } from "@/lib/studio3d/types";

const TONE: Record<ProjectStatus, string> = {
  storyboard: "border-accent/50 text-accent",
  queued: "border-line text-ink-muted",
  building: "border-brand/50 text-brand",
  animating: "border-brand/50 text-brand",
  rendering: "border-brand/50 text-brand",
  ready: "border-core/50 text-core",
  failed: "border-red-500/50 text-red-400",
};

const ACTIVE = new Set<ProjectStatus>(["building", "animating", "rendering"]);

export function StatusPill({ status }: { status: ProjectStatus }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border bg-canvas/70 px-2 py-0.5 text-[11px] font-medium backdrop-blur ${TONE[status]}`}>
      {ACTIVE.has(status) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {(status === "ready" || status === "storyboard") && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ToolChip({ tool, label, title, onClick, disabled }: { tool: string; label?: string; title?: string; onClick?: () => void; disabled?: boolean }) {
  const cls = `s3d-chip s3d-chip--${tool}`;
  if (!onClick) {
    return (
      <span className={cls} title={title}>
        {label ?? tool}
      </span>
    );
  }
  return (
    <button type="button" className={`${cls} s3d-chip--button`} title={title} onClick={onClick} disabled={disabled}>
      {label ?? tool}
    </button>
  );
}
