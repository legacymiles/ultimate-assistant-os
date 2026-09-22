"use client";

import { useState } from "react";
import { Icon } from "../icons";
import { mintRunnerToken } from "@/lib/video-studio/client";
import type { Studio } from "./studio";
import { CapabilityBadge, MethodMark, Panel, timeAgo } from "./ui";

// The integrations page. One row per requirement, and the row says whether
// this machine actually has it — checked a moment ago, not assumed.

export function Integrations({ s }: { s: Studio }) {
  const [token, setToken] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);

  const mint = async () => {
    setMinting(true);
    try {
      const result = await mintRunnerToken();
      setToken(result.token);
      await s.refreshMethods();
    } catch (err) {
      s.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMinting(false);
    }
  };

  return (
    <div className="vsa-screen">
      <Panel
        title="Connect your PC"
        hint="Four of the five engines render on your own machine. The studio runner is what lets the website reach them."
        actions={
          <button type="button" className="vsa-btn" onClick={() => void s.refreshMethods()}>
            <Icon.Refresh width={13} height={13} /> Re-check
          </button>
        }
      >
        <div className="vsa-runner">
          <span className={`vsa-cap is-${s.runner.online ? "ready" : s.runner.hasToken ? "not-connected" : "requires-installation"}`}>
            <i aria-hidden />
            {s.runner.online ? "Runner online" : s.runner.hasToken ? "Runner offline" : "No runner token yet"}
          </span>
          <span className="vsa-hint">last seen {timeAgo(s.runner.lastSeen)}</span>
          <button type="button" className="vsa-btn is-primary" disabled={minting} onClick={() => void mint()}>
            {s.runner.hasToken ? "Replace the token" : "Create a runner token"}
          </button>
        </div>

        {token && (
          <div className="vsa-token">
            <p>
              Paste this into <code>tools/video-studio-runner/.env</code> as <code>HUB_TOKEN</code>. It is shown
              once.
            </p>
            <code className="vsa-token-value">{token}</code>
            <button type="button" className="vsa-btn is-small" onClick={() => void navigator.clipboard.writeText(token)}>
              <Icon.Copy width={12} height={12} /> Copy
            </button>
          </div>
        )}

        <ol className="vsa-setup">
          <li>
            Create a token above and put it in <code>tools/video-studio-runner/.env</code> together with{" "}
            <code>HUB_URL</code>.
          </li>
          <li>
            <code>cd tools/video-studio-runner &amp;&amp; npm install</code>
          </li>
          <li>
            <code>npm run runner</code> — it polls for jobs and runs each one with Claude Code and that
            engine&apos;s skill.
          </li>
        </ol>
      </Panel>

      {s.methods
        .filter((m) => !m.hidden)
        .map((method) => (
          <Panel key={method.id} className="vsa-integration">
            <header className="vsa-integration-head">
              <MethodMark hue={method.hue} size={32} />
              <div>
                <h3>{method.name}</h3>
                <p>{method.capability?.summary}</p>
              </div>
              <CapabilityBadge capability={method.capability} />
            </header>

            <table className="vsa-reqs">
              <tbody>
                {(method.capability?.requirements ?? []).map((req) => (
                  <tr key={req.id} className={req.met ? "is-met" : req.optional ? "is-optional" : "is-missing"}>
                    <td className="vsa-req-state">{req.met ? "✓" : req.optional ? "–" : "✕"}</td>
                    <td className="vsa-req-label">
                      {req.label}
                      {req.optional && <em> optional</em>}
                    </td>
                    <td className="vsa-req-detail">
                      <code>{req.detail}</code>
                    </td>
                    <td className="vsa-req-how">{req.howTo}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {method.capability?.error && <p className="vsa-error is-inline">{method.capability.error}</p>}

            <p className="vsa-hint">
              Skill: <code>{method.skill}</code>
              {method.docsUrl && (
                <>
                  {" · "}
                  <a href={method.docsUrl} target="_blank" rel="noreferrer">
                    documentation
                  </a>
                </>
              )}
            </p>
          </Panel>
        ))}
    </div>
  );
}
