"use client";

// Jarvis Skill Integration — the guide publishes into ONE skill, h3-prompt.
// This page shows what is published versus approved, the exact SKILL.md that
// would be written, and how the other H3-related skills on this PC relate.

import { useState } from "react";
import { Check, Copy, Upload } from "lucide-react";
import { currentVersion, skillMarkdown, SKILL_NAME } from "@/lib/h3-lab/guide";
import type { SectionProps } from "../sections";
import { Chip, Panel, SectionHead, ago, when, type Tone } from "../ui";

const RELATED: { name: string; role: string; tone: Tone; relation: string }[] = [
  { name: "h3-prompt", role: "authoritative", tone: "amber", relation: "This guide. Every approved version can be published into it; it is the one skill to use for H3 prompts." },
  { name: "h3-cinematic-prompt", role: "folded in", tone: "warn", relation: "Its camera and structure rules live in the guide's Camera and Shot structure sections. Still installed." },
  { name: "h3-stitched-film", role: "folded in", tone: "warn", relation: "Its one-shot law and clip-plan tokens live in the Long-form section. Still installed." },
  { name: "h3-long-story", role: "folded in", tone: "warn", relation: "Its scene planning lives in the Long-form and Character continuity sections. Still installed." },
  { name: "h3-scene-continuity", role: "referenced", tone: "cyan", relation: "Keeps scripts/continuity.mjs, the measuring tool for stitched films. The guide links to it." },
  { name: "film-plan", role: "linked", tone: undefined, relation: "Planning — decides what the shots are. The guide decides how they are worded. Not merged." },
  { name: "shot-plan-storyboard", role: "linked", tone: undefined, relation: "The storyboard sheet UI. Linked, not merged." },
  { name: "h3-scroll-world", role: "separate", tone: undefined, relation: "A website pipeline that happens to render with H3. Separate." },
  { name: "custom-video-swap · music-video-realistic · viggle-motion-swap", role: "consumers", tone: undefined, relation: "Their H3 steps should load h3-prompt for the wording." },
];

export default function Skill({ lab }: SectionProps) {
  const s = lab.state;
  const v = currentVersion(s.guide);
  const published = s.guide.publishedVersion;
  const behind = published === null || v.version > published;
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const md = skillMarkdown(v);

  async function publish() {
    const res = await lab.act({ action: "guide.publish" }, `Publish v${v.version} to ${SKILL_NAME}`);
    if (res) setConfirming(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <SectionHead
        eyebrow="Jarvis Skill Integration"
        title={<>One skill: <span className="mono" style={{ fontSize: "0.7em", color: "var(--amber)" }}>{SKILL_NAME}</span></>}
        lede="The Master Prompt Guide publishes into the h3-prompt skill. Jarvis, this PC and the VPS all sync skills from the same store, so publishing updates every one of them."
      />

      {behind ? (
        <div className="notice">
          <b>v{v.version} is approved but not published.</b>{" "}
          {published === null ? "The h3-prompt skill has never been written from this lab." : `The skill still carries v${published} (published ${ago(s.guide.publishedAt)}).`}
        </div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <Panel title="Published vs approved">
          <div className="row" style={{ gap: 28, alignItems: "flex-end" }}>
            <div>
              <span className="eyebrow">Approved guide</span>
              <div className="serif" style={{ fontSize: 44, lineHeight: 1, color: "var(--amber)" }}>v{v.version}</div>
              <span className="mono muted" style={{ fontSize: 11 }}>{when(v.createdAt)}</span>
            </div>
            <div>
              <span className="eyebrow">In the skill</span>
              <div className="serif" style={{ fontSize: 44, lineHeight: 1, color: published === null ? "var(--ink-4)" : behind ? "var(--ink-2)" : "var(--amber)" }}>
                {published === null ? "—" : `v${published}`}
              </div>
              <span className="mono muted" style={{ fontSize: 11 }}>{s.guide.publishedAt ? when(s.guide.publishedAt) : "never published"}</span>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {!behind ? (
              <Chip tone="good">v{v.version} is what every device has</Chip>
            ) : !confirming ? (
              <button type="button" className="btn primary" disabled={!!lab.busy} onClick={() => setConfirming(true)}>
                <Upload size={14} /> Publish v{v.version} to the {SKILL_NAME} skill
              </button>
            ) : (
              <div className="notice" style={{ display: "grid", gap: 10 }}>
                <span>
                  This replaces the {SKILL_NAME} skill every device syncs (Jarvis, this PC, the VPS). The previous text stays in the skill store&apos;s history.
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <button type="button" className="btn primary sm" disabled={!!lab.busy} onClick={() => void publish()}>
                    <Upload size={13} /> Yes, publish v{v.version}
                  </button>
                  <button type="button" className="btn ghost sm" onClick={() => setConfirming(false)}>Cancel</button>
                </span>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="How Jarvis uses it">
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }} className="dim">
            <li>
              Jarvis and any Claude session load it through the jarvis-memory connector: <code className="mono">get_skill(&quot;{SKILL_NAME}&quot;)</code>.
            </li>
            <li>Claude Code on this PC reads the same skill from the synced skills folder, so a published version reaches local sessions too.</li>
            <li>The lab never edits the skill on its own — publishing is this button, and nothing else writes it.</li>
          </ul>
        </Panel>
      </div>

      <Panel
        title="SKILL.md preview"
        meta={`v${v.version} · ${md.length.toLocaleString()} characters`}
        actions={
          <button type="button" className="btn sm" onClick={() => void copy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </button>
        }
      >
        <pre className="prompt" style={{ maxHeight: 460, overflowY: "auto" }}>{md}</pre>
      </Panel>

      <Panel title="Related skills found on this PC and how they relate" bodyClass="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Skill</th><th>Role</th><th>Relation to the guide</th></tr></thead>
          <tbody>
            {RELATED.map((r) => (
              <tr key={r.name}>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.name}</td>
                <td><Chip tone={r.tone}>{r.role}</Chip></td>
                <td className="dim" style={{ minWidth: 280 }}>{r.relation}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="panel-body" style={{ display: "grid", gap: 10 }}>
          <div className="notice cyan">
            Retiring the four folded skills (so only h3-prompt remains) changes your Jarvis setup — it is listed as a proposal and nothing has been removed.
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Not found on this PC: <span className="mono">h3-prompt-writing</span>, <span className="mono">3d-animation-short-generator</span> (the latter exists only inside MiniMax&apos;s official repo).
          </p>
        </div>
      </Panel>
    </div>
  );
}
