"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../icons";
import { MAX_CATEGORY_REFS } from "@/lib/recall/photos/store";
import { toThumb } from "@/lib/recall/photos/vision";
import type { PhotoCategory, PhotosData } from "@/lib/recall/photos/types";

// ---------------------------------------------------------------------------
// Make a photo folder, or teach an existing one.
//
// A folder here can be sorted into two different ways, and the dialog says so
// rather than making the user guess:
//
//   by WHO is in the picture — pick people, and the face rules do the work;
//   by WHAT the picture IS   — drop in two or three examples, and new photos
//                              that look like them land here.
//
// The second is the one that makes a folder like "Jobs" or "My Truck" possible
// at all: there is no face to match, so an example is the only thing that can
// describe it. Both can be used at once, and neither is required — a folder
// with neither is simply a folder you file into by hand.
// ---------------------------------------------------------------------------

export interface AlbumDraft {
  name: string;
  description: string;
  requires: string[];
  exact: boolean;
  refs: string[];
}

interface Props {
  photos: PhotosData;
  /** Set when editing; absent when creating. */
  category?: PhotoCategory | null;
  /** Names already taken, so a second "Jobs" is caught before it is created. */
  takenNames: string[];
  onSave: (draft: AlbumDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function AlbumDialog({ photos, category, takenNames, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [requires, setRequires] = useState<string[]>(category?.requires ?? []);
  const [exact, setExact] = useState(category?.exact ?? false);
  const [refs, setRefs] = useState<string[]>(category?.refs ?? []);
  const [error, setError] = useState<string | null>(null);
  const refInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const taken = useMemo(
    () => new Set(takenNames.map((n) => n.trim().toLowerCase()).filter((n) => n !== category?.name.trim().toLowerCase())),
    [takenNames, category],
  );

  async function addRefs(files: File[]) {
    const room = MAX_CATEGORY_REFS - refs.length;
    if (room <= 0) return;
    const next: string[] = [];
    for (const f of files.slice(0, room)) {
      // Stored small and as a data URL: these ride along in every triage
      // request, so a full-size photo here would be paid for on every import.
      const thumb = await toThumb(f, 256);
      if (thumb) next.push(thumb);
    }
    setRefs((r) => [...r, ...next].slice(0, MAX_CATEGORY_REFS));
  }

  function save() {
    const clean = name.trim();
    if (!clean) return setError("Give the folder a name.");
    if (taken.has(clean.toLowerCase())) return setError(`There is already a folder called “${clean}”.`);
    onSave({ name: clean, description: description.trim(), requires, exact, refs });
  }

  const editing = Boolean(category);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        className="animate-fade-in w-full max-w-md rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/15 text-amber-300">
            <Icon.Folder width={15} height={15} />
          </span>
          <span className="text-sm font-semibold text-ink">
            {editing ? `Edit “${category?.name}”` : "New photo folder"}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto rounded-lg p-1 text-ink-faint hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={15} height={15} />
          </button>
        </div>

        <label className="mb-2 block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            Folder name
          </span>
          <input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="e.g. Jobs, My Truck, My Sister"
            className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25"
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            What belongs in here{" "}
            <span className="normal-case tracking-normal text-ink-faint/70">
              optional — the agent reads this
            </span>
          </span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. payslips, job adverts and offer letters"
            className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-amber-400 focus:ring-2 focus:ring-amber-400/25"
          />
        </label>

        {/* Teach by example */}
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
          Reference pictures
        </p>
        <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
          Add two or three examples and new photos that look like them come here on their own — the
          same truck, the same person, the same kind of document. This is the only way a folder with
          no face behind it can sort itself.
        </p>
        <input
          ref={refInput}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addRefs(files);
          }}
        />
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {refs.map((r, i) => (
            <span key={i} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={r} alt={`Reference ${i + 1}`} className="h-full w-full object-cover" />
              <button
                onClick={() => setRefs((x) => x.filter((_, j) => j !== i))}
                aria-label={`Remove reference ${i + 1}`}
                className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
              >
                <Icon.Trash width={13} height={13} />
              </button>
            </span>
          ))}
          {refs.length < MAX_CATEGORY_REFS && (
            <button
              onClick={() => refInput.current?.click()}
              className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-line text-ink-faint transition hover:border-amber-400/60 hover:text-amber-300"
              aria-label="Add a reference picture"
            >
              <Icon.Plus width={15} height={15} />
            </button>
          )}
        </div>

        {/* Teach by who is in it */}
        {photos.people.length > 0 && (
          <>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Or sort by who is in the photo
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {photos.people.map((p) => {
                const on = requires.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() =>
                      setRequires((r) => (on ? r.filter((x) => x !== p.id) : [...r, p.id]))
                    }
                    className={
                      "rounded-lg border px-2.5 py-1 text-[11.5px] transition " +
                      (on
                        ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                        : "border-line text-ink-muted hover:text-ink")
                    }
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
            {requires.length > 0 && (
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-[11.5px] text-ink-muted">
                <input
                  type="checkbox"
                  checked={exact}
                  onChange={(e) => setExact(e.target.checked)}
                  className="h-3.5 w-3.5 accent-amber-500"
                />
                Only when nobody else is in the shot
              </label>
            )}
          </>
        )}

        {error && <p className="mb-2 text-[11px] text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          {editing && onDelete && !category?.builtIn && (
            <button
              onClick={onDelete}
              className="rounded-xl border border-line px-3 py-2 text-[12px] text-red-300 transition hover:border-red-400/50"
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="ml-auto rounded-xl border border-line px-3 py-2 text-[12px] text-ink-muted transition hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="rounded-xl bg-amber-500 px-3.5 py-2 text-[13px] font-semibold text-black transition hover:bg-amber-400"
          >
            {editing ? "Save" : "Create folder"}
          </button>
        </div>

        {!editing && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
            It appears on the Folders tab under <strong className="text-ink-muted">Photos</strong>{" "}
            straight away, and goes to Google Drive with the next backup.
          </p>
        )}
      </div>
    </div>
  );
}
