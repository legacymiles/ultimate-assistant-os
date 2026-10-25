"use client";

// ---------------------------------------------------------------------------
// Money Plays — the money that is actually running.
//
// The owner's rule (Oct 2026): Money Agent Studio and Financial Bible are two
// apps, but its earnings flow in here. So this room does not keep its own
// copy of anything: it reads Money Agent Studio's synced board and Personas
// Studio's (for views) and shows every agent as a play — what it is, what it
// has made, what it paid, what each video is worth. Ideas not running yet
// stay in Build Plans.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState } from "react";
import { compact, money, summarize, totals } from "@/lib/money-agents/logic";
import { KEY, loadBoard } from "@/lib/money-agents/store";
import { AGENT_KINDS } from "@/lib/money-agents/types";
import { KEY as PERSONAS_KEY, loadBoard as loadPersonas } from "@/lib/social-personas/store";
import { useRemotePull } from "@/lib/sync/useSync";

export function PlaysRoom() {
  const [board, setBoard] = useState(() => loadBoard());
  const [personas, setPersonas] = useState(() => loadPersonas().personas);
  useRemotePull(KEY, () => setBoard(loadBoard()));
  useRemotePull(PERSONAS_KEY, () => setPersonas(loadPersonas().personas));

  const t = totals(board, personas);
  const rows = board.agents
    .map((a) => ({ a, s: summarize(a, board, personas) }))
    .sort((x, y) => y.s.paid - x.s.paid || y.s.estimated - x.s.estimated);

  return (
    <section className="bible-plays">
      <header className="bible-plays-head">
        <div>
          <h2>Money Plays</h2>
          <p>Every money agent you run, with what it actually paid. Kept in Money Agent Studio — this room reads it live.</p>
        </div>
        <Link className="bb" data-tone="go" href="/apps/money-agent-studio">
          Open Money Agent Studio ↗
        </Link>
      </header>

      <div className="bible-plays-sums">
        <div>
          <strong>{money(t.paidThisMonth)}</strong>
          <small>paid this month</small>
        </div>
        <div>
          <strong>{money(t.paidAllTime)}</strong>
          <small>paid, all time</small>
        </div>
        <div>
          <strong>{money(t.estimated)}</strong>
          <small>estimated from views</small>
        </div>
        <div>
          <strong>{compact(t.views)}</strong>
          <small>views</small>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bible-empty" style={{ margin: "24px 0" }}>
          <h2>No plays running yet</h2>
          <p>
            Start a Clipper, a Faceless channel or a paid Campaign clipper in Money Agent Studio. As soon as it makes something, it shows up
            here with its views and money.
          </p>
          <Link className="bb" data-tone="go" href="/apps/money-agent-studio?tab=agents">
            Make the first one
          </Link>
        </div>
      ) : (
        <div className="bible-plays-table">
          <table>
            <thead>
              <tr>
                <th>Play</th>
                <th>Kind</th>
                <th>Status</th>
                <th className="num">Made</th>
                <th className="num">Live</th>
                <th className="num">Views</th>
                <th className="num">Estimated</th>
                <th className="num">Paid</th>
                <th className="num">Paid / video</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, s }) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/apps/money-agent-studio?tab=agents`}>{a.name}</Link>
                    {a.niche && <small>{a.niche}</small>}
                  </td>
                  <td>{AGENT_KINDS.find((k) => k.id === a.kind)?.label}</td>
                  <td>{a.status === "active" ? "running" : "paused"}</td>
                  <td className="num">{s.made}</td>
                  <td className="num">{s.live}</td>
                  <td className="num">{compact(s.views)}</td>
                  <td className="num">{money(s.estimated)}</td>
                  <td className="num strong">{money(s.paid)}</td>
                  <td className="num">{s.perVideo ? money(s.perVideo) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
