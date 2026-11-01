"use client";

// ---------------------------------------------------------------------------
// Money Agent Studio at its own route.
//
// The same three sections Jarvis mounts, with their own switcher instead of the
// studio shell's. It is a separate shell rather than a reuse of StudioShell
// because that one is handed the Jarvis store, the commit function and the
// active profile, and none of these three sections want any of them — standing
// up an empty store just to satisfy a type would be inventing state so a type
// would stop complaining.
//
// Sections are dynamic imports here for the same reason they are there: EA Lab
// pulls in the whole bench, and somebody who came to size a position should not
// download it.
// ---------------------------------------------------------------------------

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { getStudio } from "@/lib/studio/studios";
import { Icon } from "../icons";
import "../jarvis/studio-hub.css";

const studio = getStudio("money")!;

const SECTIONS: Record<string, React.ComponentType> = {
  agent: dynamic(() => import("./TradingAgent").then((m) => m.TradingAgent), { ssr: false }),
  "ea-lab": dynamic(() => import("../ea-lab/EaLab").then((m) => m.EaLab), { ssr: false }),
  calculator: dynamic(() => import("../calculator/Calculator").then((m) => m.Calculator), {
    ssr: false,
  }),
};

export function MoneyAgentStudio() {
  const [current, setCurrent] = useState(studio.sections[0].id);
  const active = studio.sections.find((s) => s.id === current) ?? studio.sections[0];
  const Mounted = SECTIONS[active.id];

  return (
    <div className="sshell min-h-dvh" style={{ ["--h"]: studio.hue } as React.CSSProperties}>
      <div className="sshell-bar" style={{ ["--h"]: studio.hue } as React.CSSProperties}>
        <Link href="/" className="sshell-back">
          <Icon.ArrowLeft />
          Hub
        </Link>
        <div className="sshell-name">
          {studio.name}
          <span>{studio.tagline}</span>
        </div>
        <nav className="sshell-rail" aria-label="Money Agent Studio sections">
          {studio.sections.map((s) => {
            const Glyph = Icon[s.icon as keyof typeof Icon] ?? Icon.Square;
            return (
              <button
                key={s.id}
                type="button"
                className={`sshell-tab${s.id === active.id ? " is-on" : ""}`}
                aria-current={s.id === active.id ? "page" : undefined}
                onClick={() => setCurrent(s.id)}
                title={s.blurb}
              >
                <Glyph aria-hidden />
                {s.label}
              </button>
            );
          })}
        </nav>
        <div className="sshell-blurb">{active.blurb}</div>
      </div>
      <div className="sshell-stage">
        <Mounted />
      </div>
    </div>
  );
}
