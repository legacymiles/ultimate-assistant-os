"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import {
  addPersonRef,
  createPerson,
  deletePerson,
  MAX_PERSON_REFS,
  removePersonRef,
  updatePerson,
} from "@/lib/recall/photos/store";
import { ROLE_LABELS } from "@/lib/recall/photos/types";
import type { Person, PersonRole, PhotosData } from "@/lib/recall/photos/types";
import { invalidateContactSheet, toThumb } from "@/lib/recall/photos/vision";
import { buildSheet, evidenceCount, sheetIsStale } from "@/lib/recall/photos/characters";
import { characterToken } from "@/lib/studio/characters";

// ---------------------------------------------------------------------------
// People.
//
// This is the screen that makes auto-filing work, so it says so plainly: a
// person with no reference faces cannot be recognised, and the UI shows that as
// a warning on the card rather than letting the user wonder why their photos
// keep landing in Unsorted.
//
// Reference faces are stored as small square crops in the SAME synced blob as
// the rest of the people list — a few kilobytes each — so a phone and a laptop
// recognise the same family without re-teaching either one.
// ---------------------------------------------------------------------------

const ROLE_ORDER: PersonRole[] = ["self", "partner", "child", "relative", "friend", "other"];

const ROLE_HINT: Record<PersonRole, string> = {
  self: "You. Needed before any “me and …” folder can work.",
  partner: "Your partner.",
  child: "Your kids — each one gets their own folder.",
  relative: "Brothers, sisters, parents. Two or more of them means “My Big Family”.",
  friend: "Friends and everyone else worth naming.",
  other: "Anyone else you want filed by name.",
};

interface Props {
  data: PhotosData;
  onData: (data: PhotosData) => void;
  onToast: (msg: string) => void;
  onClose: () => void;
}

