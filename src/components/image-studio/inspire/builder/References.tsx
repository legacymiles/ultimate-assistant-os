"use client";

// Style references: up to six images, each with a purpose (art style,
// character, clothing …). Uploads land in the person's private Style Reference
// Library, so they can be picked again in any later build.

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Images, X } from "lucide-react";
import { REFERENCE_PURPOSES, type InspireImage, type LibraryItem, type LibraryReference, type ReferencePurpose } from "@/lib/image-studio/inspire/types";
import { api, fileToDataUrl, imageFiles } from "../api";
import { useInspire, type BuilderRef } from "../store";
import { Modal, Spinner } from "../ui";
import { errorText, MAX_REFS } from "./shared";

export function References() {
  const { me, lib, builder, setBuilder, requireSignIn, upsertOwnImage, reloadLibrary, patchItem, toast, detail } = useInspire();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refs = builder.refs;
  const libRefs = lib.items.filter((i): i is LibraryReference => i.kind === "reference");

  const upload = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      setError(null);
      const room = MAX_REFS - builder.refs.length;
      if (room <= 0) {
        setError(`You can use up to ${MAX_REFS} references. Remove one to add another.`);
        return;
      }
      requireSignIn("upload style references", async () => {
        const take = files.slice(0, room);
        setBusy(take.length);
        let added = 0;
        for (const file of take) {
          try {
            const name = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 80) || "Reference";
            const dataUrl = await fileToDataUrl(file, 1600);
            const { image } = await api.post<{ image: InspireImage }>("/images", { image: dataUrl, source: "reference", name });
            const { item } = await api.post<{ item: LibraryItem }>("/library", { kind: "reference", imageId: image.id, purpose: "style", name });
            upsertOwnImage(image);
            setBuilder((b) => (b.refs.length >= MAX_REFS ? b : { ...b, refs: [...b.refs, { id: item.id, imageId: image.id, src: image.thumb, name, purpose: "style" }] }));
            added++;
          } catch (err) {
            setError(`${file.name}: ${errorText(err)}`);
          } finally {
            setBusy((n) => Math.max(0, n - 1));
          }
        }
        if (added) {
          toast(added === 1 ? "Reference added to your Style Reference Library" : `${added} references added to your Style Reference Library`);
          void reloadLibrary();
        }
        if (files.length > room) setError(`Only ${room} more fit — a build uses up to ${MAX_REFS} references.`);
      });
    },
    [builder.refs.length, requireSignIn, setBuilder, upsertOwnImage, reloadLibrary, toast],
  );

  // Paste an image anywhere in the Builder (not while another dialog is open).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (detail) return;
      const files = imageFiles(e.clipboardData?.items);
      if (!files.length) return;
      e.preventDefault();
      upload(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [upload, detail]);

  const setPurpose = (ref: BuilderRef, purpose: ReferencePurpose) => {
    setBuilder((b) => ({ ...b, refs: b.refs.map((r) => (r.id === ref.id ? { ...r, purpose } : r)) }));
    if (libRefs.some((i) => i.id === ref.id)) void patchItem(ref.id, { purpose });
  };
  const removeRef = (ref: BuilderRef) => setBuilder((b) => ({ ...b, refs: b.refs.filter((r) => r.id !== ref.id) }));

  const togglePick = (item: LibraryReference) => {
    if (refs.some((r) => r.id === item.id)) {
      setBuilder((b) => ({ ...b, refs: b.refs.filter((r) => r.id !== item.id) }));
      return;
    }
    if (refs.length >= MAX_REFS) {
      toast(`A build uses up to ${MAX_REFS} references`, { tone: "bad" });
      return;
    }
    const img = lib.images[item.imageId];
    setBuilder((b) => ({ ...b, refs: [...b.refs, { id: item.id, imageId: item.imageId, src: img?.thumb ?? "", name: item.name, purpose: item.purpose }] }));
  };

  return (
    <section className="b-refs" aria-labelledby="b-refs-h">
      <div className="b-sec-head">
        <h2 id="b-refs-h" className="insp-kicker" style={{ margin: 0 }}>
          4 · Style references <span className="insp-count">· {refs.length}/{MAX_REFS}</span>
        </h2>
        <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet" onClick={() => (me?.signedIn ? setPicking(true) : requireSignIn("use your Style Reference Library", () => setPicking(true)))}>
          <Images size={14} /> Pick from your references
        </button>
      </div>

      {refs.length > 0 && (
        <ul className="b-ref-list">
          {refs.map((r) => {
            const purpose = REFERENCE_PURPOSES.find((p) => p.id === r.purpose) ?? REFERENCE_PURPOSES[0];
            return (
              <li key={r.id} className="b-ref">
                <img src={lib.images[r.imageId]?.thumb ?? r.src} alt={r.name} />
                <div style={{ minWidth: 0, display: "grid", gap: 5 }}>
                  <span className="b-ref-name" title={r.name}>
                    {r.name}
                  </span>
                  <select className="insp-select" style={{ height: 32, fontSize: 12.5 }} value={r.purpose} onChange={(e) => setPurpose(r, e.target.value as ReferencePurpose)} aria-label={`What ${r.name} is for`}>
                    {REFERENCE_PURPOSES.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <span className="insp-faint" style={{ fontSize: 11.5, lineHeight: 1.35 }}>
                    {purpose.hint}
                  </span>
                </div>
                <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon b-ref-x" aria-label={`Remove ${r.name} from this build`} onClick={() => removeRef(r)}>
                  <X size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {refs.length < MAX_REFS && (
        <div
          className="insp-dropzone b-drop"
          data-over={over}
          onDragOver={(e) => {
            if (!Array.from(e.dataTransfer.types).includes("Files")) return;
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            upload(imageFiles(e.dataTransfer.files));
          }}
        >
          <ImagePlus size={18} className="insp-faint" aria-hidden />
          <span className="insp-muted" style={{ fontSize: 13 }}>
            Drop images, paste one, or{" "}
            <button type="button" className="b-link" onClick={() => input.current?.click()}>
              choose files
            </button>
          </span>
          <span className="insp-faint" style={{ fontSize: 11.5 }}>
            Borrow an art style, a character, an outfit, a layout, a palette or a setting. Saved privately to your Style Reference Library.
          </span>
          {busy > 0 && (
            <span className="insp-muted" style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 12.5 }} role="status">
              <Spinner size={13} /> Uploading {busy} image{busy === 1 ? "" : "s"}…
            </span>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              upload(imageFiles(e.target.files));
              e.target.value = "";
            }}
          />
        </div>
      )}
      {refs.length > 0 && (
        <p className="insp-faint" style={{ margin: "8px 0 0", fontSize: 11.5 }}>
          With references attached the picture is drawn by the AI image model; builds without references draw free on your PC when WanGP is running.
        </p>
      )}
      {error && (
        <div className="insp-error" role="alert" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}

      <Modal open={picking} onClose={() => setPicking(false)} label="Your style references">
        <div style={{ padding: 20, display: "grid", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <div>
              <div className="insp-h2">Your style references</div>
              <div className="insp-faint" style={{ fontSize: 12.5 }}>
                Click to add or remove · {refs.length}/{MAX_REFS} in this build
              </div>
            </div>
            <button type="button" className="insp-btn insp-btn-sm insp-btn-quiet insp-btn-icon" aria-label="Close" onClick={() => setPicking(false)}>
              <X size={15} />
            </button>
          </div>
          {libRefs.length === 0 ? (
            <p className="insp-note" style={{ margin: 0 }}>
              Your Style Reference Library is empty. Upload an image in the references area and it is kept here for every future build.
            </p>
          ) : (
            <div className="b-pick-grid">
              {libRefs.map((item) => {
                const img = lib.images[item.imageId];
                const on = refs.some((r) => r.id === item.id);
                return (
                  <button key={item.id} type="button" className="b-pick" aria-pressed={on} onClick={() => togglePick(item)}>
                    {img ? (
                      <img src={img.thumb} alt="" style={{ background: img.tint }} />
                    ) : (
                      <span className="insp-skel" style={{ display: "block", aspectRatio: "1" }} />
                    )}
                    <span className="b-ref-name">{item.name}</span>
                    <span className="insp-faint" style={{ fontSize: 11 }}>
                      {REFERENCE_PURPOSES.find((p) => p.id === item.purpose)?.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <button type="button" className="insp-btn" style={{ justifySelf: "end" }} onClick={() => setPicking(false)}>
            Done
          </button>
        </div>
      </Modal>
    </section>
  );
}
