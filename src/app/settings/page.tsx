import { BottomNav } from "@/components/hub/BottomNav";
import { Icon } from "@/components/icons";

export const metadata = { title: "Settings · Ultimate Assistant OS" };

export default function SettingsPage() {
  return (
    <>
      <div className="mx-auto w-full max-w-2xl px-4 pb-28 pt-8 sm:px-6 sm:pt-10">
        <h1 className="mb-1 text-2xl font-bold text-ink">Settings</h1>
        <p className="mb-6 text-sm text-ink-muted">
          Workspace-wide preferences. More options arrive as new modules ship.
        </p>

        <section className="space-y-3">
          <SettingRow icon="Database" title="Storage" value="Local demo mode" />
          <SettingRow icon="Sparkles" title="AI engine" value="Heuristic (no key set)" />
          <SettingRow icon="Layers" title="Modules" value="Projects Timeline" />
        </section>
      </div>
      <BottomNav />
    </>
  );
}

function SettingRow({
  icon,
  title,
  value,
}: {
  icon: keyof typeof Icon;
  title: string;
  value: string;
}) {
  const I = Icon[icon];
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-panel-2 text-ink-muted">
          <I width={16} height={16} />
        </span>
        <div className="text-sm font-medium text-ink">{title}</div>
      </div>
      <div className="text-xs text-ink-faint">{value}</div>
    </div>
  );
}
