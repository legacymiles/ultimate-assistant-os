"use client";

// ---------------------------------------------------------------------------
// Beyond the build.
//
// Nine buttons and nothing else. This is the whole of the app's position on
// company formation, insurance, branding and the rest: they exist, they are one
// press away, and until that press they are not in the plan and not in the
// prompt. A build plan that opens with "first, form an LLC" is a plan nobody
// reads, and that was the owner's own instruction.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { uid } from "@/lib/bible/ids";
import type { Extra, ExtraTopic, HomeBase, Plan } from "@/lib/bible/types";

const TOPICS: { id: ExtraTopic; label: string }[] = [
  { id: "legal-structure", label: "Legal structure" },
  { id: "insurance", label: "Insurance" },
  { id: "banking", label: "Banking" },
  { id: "taxes", label: "Taxes" },
  { id: "branding", label: "Branding" },
  { id: "marketing", label: "Marketing" },
  { id: "selling-online", label: "Selling online" },
  { id: "hiring", label: "Hiring" },
  { id: "scaling", label: "Scaling" },
];

export function Beyond({
  plan,
  homeBase,
  onPatch,
}: {
  plan: Plan;
  homeBase: HomeBase | null;
  onPatch: (plan: Plan) => void;
}) {
  const [busy, setBusy] = useState<ExtraTopic | null>(null);
  const [error, setError] = useState("");

  const write = async (topic: ExtraTopic) => {
    setBusy(topic);
    setError("");
    try {
      const res = await fetch("/api/bible/extra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, summary: plan.summary, homeBase }),
      });
      const json = await res.json();
      if (!res.ok || !json?.body) {
        setError(json?.error ?? "That did not come back. Try again.");
        return;
      }
      const extra: Extra = {
        id: uid("extra"),
        topic,
        body: json.body,
        createdAt: new Date().toISOString(),
      };
      // Replace an existing answer on the same topic rather than stacking two.
      onPatch({
        ...plan,
        extras: [...plan.extras.filter((e) => e.topic !== topic), extra],
      });
    } catch {
      setError("The connection dropped. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="bible-beyond">
      <h3 className="bible-mini-h">Beyond the build</h3>
      <p>
        None of this is part of making the thing, so none of it is in the plan. Press one and it gets
        written, here, on its own.
      </p>

      <div className="bible-beyond-row">
        {TOPICS.map((t) => {
          const written = plan.extras.find((e) => e.topic === t.id);
          return (
            <button
              key={t.id}
              type="button"
              className="bb"
              disabled={busy !== null}
              onClick={() => void write(t.id)}
            >
              {busy === t.id ? "Writing…" : written ? `${t.label} ↻` : t.label}
            </button>
          );
        })}
      </div>

      {error && <p className="bible-notice" style={{ marginTop: 12 }}>{error}</p>}

      {plan.extras.map((extra) => (
        <article key={extra.id} className="bible-extra">
          <h4>{TOPICS.find((t) => t.id === extra.topic)?.label ?? extra.topic}</h4>
          <div className="bible-extra-body">{extra.body}</div>
        </article>
      ))}
    </section>
  );
}
