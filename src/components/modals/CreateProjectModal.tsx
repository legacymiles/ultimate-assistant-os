"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Field, Modal, PrimaryButton, GhostButton, inputClass } from "../Modal";

export function CreateProjectModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const createProject = useStore((s) => s.createProject);
  const busy = useStore((s) => s.busy);
  const [name, setName] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [overview, setOverview] = useState("");
  const [detailed, setDetailed] = useState("");

  const reset = () => {
    setName("");
    setOneLiner("");
    setOverview("");
    setDetailed("");
  };

  const submit = async () => {
    if (!name.trim()) return;
    await createProject({
      name: name.trim(),
      one_liner: oneLiner.trim(),
      overview: overview.trim(),
      detailed: detailed.trim(),
    });
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Create Project"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || !name.trim()}>
            Create Project
          </PrimaryButton>
        </>
      }
    >
      <Field label="Project Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. GoldEA Basket Trader"
          className={inputClass}
        />
      </Field>
      <Field label="One-Line Summary" hint="A short description. The AI can refine this later.">
        <input
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          placeholder="What is this project, in one line?"
          className={inputClass}
        />
      </Field>
      <Field label="Overview" hint="Optional. A short, plain-English summary.">
        <textarea
          value={overview}
          onChange={(e) => setOverview(e.target.value)}
          rows={3}
          placeholder="A short description of the project…"
          className={inputClass + " resize-none"}
        />
      </Field>
      <Field
        label="Detailed Explanation"
        hint="Optional. Paste everything — all the important details. The AI Analyst refines this later."
      >
        <textarea
          value={detailed}
          onChange={(e) => setDetailed(e.target.value)}
          rows={6}
          placeholder="Every rule, number and decision that matters…"
          className={inputClass + " resize-y"}
        />
      </Field>
    </Modal>
  );
}
