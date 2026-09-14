"use client";

// ---------------------------------------------------------------------------
// The video stage. The film renders the Smart Shot way: ONE H3 generation of
// every cut from one compiled prompt, with the reference sheets and the
// composed shot-plan sheet attached. Below it, each cut can be retaken on
// its own for a single beat that needs another go.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { videoBackend } from "@/lib/smart-shot/client";
import { QUALITY, estimateCost } from "@/lib/smart-shot/constants";
import type { H3Brief } from "@/lib/smart-shot/h3prompt";
import type { PlanCut, Take } from "@/lib/smart-shot/types";
import { PanelImg } from "./Sheet";
import { FULL, type Studio } from "./studio";

export function VideoStage({ s }: { s: Studio }) {
  const plan = s.project.plan!;
  const [backend, setBackend] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    videoBackend().then(setBackend).catch(() => setBackend(null));
  }, []);
  const total = plan.cuts.reduce((a, c) => a + c.durationSec, 0);
  const q = QUALITY[s.project.brief.quality];

  return (
    <div className="ss-video">
      <div className="ss-toolbar">
        <div>
          <div className="ss-label">
            Video · {plan.cuts.length} cuts · {s.project.brief.aspectRatio} | {q.label} | {Math.min(15, total)}s
          </div>
          <div className="ss-title">{plan.title}</div>
          <div className="ss-hint">
            {backend ? (
              backend.id === "placeholder" ? (
                <>No video backend configured — renders will be animatic placeholders. Add RUNPOD_API_KEY + RUNPOD_ENDPOINT_ID, MINIMAX_API_KEY or AI_GATEWAY_API_KEY.</>
              ) : (
                <>Rendering with {backend.label}. {estimateCost(Math.min(15, total), s.project.brief.quality)}.</>
              )
            ) : (
              "Checking the video backend…"
            )}
          </div>
        </div>
        <div className="ss-toolbar-actions">
          <button type="button" className="ss-btn" onClick={() => s.setStage("storyboard")}>
            <Icon.ArrowLeft width={13} height={13} /> Shot plan
          </button>
        </div>
      </div>

      <FullFilm s={s} />

      <div className="ss-label" style={{ marginTop: 8 }}>
        Retake a single cut
      </div>
      <p className="ss-hint">Each cut can also render on its own (minimum 4 s) with its storyboard frame as the reference — useful when one beat needs another go.</p>
      <div className="ss-cutlist">
        {plan.cuts.map((c) => (
          <CutRow key={c.id} s={s} cut={c} />
        ))}
      </div>
    </div>
  );
}

function latest(takes: Take[], cutId: string | null): Take | undefined {
  const mine = takes.filter((t) => t.cutId === cutId);
  return mine[mine.length - 1];
}

function usePrompt(s: Studio, load: () => Promise<H3Brief>, stamp: string) {
  const [brief, setBrief] = useState<H3Brief | null>(null);
  useEffect(() => {
    let alive = true;
    setBrief(null);
    load().then((b) => alive && setBrief(b));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);
  return brief;
}

function PromptBox({ s, brief, overrideKey }: { s: Studio; brief: H3Brief | null; overrideKey: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const override = s.project.promptOverrides[overrideKey];
  return (
    <div className="ss-cutrow-prompt">
      <div className="ss-h">
        MINIMAX H3 VIDEO PROMPT
        <span className="ss-cut-tools">
          {brief && !editing && (
            <button type="button" onClick={() => navigator.clipboard?.writeText(brief.text)} title="Copy">
              <Icon.Copy width={11} height={11} />
            </button>
          )}
          {!editing ? (
            <button
              type="button"
              onClick={() => {
                setDraft(brief?.text ?? "");
                setEditing(true);
              }}
              title="Edit the prompt by hand"
            >
              <Icon.Edit width={11} height={11} />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  s.setPromptOverride(overrideKey, draft);
                  setEditing(false);
                }}
              >
                save
              </button>
              <button type="button" onClick={() => setEditing(false)}>
                cancel
              </button>
            </>
          )}
          {override && !editing && (
            <button type="button" onClick={() => s.setPromptOverride(overrideKey, null)} title="Go back to the composed prompt">
              reset
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <textarea className="ss-prompt ss-prompt-edit" value={draft} onChange={(e) => setDraft(e.target.value)} rows={16} />
      ) : (
        <pre className="ss-prompt">{brief?.text ?? "composing…"}</pre>
      )}
      {brief && (
        <div className="ss-hint">
          {brief.notes.split("\n").join(" · ")}
          {brief.references.length > 0 && <> · refs: {brief.references.map((r) => `${r.label}=${r.source.name}`).join(", ")}</>}
          {override && " · hand-edited"}
        </div>
      )}
    </div>
  );
}

