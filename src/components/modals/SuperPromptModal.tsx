"use client";

import { useMemo, useState } from "react";
import { buildSuperPrompt } from "@/lib/superprompt";
import type { AppDoc } from "@/lib/timeline/appDocs";
import { buildChangePrompt, buildRepoBrief, CHANGE_STARTERS } from "@/lib/timeline/brief";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { GhostButton, Modal, PrimaryButton } from "../Modal";

type Mode = "build" | "change" | "brief";

const MODES: { id: Mode; label: string; blurb: string }[] = [
  {
    id: "build",
    label: "Build new",
    blurb:
      "Build the project from scratch, from its overview, features, versions and Knowledge Inbox. For a fresh agent session with no code yet.",
  },
  {
    id: "change",
    label: "Change it",
    blurb:
      "Redesign, remix, add or fix something that already exists. Every feature it has goes in as a list the change must keep working.",
  },
  {
    id: "brief",
    label: "Repo brief",
    blurb:
      "This project's whole record as an AGENTS.md. Put it at the root of any repo and every AI tool that opens it reads it first.",
  },
];

const slugOf = (name: string) => name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

export function SuperPromptModal({
  project,
  doc = null,
  open,
  onClose,
}: {
  project: Project;
  /** The repo's doc for this app, when it is a hub app that has one. */
  doc?: AppDoc | null;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("build");
  const [change, setChange] = useState("");
  const prompt = useMemo(() => {
    if (!open) return "";
    if (mode === "change") return buildChangePrompt(project, doc, change);
    if (mode === "brief") return buildRepoBrief(project, doc);
    return buildSuperPrompt(project);
  }, [open, mode, project, doc, change]);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked; the user can still select the text */
    }
  };

  const fileName =
    mode === "brief" ? "AGENTS.md" : `${slugOf(project.name)}-${mode === "change" ? "change" : "build"}-prompt.md`;

  const download = () => {
    const blob = new Blob([prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const words = prompt ? prompt.trim().split(/\s+/).length : 0;
  const featureCount = project.features.length + (doc?.features.length ?? 0);
  const current = MODES.find((m) => m.id === mode)!;

  return (
    <Modal
      open={open}
      title="Super Prompt"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-xs tabular-nums text-ink-faint">
            {words.toLocaleString()} words
            {mode !== "build" && ` · ${featureCount} feature${featureCount === 1 ? "" : "s"} kept`}
          </span>
          <GhostButton onClick={download}>Download {mode === "brief" ? "AGENTS.md" : ".md"}</GhostButton>
          <PrimaryButton onClick={copy}>
            {copied ? <Icon.Check width={16} height={16} /> : null}
            {copied ? "Copied!" : "Copy"}
          </PrimaryButton>
        </>
      }
    >
      <div role="tablist" aria-label="What the prompt is for" className="mb-3 flex gap-1 rounded-xl border border-line bg-canvas p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition",
              mode === m.id ? "bg-brand text-white" : "text-ink-muted hover:bg-panel-2 hover:text-ink",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <p className="mb-3 text-xs leading-relaxed text-ink-muted">
        {current.blurb}
        {mode !== "build" && doc && (
          <>
            {" "}Includes the repo&apos;s own record: <span className="font-mono text-[11px] text-ink-faint">docs/apps/{doc.slug}.md</span>.
          </>
        )}
      </p>

      {mode === "change" && (
        <div className="mb-3">
          <label htmlFor="sp-change" className="mb-1.5 block text-xs font-semibold text-ink">
            What should change?
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {CHANGE_STARTERS.map((s) => (
              <button
                key={s.kind}
                onClick={() => setChange(s.text)}
                className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-muted transition hover:border-brand/50 hover:text-ink"
              >
                {s.label}
              </button>
            ))}
          </div>
          <textarea
            id="sp-change"
            value={change}
            onChange={(e) => setChange(e.target.value)}
            rows={3}
            placeholder="e.g. Make the recipe page feel like a magazine spread, and add a print button."
            className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand/60 focus:outline-none"
          />
        </div>
      )}

      <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas p-4 text-xs leading-relaxed text-ink-muted">
        {prompt}
      </pre>
    </Modal>
  );
}
