"use client";

import type { Feature, Project } from "@/lib/types";
import { Icon } from "./icons";

function FeatureCard({ feature }: { feature: Feature }) {
  const core = feature.group === "core";
  return (
    <div
      className={
        "rounded-2xl border p-4 transition " +
        (core
          ? "border-core/30 bg-core/[0.07] hover:border-core/50"
          : "border-support/30 bg-support/[0.07] hover:border-support/50")
      }
    >
      <div className="flex items-start gap-2.5">
        <span
          className={
            "mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full " + (core ? "bg-core" : "bg-support")
          }
        />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink">{feature.title}</h4>
          {feature.description && (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {feature.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({
  label,
  accent,
  features,
}: {
  label: string;
  accent: "core" | "support";
  features: Feature[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span
          className={"h-2.5 w-2.5 rounded-full " + (accent === "core" ? "bg-core" : "bg-support")}
        />
        <h3 className="text-sm font-semibold text-ink">{label}</h3>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[11px] font-medium text-ink-faint">
          {features.length}
        </span>
      </div>
      {features.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-xs text-ink-faint">
          None yet — add knowledge and let the AI Analyst populate this.
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {features.map((f) => (
            <FeatureCard key={f.id} feature={f} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FeaturesSection({ project }: { project: Project }) {
  const core = project.features.filter((f) => f.group === "core");
  const supporting = project.features.filter((f) => f.group === "supporting");

  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon.Layers width={18} height={18} className="text-ink-muted" />
        <h2 className="text-base font-semibold text-ink">Features</h2>
      </div>
      <div className="space-y-6">
        <Group label="Core Features" accent="core" features={core} />
        <Group label="Supporting Features" accent="support" features={supporting} />
      </div>
    </section>
  );
}
