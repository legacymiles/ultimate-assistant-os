"use client";

// ---------------------------------------------------------------------------
// Find My Life on the Jarvis Dashboard: a small live radar and the five things
// that matter most right now (lost first, then the freshest). Tap the card for
// the whole app in the widget sheet; it also has its own page.
// While the dashboard is open, a registered browser keeps reporting itself and
// answers Ring — the widget runs the same hook as the full app.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { Icon } from "../icons";
import { MiniBtn, Widget, WidgetSheet } from "../new-jarvis/Widgets";
import { ago, bestFix, freshness, sortDevices, summary, whereText } from "@/lib/find-my-life/engine";
import { useFindMyLife } from "@/lib/find-my-life/useFindMyLife";
import { FindMyLifeApp } from "./FindMyLifeApp";
import { Radar } from "./Radar";
import "./find-my-life.css";

export function FindMyLifeWidget({ onExpand }: { onExpand: () => void }) {
  const f = useFindMyLife();
  const doc = f.view?.doc;
  const devices = useMemo(() => (doc ? sortDevices(doc.devices) : []), [doc]);
  const sum = doc ? summary(doc) : null;
  const center = f.here ?? devices.map(bestFix).find(Boolean) ?? null;
  const now = new Date();
  return (
    <Widget
      title="Find My Life"
      icon="Target"
      count={sum?.lost || undefined}
      live={Boolean(sum?.lost)}
      onExpand={onExpand}
      actions={
        <MiniBtn label="Open in its own tab" onClick={() => window.open("/apps/find-my-life", "_blank", "noopener")}>
          <Icon.Launch width={12} height={12} aria-hidden />
        </MiniBtn>
      }
      status={sum ? (sum.lowBattery.length ? `${sum.line} · ${sum.lowBattery.length} low battery` : sum.line) : f.error ?? "Loading…"}
    >
      <div className="fml" style={{ background: "transparent", minHeight: 0 }}>
        <div className="fml-mini">
          <Radar devices={devices} center={center} mini label="Mini radar" />
          {devices.length ? (
            <ul>
              {devices.slice(0, 5).map((d) => {
                const fix = bestFix(d);
                return (
                  <li key={d.id} data-f={d.lost ? "lost" : freshness(fix, now)} data-lost={d.lost ? "true" : undefined}>
                    <span className="fml-dot" />
                    <span title={whereText(doc!, fix)}>{d.name}</span>
                    <span className="fml-mono">{d.lost ? "LOST" : fix ? ago(fix, now) : "set up"}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p style={{ fontSize: 12, color: "var(--fml-ink-soft)" }}>Your phone, laptop, car, keys — all on one radar. Tap to add the first.</p>
          )}
        </div>
      </div>
    </Widget>
  );
}

export function FindMyLifeExpanded({ onClose }: { onClose: () => void }) {
  return (
    <WidgetSheet
      title="Find My Life"
      kicker="Every device and thing you own"
      onClose={onClose}
      actions={
        <a href="/apps/find-my-life" target="_blank" rel="noopener" className="deck-btn">
          <Icon.Launch width={12} height={12} aria-hidden /> Own tab
        </a>
      }
    >
      <FindMyLifeApp embedded />
    </WidgetSheet>
  );
}