function TakeView({ s, take, name, onRender, busyLabel }: { s: Studio; take: Take | undefined; name: string; onRender: () => void; busyLabel: string }) {
  const busy = take && (take.status === "queued" || take.status === "generating");
  const url = take?.mediaId ? s.urls[take.mediaId] : undefined;
  const count = s.project.takes.filter((t) => t.cutId === (take?.cutId ?? null)).length;
  return (
    <div className="ss-cutrow-take">
      {url ? (
        <video src={url} controls playsInline className="ss-clip" />
      ) : (
        <div className="ss-clip ss-clip-empty">
          {busy ? (
            <>
              <span className="ss-spinner" /> {take.status === "queued" ? "queued" : "generating"}
              {take.note ? ` · ${take.note}` : ""}
            </>
          ) : take?.status === "error" ? (
            <span className="ss-err">{take.error}</span>
          ) : take?.status === "done" && take.engine === "placeholder" ? (
            <span>Animatic placeholder (no backend). The prompt is what H3 would receive.</span>
          ) : (
            "no take yet"
          )}
        </div>
      )}
      <div className="ss-take-actions">
        <button type="button" className="ss-primary" onClick={onRender} disabled={!!busy || !!s.busy}>
          <Icon.Film width={13} height={13} /> {busy ? busyLabel : take ? "Recreate video" : "Generate video"}
        </button>
        {url && (
          <a className="ss-btn" href={url} download={`${name}.mp4`}>
            <Icon.Download width={13} height={13} /> mp4
          </a>
        )}
        {count > 1 && <span className="ss-hint">{count} takes</span>}
      </div>
    </div>
  );
}

function FullFilm({ s }: { s: Studio }) {
  const plan = s.project.plan!;
  const take = latest(s.project.takes, null);
  const stamp = JSON.stringify([plan, s.project.promptOverrides[FULL], s.project.panels.map((p) => p.mediaId), s.project.sheetMediaId]);
  const brief = usePrompt(s, s.fullBrief, stamp);
  const sheetUrl = s.project.sheetMediaId ? s.urls[s.project.sheetMediaId] : undefined;
  const url = take?.mediaId ? s.urls[take.mediaId] : undefined;

  return (
    <div className="ss-full">
      <div className="ss-full-main">
        {url ? (
          <video src={url} controls playsInline className="ss-player-video" />
        ) : (
          <div className="ss-full-empty">
            {take && (take.status === "queued" || take.status === "generating") ? (
              <>
                <span className="ss-spinner" /> {take.status === "queued" ? "queued" : "generating the film"}
                {take.note ? ` · ${take.note}` : ""}
              </>
            ) : take?.status === "error" ? (
              <span className="ss-err">{take.error}</span>
            ) : take?.status === "done" && take.engine === "placeholder" ? (
              "Animatic placeholder (no backend)."
            ) : (
              "The whole film renders here as one MiniMax H3 generation."
            )}
          </div>
        )}
        <div className="ss-full-side">
          <div className="ss-h">REFERENCES</div>
          <div className="ss-refstrip">
            {sheetUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sheetUrl} alt="Shot plan sheet" title="The composed shot-plan sheet, attached to the render" />
            ) : (
              <span className="ss-hint">The shot-plan sheet is composed when you generate.</span>
            )}
          </div>
          <div className="ss-h">SETTINGS</div>
          <div className="ss-hint">
            {s.project.brief.aspectRatio} | {QUALITY[s.project.brief.quality].label} | {Math.min(15, plan.cuts.reduce((a, c) => a + c.durationSec, 0))}s · Audio: On
          </div>
          <TakeView s={s} take={take} name={`${plan.title.replace(/[^\w-]+/g, "-").toLowerCase()}`} onRender={s.renderFull} busyLabel="Rendering…" />
        </div>
      </div>
      <PromptBox s={s} brief={brief} overrideKey={FULL} />
    </div>
  );
}

function CutRow({ s, cut }: { s: Studio; cut: PlanCut }) {
  const stamp = JSON.stringify([cut, s.project.plan?.characters, s.project.plan?.products, s.project.plan?.environments, s.project.plan?.lighting, s.project.plan?.moods, s.project.promptOverrides[cut.id], s.project.panels.map((p) => p.mediaId)]);
  const brief = usePrompt(s, () => s.briefFor(cut), stamp);
  const take = latest(s.project.takes, cut.id);
  return (
    <div className="ss-cutrow">
      <div className="ss-cutrow-frame">
        <PanelImg s={s} kind="cut" targetId={cut.id} />
        <div className="ss-cut-spec">
          {cut.title} · {cut.lensMm}mm | {cut.aperture} | {cut.move.toUpperCase()} | {cut.framing.toUpperCase()}
        </div>
      </div>
      <PromptBox s={s} brief={brief} overrideKey={cut.id} />
      <TakeView s={s} take={take} name={cut.title.replace(/\s+/g, "-").toLowerCase()} onRender={() => s.render(cut.id)} busyLabel="Rendering…" />
    </div>
  );
}
