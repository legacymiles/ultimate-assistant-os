"use client";

// ---------------------------------------------------------------------------
// Profiles › a person's identity: profile picture, face references, consent —
// and the app-wide face recognition settings.
//
// The rules this screen enforces (lib/identity):
//   · only photos IN the profile — uploaded here, or explicitly picked from the
//     Images library here — can be the profile picture or a face reference;
//   · nothing is used for recognition until face recognition is switched on for
//     that person, and switching it off deletes the face data derived from them;
//   · the Images library is offered for picking, never merged in.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus, ScanFace, Star, Trash2, X } from "lucide-react";
import type { ProfilesStore } from "@/lib/profiles/useProfiles";
import type { Media, ProfileNode } from "@/lib/profiles/types";
import { buildIdentities, eligibleMedia, enrolledRefs, findDuplicates } from "@/lib/identity/registry";
import { DEFAULT_FACE_SETTINGS, FACE_SETTINGS_CHANGED, getFaceSettings, saveFaceSettings, type FaceSettings } from "@/lib/identity/settings";
import { fileToMedia, MediaTile } from "./bits";
import type { Nav } from "./views";

const sty = (o: Record<string, string | number>) => o as React.CSSProperties;

/** A square avatar cut from a profile photo. */
export async function squareAvatar(src: string, size = 192): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const k = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * k;
    const h = img.naturalHeight * k;
    c.getContext("2d")?.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return undefined;
  }
}

/** Make a photo the person's profile picture. */
export async function setPrimary(store: ProfilesStore, node: ProfileNode, m: Media, nav: Nav) {
  if (!eligibleMedia(m)) return nav.toast("Only a photo in this profile can be the profile picture");
  const avatar = await squareAvatar(m.src!);
  if (!avatar) return nav.toast("That photo couldn't be read");
  store.apply([{ op: "patch_node", node: node.id, patch: { primaryMediaId: m.id, avatar } }], `New profile picture for ${node.name}`);
  nav.toast(`Profile picture set for ${node.name}`, "last");
}

export function toggleRef(store: ProfilesStore, node: ProfileNode, m: Media, nav: Nav) {
  if (!eligibleMedia(m)) return nav.toast("Only a photo in this profile can be a face reference");
  const on = !m.ref;
  store.apply([{ op: "patch_media", node: node.id, media: m.id, patch: { ref: on } }]);
  if (on && !node.faceConsent?.granted) nav.toast(`Marked. Switch on face recognition for ${node.name} in their settings to use it.`);
  else nav.toast(on ? `Camera Autopilot will use this to recognise ${node.name}` : `No longer used to recognise ${node.name}`, "last");
}

/** The two buttons a person's photo gets in the lightbox. */
export function LightboxIdentityActions({ store, node, m: shown, nav }: { store: ProfilesStore; node: ProfileNode; m: Media; nav: Nav }) {
  // The lightbox holds a snapshot; read the photo's current flags from the profile.
  const m = node.media.find((x) => x.id === shown.id);
  if (node.kind !== "person" || !m || !eligibleMedia(m)) return null;
  const primary = node.primaryMediaId === m.id;
  return (
    <div className="pf-lb-acts" onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`pf-btn${primary ? " on" : ""}`} aria-pressed={primary} disabled={primary} onClick={() => void setPrimary(store, node, m, nav)}>
        <Star /> {primary ? "Profile picture" : "Make profile picture"}
      </button>
      <button type="button" className={`pf-btn${m.ref ? " on" : ""}`} aria-pressed={Boolean(m.ref)} onClick={() => toggleRef(store, node, m, nav)}>
        <ScanFace /> {m.ref ? "Face reference" : "Use for face recognition"}
      </button>
    </div>
  );
}

/** Small marks on a gallery tile: profile picture, face reference. */
export function TileBadges({ node, m }: { node: ProfileNode | undefined; m: Media }) {
  if (!node || node.kind !== "person") return null;
  const primary = node.primaryMediaId === m.id;
  if (!primary && !m.ref) return null;
  return (
    <span className="pf-badges" aria-hidden="true">
      {primary ? <i title="Profile picture"><Star /></i> : null}
      {m.ref ? <i title="Face reference"><ScanFace /></i> : null}
    </span>
  );
}

