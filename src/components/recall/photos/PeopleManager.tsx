"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons";
import {
  addPersonRef,
  createPerson,
  deletePerson,
  removePersonRef,
  updatePerson,
} from "@/lib/recall/photos/store";
import { ROLE_LABELS } from "@/lib/recall/photos/types";
import type { Person, PersonRole, PhotosData } from "@/lib/recall/photos/types";
import { invalidateContactSheet, toThumb } from "@/lib/recall/photos/vision";

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
          Name the people who matter and give each of them two or three clear photos of their face.
          Dashboard builds those into a labelled reference sheet and shows it to the vision model
          alongside every new photo, so it can answer &ldquo;which of these people is in this
          picture?&rdquo; instead of guessing. Everything stays in your own storage.
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
    for (const file of Array.from(files).slice(0, 4)) {
      // A square 256px crop is all the model needs to compare faces, and it
      // keeps six references per person down to a few tens of kilobytes.
      const url = await toThumb(file, 256);
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
