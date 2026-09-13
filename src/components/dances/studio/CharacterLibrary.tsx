"use client";

// Your reusable cast. A character is a name, one primary reference image, and
// optional extra angles — made once, used in every dance.

import { useEffect, useRef, useState } from "react";

import { CHARACTER_IMAGE_ACCEPT, api, mediaUrl, prepareCharacterImage, sendJson, uploadMedia } from "@/lib/dance-studio/client";
import { CHARACTER_MAX_EXTRA } from "@/lib/dance-studio/limits";
import type { Character, StudioState } from "@/lib/dance-studio/types";

interface Props {
  state: StudioState;
  onChanged: () => Promise<void>;
  onUse: (characterId: string) => void;
}

export function CharacterLibrary({ state, onChanged, onUse }: Props) {
  const { characters, generations } = state.library;
  const [editing, setEditing] = useState<Character | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [error, setError] = useState("");

  async function patch(id: string, body: Partial<Character>, method = "PATCH") {
    setError("");
    try {
      if (method === "DELETE") await api(`/api/dance-studio/characters/${id}`, { method });
      else await sendJson(`/api/dance-studio/characters/${id}`, body, method);
    } catch (err) {
      setError((err as Error).message);
    }
    await onChanged();
  }

  return (
    <div className="ds-charlib">
      <div className="ds-charlib__head">
        <p className="ds-muted">
          A clear, well-lit, full-body image works best — the character&apos;s proportions should suit the dance (don&apos;t drive a head-and-shoulders portrait with a full-body routine).
        </p>
        <button type="button" className="btn btn--primary" onClick={() => setEditing("new")}>
          New character
        </button>
      </div>
      {error && <p className="dm__err">{error}</p>}

      {characters.length === 0 ? (
        <div className="ds-empty ds-card">
          <p>No characters yet.</p>
        </div>
      ) : (
        <div className="ds-chars">
          {characters.map((c) => {
            const takes = generations.filter((g) => g.characterId === c.id).length;
            return (
              <article key={c.id} className={`ds-char${c.active ? "" : " is-off"}`}>
                <div className="ds-char__img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(c.imageKey)} alt={c.name} />
                </div>
                <div className="ds-char__body">
                  <div className="ds-gtile__title">
                    <strong>{c.name}</strong>
                    <span className={`ds-chip${c.active ? " is-done" : ""}`}>{c.active ? "Active" : "Inactive"}</span>
                  </div>
                  {c.description && <p className="ds-muted">{c.description}</p>}
                  {c.extraImageKeys.length > 0 && (
                    <div className="ds-thumbs">
                      {c.extraImageKeys.map((k) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={k} src={mediaUrl(k)} alt="" />
                      ))}
                    </div>
                  )}
                  <small className="ds-muted">
                    {takes} take{takes === 1 ? "" : "s"}
                  </small>
                  <div className="ds-gtile__actions">
                    <button type="button" className="btn btn--primary" disabled={!c.active} onClick={() => onUse(c.id)}>
                      Use character
                    </button>
                    <button type="button" className="btn" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    <label className="ds-check">
                      <input type="checkbox" checked={c.active} onChange={(e) => patch(c.id, { active: e.target.checked })} />
                      Active
                    </label>
                    {confirmDelete === c.id ? (
                      <button type="button" className="btn btn--danger" onClick={() => patch(c.id, {}, "DELETE")}>
                        Really delete
                      </button>
                    ) : (
                      <button type="button" className="btn btn--quiet" onClick={() => setConfirmDelete(c.id)}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {editing && (
        <CharacterDialog
          character={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

/** An image already converted to the model's format, with a preview of exactly what will be sent. */
interface PreparedImage {
  blob: Blob;
  preview: string;
  name: string;
}

async function prepare(file: File): Promise<PreparedImage> {
  const blob = await prepareCharacterImage(file);
  return { blob, preview: URL.createObjectURL(blob), name: file.name };
}

function firstImage(list: FileList | null | undefined): File | null {
  return Array.from(list ?? []).find((f) => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name)) ?? null;
}

function CharacterDialog({ character, onClose, onSaved }: { character: Character | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(character?.name ?? "");
  const [description, setDescription] = useState(character?.description ?? "");
  const [active, setActive] = useState(character?.active ?? true);
  const [primary, setPrimary] = useState<PreparedImage | null>(null);
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [primaryError, setPrimaryError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [keptExtras, setKeptExtras] = useState<string[]>(character?.extraImageKeys ?? []);
  const [newExtras, setNewExtras] = useState<PreparedImage[]>([]);
  const [extrasBusy, setExtrasBusy] = useState(false);
  const [extrasError, setExtrasError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const primaryInput = useRef<HTMLInputElement>(null);
  const [imageLink, setImageLink] = useState("");

  // Ctrl+V / ⌘V an image anywhere in the dialog. Works where a file picker
  // can't open (embedded browsers) and skips saving a screenshot to disk.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = firstImage(e.clipboardData?.files);
      if (!file) return;
      e.preventDefault();
      void pickPrimary(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // pickPrimary only closes over setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function useImageLink() {
    const url = imageLink.trim();
    if (!url) return;
    setPrimaryBusy(true);
    setPrimaryError("");
    try {
      const res = await fetch("/api/dance-studio/fetch-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Couldn't fetch that image (${res.status}).`);
      const blob = await res.blob();
      const name = decodeURIComponent(new URL(url, window.location.href).pathname.split("/").pop() || "image-from-link");
      setPrimaryBusy(false);
      await pickPrimary(new File([blob], name, { type: blob.type || "image/jpeg" }));
      setImageLink("");
    } catch (err) {
      setPrimaryError((err as Error).message);
      setPrimaryBusy(false);
    }
  }

  const primaryPreview = primary?.preview ?? (character ? mediaUrl(character.imageKey) : null);
  const room = CHARACTER_MAX_EXTRA - keptExtras.length - newExtras.length;

  // Converted on pick, not on save: a file that can't be used says so while it's still in your hand.
  async function pickPrimary(file: File | null) {
    if (!file) return setPrimaryError("That isn't an image file.");
    setPrimaryBusy(true);
    setPrimaryError("");
    try {
      const next = await prepare(file);
      setPrimary((old) => {
        if (old) URL.revokeObjectURL(old.preview);
        return next;
      });
    } catch (err) {
      setPrimaryError((err as Error).message);
    } finally {
      setPrimaryBusy(false);
    }
  }

  async function pickExtras(files: FileList | null) {
    const picked = Array.from(files ?? []).slice(0, room);
    if (!picked.length) return;
    setExtrasBusy(true);
    setExtrasError("");
    const failures: string[] = [];
    for (const f of picked) {
      try {
        const img = await prepare(f);
        setNewExtras((x) => [...x, img]);
      } catch (err) {
        failures.push((err as Error).message);
      }
    }
    setExtrasError(failures.join(" "));
    setExtrasBusy(false);
  }

  async function save() {
    if (!name.trim()) return setError("Give the character a name.");
    if (!primary && !character) return setError("Add a reference image.");
    setBusy(true);
    setError("");
    try {
      const imageKey = primary ? await uploadMedia("chars", primary.blob, "image/jpeg") : character!.imageKey;
      const added: string[] = [];
      for (const img of newExtras) added.push(await uploadMedia("chars", img.blob, "image/jpeg"));
      const body = { name: name.trim(), description, active, imageKey, extraImageKeys: [...keptExtras, ...added] };
      if (character) await sendJson(`/api/dance-studio/characters/${character.id}`, body, "PATCH");
      else await sendJson("/api/dance-studio/characters", body);
      await onSaved();
    } catch (err) {
      setError(`Couldn't save: ${(err as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="dm__backdrop" onClick={onClose} role="presentation">
      <div className="dm dm--narrow" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Character">
        <button type="button" className="dm__close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dm__body">
          <h2 className="dm__name">{character ? `Edit ${character.name}` : "New character"}</h2>

          <label className="dm__field">
            <span>Character name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Pixel" />
          </label>

          <label className="dm__field">
            <span>
              Description <small>optional — helps keep the look consistent</small>
            </span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. blue robot, white sneakers, glowing visor" />
          </label>

          <div className="dm__field">
            <span>
              Reference image <small>JPG, PNG, WebP or iPhone photo · full body works best</small>
            </span>
            <input
              ref={primaryInput}
              type="file"
              accept={CHARACTER_IMAGE_ACCEPT}
              hidden
              onChange={(e) => {
                void pickPrimary(firstImage(e.target.files));
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className={`ds-imgdrop${dragOver ? " is-over" : ""}${primaryPreview ? " has-image" : ""}`}
              onClick={() => primaryInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void pickPrimary(firstImage(e.dataTransfer.files));
              }}
              disabled={primaryBusy || busy}
            >
              {primaryPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={primaryPreview} alt="Reference image preview" />
              )}
              <span className="ds-imgdrop__label">
                <strong>{primaryBusy ? "Preparing image…" : primaryPreview ? "Replace image" : "Upload reference image"}</strong>
                <small>{primary ? `${primary.name} · ready` : "Click to choose, drag a picture here, or paste one (Ctrl+V)"}</small>
              </span>
            </button>
            <div className="ds-urlrow">
              <input
                className="ds-input"
                value={imageLink}
                onChange={(e) => setImageLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void useImageLink();
                  }
                }}
                placeholder="…or paste an image link"
                aria-label="Image link"
              />
              <button type="button" className="btn" onClick={useImageLink} disabled={!imageLink.trim() || primaryBusy || busy}>
                Use link
              </button>
            </div>
            {primaryError && <span className="dm__err">{primaryError}</span>}
          </div>

          <div className="dm__field">
            <span>
              Additional reference images <small>optional · up to {CHARACTER_MAX_EXTRA} — other angles or close-ups</small>
            </span>
            <div className="ds-thumbs">
              {keptExtras.map((k) => (
                <figure key={k}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(k)} alt="" />
                  <button type="button" aria-label="Remove" onClick={() => setKeptExtras((x) => x.filter((y) => y !== k))}>
                    ×
                  </button>
                </figure>
              ))}
              {newExtras.map((img, i) => (
                <figure key={img.preview}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt="" />
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => {
                      URL.revokeObjectURL(img.preview);
                      setNewExtras((x) => x.filter((_, j) => j !== i));
                    }}
                  >
                    ×
                  </button>
                </figure>
              ))}
              {room > 0 && (
                <label className="btn btn--quiet">
                  {extrasBusy ? "Preparing…" : "+ Add images"}
                  <input
                    type="file"
                    accept={CHARACTER_IMAGE_ACCEPT}
                    multiple
                    hidden
                    onChange={(e) => {
                      void pickExtras(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            {extrasError && <span className="dm__err">{extrasError}</span>}
          </div>

          <label className="ds-check">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active — available when generating
          </label>

          {error && <p className="dm__err">{error}</p>}

          <div className="dm__actions">
            <span className="dm__spacer" />
            <button type="button" className="btn btn--quiet" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" onClick={save} disabled={busy || primaryBusy || extrasBusy}>
              {busy ? "Saving…" : "Save character"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