export function PeopleManager({ data, onData, onToast, onClose }: Props) {
  const [editing, setEditing] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);
  const hasSelf = data.people.some((p) => p.role === "self");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function remove(p: Person) {
    if (!window.confirm(`Remove ${p.name}? Photos already filed stay where they are.`)) return;
    onData(deletePerson(p.id));
    invalidateContactSheet();
    onToast(`${p.name} removed`);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-2xl rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
            <Icon.Users width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">People Dashboard can recognise</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        <p className="mb-3 text-[11.5px] leading-relaxed text-ink-muted">
          Name the people who matter and give each of them up to {MAX_PERSON_REFS} clear photos of
          their face &mdash; different angles, different hair, different years. Every one of them
          goes onto a labelled reference sheet that is shown to the vision model alongside each new
          photo, so it answers &ldquo;which of these people is this?&rdquo; instead of guessing.
          Then press <strong className="font-semibold text-ink">Describe</strong> to have their
          face written down: recognition gets told which features to compare, and you can
          <span className="text-ink"> @their&#8209;name</span> in a Studio prompt to put them in a
          video without uploading anything. Everything stays in your own storage.
        </p>

        {!hasSelf && data.people.length > 0 && (
          <p className="mb-3 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11.5px] text-amber-200">
            Nobody is marked as <strong>Me</strong> yet. Selfies, &ldquo;Me &amp; …&rdquo; and
            &ldquo;My Little Family&rdquo; all need to know which face is yours.
          </p>
        )}

        <div className="space-y-2">
          {data.people.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              onEdit={() => setEditing(p)}
              onRemove={() => remove(p)}
              onData={onData}
              onToast={onToast}
            />
          ))}
        </div>

        {data.people.length === 0 && (
          <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
            <p className="text-sm font-medium text-ink">Start with yourself</p>
            <p className="mx-auto mt-1 max-w-xs text-[11.5px] leading-relaxed text-ink-muted">
              Add yourself first, then your partner and kids. Every folder you listed falls out of
              who is in the picture.
            </p>
          </div>
        )}

        <button
          onClick={() => setAdding(true)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2.5 text-xs font-medium text-ink-faint transition hover:border-amber-400/50 hover:text-amber-300"
        >
          <Icon.Plus width={14} height={14} /> Add someone
        </button>
      </div>

      {(adding || editing) && (
        <PersonDialog
          initial={editing}
          suggestSelf={!hasSelf && !editing}
          onSubmit={(name, role, notes) => {
            if (editing) {
              onData(updatePerson(editing.id, { name, role, notes }));
              onToast("Saved");
            } else {
              onData(createPerson({ name, role, notes }));
              onToast(`${name} added — now give them a few photos`);
            }
            invalidateContactSheet();
          }}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PersonCard({
  person,
  onEdit,
  onRemove,
  onData,
  onToast,
}: {
  person: Person;
  onEdit: () => void;
  onRemove: () => void;
  onData: (d: PhotosData) => void;
  onToast: (m: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function addFaces(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    let latest: PhotosData | null = null;
    for (const file of Array.from(files).slice(0, MAX_PERSON_REFS)) {
      // 256px at high quality. This crop is not a thumbnail — it is the picture
      // recognition later compares a stranger's face against, and JPEG artefacts
      // land on exactly the fine detail (eyelids, a nose line, a hairline) that
      // tells two relatives apart. A few extra kilobytes each is the right trade.
      const url = await toThumb(file, 256, 0.9);
      if (url) latest = addPersonRef(person.id, url);
    }
    if (latest) onData(latest);
    invalidateContactSheet();
    setBusy(false);
    onToast(`Reference photos added for ${person.name}`);
  }

  return (
    <div className="rounded-xl border border-line bg-canvas p-2.5">
      <div className="flex items-center gap-2">
        {person.refs[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={person.refs[0]}
            alt={person.name}
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-panel-2 text-ink-faint">
            <Icon.Users width={15} height={15} />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-ink">{person.name}</span>
          <span className="block text-[11px] text-ink-muted">
            {ROLE_LABELS[person.role]}
            {person.refs.length > 0 && ` · ${person.refs.length} reference ${person.refs.length === 1 ? "photo" : "photos"}`}
          </span>
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void addFaces(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="shrink-0 rounded-lg border border-line px-2 py-1.5 text-[11px] text-ink-muted transition hover:text-ink disabled:opacity-50"
        >
          {busy ? "Adding…" : "Add photos"}
        </button>
        <button
          onClick={onEdit}
          aria-label={`Edit ${person.name}`}
          className="shrink-0 rounded-lg p-1.5 text-ink-faint hover:text-ink"
        >
          <Icon.Edit width={13} height={13} />
        </button>
        <button
          onClick={onRemove}
          aria-label={`Remove ${person.name}`}
          className="shrink-0 rounded-lg p-1.5 text-ink-faint hover:text-red-400"
        >
          <Icon.Trash width={13} height={13} />
        </button>
      </div>

      {person.refs.length === 0 ? (
        <p className="mt-2 rounded-lg bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-200">
          No face photos yet — {person.name} can&apos;t be recognised in new pictures until there
          is at least one.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {person.refs.map((r, i) => (
            <span key={i} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r} alt="" className="h-11 w-11 rounded-lg object-cover" />
              <button
                onClick={() => {
                  onData(removePersonRef(person.id, i));
                  invalidateContactSheet();
                }}
                aria-label="Remove this reference photo"
                className="absolute -right-1 -top-1 hidden rounded-full bg-canvas p-0.5 text-ink-faint shadow group-hover:block hover:text-red-400"
              >
                <Icon.Close width={11} height={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <CharacterPanel person={person} onData={onData} onToast={onToast} />
    </div>
  );
}

/**
 * What the app has written down about this person.
 *
 * It sits on their card rather than behind a menu because it is the answer to
 * the two things the owner actually asks of this screen: why a face is still not
 * being recognised, and how to put this person in a video. One paragraph covers
 * both, and the row above it says what the description was written from — so
 * "add more photos, then rebuild" is a visible instruction rather than folklore.
 */
function CharacterPanel({
  person,
  onData,
  onToast,
}: {
  person: Person;
  onData: (d: PhotosData) => void;
  onToast: (m: string) => void;
}) {
  const subject = { kind: "person" as const, person };
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");
  const [open, setOpen] = useState(false);
  const { refs, filed } = evidenceCount(subject);
  const total = refs + filed;
  const sheet = person.sheet ?? null;
  const stale = sheetIsStale(subject);
  const token = characterToken(person.name);

  async function describe() {
    setBusy(true);
    setWarning("");
    const result = await buildSheet(subject);
    setBusy(false);
    if (result.error) {
      onToast(result.error);
      return;
    }
    if (result.data) onData(result.data);
    if (result.warning) setWarning(result.warning);
    setOpen(true);
    onToast(`${person.name} described from ${result.used} picture${result.used === 1 ? "" : "s"}`);
  }

  return (
    <div className="mt-2.5 border-t border-line pt-2.5">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-ink-muted">Character sheet</span>
        {sheet ? (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-[11px] text-ink-faint transition hover:text-ink"
          >
            {open ? "Hide" : "Read"}
            {/* A right chevron turns DOWN to open and back to the right to close.
                Rotating it 180 would point it left, which reads as "go back". */}
            <Icon.Chevron
              width={11}
              height={11}
              className={`transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="text-[11px] text-ink-faint">not written yet</span>
        )}
        <span className="ml-auto text-[11px] text-ink-faint">
          {total === 0
            ? "no pictures to read"
            : `${total} picture${total === 1 ? "" : "s"} known${filed ? ` (${filed} from their folders)` : ""}`}
        </span>
        <button
          onClick={() => void describe()}
          disabled={busy || total === 0}
          className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-muted transition hover:border-amber-400/50 hover:text-amber-200 disabled:opacity-40"
        >
          {busy ? "Reading their photos…" : sheet ? "Rebuild" : "Describe"}
        </button>
      </div>

      {stale && !busy && (
        <p className="mt-1.5 text-[11px] text-amber-200/90">
          There are more pictures of {person.name} now than the {sheet?.builtFrom} this was written
          from. Rebuild to use them.
        </p>
      )}
      {warning && (
        <p className="mt-1.5 rounded-lg bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-200">
          {warning}
        </p>
      )}

      {sheet && open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11.5px] leading-relaxed text-ink-muted">{sheet.appearance}</p>
          {sheet.identifiers.length > 0 && (
            <div>
              <p className="mb-1 text-[10.5px] text-ink-faint">
                Matched on these, because photographs cannot change them
              </p>
              <div className="flex flex-wrap gap-1">
                {sheet.identifiers.map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-muted"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          {sheet.wardrobe && (
            <p className="text-[11px] text-ink-faint">Usually wears: {sheet.wardrobe}</p>
          )}
          <p className="text-[11px] text-ink-faint">
            Write <span className="text-ink">@{token}</span> in a Studio prompt to put {person.name}
            {" "}in a shot. Their face goes with it; you don&apos;t upload anything.
          </p>
        </div>
      )}
    </div>
  );
}

function PersonDialog({
  initial,
  suggestSelf,
  onSubmit,
  onClose,
}: {
  initial: Person | null;
  suggestSelf: boolean;
  onSubmit: (name: string, role: PersonRole, notes: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState<PersonRole>(initial?.role ?? (suggestSelf ? "self" : "child"));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  function submit() {
    if (!name.trim()) return;
    onSubmit(name.trim(), role, notes);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 p-4 pt-[18vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-sm rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-sm font-semibold text-ink">{initial ? "Edit person" : "Add someone"}</p>
        <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Name
        </label>
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Leo"
          className="mb-3 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />
        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Who they are
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ROLE_ORDER.map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={
                "rounded-full border px-2.5 py-1 text-[11px] transition " +
                (role === r
                  ? "border-amber-400 bg-amber-400/15 font-medium text-amber-200"
                  : "border-line text-ink-muted hover:text-ink")
              }
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{ROLE_HINT[role]}</p>

        <label className="mb-1 mt-3 block text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          Note <span className="normal-case tracking-normal text-ink-faint/70">optional</span>
        </label>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Anything that helps you remember"
          className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/25"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-2 disabled:opacity-40"
          >
            {initial ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
