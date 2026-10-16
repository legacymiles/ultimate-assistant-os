"use client";

// ---------------------------------------------------------------------------
// App plugins — the hub apps allowed into Jarvis.
//
// This started as a third view inside Studio, which put it behind a tab bar
// that is really about workflows. It belongs in the rail: a plugin is a door
// out of Jarvis into a whole app, not a way of looking at the workflow wall.
// They are not copies — each one still lives in the hub (src/lib/catalog.ts)
// and opens in its own tab, so a half-written prompt is never lost.
// ---------------------------------------------------------------------------

import { Icon } from "../icons";
import { studioPlugins } from "@/lib/studio/plugins";
import { noteLaunch, toggleFavorite, useLauncher } from "@/lib/new-jarvis/launcher";

export function PluginsTab() {
  const plugins = studioPlugins();
  // Starred apps ride to the top of the Dashboard's Deck; the star lives here
  // because this is where the owner looks at the whole list.
  const { favorites } = useLauncher();
  return (
    <div className="p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold text-ink">App plugins</h2>
        <span className="text-[11px] text-ink-faint">
          {plugins.length} {plugins.length === 1 ? "app" : "apps"} from the hub. Star one to pin it to your
          Dashboard.
        </span>
      </div>

      {plugins.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line py-12 text-center text-xs text-ink-muted">
          No plugins allowed yet. Adding one is adding a slug to PLUGIN_SLUGS in src/lib/studio/plugins.ts.
        </p>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {plugins.map((p) => {
            const fav = favorites.includes(p.slug);
            return (
            <li key={p.slug} className="relative">
              <button
                type="button"
                onClick={() => toggleFavorite(p.slug)}
                aria-pressed={fav}
                aria-label={fav ? `Unpin ${p.title} from the Dashboard` : `Pin ${p.title} to the Dashboard`}
                title={fav ? "On your Dashboard" : "Add to your Dashboard"}
                className={`absolute right-2 bottom-2 z-10 grid h-9 w-9 place-items-center rounded-lg border transition ${
                  fav
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                    : "border-line bg-panel text-ink-faint hover:border-ink-faint hover:text-ink"
                }`}
              >
                <Icon.Star width={15} height={15} fill={fav ? "currentColor" : "none"} aria-hidden />
              </button>
              <a
                href={p.href}
                target="_blank"
                rel="noreferrer"
                onClick={() => noteLaunch("app", p.slug, p.title)}
                className="st-card group flex h-full gap-3 rounded-xl border border-line bg-panel p-3 transition hover:-translate-y-0.5 hover:border-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-muted"
                style={{ ["--h" as string]: p.hue }}
              >
                <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg">
                  <span className="st-art st-m-orbit" aria-hidden>
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink">{p.title}</span>
                    {p.status === "coming-soon" && (
                      <span className="rounded border border-line px-1 py-px text-[9px] uppercase tracking-wide text-ink-faint">
                        Soon
                      </span>
                    )}
                    <Icon.Launch
                      width={12}
                      height={12}
                      className="ml-auto shrink-0 text-ink-faint transition group-hover:text-ink"
                    />
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-muted">{p.tag}</span>
                  {p.why && <span className="mt-1.5 block text-[11px] leading-snug text-ink-faint">{p.why}</span>}
                </span>
              </a>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
