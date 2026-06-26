"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Field, Modal, PrimaryButton, GhostButton, inputClass } from "../Modal";

export function AddVersionModal({
  projectId,
  suggestedNumber,
  open,
  onClose,
}: {
  projectId: string;
  suggestedNumber: string;
  open: boolean;
  onClose: () => void;
}) {
  const addVersion = useStore((s) => s.addVersion);
  const busy = useStore((s) => s.busy);
  const [number, setNumber] = useState(suggestedNumber);
  const [summary, setSummary] = useState("");

  const submit = async () => {
    if (!number.trim()) return;
    await addVersion(projectId, { number: number.trim(), summary: summary.trim() });
    setSummary("");
    onClose();
  };

  return (
    <Modal
      open={open}
      title="New Version"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || !number.trim()}>
            Add Version
          </PrimaryButton>
        </>
      }
    >
      <Field label="Version Number">
        <input
          autoFocus
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="e.g. 3.0"
          className={inputClass}
        />
      </Field>
      <Field label="Summary" hint="What changed in this version?">
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          placeholder="Describe this version…"
          className={inputClass + " resize-none"}
        />
      </Field>
    </Modal>
  );
}
