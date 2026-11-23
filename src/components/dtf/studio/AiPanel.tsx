"use client";

import { ArrowUp, Check, ImagePlus, Loader2, Paperclip, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/dtf/client";
import { getColor, getGarment, SIDE_LABEL } from "@/lib/dtf/garments";
import { applyOps } from "@/lib/dtf/project";
import { measureText } from "@/lib/dtf/render";
import type { AiProposal, AiReply, AssetRef, DesignOp, DesignProject, SideId } from "@/lib/dtf/types";
import FlatThumb from "./FlatThumb";
import { svgToSource, useStudio } from "./useStudio";

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  reply?: AiReply;
  refs?: AssetRef[];
  error?: boolean;
}

const STARTERS = [
  "Make this design look more expensive.",
  "Give me a vintage streetwear version.",
  "Make this graphic work on a black oversized shirt.",
  "Create three different versions of this design.",
  "Move the graphic slightly higher.",
  "Will this print well? What would you change?",
];

export default function AiPanel() {
  const s = useStudio();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [refs, setRefs] = useState<AssetRef[]>([]);
  const [uploading, setUploading] = useState(false);
  const [applied, setApplied] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const g = getGarment(s.project.garmentId);
  const color = getColor(g, s.project.colorId);
  const signedIn = Boolean(s.caps?.signedIn);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || thinking) return;
    if (!signedIn) return;
    const userTurn: Turn = { id: crypto.randomUUID(), role: "user", text: msg, refs: refs.length ? refs : undefined };
    setTurns((t) => [...t, userTurn]);
    setInput("");
    setThinking(true);
    try {
      // The model can only see files that exist on the server.
      await s.syncAssets();
      const history = turns.slice(-10).map((t) => ({ role: t.role, content: t.role === "assistant" ? (t.reply?.message ?? t.text) : t.text }));
      const reply = await api.ai({
        project: s.project,
        message: msg,
        history,
        referenceAssetIds: [...refs, ...s.project.references].map((r) => r.id).filter((id, i, a) => a.indexOf(id) === i).slice(0, 4),
        readiness: s.readiness,
        selectedLayerId: s.selectedId,
      });
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: "assistant", text: reply.message, reply }]);
      if (refs.length) {
        // Keep references with the design so later turns (and the shop) can see them.
        const known = new Set(s.project.references.map((r) => r.id));
        const add = refs.filter((r) => !known.has(r.id));
        if (add.length) s.replace({ ...s.project, references: [...s.project.references, ...add].slice(-8) });
        setRefs([]);
      }
    } catch (e) {
      setTurns((t) => [...t, { id: crypto.randomUUID(), role: "assistant", text: e instanceof ApiError ? e.message : "The designer couldn't answer just now. Try again.", error: true }]);
    } finally {
      setThinking(false);
    }
  };

  const apply = (p: AiProposal) => {
    const r = s.dispatch(p.ops);
    setApplied((a) => ({ ...a, [p.id]: true }));
    for (const job of r.pending) void s.removeBg(job.layerId, job.tolerance);
    if (r.created[0]) s.setSelectedId(r.created[r.created.length - 1]);
    if (r.skipped.length && !r.applied) s.notify("That suggestion no longer matches the design — ask again.", "info");
    void s.syncAssets();
  };

  const addRef = async (files: FileList) => {
    setUploading(true);
    try {
      const out: AssetRef[] = [];
      for (const f of Array.from(files).slice(0, 4)) {
        const { asset } = await api.upload(f, "reference", f.name);
        out.push(asset);
      }
      setRefs((r) => [...r, ...out].slice(0, 4));
    } catch (e) {
      s.notify(e instanceof Error ? e.message : "Upload failed.", "error");
    } finally {
      setUploading(false);
    }
  };

  const selected = s.selected;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--line)] px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--ai-soft)] text-[var(--ai)]">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="text-[14px] font-semibold text-white">AI Designer</div>
          <span className="ml-auto rounded-full border border-[var(--line)] px-2 py-0.5 text-[10.5px] text-[var(--text-3)]">{s.caps?.ai === "live" ? "Live model" : "Built-in designer"}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--text-3)]">
          <span className="rounded-full bg-white/[0.04] px-2 py-0.5">
            {g.name} · {color.name}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2 py-0.5">{SIDE_LABEL[s.side]}</span>
          {selected && <span className="rounded-full bg-[var(--ai-soft)] px-2 py-0.5 text-[#d9d1ff]">Editing: {selected.kind === "text" ? `“${selected.text.slice(0, 18)}”` : selected.name}</span>}
        </div>
      </div>

      <div ref={list} className="dtf-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!turns.length && (
          <div>
            <p className="text-[13px] leading-relaxed text-[var(--text-2)]">
              Tell me what you want, or drop in a reference — a photo, a sketch, a screenshot of a style you like. I see your garment, colour, layers and print checks, and I change the design itself. Nothing lands until you press Apply.
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              {STARTERS.map((q) => (
                <button key={q} disabled={!signedIn} className="rounded-[10px] border border-[var(--line)] px-3 py-2 text-left text-[12.5px] text-[var(--text-2)] transition hover:border-[rgba(167,150,255,0.4)] hover:text-white disabled:opacity-40" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ml-8 rounded-[14px] rounded-br-[4px] bg-white/[0.07] px-3.5 py-2.5 text-[13px] text-white">
              {t.refs && (
                <div className="mb-2 flex gap-1.5">
                  {t.refs.map((r) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={r.id} src={r.url} alt="Reference" className="h-12 w-12 rounded-[8px] object-cover" />
                  ))}
                </div>
              )}
              {t.text}
            </div>
          ) : (
            <div key={t.id} className="space-y-3">
              <p className={`text-[13px] leading-relaxed ${t.error ? "text-[var(--block)]" : "text-[var(--text)]"}`}>{t.text}</p>
              {t.reply?.proposals.map((p) => (
                <ProposalCard key={p.id} p={p} done={Boolean(applied[p.id])} onApply={() => apply(p)} onUndo={() => (s.undo(), setApplied((a) => ({ ...a, [p.id]: false })))} />
              ))}
              {!!t.reply?.palette?.length && (
                <div>
                  <div className="dtf-label mb-1.5">Works on {color.name.toLowerCase()}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {t.reply.palette.map((c) => (
                      <button
                        key={c.hex + c.name}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--line)] py-1 pl-1 pr-2.5 text-[11.5px] text-[var(--text-2)] hover:border-[var(--line-2)]"
                        title={selected?.kind === "text" ? "Apply to the selected text" : c.hex}
                        onClick={() => selected?.kind === "text" && s.dispatch([{ op: "set-text", layerId: selected.id, color: c.hex }])}
                      >
                        <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: c.hex }} />
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!!t.reply?.notes?.length && (
                <ul className="space-y-1 border-l border-[rgba(167,150,255,0.3)] pl-3 text-[12px] leading-relaxed text-[var(--text-2)]">
                  {t.reply.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          ),
        )}
        {thinking && <div className="dtf-thinking text-[13px]">Designing on your {g.name.toLowerCase()}…</div>}
      </div>

      <div className="border-t border-[var(--line)] p-3">
        {!signedIn ? (
          <div className="rounded-[12px] bg-white/[0.03] p-3 text-[12.5px] text-[var(--text-2)]">
            Sign in to work with the AI designer — it keeps your references and edits with your account.
            <a className="dtf-btn ai sm mt-2 w-full" href="/login?next=/apps/dtf-studio">
              Sign in
            </a>
          </div>
        ) : (
          <>
            {!!refs.length && (
              <div className="mb-2 flex gap-1.5">
                {refs.map((r) => (
                  <span key={r.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.url} alt="Reference" className="h-12 w-12 rounded-[8px] object-cover" />
                    <button className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black text-white" aria-label="Remove reference" onClick={() => setRefs((x) => x.filter((y) => y.id !== r.id))}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-[14px] border border-[var(--line-2)] bg-black/30 p-1.5 focus-within:border-[rgba(167,150,255,0.5)]">
              <button className="dtf-icon shrink-0" aria-label="Attach a reference image" onClick={() => file.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
              </button>
              <textarea
                className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[13px] text-white outline-none placeholder:text-[var(--text-3)]"
                rows={1}
                placeholder={selected ? "Ask about the selected layer…" : "Describe a change or an idea…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                aria-label="Message the AI designer"
              />
              <button className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--ai)] text-[#160f33] transition disabled:opacity-30" disabled={!input.trim() || thinking} onClick={() => send(input)} aria-label="Send">
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => e.target.files && addRef(e.target.files).finally(() => (e.target.value = ""))} />
            <p className="mt-1.5 flex items-center gap-1 px-1 text-[10.5px] text-[var(--text-3)]">
              <ImagePlus className="h-3 w-3" /> References guide the style. Original artwork only — no logos or characters you don&apos;t own.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ProposalCard({ p, done, onApply, onUndo }: { p: AiProposal; done: boolean; onApply: () => void; onUndo: () => void }) {
  const s = useStudio();
  return (
    <div className={`overflow-hidden rounded-[14px] border transition ${done ? "border-[rgba(91,227,164,0.35)]" : "border-[rgba(167,150,255,0.25)]"} bg-[rgba(167,150,255,0.05)]`}>
      <div className="flex gap-3 p-3">
        <ProposalThumb project={s.project} ops={p.ops} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-white">{p.title}</div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-2)]">{p.rationale}</p>
          <ul className="mt-1.5 space-y-0.5">
            {p.ops.slice(0, 5).map((op, i) => (
              <li key={i} className="truncate text-[11px] text-[var(--text-3)]">
                · {describeOp(op, s.project)}
              </li>
            ))}
            {p.ops.length > 5 && <li className="text-[11px] text-[var(--text-3)]">· and {p.ops.length - 5} more</li>}
          </ul>
        </div>
      </div>
      <div className="flex gap-1.5 border-t border-[var(--line)] px-3 py-2">
        {done ? (
          <>
            <span className="flex items-center gap-1 text-[12px] text-[var(--ok)]">
              <Check className="h-3.5 w-3.5" /> Applied
            </span>
            <button className="dtf-btn sm ghost ml-auto" onClick={onUndo}>
              <RotateCcw className="h-3.5 w-3.5" /> Undo
            </button>
          </>
        ) : (
          <button className="dtf-btn ai sm ml-auto" onClick={onApply} disabled={!p.ops.length}>
            Apply to design
          </button>
        )}
      </div>
    </div>
  );
}

/** A small flat render of what the design WOULD look like with these ops. */
function ProposalThumb({ project, ops }: { project: DesignProject; ops: DesignOp[] }) {
  const result = useMemo(() => applyOps(project, ops, { measure: measureText, svgSource: svgToSource }).project, [project, ops]);
  const touched = ops.map((o) => ("side" in o ? o.side : "layerId" in o ? result.layers.find((l) => l.id === o.layerId)?.side : undefined)).find(Boolean) as SideId | undefined;
  return (
    <div className="grid h-[96px] w-[76px] shrink-0 place-items-center rounded-[8px] bg-black/30">
      <FlatThumb project={result} side={touched} width={64} />
    </div>
  );
}

function describeOp(op: DesignOp, p: DesignProject): string {
  const name = (id: string) => {
    const l = p.layers.find((x) => x.id === id);
    return l ? (l.kind === "text" ? `“${l.text.slice(0, 16)}”` : l.name) : "layer";
  };
  switch (op.op) {
    case "move":
      return op.dy || op.dx ? `Nudge ${name(op.layerId)} ${op.dy ? `${op.dy > 0 ? "up" : "down"} ${Math.abs(op.dy)} cm` : ""}${op.dx ? ` ${op.dx > 0 ? "right" : "left"} ${Math.abs(op.dx)} cm` : ""}` : `Move ${name(op.layerId)}`;
    case "resize":
      return `${(op.scale ?? 1) >= 1 ? "Enlarge" : "Shrink"} ${name(op.layerId)}${op.scale ? ` ×${op.scale.toFixed(2)}` : ""}`;
    case "rotate":
      return `Rotate ${name(op.layerId)} to ${Math.round(op.rotation)}°`;
    case "set-text":
      return `Restyle ${name(op.layerId)}${op.font ? ` in ${op.font.replace(/-/g, " ")}` : ""}${op.color ? ` · ${op.color}` : ""}`;
    case "add-text":
      return `Add text “${op.text.slice(0, 20)}”`;
    case "add-svg":
      return `Add original graphic: ${op.name}`;
    case "set-color":
      return `Garment colour → ${op.colorId.replace(/-/g, " ")}`;
    case "set-garment":
      return `Switch to ${getGarment(op.garmentId).name}`;
    case "set-placement":
      return `${SIDE_LABEL[op.side]} placement → ${op.zoneId.replace(/-/g, " ")}`;
    case "remove-background":
      return `Remove background from ${name(op.layerId)} (original kept)`;
    case "delete":
      return `Remove ${name(op.layerId)}`;
    case "duplicate":
      return `Duplicate ${name(op.layerId)}`;
    case "reorder":
      return `Send ${name(op.layerId)} ${op.to}`;
    case "set-opacity":
      return `Opacity of ${name(op.layerId)} → ${Math.round(op.opacity * 100)}%`;
    case "center":
      return `Centre ${name(op.layerId)}`;
  }
}
