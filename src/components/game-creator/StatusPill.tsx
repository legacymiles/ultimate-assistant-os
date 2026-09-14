import { STATUS_LABEL, type GameStatus } from "@/lib/game-creator/types";

const TONE: Record<GameStatus, string> = {
  queued: "border-line text-ink-muted",
  designing: "border-brand/50 text-brand",
  building: "border-brand/50 text-brand",
  testing: "border-accent/50 text-accent",
  packaging: "border-accent/50 text-accent",
  ready: "border-core/50 text-core",
  failed: "border-red-500/50 text-red-400",
};

const ACTIVE = new Set<GameStatus>(["designing", "building", "testing", "packaging"]);

export function StatusPill({ status }: { status: GameStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border bg-canvas/70 px-2 py-0.5 text-[11px] font-medium backdrop-blur ${TONE[status]}`}
    >
      {ACTIVE.has(status) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden />}
      {status === "ready" && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {STATUS_LABEL[status]}
    </span>
  );
}
