"use client";

// ---------------------------------------------------------------------------
// EA World › Terminals — OpenTerminal, Vibe-Trading and Fincept, one place.
//
// The table says plainly whether each one is running on this PC. The check is
// a no-cors request to its localhost port: it can tell "something answered"
// from "nothing there", nothing more, and some browsers block it outright —
// which is why "not answering" says what to try rather than that it is down.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { TERMINALS, type TerminalApp } from "@/lib/ea-replay/terminals";
import "./replay.css";

type Status = "checking" | "up" | "down" | "n/a";

async function probe(url: string): Promise<boolean> {
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

export function TerminalsStudio({ embedded = false }: { embedded?: boolean }) {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const check = useCallback(async () => {
    setStatus(Object.fromEntries(TERMINALS.map((t) => [t.id, t.url ? "checking" : "n/a"])));
    const results = await Promise.all(TERMINALS.map(async (t) => [t.id, t.url ? ((await probe(t.url)) ? "up" : "down") : "n/a"] as const));
    setStatus(Object.fromEntries(results));
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const copy = async (t: TerminalApp) => {
    try {
      await navigator.clipboard.writeText(t.start);
      setCopied(t.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard refused — the command is visible to copy by hand */
    }
  };

  const embed = TERMINALS.find((t) => t.id === shown);

  return (
    <div className={`rpl${embedded ? " rpl--embedded" : ""}`} style={{ gridTemplateRows: embed ? "auto auto 1fr" : "auto auto 1fr" }}>
      <header className="rpl-top">
        <div className="rpl-title">
          <h1>Terminals</h1>
          {!embedded && <Link href="/apps/trading-studio">Trading Studio</Link>}
        </div>
        <span className="muted">Three outside terminals for the market around your bots. They run on this PC.</span>
        <div className="rpl-source">
          <button className="rpl-btn" onClick={() => void check()}>
            Check again
          </button>
          <Link className="rpl-btn" href="/apps/trading-studio?section=replay">
            Open Replay
          </Link>
        </div>
      </header>

      <div style={{ overflow: "auto", background: "var(--rpl-panel)", borderBottom: "1px solid var(--rpl-line)" }}>
        <table className="rpl-table">
          <thead>
            <tr>
              <th>Terminal</th>
              <th>What it adds</th>
              <th>Runs as</th>
              <th>Status</th>
              <th>Start it</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {TERMINALS.map((t) => {
              const s = status[t.id] ?? "checking";
              return (
                <tr key={t.id}>
                  <td style={{ verticalAlign: "top" }}>
                    <a href={t.repo} target="_blank" rel="noreferrer" style={{ color: "var(--rpl-ink)", fontWeight: 600 }}>
                      {t.name}
                    </a>
                    <div className="faint">{t.license}</div>
                  </td>
                  <td style={{ whiteSpace: "normal", maxWidth: 520, verticalAlign: "top" }} className="muted">
                    {t.role}
                  </td>
                  <td style={{ whiteSpace: "normal", verticalAlign: "top" }}>
                    {t.runs}
                    <div className="faint">Needs {t.needs}</div>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <span className="rpl-row" style={{ gap: 6, flexWrap: "nowrap", whiteSpace: "nowrap" }}>
                      <span className={`rpl-dot ${s === "up" ? "rpl-dot--real" : ""}`} />
                      {s === "up" ? (
                        <span>running on {t.url!.replace("http://", "")}</span>
                      ) : s === "down" ? (
                        <span className="muted">not answering</span>
                      ) : s === "n/a" ? (
                        <span className="muted">desktop app</span>
                      ) : (
                        <span className="faint">checking…</span>
                      )}
                    </span>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <button className="rpl-btn mono" style={{ fontSize: 10.5 }} onClick={() => void copy(t)} title="Copy — run it in PowerShell from the hub folder">
                      {copied === t.id ? "Copied" : "Copy start command"}
                    </button>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <span className="rpl-row" style={{ flexWrap: "nowrap" }}>
                      {t.url && (
                        <a className="rpl-btn" href={t.url} target="_blank" rel="noreferrer">
                          Open in a tab
                        </a>
                      )}
                      {t.embeddable && (
                        <button className="rpl-btn rpl-btn--primary" onClick={() => setShown(shown === t.id ? null : t.id)} disabled={s !== "up"}>
                          {shown === t.id ? "Hide" : "Show here"}
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="rpl-note" style={{ padding: "8px 12px", margin: 0 }}>
          First time: run <span className="mono">tools\ea-terminals\install.ps1</span> once from the hub folder. It clones OpenTerminal, installs Vibe-Trading into its own Python
          environment and downloads the Fincept installer. Then <span className="mono">start.ps1</span> starts all three. Status checks talk to localhost from this browser; if
          a running terminal shows as not answering, open it in a tab — some browsers block the check.
        </p>
      </div>

      <div style={{ position: "relative", minHeight: 360 }}>
        {embed?.url ? (
          <iframe title={embed.name} src={embed.url} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#000" }} />
        ) : (
          <div className="rpl-empty" style={{ position: "absolute" }}>
            <h2>OpenTerminal can be shown here once it is running</h2>
            <p>Vibe-Trading refuses to be framed by other pages and Fincept is a desktop app, so those two open on their own.</p>
          </div>
        )}
      </div>
    </div>
  );
}
