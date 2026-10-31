"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { Modal } from "../Modal";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { STORE_KEY as FOURCS_KEY } from "@/lib/new-dashboard/model";
import type { DashboardStore as FourCsStore } from "@/lib/new-dashboard/types";
import {
  STORE_KEY, applyDrafts, buildQueue, chainTo, childrenOf, confirmField, emptyStore,
  nodeById, removeNode, seedNodes, spawn, undoWrite,
} from "@/lib/profile/model";
import { buildMap, redactForAi } from "@/lib/profile/redact";
import { aboutFromCited, heuristicAbout } from "@/lib/profile/about";
import { AboutMe } from "./AboutMe";
import { ColumnBrowser } from "./ColumnBrowser";
import { ConfirmQueue } from "./ConfirmQueue";
import { Ingest } from "./Ingest";
import { OneBar, type Answer } from "./OneBar";
import { RecordView } from "./RecordView";
import type { Draft, Node, ProfileStore } from "@/lib/profile/types";
import "./profile.css";

/**
 * Profile — the Jarvis tab where everything Jarvis knows about the owner lives.
 *
 * Two layers, and the split is the whole design (docs/superpowers/specs/
 * jarvis-profile-app.md): About Me is the one-page briefing read every turn,
 * the tree below is the full record read on demand. The owner never files
 * anything by hand — they drop a document, or answer the confirm queue.
 *
 * Replaces the Four-Cs dashboard here; that app still lives at
 * /apps/new-dashboard and its seven answers import in as seed facts.
 */

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";

