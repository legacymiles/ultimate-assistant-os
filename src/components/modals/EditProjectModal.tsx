"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import type { Project } from "@/lib/types";
import { Field, Modal, PrimaryButton, GhostButton, inputClass } from "../Modal";

export function EditProjectModal({
  project,
  open,
  onClose,
}: {
  project: Project;
  open: boolean;
  onClose: () => void;
}) {
  const updateProjectMeta = useStore((s) => s.updateProjectMeta);
  const busy = useStore((s) => s.busy);
  const [name, setName] = useState(project.name);
  const [oneLiner, setOneLiner] = useState(project.one_liner);
  const [overview, setOverview] = useState(project.overview);
  const [detailed, setDetailed] = useState(project.detailed ?? "");

  const submit = async () => {
    if (!name.trim()) return;
    await updateProjectMeta(project.id, {
      name: name.trim(),
      one_liner: oneLiner.trim(),
      overview: overview.trim(),
      detailed: detailed.trim(),
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Edit Project"
      onClose={onClose}
      wide
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || !name.trim()}>
            Save Changes
          </PrimaryButton>
        </>
      }
    >
      <Field label="Project Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="One-Line Summary">
        <input
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Overview" hint="Short, skimmable — a couple of sentences.">
        <textarea
          value={overview}
          onChange={(e) => setOverview(e.target.value)}
          rows={4}
          className={inputClass + " resize-none"}
        />
      </Field>
      <Field
        label="Detailed Explanation"
        hint="The full write-up — every important detail. The AI Analyst keeps this current."
      >
        <textarea
          value={detailed}
          onChange={(e) => setDetailed(e.target.value)}
          rows={10}
          className={inputClass + " resize-y"}
        />
      </Field>
    </Modal>
  );
}
