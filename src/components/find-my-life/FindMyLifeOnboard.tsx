"use client";

// ---------------------------------------------------------------------------
// The Find My Life step in Jarvis onboarding: make the device you're holding
// findable in one tap, then add the other things you carry with one tap each.
// Each added thing's finishing touch (Shortcut, car sign-in, tag link) lives on
// its card in Find My Life, so onboarding stays a minute long.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { bestFix } from "@/lib/find-my-life/engine";
import { KIND_BY_ID, type Kind } from "@/lib/find-my-life/kinds";
import { thisDeviceGuess, useFindMyLife } from "@/lib/find-my-life/useFindMyLife";
import { KindIcon } from "./KindIcon";
import "./find-my-life.css";

const QUICK: Kind[] = ["phone", "laptop", "car", "keys", "wallet", "glasses", "earbuds", "watch"];

export function FindMyLifeOnboard() {
  const f = useFindMyLife();
  const [added, setAdded] = useState<Kind[]>([]);
  const devices = f.view?.doc.devices ?? [];
  const me = devices.find((d) => d.id === f.thisId);
  const guess = thisDeviceGuess();
  const has = (k: Kind) => added.includes(k) || devices.some((d) => d.kind === k);

  return (
    <div className="fml" style={{ background: "transparent", minHeight: 0 }}>
      {me ? (
        <div className="fml-this" style={{ cursor: "default" }} data-f={bestFix(me) ? "live" : "recent"}>
          <span className="fml-detail-icon" style={{ width: 48, height: 48 }}>
            <KindIcon kind={me.kind} size={24} />
          </span>
          <span>
            <b style={{ display: "block", fontSize: 14.5 }}>{me.name} is findable</b>
            <span style={{ fontSize: 12.5, color: "var(--fml-ink-soft)" }}>{bestFix(me) ? "It's on your radar now." : "Allow location when asked and it shows up live."}</span>
          </span>
          <span className="fml-chip" data-f="live">
            ✓
          </span>
        </div>
      ) : (
        <button type="button" className="fml-this" onClick={() => void f.makeThisFindable()} disabled={f.busy === "this" || !f.view}>
          <span className="fml-detail-icon" data-f="recent" style={{ width: 48, height: 48 }}>
            <KindIcon kind={guess.kind} size={24} />
          </span>
          <span>
            <b style={{ display: "block", fontSize: 14.5 }}>Make {guess.name.replace(/^My /, "my ")} findable</b>
            <span style={{ fontSize: 12.5, color: "var(--fml-ink-soft)" }}>One tap. It shows up live on your radar.</span>
          </span>
          <span className="fml-chip" data-f="live">
            {f.busy === "this" ? "…" : "Tap"}
          </span>
        </button>
      )}
      <p className="fml-label" style={{ marginTop: 4 }}>
        What else do you carry? Tap to add
      </p>
      <div className="fml-kinds">
        {QUICK.map((k) => {
          const done = has(k);
          return (
            <button
              key={k}
              type="button"
              className="fml-kind"
              aria-pressed={done}
              disabled={done || !f.view}
              style={done ? { borderColor: "rgb(91 227 143 / 0.5)", opacity: 0.85 } : undefined}
              onClick={async () => {
                if (await f.act("device.add", { kind: k, name: KIND_BY_ID[k].example }, "add")) setAdded((a) => [...a, k]);
              }}
            >
              <KindIcon kind={k} size={22} />
              {done ? `${KIND_BY_ID[k].label} ✓` : KIND_BY_ID[k].label}
            </button>
          );
        })}
      </div>
      {f.error && <p className="fml-error" style={{ marginTop: 10 }}>{f.error}</p>}
      <p style={{ marginTop: 10, fontSize: 12, color: "var(--fml-ink-faint)" }}>
        Each one shows the best way it can be found — car sign-in, a 1-minute iPhone Shortcut, or its AirTag — in{" "}
        <a href="/apps/find-my-life" target="_blank" rel="noopener" style={{ color: "var(--fml-hud)" }}>
          Find My Life
        </a>
        . Also on your Dashboard.
      </p>
    </div>
  );
}
