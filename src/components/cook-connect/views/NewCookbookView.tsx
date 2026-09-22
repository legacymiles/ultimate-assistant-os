"use client";

import { useState } from "react";
import { useCook } from "../CookConnect";
import { Columns, PageHead } from "../Columns";
import { recordActivity } from "@/lib/cook-connect/social";
import { Button, Field, Input, Panel, SectionHead, Spinner, Textarea, cx } from "../ui";

export function NewCookbookView() {
  const { sb, userId, navigate, notify } = useCook();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!userId || !title.trim()) return;
    setSaving(true);
    // The id is made here rather than returned by the insert: a SELECT policy
    // that re-reads the table cannot see a row inside INSERT ... RETURNING.
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `cb-${Date.now()}`;

    const { error } = await sb.from("cookbooks").insert({
      id,
      owner_id: userId,
      title: title.trim(),
      description: description.trim() || null,
      cover_url: null,
      privacy,
    });
    setSaving(false);
    if (error) { notify(`Could not create it: ${error.message}`); return; }

    if (privacy === "public") {
      await recordActivity(sb, {
        kind: "cookbook_published",
        actor_id: userId,
        subject_id: id,
        summary: `published ${title.trim()}`,
      });
    }
    notify(`${title.trim()} is open. Add the first recipe.`);
    navigate({ page: "new-recipe", cookbookId: id });
  };

  return (
    <Columns>
      <PageHead
        title="New cookbook"
        subtitle="A cookbook is a folder with a point of view — a cuisine, a season, a weeknight habit. Give it a name and add the first recipe."
      />

      <div className="max-w-[34rem]">
        <Panel>
          <SectionHead title="Details" />
          <div className="space-y-3 p-3">
            <Field label="Title">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) void create(); }}
                placeholder="Sunday Pot"
                autoFocus
              />
            </Field>

            <Field label="What is in it?" hint="One or two lines. This is what people read in Discover.">
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="One big pot, all afternoon, everybody eats."
              />
            </Field>

            <div>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--cc-ink-faint)]">
                Who can see it
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                {([
                  { id: "public" as const, label: "Public", body: "In Discover, in feeds, and on the leaderboard." },
                  { id: "private" as const, label: "Private", body: "Only you. Nobody can find or save it." },
                ]).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPrivacy(option.id)}
                    aria-pressed={privacy === option.id}
                    className={cx(
                      "rounded-lg border p-2.5 text-left transition-colors duration-150",
                      privacy === option.id
                        ? "border-[var(--cc-ember)] bg-[var(--cc-ember-wash)]"
                        : "border-[var(--cc-line)] bg-[var(--cc-panel-2)] hover:border-[#39405a]",
                    )}
                  >
                    <span className="block text-[13px] font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-[var(--cc-ink-muted)]">
                      {option.body}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-[var(--cc-line)] p-3">
            <Button variant="primary" disabled={!title.trim() || saving} onClick={() => void create()}>
              {saving && <Spinner size={14} />}
              Create and add a recipe
            </Button>
            <Button variant="ghost" onClick={() => navigate({ page: "cookbooks" })}>
              Cancel
            </Button>
          </div>
        </Panel>
      </div>
    </Columns>
  );
}