/** Copy library pictures into the profile — the one explicit road from Images to a profile. */
async function fromLibrary(picked: Media[]): Promise<Media[]> {
  const out: Media[] = [];
  const [{ getData }, { getFile }, { toAnalysisDataUrl }] = await Promise.all([
    import("@/lib/recall/store"),
    import("@/lib/recall/files"),
    import("@/lib/recall/photos/vision"),
  ]);
  const items = new Map(getData().items.map((i) => [i.id, i]));
  for (const m of picked) {
    const itemId = m.id.replace(/^rc-/, "");
    const item = items.get(itemId);
    // The full picture when this device still has it; the library thumbnail otherwise.
    let src = m.src;
    const fileId = item?.attachment?.fileId;
    if (fileId && m.kind === "photo") {
      const blob = await getFile(fileId).catch(() => null);
      if (blob) src = (await toAnalysisDataUrl(blob, 720).catch(() => "")) || src;
    }
    if (!src) continue;
    out.push({
      id: `m-lib-${itemId}`,
      kind: m.kind,
      src,
      caption: m.caption,
      date: m.date,
      origin: "library",
      // Already in the library: the mirror must not copy it back a second time.
      recallItemId: itemId,
    });
  }
  return out;
}

export function LibraryPicker({ store, node, nav, close }: { store: ProfilesStore; node: ProfileNode; nav: Nav; close: () => void }) {
  const list = store.library(node.id);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [close]);
  const add = async () => {
    setBusy(true);
    const made = await fromLibrary(list.filter((m) => sel.has(m.id)));
    setBusy(false);
    if (!made.length) return nav.toast("Those pictures couldn't be copied");
    store.apply([{ op: "add_media", node: node.id, media: made }], `Added ${made.length} from the Images library to ${node.name}`);
    nav.toast(`Added ${made.length} to ${node.name}'s profile`, "last");
    close();
  };
  return (
    <div className="pf-lb pf-pick" role="dialog" aria-modal="true" aria-label={`Add pictures of ${node.name} from the Images library`} onClick={close}>
      <div className="pf-pick-card" onClick={(e) => e.stopPropagation()}>
        <div className="pf-pick-h">
          <div>
            <p className="pf-eyebrow">Images library › {node.name}</p>
            <h2>Pick pictures for the profile</h2>
            <p className="pf-sub">Everything here stays in the library. Only what you pick is copied into {node.name}&apos;s profile — and only a picked photo can become their profile picture or a face reference.</p>
          </div>
          <button type="button" className="pf-ib" onClick={close} aria-label="Close">
            <X />
          </button>
        </div>
        {list.length ? (
          <div className="pf-pick-grid">
            {list.map((m) => {
              const on = sel.has(m.id);
              return (
                <button key={m.id} type="button" className={`pf-pick-t${on ? " on" : ""}`} aria-pressed={on} onClick={() => setSel((s) => { const n = new Set(s); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}>
                  <MediaTile m={m} />
                  {on ? <span className="pf-pick-ok"><Check /></span> : null}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="pf-empty">No pictures of {node.name} in the Images library that aren&apos;t already in the profile.</p>
        )}
        <div className="pf-pick-f">
          <span className="pf-sub">{sel.size ? `${sel.size} selected` : `${list.length} in the library`}</span>
          <button type="button" className="pf-btn go" disabled={!sel.size || busy} onClick={() => void add()}>
            {busy ? "Copying…" : `Add ${sel.size || ""} to profile`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Profiles › a person › Settings › Face recognition. */
export function FaceSection({ store, node, nav, hue }: { store: ProfilesStore; node: ProfileNode; nav: Nav; hue: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const consent = Boolean(node.faceConsent?.granted);
  const refs = node.media.filter((m) => m.ref && eligibleMedia(m));
  const enrolled = enrolledRefs(node).length > 0;
  const primary = node.media.find((m) => m.id === node.primaryMediaId);

  const setConsent = (on: boolean) => {
    store.apply(
      [{ op: "patch_node", node: node.id, patch: { faceConsent: { granted: on, at: new Date().toISOString(), by: "owner" } } }],
      on ? `Face recognition on for ${node.name}` : `Face recognition off for ${node.name} — face data deleted`,
    );
    setConfirmOff(false);
    nav.toast(on ? `Face recognition on for ${node.name}` : `Face recognition off. ${node.name}'s face data is deleted everywhere.`, "last");
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const made = (await Promise.all([...files].slice(0, 6).map(fileToMedia))).filter((m): m is Media => Boolean(m) && m!.kind === "photo");
    if (!made.length) return nav.toast("Those files aren't photos");
    const media = made.map((m) => ({ ...m, origin: "upload" as const, ref: true }));
    store.apply([{ op: "add_media", node: node.id, media }], `Added ${media.length} reference photo${media.length === 1 ? "" : "s"} for ${node.name}`);
    if (!node.primaryMediaId && !node.avatar) await setPrimary(store, { ...node, media: [...media, ...node.media] }, media[0], nav);
    nav.toast(consent ? `Added — Camera Autopilot will use them for ${node.name}` : `Added. Switch on face recognition to use them.`, "last");
  };

  return (
    <section className="pf-group pf-rise" style={sty({ "--i": 1.5 })}>
      <h3>Face recognition</h3>
      <div className="pf-field">
        <span>
          Recognise {node.name} by face
          <small>
            {consent
              ? node.faceConsent?.by === "carried"
                ? "On — carried over from the Photos tab. Switch off any time."
                : "On. Camera Autopilot compares new photos with the references below."
              : "Off. Nothing about their face is stored or compared."}
          </small>
        </span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {confirmOff ? (
            <>
              <button type="button" className="pf-btn danger" onClick={() => setConsent(false)}>
                Turn off and delete
              </button>
              <button type="button" className="pf-btn" onClick={() => setConfirmOff(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" role="switch" aria-checked={consent} aria-label={`Recognise ${node.name} by face`} className="pf-switch" style={sty({ "--h": hue })} onClick={() => (consent ? setConfirmOff(true) : setConsent(true))} />
          )}
        </span>
      </div>
      <div className="pf-field" style={{ alignItems: "flex-start" }}>
        <span>
          Profile picture
          <small>{primary ? "Shown everywhere Jarvis shows them." : "Pick one from their photos, or add reference photos — the first becomes it."}</small>
        </span>
        {node.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pf-face-av" src={node.avatar} alt={`${node.name}'s profile picture`} />
        ) : null}
      </div>
      <div className="pf-field" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
        <span>
          Face references · {refs.length}
          <small>
            {enrolled
              ? `Camera Autopilot can recognise ${node.name}. Clear, single-face photos from different angles work best.`
              : refs.length
                ? "Marked, but not used until face recognition is on."
                : "None yet. Add a few clear photos of just their face, or mark ones from their photos."}
          </small>
        </span>
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
          <button type="button" className="pf-btn" onClick={() => input.current?.click()}>
            <ImagePlus /> Add reference photos
          </button>
          <button type="button" className="pf-btn" onClick={() => nav.open({ t: "gallery", id: node.id })}>
            Mark from photos
          </button>
        </span>
        {refs.length ? (
          <div className="pf-face-refs">
            {refs.map((m) => (
              <span key={m.id} className="pf-face-ref">
                <MediaTile m={m} />
                <button type="button" className="pf-ib" aria-label="Stop using this photo for face recognition" onClick={() => toggleRef(store, node, m, nav)}>
                  <X />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** Profiles › Settings › Face recognition (every person). */
export function FaceSettingsSection({ store, nav }: { store: ProfilesStore; nav: Nav }) {
  const [s, setS] = useState<FaceSettings>(DEFAULT_FACE_SETTINGS);
  const [sealed, setSealed] = useState<boolean | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  useEffect(() => {
    const load = () => void getFaceSettings().then(setS);
    load();
    window.addEventListener(FACE_SETTINGS_CHANGED, load);
    void import("@/lib/identity/faces").then((f) => f.sealConfigured()).then(setSealed);
    return () => window.removeEventListener(FACE_SETTINGS_CHANGED, load);
  }, []);
  const cards = useMemo(() => buildIdentities(store.data), [store.data]);
  const enrolled = cards.filter((c) => c.enrolled);
  const dups = useMemo(() => findDuplicates(cards), [cards]);
  const set = (patch: Partial<FaceSettings>) => void saveFaceSettings(patch).then(setS);
  const wipe = async () => {
    const { deleteAllFaceData } = await import("@/lib/identity/sync");
    const n = await deleteAllFaceData();
    setConfirmWipe(false);
    nav.toast(`Face data deleted${n ? ` and recognition turned off for ${n} ${n === 1 ? "person" : "people"}` : ""}`);
  };
  return (
    <section className="pf-group pf-rise" style={sty({ "--i": 1.5 })}>
      <h3>Face recognition</h3>
      <div className="pf-field">
        <span>
          Camera Autopilot recognises people
          <small>{enrolled.length ? `${enrolled.length} enrolled: ${enrolled.map((c) => c.name).join(", ")}` : "Nobody enrolled yet — switch it on inside a person's settings."}</small>
        </span>
        <button type="button" role="switch" aria-checked={s.enabled} aria-label="Face recognition" className="pf-switch" onClick={() => set({ enabled: !s.enabled })} />
      </div>
      <div className="pf-field" style={{ flexWrap: "wrap" }}>
        <span>
          File as the person at {Math.round(s.autoAssign * 100)}% sure
          <small>Above this a recognised face is filed by. Higher is stricter.</small>
        </span>
        <input className="pf-range" type="range" min={60} max={98} step={1} value={Math.round(s.autoAssign * 100)} aria-label="Auto-assign threshold" onChange={(e) => set({ autoAssign: Number(e.target.value) / 100 })} />
      </div>
      <div className="pf-field" style={{ flexWrap: "wrap" }}>
        <span>
          Ask me from {Math.round(s.suggestFloor * 100)}% sure
          <small>Between the two, a photo asks &ldquo;Is this …?&rdquo; and waits for you. Below, the face stays unidentified.</small>
        </span>
        <input className="pf-range" type="range" min={50} max={Math.round(s.autoAssign * 100)} step={1} value={Math.round(s.suggestFloor * 100)} aria-label="Ask-me threshold" onChange={(e) => set({ suggestFloor: Number(e.target.value) / 100 })} />
      </div>
      <div className="pf-field">
        <span className={`pf-status${sealed ? " ok" : ""}`}>
          <i />
          {sealed == null ? "Checking storage…" : sealed ? "Face data is encrypted at rest (AES-256)" : "No IDENTITY_ENC_KEY: face data stays in this browser's memory only, never stored"}
        </span>
      </div>
      {dups.length ? (
        <div className="pf-field" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <span>
            Possibly the same person twice
            <small>One person should have one profile. Archive the extra one, or rename it if they really are different people.</small>
          </span>
          <div className="pf-chips">
            {dups.flatMap((d) => d.ids).filter((id, i, a) => a.indexOf(id) === i).map((id) => (
              <button key={id} type="button" className="pf-chip" onClick={() => nav.open({ t: "node", id })}>
                {cards.find((c) => c.id === id)?.path || cards.find((c) => c.id === id)?.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="pf-field">
        <span>
          {confirmWipe ? "Delete every face reference template and turn recognition off for everyone?" : "Delete all face data"}
          <small>Profile photos stay. Recognition needs consent again, per person.</small>
        </span>
        {confirmWipe ? (
          <span style={{ display: "flex", gap: 6 }}>
            <button type="button" className="pf-btn danger" onClick={() => void wipe()}>
              <Trash2 /> Delete
            </button>
            <button type="button" className="pf-btn" onClick={() => setConfirmWipe(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="pf-btn danger" onClick={() => setConfirmWipe(true)}>
            Delete face data
          </button>
        )}
      </div>
    </section>
  );
}
