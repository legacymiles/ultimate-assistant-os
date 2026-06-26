"use client";

import { useMemo, useState } from "react";
import { buildSuperPrompt } from "@/lib/superprompt";
import type { Project } from "@/lib/types";
import { Icon } from "../icons";
import { GhostButton, Modal, PrimaryButton } from "../Modal";

export function SuperPromptModal({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const prompt = useMemo(() => (open ? buildSuperPrompt(project) : ""), [open, project]);
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

  const download = () => {
    const blob = new Blob([prompt], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-build-prompt.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const words = prompt ? prompt.trim().split(/\s+/).length : 0;

  return (
    <Modal
      open={open}
      title="Super Prompt"
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-ink-faint">
            {words.toLocaleString()} words · build-ready
          </span>
          <GhostButton onClick={download}>Download .md</GhostButton>
          <PrimaryButton onClick={copy}>
            {copied ? <Icon.Check width={16} height={16} /> : null}
            {copied ? "Copied!" : "Copy prompt"}
          </PrimaryButton>
        </>
      }
    >
      <p className="mb-3 text-xs leading-relaxed text-ink-muted">
        A detailed, build-ready prompt synthesised from this project&apos;s overview, features,
        version history and entire Knowledge Inbox — optimised for an agentic coding model like
        Claude Code. Paste it into a fresh agent session to build the project from scratch.
      </p>
      <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-canvas p-4 text-xs leading-relaxed text-ink-muted">
        {prompt}
      </pre>
    </Modal>
  );
}