export function ProfileApp() {
  const [store, setStore] = useState<ProfileStore>(emptyStore);
  const [ready, setReady] = useState(false);
  const [trail, setTrail] = useState<string[]>([]);
  const [lit, setLit] = useState<string[]>([]);
  const [ingesting, setIngesting] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [editBasics, setEditBasics] = useState(false);
  const [building, setBuilding] = useState(false);
  const [aboutNote, setAboutNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    const loaded = loadLocal<ProfileStore>(STORE_KEY, emptyStore());
    // First open seeds the seven root tiles, so the owner never meets an empty
    // screen with an "add folder" button and no idea what to call it.
    setStore(loaded.nodes.length ? loaded : { ...loaded, nodes: seedNodes() });
    setReady(true);
  }, []);
  useEffect(reload, [reload]);
  useRemotePull(STORE_KEY, reload);

  const commit = useCallback((next: ProfileStore) => {
    setStore(next);
    saveSynced(STORE_KEY, next);
  }, []);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const queue = useMemo(() => buildQueue(store.nodes), [store.nodes]);
  const selected = trail.length ? nodeById(store.nodes, trail[trail.length - 1]) : null;
  const breadcrumb = useMemo(() => chainTo(store.nodes, selected?.id ?? null), [store.nodes, selected]);

  /** Open a node by jumping the whole trail to it — used by search, provenance and the queue. */
  const jump = useCallback(
    (nodeId: string) => {
      const chain = chainTo(store.nodes, nodeId);
      if (chain.length) setTrail(chain.map((n) => n.id));
    },
    [store.nodes],
  );

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  const updateNode = (next: Node) =>
    commit({ ...store, nodes: store.nodes.map((n) => (n.id === next.id ? next : n)) });

  const addChild = (parentId: string | null) => {
    const made = spawn("New folder", parentId, "", "Folder");
    commit({ ...store, nodes: [...store.nodes, ...made] });
    jump(made[0].id);
  };

  const deleteNode = (id: string) => {
    const node = nodeById(store.nodes, id);
    if (!node) return;
    const inside = childrenOf(store.nodes, id).length;
    const msg = inside
      ? `Delete “${node.name}” and the ${inside} folder${inside === 1 ? "" : "s"} inside it?`
      : `Delete “${node.name}”?`;
    if (!confirm(msg)) return;
    commit({ ...store, nodes: removeNode(store.nodes, id) });
    setTrail(trail.slice(0, Math.max(trail.indexOf(id), 0)));
  };

  const apply = (drafts: Draft[]) => {
    const { store: next } = applyDrafts({ ...store, onboarded: true }, drafts);
    commit(next);
    if (drafts[0]) {
      // Land the owner on the first thing that changed, so a write is never invisible.
      const first = next.nodes.find((n) => n.name === drafts[0].path[drafts[0].path.length - 1]);
      if (first) jump(first.id);
    }
  };

  /** Bring the Four-Cs dashboard's seven answers in as seed facts. */
  const importIntake = (): number => {
    const four = loadLocal<FourCsStore | null>(FOURCS_KEY, null);
    const p = four?.profiles.find((x) => x.id === four.activeId) ?? four?.profiles[0];
    if (!p) return 0;

    const drafts: Draft[] = [];
    const push = (path: string[], pack: string, label: string, value: string) => {
      if (value?.trim()) drafts.push({ path, pack, fields: [{ label, value: value.trim() }] });
    };
    push(["Me", "Preferences & Routines"], "", "What I do", p.intake.q1);
    push(["Me", "Preferences & Routines"], "", "90-day priorities", p.intake.q3.filter(Boolean).join("; "));
    push(["Me", "Preferences & Routines"], "", "What eats my week", p.intake.q7);
    // q2 is raw writing samples, pasted and never edited — exactly what the
    // voice pack needs, and the one thing that must not come from AI output.
    push(["Me", "Voice & Tone"], "voice", "Something I actually wrote", p.intake.q2.filter(Boolean).join("\n\n---\n\n"));

    if (!drafts.length) return 0;
    const { store: next } = applyDrafts({ ...store, basics: { ...store.basics, name: store.basics.name || p.name } }, drafts);
    commit(next);
    return drafts.length;
  };

  // ---------------------------------------------------------------------------
  // About Me
  // ---------------------------------------------------------------------------

  const rebuild = async () => {
    setBuilding(true);
    setAboutNote("");
    // The offline briefing is written first, so there is always one even if the
    // call fails — and so the owner sees something immediately.
    const fallback = heuristicAbout(store);
    try {
      const res = await fetch("/api/profile/about", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Redacted HERE, in the browser: secrets never leave the device at all.
          // Empty branches are dropped too, or the briefing fills up with
          // "Health folder is on file" instead of facts.
          tree: redactForAi(store.nodes, store.basics, { withIds: true, onlyFilled: true }),
          name: store.basics.name,
        }),
      });
      const data = (await res.json()) as { lines?: { text: string; sources?: string[] }[]; status?: string };
      if (data.status === "ok" && data.lines?.length) {
        commit({ ...store, about: aboutFromCited(data.lines, store) });
      } else {
        commit({ ...store, about: fallback });
        setAboutNote(
          data.status === "no-key"
            ? "No AI key set, so this is the plain version built from your folders. Add a key in the hub's AI panel for the written one."
            : "The model did not answer, so this is the plain version built from your folders.",
        );
      }
    } catch {
      commit({ ...store, about: fallback });
      setAboutNote("Could not reach the model, so this is the plain version built from your folders.");
    } finally {
      setBuilding(false);
    }
  };

  const pinLine = (line: string) => {
    const t = line.trim();
    const has = store.about.pinned.includes(t);
    commit({
      ...store,
      about: {
        ...store.about,
        pinned: has ? store.about.pinned.filter((p) => p !== t) : [...store.about.pinned, t],
      },
    });
  };

  const vetoLine = (line: string) => {
    const t = line.trim();
    const about = {
      ...store.about,
      vetoed: store.about.vetoed.includes(t) ? store.about.vetoed : [...store.about.vetoed, t],
      // Drop it from the current text immediately; a veto that waits for the
      // next rebuild reads as a button that did nothing.
      text: store.about.text
        .split("\n")
        .filter((l) => l.trim() !== t)
        .join("\n"),
    };
    commit({ ...store, about });
  };

  // ---------------------------------------------------------------------------
  // Ask
  // ---------------------------------------------------------------------------

  const ask = async (question: string) => {
    setAsking(true);
    setAnswer(null);
    try {
      const res = await fetch("/api/profile/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          tree: redactForAi(store.nodes, store.basics, { withIds: true }),
          about: store.about.text,
        }),
      });
      const data = (await res.json()) as { answer?: string; open?: string; missing?: boolean; note?: string; status?: string };
      setAnswer({
        text: data.answer ?? "",
        open: data.open && nodeById(store.nodes, data.open) ? data.open : "",
        missing: Boolean(data.missing),
        note: data.note || (data.status === "failed" ? "That did not go through." : ""),
      });
    } catch {
      setAnswer({ text: "", open: "", missing: false, note: "That did not go through." });
    } finally {
      setAsking(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Avatar
  // ---------------------------------------------------------------------------

  /**
   * Downscale to 256px before storing. The avatar shares one localStorage blob
   * with the whole tree, and a phone camera JPEG would eat the quota on its own.
   */
  const setAvatar = async (file: File) => {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      commit({ ...store, avatar: canvas.toDataURL("image/jpeg", 0.82) });
    } catch {
      alert("Could not read that image.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  if (!ready) return <div className="min-h-dvh" />;

  const recent = store.writes.slice(0, 3);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Basics — the one block that is hand-edited and never derived. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-3 py-2.5">
        <button
          type="button"
          onClick={() => avatarRef.current?.click()}
          className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-line bg-panel-2"
          aria-label="Change profile photo"
        >
          {store.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon.Users width={18} height={18} className="mx-auto text-ink-faint" />
          )}
          <span className="absolute inset-0 hidden items-center justify-center bg-black/55 group-hover:flex">
            <Icon.Camera width={14} height={14} className="text-white" />
          </span>
        </button>
        <input
          ref={avatarRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && void setAvatar(e.target.files[0])}
        />

        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{store.basics.name || "Your profile"}</div>
          <div className="truncate font-mono text-[10px] text-ink-faint">
            {[store.basics.birthday, store.basics.pronouns, store.basics.location].filter(Boolean).join(" · ") ||
              "no basics yet"}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setEditBasics(true)} className={btn}>
            <Icon.Edit width={11} height={11} /> Basics
          </button>
          <button type="button" onClick={() => setIngesting(true)} className={btn}>
            <Icon.Upload width={11} height={11} /> Add info
          </button>
          <button type="button" onClick={() => setMapOpen(true)} className={btn} title="What Jarvis reads to navigate this">
            <Icon.Target width={11} height={11} /> Map
          </button>
        </div>
      </div>

      <OneBar
        nodes={store.nodes}
        onJump={jump}
        onAsk={ask}
        asking={asking}
        answer={answer}
        onClear={() => setAnswer(null)}
      />

      <ConfirmQueue
        items={queue}
        nodes={store.nodes}
        onConfirm={(nodeId, fieldId, value) => commit(confirmField(store, nodeId, fieldId, value))}
        onJump={jump}
      />

      <AboutMe
        doc={store.about}
        nodes={store.nodes}
        busy={building}
        note={aboutNote}
        onRebuild={() => void rebuild()}
        onTrace={setLit}
        onJump={jump}
        onPin={pinLine}
        onVeto={vetoLine}
      />

      {/* Write-back marks — the video's `[Edited offer.md]`, with the undo it implies. */}
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel-2/40 px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase text-ink-faint">edited</span>
          {recent.map((w) => (
            <span key={w.id} className="inline-flex items-center gap-1 rounded border border-line bg-panel px-1.5 py-0.5">
              <button type="button" onClick={() => jump(w.nodeId)} className="font-mono text-[10px] text-ink-muted hover:text-accent">
                {w.where}
              </button>
              <button
                type="button"
                onClick={() => commit(undoWrite(store, w.id))}
                className="text-[10px] font-medium text-ink-faint hover:text-ink"
                title="Put it back"
              >
                undo
              </button>
            </span>
          ))}
        </div>
      )}

      {/* The trail, spelled out — the columns are the breadcrumb, but on a phone
          only one column fits, so it also needs saying. */}
      {breadcrumb.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5 font-mono text-[10px] text-ink-faint">
          <button type="button" onClick={() => setTrail([])} className="hover:text-ink">
            profile
          </button>
          {breadcrumb.map((n, i) => (
            <span key={n.id} className="flex shrink-0 items-center gap-1">
              <span className="opacity-50">›</span>
              <button
                type="button"
                onClick={() => setTrail(trail.slice(0, i + 1))}
                className={i === breadcrumb.length - 1 ? "text-ink" : "hover:text-ink"}
              >
                {n.name}
              </button>
            </span>
          ))}
        </div>
      )}

      <ColumnBrowser
        nodes={store.nodes}
        trail={trail}
        onTrail={setTrail}
        lit={lit}
        onAdd={addChild}
        record={
          selected ? (
            <RecordView
              node={selected}
              childCount={childrenOf(store.nodes, selected.id).length}
              onChange={updateNode}
              onDelete={() => deleteNode(selected.id)}
              onAddChild={() => addChild(selected.id)}
            />
          ) : (
            <Empty onIngest={() => setIngesting(true)} seeded={store.onboarded} />
          )
        }
      />

      <Ingest
        open={ingesting}
        onClose={() => setIngesting(false)}
        onApply={apply}
        onImportIntake={importIntake}
      />

      <BasicsModal
        open={editBasics}
        store={store}
        onClose={() => setEditBasics(false)}
        onSave={(basics) => {
          commit({ ...store, basics });
          setEditBasics(false);
        }}
      />

      <MapModal open={mapOpen} onClose={() => setMapOpen(false)} text={buildMap(store.nodes, store.basics)} />
    </div>
  );
}

