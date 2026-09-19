"use client";

// A tab that does not exist yet says so plainly, names what it will do and
// which stage brings it. The alternative — a mocked-up screen — is exactly the
// dishonesty this app is built to avoid.

export function Placeholder({ stage, title, does }: { stage: number; title: string; does: string }) {
  return (
    <div className="p-4 sm:p-6">
      <div className="max-w-xl rounded-xl border border-dashed border-line bg-panel p-5">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-faint">
            stage {stage}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-ink-muted">{does}</p>
        <p className="mt-3 text-[11px] text-ink-faint">
          Not built yet — nothing here is simulated.
        </p>
      </div>
    </div>
  );
}
