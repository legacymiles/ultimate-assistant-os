// ---------------------------------------------------------------------------
// The standout: the routing rail.
//
// One memorable thing on this page, and it is the thing the page is actually
// about — where a search goes. The chain is drawn as stations on a rail in the
// order a request tries them: this machine, then the VPS, then the cloud. The
// segment a request travelled is lit indigo, the station that served it is
// ringed, stations that failed are struck through in red, and a station whose
// breaker is open is dimmed with its cooldown shown.
//
// After a test search the rail replays that request: a pulse travels the lit
// segments to the station that answered. That is the whole mechanic — no
// decoration, just the routing made visible.
//
// Under `prefers-reduced-motion` the pulse does not run and the lit path is
// simply drawn; the information is identical, which is the rule for a
// standout. On a phone the rail turns vertical.
// ---------------------------------------------------------------------------

"use client";

import { Check, Cloud, Laptop, Server, X } from "lucide-react";
import type { ProviderAttempt, ProviderStatus } from "@/lib/search/types";
import { Chip, Dot, STATE, ms } from "./shared";

interface Station {
  key: string;
  provider: string;
  location: "laptop" | "vps" | "cloud" | null;
  endpoint: string | null;
  name: string;
  state: ProviderStatus["state"];
  detail: string | null;
  latencyMs: number | null;
  openUntil: string | null;
  /** From the last test search: did this station get tried, and how did it go. */
  attempt?: ProviderAttempt;
}

const ICONS = { laptop: Laptop, vps: Server, cloud: Cloud } as const;

const LOCATION_NAME: Record<string, string> = {
  laptop: "on this machine",
  vps: "on your VPS",
  cloud: "hosted",
};

/** The provider's name, which is the identity — `SearXNG`, not `Cloud`. */
function nameOf(station: Station): string {
  // `label` carries the location for a SearXNG instance ("SearXNG · this
  // machine"), because there can be several. Everything before the separator
  // is the provider.
  return station.name.split("·")[0].trim() || station.provider;
}

/** Where it is, as a phrase under the name. Never the headline. */
function whereOf(station: Station): string {
  if (station.state === "unconfigured") return "not set up";
  if (station.location === "vps" && station.endpoint) {
    try {
      return `on ${new URL(station.endpoint).host}`;
    } catch {
      return "on your VPS";
    }
  }
  return LOCATION_NAME[station.location ?? "cloud"] ?? "hosted";
}

function colorFor(station: Station): string {
  if (station.attempt?.ok) return STATE.up;
  if (station.attempt && !station.attempt.skipped) return STATE.failed;
  if (station.state === "up") return STATE.up;
  if (station.state === "open") return STATE.waiting;
  if (station.state === "down") return STATE.failed;
  return "#6b7385"; // ink-faint: configured-but-unknown, or not configured
}