function Empty({ onIngest, seeded }: { onIngest: () => void; seeded: boolean }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-2 p-5">
      <p className="text-sm font-semibold text-ink">
        {seeded ? "Pick a folder" : "Nothing in here yet"}
      </p>
      <p className="max-w-sm text-xs leading-relaxed text-ink-muted">
        {seeded
          ? "Use ↑ ↓ to move, → to go deeper, ← to come back."
          : "Drop in a resume or a bill, or say a sentence about yourself, and the folders get built for you."}
      </p>
      {!seeded && (
        <button
          type="button"
          onClick={onIngest}
          className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-2"
        >
          <Icon.Upload width={12} height={12} /> Add your info
        </button>
      )}
    </div>
  );
}

const field =
  "w-full rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";

function BasicsModal({
  open, store, onClose, onSave,
}: {
  open: boolean;
  store: ProfileStore;
  onClose: () => void;
  onSave: (basics: ProfileStore["basics"]) => void;
}) {
  const [b, setB] = useState(store.basics);
  useEffect(() => setB(store.basics), [store.basics, open]);

  const row = (label: string, key: keyof ProfileStore["basics"], type = "text", placeholder = "") => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-ink-muted">{label}</span>
      <input
        type={type}
        value={b[key]}
        placeholder={placeholder}
        onChange={(e) => setB({ ...b, [key]: e.target.value })}
        className={field}
      />
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Basics"
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(b)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-2"
          >
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-2.5 px-5 py-4">
        {row("Name", "name")}
        {row("Birthday", "birthday", "date")}
        {row("Pronouns", "pronouns", "text", "they/them")}
        {row("Location", "location", "text", "City")}
        {row("Email", "email", "email")}
        {row("Phone", "phone", "tel")}
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-ink-muted">
            One thing Jarvis should always know
          </span>
          <textarea
            rows={2}
            value={b.headline}
            onChange={(e) => setB({ ...b, headline: e.target.value })}
            placeholder="Survives every rebuild of About Me."
            className={`${field} resize-y`}
          />
        </label>
      </div>
    </Modal>
  );
}

function MapModal({ open, onClose, text }: { open: boolean; onClose: () => void; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="The map Jarvis reads"
      wide
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] text-ink-faint">Structure and rules only — no values, no secrets.</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            className={btn}
          >
            <Icon.Copy width={11} height={11} /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
      }
    >
      <pre className="max-h-[60vh] overflow-auto px-5 py-4 font-mono text-[11px] leading-relaxed text-ink-muted">
        {text}
      </pre>
    </Modal>
  );
}
