"use client";

import { useEffect, useMemo, useState } from "react";
import { buildSuperPrompt } from "@/lib/superprompt";
import { recordFor } from "@/lib/timeline/appRecords";
import { buildChangeItPrompt } from "@/lib/timeline/records";
import type { Feature, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "../icons";
import { GhostButton, Modal, PrimaryButton } from "../Modal";

export type SuperPromptMode = "change" | "rebuild";

const MODES: { id: SuperPromptMode; label: string; hint: string }[] = [
  { id: "change", label: "Change it", hint: "Edit the app that exists — change one thing, keep everything else working." },
  { id: "rebuild", label: "Rebuild", hint: "Build the whole project from scratch in a fresh agent session." },
];

export function SuperPromptModal({
  project,
  open,
  onClose,
  initialMode = "change",
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
  initialMode?: SuperPromptMode;
}) {
  const record = recordFor(project);
  const [mode, setMode] = useState<SuperPromptMode>(initialMode);
  const [request, setRequest] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) setMode(initialMode);
  }, [open, initialMode]);

  const prompt = useMemo(() => {
    if (!open) return "";
    if (mode === "change") {
      return buildChangeItPrompt({
        name: project.name,
        request,
        record,
        project,
        edits: project.edits ?? [],
        today: new Date().toISOString().slice(0, 10),
      });
    }
    // An app with no saved features still has a record — rebuild from it.
    const withRecord =
      record && !project.features.length
        ? { ...project, features: record.features.map((t, i): Feature => asFeature(project.id, t, i)) }
        : project;
    return buildSuperPrompt(withRecord);
  }, [open, mode, project, record, request]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be blocked; the user can still select the text */
    }
  };

  const download = () => {
    const blob = new Blob([prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${mode === "change" ? "change-it" : "build-prompt"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const words = prompt ? prompt.trim().split(/\s+/).length : 0;
  const active = MODES.find((m) => m.id === mode)!;
  const cli = record ? `npm run change-it -- ${record.slug} "${request.trim().replace(/"/g, "'") || "what to change"}"` : null;

  return (
    <Modal
      open={open}
      title="Super Prompt"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-ink-faint tabular-nums">
            {words.toLocaleString()} words · {mode === "change" ? "edit-ready" : "build-ready"}
          </span>
          <GhostButton onClick={download}>Download .md</GhostButton>
          <PrimaryButton onClick={copy}>
            {copied ? <Icon.Check width={16} height={16} /> : null}
            {copied ? "Copied!" : "Copy prompt"}
          </PrimaryButton>
        </>
      }
    >
      <div role="radiogroup" aria-label="Prompt mode" className="mb-3 inline-flex rounded-xl border border-line bg-canvas p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
              mode === m.id ? "bg-brand text-white" : "text-ink-muted hover:text-ink",
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs leading-relaxed text-ink-muted">
        {active.hint}{" "}
        {mode === "change"
          ? record
            ? `Built from docs/apps/${record.slug}.md — its features, what must keep working, the sign-in, routes, data rules, keys and tests the code has, and every edit since the record was reviewed.`
            : "Built from this project's overview, features and Knowledge Inbox."
          : "Synthesised from the overview, features, version history and entire Knowledge Inbox."}
      </p>

      {mode === "change" && (
        <div className="mb-3">
          <label htmlFor="change-it-request" className="mb-1 block text-xs font-semibold text-ink">
            What should change?
          </label>
          <textarea
            id="change-it-request"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            rows={3}
            autoFocus
            placeholder="e.g. Add one-click Google sign-in to the welcome screen"
            className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand/60 focus:outline-none"
          />
          {cli && (
            <p className="mt-1 break-all text-[11px] text-ink-faint">
              Same prompt from a terminal: <code className="text-ink-muted">{cli}</code>
            </p>
          )}
        </div>
      )}

      <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas p-4 text-xs leading-relaxed text-ink-muted">
        {prompt}
      </pre>
    </Modal>
  );
}

function asFeature(projectId: string, text: string, i: number): Feature {
  const [title, ...rest] = text.split(" — ");
  return {
    id: `record-${i}`,
    project_id: projectId,
    title,
    description: rest.join(" — "),
    group: "core",
    created_at: new Date(0).toISOString(),
  };
}
