"use client";

// H3 Connection — the PC worker that drives WanGP, what it last reported, a
// pass/fail checklist built only from that report and the hub's own config,
// the render queue, failures, and pairing a new worker.

import { useState, type ReactNode } from "react";
import { Check, CircleSlash, Copy, KeyRound, RotateCcw, X, Minus } from "lucide-react";
import type { Generation } from "@/lib/h3-lab/model";
import { genreName } from "@/lib/h3-lab/genres";
import type { SectionProps } from "../sections";
import { Chip, Empty, Panel, SectionHead, StatusChip, ago, when } from "../ui";

const ONLINE_MS = 90_000;
const H3_MODELS = ["minimax_h3_ref2va_pruned", "minimax_h3_fl2va_pruned"];

type DiagRow = { label: string; state: "pass" | "fail" | "warn" | "na"; detail: string };

export default function Connection({ lab, go }: SectionProps) {
  const s = lab.state;
  const m = lab.meta;
  const w = s.worker;
  const online = !!w.lastSeen && Date.now() - Date.parse(w.lastSeen) < ONLINE_MS;
  const everSeen = !!w.lastSeen;
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const missingModels = H3_MODELS.filter((id) => !w.models.includes(id));
  const checks: DiagRow[] = [
    m
      ? { label: "Hub storage", state: m.storage === "remote" ? "pass" : "warn", detail: m.storage === "remote" ? "Supabase server_docs — every device sees the same lab." : "A local file on the machine serving this page — only this machine sees the lab." }
      : { label: "Hub storage", state: "na", detail: "Not reported yet." },
    m
      ? { label: "Worker paired", state: m.workerPaired ? "pass" : "fail", detail: m.workerPaired ? "A worker token has been created." : "No worker token yet — create one below." }
      : { label: "Worker paired", state: "na", detail: "Not reported yet." },
    { label: "Worker online", state: online ? "pass" : "fail", detail: everSeen ? `Last check-in ${ago(w.lastSeen)}${w.machine ? ` from ${w.machine}` : ""}.` : "The worker has never checked in." },
    !everSeen
      ? { label: "WanGP MCP ready", state: "na", detail: "Reported by the worker once it checks in." }
      : { label: "WanGP MCP ready", state: online && (w.wangp === "ready" || w.wangp === "busy") ? "pass" : "fail", detail: `${online ? w.wangp : "last known: " + w.wangp}${w.wangpDetail ? ` — ${w.wangpDetail}` : ""}` },
    !everSeen
      ? { label: "H3 models present", state: "na", detail: "Reported by the worker once it checks in." }
      : { label: "H3 models present", state: missingModels.length ? "fail" : "pass", detail: missingModels.length ? `WanGP did not report: ${missingModels.join(", ")}.` : "Ref2VA and FL2VA pruned models reported." },
    !everSeen
      ? { label: "ffmpeg present", state: "na", detail: "Reported by the worker once it checks in." }
      : { label: "ffmpeg present", state: w.ffmpeg ? "pass" : "fail", detail: w.ffmpeg ? "Clips get measured (cuts, SSIM, freezes, camera motion)." : "Without ffmpeg nothing is measured — set FFMPEG_PATH in the worker's .env." },
    !everSeen
      ? { label: "Claude Code CLI", state: "na", detail: "Reported by the worker once it checks in." }
      : {
          label: "Claude Code CLI",
          state: w.claude ? "pass" : s.agent.brain === "claude-code" ? "fail" : "na",
          detail: w.claude ? "Available for think jobs." : s.agent.brain === "claude-code" ? "Brain is set to Claude Code but the worker cannot find the claude CLI." : "Not found, and not needed while the brain is the hub's AI.",
        },
    m
      ? {
          label: "Hub AI configured",
          state: m.aiConfigured ? "pass" : s.agent.brain === "hub-ai" ? "fail" : "na",
          detail: m.aiConfigured ? "The hub has a key for vision judging and reasoning." : s.agent.brain === "hub-ai" ? "Brain is the hub's AI but no key is set — judging falls back to measurements only." : "No key, and not needed while the brain is Claude Code.",
        }
      : { label: "Hub AI configured", state: "na", detail: "Not reported yet." },
    m
      ? { label: "Scheduled tick", state: m.tickConfigured ? "pass" : "warn", detail: m.tickConfigured ? "A scheduled job can move the agent forward with the PC off." : "No H3LAB_TICK_TOKEN on this deploy — the agent advances only from the worker's idle tick or an open lab page." }
      : { label: "Scheduled tick", state: "na", detail: "Not reported yet." },
  ];

  const inFlight = s.generations
    .filter((g) => g.status === "queued" || g.status === "claimed" || g.status === "rendering")
    .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  const failures = s.generations
    .filter((g) => g.status === "failed")
    .sort((a, b) => (b.finishedAt ?? b.queuedAt).localeCompare(a.finishedAt ?? a.queuedAt))
    .slice(0, 12);
  const current = w.current ? s.generations.find((g) => g.id === w.current) : undefined;

  async function mint() {
    const res = await lab.act({ action: "worker.token" }, "Create worker token");
    if (res?.token) {
      setToken(res.token);
      setCopied(false);
    }
  }

  async function copyToken() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <SectionHead
        eyebrow="H3 Connection"
        title="The PC, WanGP and the render queue"
        lede="Renders run on the PC with Pinokio. A small worker there polls this site for work and posts results back — the website never calls the PC, so nothing local is exposed."
      />

      {!online ? (
        <div className="notice">
          <b>{everSeen ? `The worker was last seen ${ago(w.lastSeen)}.` : "No worker has checked in yet."}</b>{" "}
          Renders need the PC on with the worker running. Queued renders ({inFlight.filter((g) => g.status === "queued").length}) wait and resume when it returns.
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Panel title="Worker status" meta={everSeen ? `seen ${ago(w.lastSeen)}` : "never seen"} bodyClass="tbl-wrap">
          <table className="tbl">
            <tbody>
              <Fact k="Last seen" v={<><span className={`lamp ${online ? "on" : "bad"}`} style={{ display: "inline-block", marginRight: 7 }} />{w.lastSeen ? `${when(w.lastSeen)} (${ago(w.lastSeen)})` : "never"}</>} />
              <Fact k="Machine" v={w.machine || "—"} />
              <Fact k="Worker version" v={<span className="mono">{w.version || "—"}</span>} />
              <Fact k="WanGP" v={<><Chip tone={w.wangp === "ready" ? "good" : w.wangp === "busy" ? "cyan" : w.wangp === "down" ? "bad" : undefined}>{w.wangp}</Chip> <span className="dim">{w.wangpDetail}</span></>} />
              <Fact k="ffmpeg" v={everSeen ? (w.ffmpeg ? "found" : "missing") : "—"} />
              <Fact k="Claude Code CLI" v={everSeen ? (w.claude ? "found" : "missing") : "—"} />
              <Fact k="Models" v={w.models.length ? <span className="row" style={{ gap: 4 }}>{w.models.map((x) => <Chip key={x} tone={H3_MODELS.includes(x) ? "amber" : undefined}>{x}</Chip>)}</span> : <span className="muted">none reported</span>} />
              <Fact
                k="Rendering now"
                v={
                  w.current ? (
                    <button type="button" className="btn sm ghost" onClick={() => go("compare", w.current!)}>
                      {current ? `${genreName(current.genre)} · ${current.arm}` : w.current}
                    </button>
                  ) : (
                    <span className="muted">nothing</span>
                  )
                }
              />
              <Fact k="Worker's queue depth" v={<span className="mono">{w.queueDepth}</span>} />
            </tbody>
          </table>
        </Panel>

        <Panel title="Diagnostics" meta={`${checks.filter((c) => c.state === "pass").length}/${checks.filter((c) => c.state !== "na").length} passing`} bodyClass="tbl-wrap">
          <table className="tbl">
            <tbody>
              {checks.map((c) => (
                <tr key={c.label}>
                  <td style={{ width: 26 }}>
                    {c.state === "pass" ? <Check size={15} color="var(--good)" aria-label="pass" />
                      : c.state === "fail" ? <X size={15} color="var(--bad)" aria-label="fail" />
                        : c.state === "warn" ? <Minus size={15} color="var(--warn)" aria-label="warning" />
                          : <CircleSlash size={14} color="var(--ink-4)" aria-label="not applicable" />}
                  </td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{c.label}</td>
                  <td className="dim" style={{ minWidth: 220 }}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Render queue" meta={`${inFlight.length} in flight`} bodyClass="tbl-wrap">
        {inFlight.length ? (
          <table className="tbl">
            <thead><tr><th>Render</th><th>Genre</th><th>Arm</th><th>Experiment</th><th>Status</th><th>Queued</th><th /></tr></thead>
            <tbody>
              {inFlight.map((g) => (
                <QueueRow key={g.id} g={g} s={s} lab={lab} go={go} />
              ))}
            </tbody>
          </table>
        ) : (
          <div className="panel-body">
            <Empty title="Nothing queued">
              Renders queue here when the agent runs an experiment or you render a shot; the worker takes them one at a time.
            </Empty>
          </div>
        )}
      </Panel>

      <Panel title="Recent failures" meta={failures.length ? `last ${failures.length}` : undefined} bodyClass="tbl-wrap">
        {failures.length ? (
          <table className="tbl">
            <thead><tr><th>Render</th><th>Genre</th><th>Failed</th><th>Error</th><th /></tr></thead>
            <tbody>
              {failures.map((g) => (
                <tr key={g.id}>
                  <td><button type="button" className="btn sm ghost mono" onClick={() => go("compare", g.id)}>{g.id.slice(-8)}</button></td>
                  <td className="dim">{genreName(g.genre)}</td>
                  <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{when(g.finishedAt)}</td>
                  <td style={{ color: "var(--bad)", minWidth: 240, fontSize: 12 }}>{g.error || "No error text was reported."}</td>
                  <td>
                    <button type="button" className="btn sm" disabled={!!lab.busy} onClick={() => void lab.act({ action: "generation.retry", id: g.id }, "Retry render")}>
                      <RotateCcw size={12} /> Retry
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted panel-body" style={{ margin: 0 }}>No failed renders.</p>
        )}
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Panel title="Pair a worker" actions={<button type="button" className="btn primary sm" disabled={!!lab.busy} onClick={() => void mint()}><KeyRound size={13} /> Create worker token</button>}>
          {token ? (
            <div className="notice" style={{ marginBottom: 12 }}>
              <b>Copy this token now — it is shown once.</b>
              <div className="row" style={{ marginTop: 8, flexWrap: "nowrap" }}>
                <code className="mono" style={{ flex: 1, minWidth: 0, overflowX: "auto", whiteSpace: "nowrap", padding: "6px 8px", background: "var(--bg-grain)", border: "1px solid var(--line)", borderRadius: 4 }}>{token}</code>
                <button type="button" className="btn sm" onClick={() => void copyToken()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}</button>
              </div>
            </div>
          ) : (
            <p className="dim" style={{ marginTop: 0 }}>
              {m?.workerPaired ? "A worker is already paired. Creating a new token is how you pair another PC or replace a lost token." : "Create a token, then set up the worker on the PC that runs Pinokio."}
            </p>
          )}
          <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
            <li>Copy <code className="mono">tools/h3-lab-worker/.env.example</code> to <code className="mono">.env</code> in the same folder.</li>
            <li>
              Set <code className="mono">HUB_URL={origin || "this site's address"}</code> and <code className="mono">H3LAB_TOKEN</code> to the token.
            </li>
            <li>
              Run <code className="mono">node tools/h3-lab-worker/worker.mjs --doctor</code> to check WanGP, ffmpeg and the hub, then <code className="mono">start-worker.cmd</code> — or <code className="mono">install-autostart.cmd</code> to start it at sign-in.
            </li>
          </ol>
          <p className="muted" style={{ margin: "12px 0 0", fontSize: 12 }}>
            The worker only makes outgoing requests to this site. Renders need the PC on; while it is off, queued renders wait and resume when it returns.
          </p>
        </Panel>

        <Panel title="This install">
          <table className="tbl">
            <tbody>
              <Fact k="Models on disk" v="MiniMax H3 pruned 20B int8 — FL2VA (first/last frame) and Ref2VA (reference images)" />
              <Fact k="Speed-ups" v="Turbo LoRAs (4-step) and the two-phase upscaler" />
              <Fact k="Text encoder" v="Q2_K quantized" />
              <Fact k="Measured" v={<span><span className="mono">~5.7 min</span> per 5 s turbo clip on the RTX 3050</span>} />
              <Fact k="Quality rungs" v={<span><Chip tone="amber">turbo</Chip> 4-step 832×480 · <Chip>hi</Chip> 20-step two-phase (not yet timed on this PC)</span>} />
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <tr>
      <td className="muted" style={{ whiteSpace: "nowrap", width: 150 }}>{k}</td>
      <td>{v}</td>
    </tr>
  );
}

function QueueRow({ g, s, lab, go }: { g: Generation; s: SectionProps["lab"]["state"]; lab: SectionProps["lab"]; go: SectionProps["go"] }) {
  const e = g.experimentId ? s.experiments.find((x) => x.id === g.experimentId) : undefined;
  return (
    <tr>
      <td><button type="button" className="btn sm ghost mono" onClick={() => go("compare", g.id)}>{g.id.slice(-8)}</button></td>
      <td className="dim">{genreName(g.genre)}</td>
      <td><Chip tone={g.arm === "master" ? "amber" : "cyan"}>{g.arm}</Chip></td>
      <td>{e ? <button type="button" className="btn sm ghost" onClick={() => go("lab", e.id)}>{e.code} · {e.name}</button> : <span className="muted">{g.productionId ? "production" : "single"}</span>}</td>
      <td><StatusChip status={g.status} /></td>
      <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{when(g.queuedAt)}</td>
      <td>
        <button type="button" className="btn sm danger" disabled={!!lab.busy} onClick={() => void lab.act({ action: "generation.cancel", id: g.id }, "Cancel render")}>
          Cancel
        </button>
      </td>
    </tr>
  );
}