export function RoutingRail({
  providers,
  attempts,
  servedBy,
  loading = false,
}: {
  providers: ProviderStatus[];
  /** The attempts from the most recent test search, if one has been run. */
  attempts?: ProviderAttempt[];
  /** `provider:endpoint` of the station that served that search. */
  servedBy?: string | null;
  /**
   * The first fetch has not landed yet. Without this, an empty provider list
   * renders as "nothing is configured" for the second before the data arrives
   * — which is a different and alarming fact.
   */
  loading?: boolean;
}) {
  const stations: Station[] = providers.map((provider) => {
    const key = `${provider.provider}:${provider.endpoint ?? "default"}`;
    return {
      key,
      provider: provider.provider,
      location: provider.location,
      endpoint: provider.endpoint,
      name: provider.label,
      state: provider.state,
      detail: provider.detail,
      latencyMs: provider.latencyMs,
      openUntil: provider.openUntil,
      attempt: attempts?.find(
        (attempt) => `${attempt.provider}:${attempt.endpoint ?? "default"}` === key,
      ),
    };
  });

  const servedIndex = servedBy ? stations.findIndex((station) => station.key === servedBy) : -1;

  return (
    <div
      data-standout="routing rail — the provider chain with the path a request actually took"
      className="px-3 py-4"
    >
      <style>{`
        @keyframes rail-pulse {
          0%   { offset-distance: 0%;   opacity: 0; }
          12%  { opacity: 1; }
          88%  { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        .rail-travel {
          offset-path: path("M 0 0 H 100");
          animation: rail-pulse 900ms ease-in-out 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .rail-travel { display: none; }
        }
      `}</style>

      <ol className="flex flex-col gap-0 sm:flex-row sm:items-stretch">
        {stations.length === 0 ? (
          <li className="text-[12px] text-ink-faint">
            {loading ? (
              "Reading the chain…"
            ) : (
              <>
                No provider is configured yet, so there is no chain to draw. Set{" "}
                <code className="font-mono text-ink-muted">SEARXNG_URL</code> and reload.
              </>
            )}
          </li>
        ) : null}

        {stations.map((station, index) => {
          const Icon = ICONS[station.location ?? "cloud"] ?? Cloud;
          const color = colorFor(station);
          // A segment is "lit" when the request really did get at least this
          // far. An unconfigured provider is drawn on the rail so the whole
          // menu is visible, but it was never in the chain — lighting its
          // segment would claim the request passed through something that does
          // not exist.
          const lit =
            servedIndex >= 0 && index <= servedIndex && station.state !== "unconfigured";
          const served = index === servedIndex;
          const failed = Boolean(station.attempt && !station.attempt.ok && !station.attempt.skipped);
          const skipped = Boolean(station.attempt?.skipped);

          return (
            <li key={station.key} className="flex min-w-0 flex-1 items-start gap-3 sm:block">
              {/* The rail itself. Vertical on a phone, horizontal from sm up. */}
              <div className="flex w-5 flex-col items-center sm:mb-2 sm:h-5 sm:w-full sm:flex-row">
                <span
                  className="hidden h-[1px] flex-1 sm:block"
                  style={{
                    background:
                      index === 0 ? "transparent" : lit ? STATE.live : "var(--color-line)",
                  }}
                />
                <span
                  className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full border"
                  style={{
                    borderColor: served ? STATE.live : "var(--color-line)",
                    background: served ? "rgba(99,102,241,0.14)" : "var(--color-panel-2)",
                  }}
                >
                  <Dot color={color} pulse={station.state === "open"} />
                  {served ? (
                    <span
                      key={`${station.key}-${station.attempt?.ms ?? 0}`}
                      aria-hidden
                      className="rail-travel pointer-events-none absolute h-1.5 w-1.5 rounded-full"
                      style={{ background: STATE.live, boxShadow: `0 0 6px ${STATE.live}` }}
                    />
                  ) : null}
                </span>
                <span
                  className="hidden h-[1px] flex-1 sm:block"
                  style={{
                    background:
                      index === stations.length - 1
                        ? "transparent"
                        : lit && index < servedIndex
                          ? STATE.live
                          : "var(--color-line)",
                  }}
                />
                {/* The phone's vertical connector. */}
                {index < stations.length - 1 ? (
                  <span
                    className="w-[1px] flex-1 sm:hidden"
                    style={{
                      minHeight: 26,
                      background: lit && index < servedIndex ? STATE.live : "var(--color-line)",
                    }}
                  />
                ) : null}
              </div>

              <div className="min-w-0 flex-1 pb-4 sm:pb-0 sm:pr-3">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                  <Icon size={12} className="shrink-0 text-ink-faint" aria-hidden />
                  <span className="truncate">{nameOf(station)}</span>
                  <span className="shrink-0 text-[11.5px] font-normal text-ink-faint">{whereOf(station)}</span>
                  {served ? <Chip tone="brand">served</Chip> : null}
                  {failed ? <Chip tone="bad">failed</Chip> : null}
                  {skipped ? <Chip tone="warn">skipped</Chip> : null}
                </p>

                {station.endpoint ? (
                  <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-muted" title={station.endpoint}>
                    {station.endpoint}
                  </p>
                ) : null}

                {/* The headline already says "not set up" for an unconfigured
                    provider, and the detail below explains it — a third line
                    saying "not configured" is noise, so it is left out. */}
                {station.state === "unconfigured" ? null : (
                  <p className="mt-1 flex items-center gap-1.5 text-[11.5px]">
                    <span style={{ color }} className="inline-flex items-center gap-1">
                      {station.state === "up" ? <Check size={10} aria-hidden /> : <X size={10} aria-hidden />}
                      {station.state === "up" ? "up" : station.state === "open" ? "breaker open" : "down"}
                    </span>
                    {station.attempt?.ms ? (
                      <span className="font-mono tabular-nums text-ink-faint">{ms(station.attempt.ms)}</span>
                    ) : station.latencyMs ? (
                      <span className="font-mono tabular-nums text-ink-faint">{ms(station.latencyMs)}</span>
                    ) : null}
                  </p>
                )}

                {station.attempt?.error ?? station.detail ? (
                  <p className="mt-1 text-[11.5px] leading-snug text-ink-faint">
                    {station.attempt?.error ?? station.detail}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <p className="mt-1 border-t border-line-soft pt-2 text-[11.5px] leading-snug text-ink-faint">
        A request walks this chain in order and stops at the first provider that answers. A SearXNG on
        this machine is only reachable by code running on this machine — on the deployed hub the
        chain starts at the VPS.
      </p>
    </div>
  );
}
