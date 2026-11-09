"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "../Modal";
import { Icon } from "../icons";
import { ProfileAvatar } from "./ProfileAvatar";
import { retrieveForQuestion } from "@/lib/recall/search";
import { createProfile, folderPathString } from "@/lib/recall/store";
import {
  PROFILE_ROLES,
  draftProfileFromJarvis,
  heuristicProfileDraft,
  profileInitials,
  type ProfileDraft,
} from "@/lib/recall/profiles";
import type { Profile, ProfileKind, ProfileRole, RecallData } from "@/lib/recall/types";

interface Props {
  open: boolean;
  initialKind?: ProfileKind;
  initialRole?: ProfileRole;
  data: RecallData;
  onClose: () => void;
  onCreated: (data: RecallData, profile: Profile) => void;
}

/**
 * Add Profile. The first screen is a conversation, not a form: say what you
 * know, Jarvis searches what you already saved, then shows you the card it
 * would build — including the blanks it refuses to invent.
 */
export function ProfileWizard({ open, initialKind, initialRole, data, onClose, onCreated }: Props) {
  const [step, setStep] = useState<"describe" | "draft">("describe");
  const [kind, setKind] = useState<ProfileKind>(initialKind ?? "person");
  const [role, setRole] = useState<ProfileRole>(initialRole ?? "other");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | undefined>(undefined);
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("describe");
    setKind(initialKind ?? "person");
    setRole(initialRole ?? (initialKind === "business" ? "other" : "other"));
    setName("");
    setAvatar(undefined);
    setDescription("");
    setDraft(null);
    setBusy(false);
    setError(null);
  }, [open, initialKind, initialRole]);

  const canAsk = name.trim().length > 0 || description.trim().length > 0;

  async function askJarvis() {
    if (!canAsk || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Only non-credential records are offered as context — a saved password
      // has no business in a profile draft.
      const query = `${name} ${description}`.trim() || kind;
      // retrieveForQuestion excludes credentials and falls back to the most
      // recent records, so "Add profile" still has context on a thin library.
      const hits = retrieveForQuestion(query, data, 6);
      const result = await draftProfileFromJarvis({
        description: (description.trim() || `Create a ${kind} profile named ${name}.`).slice(0, 4000),
        kind,
        name: name.trim().slice(0, 120) || undefined,
        candidates: hits.map((it) => ({
          id: it.id,
          title: it.title,
          summary: it.summary,
          extract: it.extract?.slice(0, 800),
        })),
        folderPaths: data.folders
          .map((f) => folderPathString(data.folders, f.id))
          .slice(0, 120),
        existingTags: [...new Set(data.items.flatMap((it) => it.tags))].slice(0, 80),
        existingProfiles: data.profiles.map((p) => ({
          displayName: p.displayName,
          kind: p.kind,
          role: p.role,
        })),
      });
      setDraft(result);
      setStep("draft");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jarvis could not build that draft.");
    } finally {
      setBusy(false);
    }
  }

  function createNow(candidate?: ProfileDraft) {
    const finalDraft =
      candidate ??
      draft ??
      heuristicProfileDraft({ description, kind, name: name.trim() || undefined });
    if (!finalDraft.displayName.trim()) {
      setError("Give the profile a name first.");
      return;
    }
    const profileRole = finalDraft.kind === "person" ? finalDraft.role ?? role : undefined;
    const created = createProfile({
      kind: finalDraft.kind,
      displayName: finalDraft.displayName,
      role: profileRole,
      headline: finalDraft.headline,
      avatar,
      fields: finalDraft.fields,
      accounts: finalDraft.accounts,
      tags: ["profile", finalDraft.kind, ...(profileRole ? [profileRole] : [])],
    });
    onCreated(created.data, created.profile);
    onClose();
  }

  const knownCount = useMemo(
    () => draft?.fields.filter((f) => f.value.trim()).length ?? 0,
    [draft],
  );

  const footer =
    step === "describe" ? (
      <>
        <button
          onClick={onClose}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink"
        >
          Cancel
        </button>
        <button
          onClick={() => createNow(heuristicProfileDraft({ description, kind, name: name.trim() || undefined }))}
          disabled={!name.trim()}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
          title="Create the blueprint with empty placeholders"
        >
          Create blank
        </button>
        <button
          onClick={() => void askJarvis()}
          disabled={!canAsk || busy}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2 disabled:opacity-40"
        >
          {busy ? (
            <>
              <Icon.Refresh width={15} height={15} className="animate-spin" /> Searching…
            </>
          ) : (
            <>
              <Icon.Sparkles width={15} height={15} /> Ask Jarvis
            </>
          )}
        </button>
      </>
    ) : (
      <>
        <button
          onClick={() => setStep("describe")}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:text-ink"
        >
          Back
        </button>
        <button
          onClick={() => createNow()}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Check width={15} height={15} /> Create profile
        </button>
      </>
    );

  return (
    <Modal open={open} title="Add profile" onClose={onClose} wide footer={footer}>
      {error && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {step === "describe" ? (
        <div>
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-brand/25 bg-brand/[0.07] p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand">
              <Icon.Bot width={18} height={18} />
            </span>
            <p className="text-xs leading-relaxed text-ink-muted">
              Tell me who or what this is. Paste anything you already know — a name, a birthday,
              a login, the date a domain renews. I&apos;ll search your folders, build the card, and
              leave honest blanks for what you haven&apos;t told me.
            </p>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2">
            {(
              [
                ["person", "Person", "Son, client, you", Icon.User],
                ["business", "Business", "Brand, domain, company", Icon.Building],
              ] as const
            ).map(([value, label, hint, KindIcon]) => (
              <button
                key={value}
                onClick={() => {
                  setKind(value);
                  if (value === "business") setRole("other");
                }}
                className={
                  "flex items-start gap-2.5 rounded-xl border p-3 text-left transition " +
                  (kind === value
                    ? "border-brand bg-brand/10"
                    : "border-line bg-canvas hover:border-brand/30")
                }
              >
                <span
                  className={
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg " +
                    (kind === value ? "bg-brand/15 text-brand" : "bg-panel-2 text-ink-faint")
                  }
                >
                  <KindIcon width={16} height={16} />
                </span>
                <span>
                  <span className="block text-[13px] font-semibold text-ink">{label}</span>
                  <span className="block text-[10px] text-ink-faint">{hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-center gap-3 rounded-xl border border-line bg-canvas p-2.5">
            <ProfileAvatar
              profile={{
                displayName: name.trim() || (kind === "business" ? "New business" : "New profile"),
                avatar,
                kind,
              }}
              size={56}
              editable
              onChange={setAvatar}
              onError={(message) => setError(message)}
            />
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-ink">
                {kind === "business" ? "Logo" : "Profile photo"}{" "}
                <span className="font-normal text-ink-faint">optional</span>
              </p>
              <p className="text-[10px] leading-relaxed text-ink-faint">
                Click the photo to upload. It is cropped square and stored with the profile.
              </p>
            </div>
          </div>

          <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_160px]">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                Name <span className="normal-case tracking-normal text-ink-faint/70">optional</span>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canAsk) void askJarvis();
                }}
                placeholder={kind === "person" ? "e.g. Mason" : "e.g. Bighomie AI"}
                className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
              />
            </label>
            {kind === "person" && (
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
                  Relationship
                </span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as ProfileRole)}
                  className="w-full rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                >
                  {PROFILE_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
              What do you know?
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder={
                kind === "person"
                  ? "My son Mason. Born 3/14/2012. He has a Trump account I opened in 2024 — I don't have the login yet."
                  : "Bighomie AI — domain bighomieai.com bought on Cloudflare. Renews 11/2/2027. Hosting on Vercel."
              }
              className="w-full resize-y rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
            />
          </label>
          <p className="mt-2 text-[10px] leading-relaxed text-ink-faint">
            Family members and businesses each get their own folder under <code>Profiles</code>.
            Blank fields stay visible as placeholders — nothing is invented.
          </p>
        </div>
      ) : draft ? (
        <div>
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-canvas p-3">
            <span
              className={
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-semibold ring-1 " +
                (draft.kind === "business"
                  ? "bg-amber-400/15 text-amber-100 ring-amber-400/30"
                  : "bg-brand/15 text-violet-100 ring-brand/30")
              }
            >
              {profileInitials(draft.displayName)}
            </span>
            <div className="min-w-0 flex-1">
              <input
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                className="w-full border-0 bg-transparent p-0 text-lg font-bold tracking-tight text-ink outline-none focus:ring-0"
                aria-label="Profile name"
              />
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                <span className="rounded-full bg-panel-2 px-1.5 py-0.5 font-semibold uppercase tracking-wider">
                  {draft.kind === "business" ? "Business" : "Person"}
                </span>
                {draft.kind === "person" && (
                  <select
                    value={draft.role ?? "other"}
                    onChange={(e) => setDraft({ ...draft, role: e.target.value as ProfileRole })}
                    className="rounded border-0 bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-muted outline-none"
                  >
                    {PROFILE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
                <span className="ml-auto inline-flex items-center gap-1">
                  {draft.engine === "ai" ? (
                    <>
                      <Icon.Sparkles width={10} height={10} /> Jarvis draft
                    </>
                  ) : (
                    <>Offline draft · add an AI key for deeper synthesis</>
                  )}
                </span>
              </div>
            </div>
          </div>

          <p className="mb-4 text-xs leading-relaxed text-ink-muted">{draft.summary}</p>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <section>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  What Jarvis has
                </h3>
                <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] tabular-nums text-ink-faint">
                  {knownCount}/{draft.fields.length}
                </span>
              </div>
              <div className="space-y-2">
                {draft.fields.map((field, i) => (
                  <label key={`${field.label}-${i}`} className="flex items-center gap-2">
                    <span className="w-[104px] shrink-0 text-[11px] text-ink-faint">{field.label}</span>
                    <input
                      value={field.value}
                      placeholder="Not added yet"
                      onChange={(e) => {
                        const fields = draft.fields.map((f, idx) =>
                          idx === i ? { ...f, value: e.target.value } : f,
                        );
                        setDraft({ ...draft, fields });
                      }}
                      type={
                        field.type === "date"
                          ? "date"
                          : field.type === "email"
                            ? "email"
                            : field.type === "url"
                              ? "url"
                              : field.type === "phone"
                                ? "tel"
                                : "text"
                      }
                      className={
                        "min-w-0 flex-1 rounded-lg border bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand " +
                        (field.value ? "border-line text-ink" : "border-dashed border-line/70 text-ink-faint")
                      }
                    />
                  </label>
                ))}
              </div>
            </section>

            <div className="space-y-4">
              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  Jarvis will ask you
                </h3>
                {draft.questions.length ? (
                  <ul className="space-y-1.5">
                    {draft.questions.map((q, i) => (
                      <li key={i} className="flex gap-2 rounded-lg border border-line bg-canvas px-2.5 py-2 text-[11px] leading-relaxed text-ink-muted">
                        <Icon.Sparkles width={11} height={11} className="mt-0.5 shrink-0 text-brand" />
                        {q}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-line bg-canvas px-2.5 py-2 text-[11px] text-ink-faint">
                    Nothing important is missing — add more later from the profile.
                  </p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  Accounts it will create
                </h3>
                {draft.accounts.length ? (
                  <ul className="space-y-1.5">
                    {draft.accounts.map((a, i) => (
                      <li key={`${a.label}-${i}`} className="rounded-lg border border-line bg-canvas px-2.5 py-2 text-[11px]">
                        <span className="block font-medium text-ink">{a.label}</span>
                        <span className="text-ink-faint">
                          {[a.provider, a.openedDate && `opened ${a.openedDate}`, a.renewalDate && `renews ${a.renewalDate}`]
                            .filter(Boolean)
                            .join(" · ") || "placeholders only"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-lg border border-line bg-canvas px-2.5 py-2 text-[11px] text-ink-faint">
                    None yet — add the Trump account, a bank or a domain from the profile.
                  </p>
                )}
              </section>

              {draft.sources.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    Read from your records
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {draft.sources.map((s) => (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-canvas px-2 py-1 text-[10px] text-ink-muted">
                        <Icon.File width={10} height={10} /> {s.title}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
