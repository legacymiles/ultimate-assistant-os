"use client";

import { mixamoClipsNeeded, toolUsage } from "@/lib/studio3d/director/normalize";
import { TOOLS, toolById } from "@/lib/studio3d/tools/registry";
import type { DirectorPlan, StudioCapabilities } from "@/lib/studio3d/types";
import { ToolChip } from "./StatusPill";

// Which tools this video uses, why, and whether the studio PC is ready for
// them — including the Mixamo clips it still needs to download. Planned tool
// slots are shown greyed so the modular pipeline is visible.

export function ToolPlan({ plan, capabilities }: { plan: DirectorPlan; capabilities: StudioCapabilities | null }) {
  const usage = toolUsage(plan);
  const clips = mixamoClipsNeeded(plan);
  const library = new Set((capabilities?.mixamo?.clips ?? []).map((c) => c.toLowerCase()));
  const missing = capabilities ? clips.filter((c) => !library.has(c.toLowerCase())) : [];
  const sceneNo = (id: string) => plan.scenes.findIndex((s) => s.id === id) + 1;

  const readiness = (tool: string): { ok: boolean; text: string } | null => {
    if (!capabilities) return null;
    if (tool === "blender") return capabilities.blender?.found ? { ok: true, text: `Installed${capabilities.blender.version ? ` · ${capabilities.blender.version}` : ""}` } : { ok: false, text: "Not found on your PC" };
    if (tool === "mixamo") return missing.length ? { ok: false, text: `${missing.length} of ${clips.length} clips missing` } : { ok: true, text: "All clips in your library" };
    if (tool === "cascadeur") return capabilities.cascadeur?.found ? { ok: true, text: "Installed" } : { ok: false, text: "Not installed — Blender keys these by hand" };
    return null;
  };

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Tool plan</h3>
        <span className="text-[11px] text-ink-faint">decided by the director</span>
      </div>

      <ul className="mt-3 space-y-3">
        {usage.map((u) => {
          const tool = toolById(u.tool)!;
          const ready = readiness(u.tool);
          return (
            <li key={u.tool} className="rounded-xl border border-line bg-canvas/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <ToolChip tool={u.tool} label={tool.name} />
                <span className="text-[11px] text-ink-muted">
                  {u.tool === "blender" ? `all ${u.scenes.length} scenes` : `${u.actions} action${u.actions === 1 ? "" : "s"} · scene ${u.scenes.map(sceneNo).join(", ")}`}
                </span>
                {ready && <span className={`ml-auto text-[11px] ${ready.ok ? "text-core" : "text-amber-400"}`}>{ready.text}</span>}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{tool.role}</p>
              {u.tool === "mixamo" && clips.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {clips.map((c) => (
                    <span
                      key={c}
                      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${missing.includes(c) ? "border-amber-400/40 text-amber-400" : "border-line text-ink-muted"}`}
                      title={missing.includes(c) ? "Download this clip from mixamo.com (FBX, Without Skin) into your library" : "In your library"}
                    >
                      {c}.fbx
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-[11px] font-medium text-ink-muted">Pipeline slots</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TOOLS.map((t) => (
            <span key={t.id} className={t.status === "planned" ? "opacity-45" : ""} title={`${t.role}${t.status === "planned" ? " (coming later)" : ""}`}>
              <ToolChip tool={t.id} label={`${t.name}${t.status === "planned" ? " · soon" : ""}`} />
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
