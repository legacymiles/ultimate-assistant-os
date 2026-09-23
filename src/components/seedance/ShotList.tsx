"use client";

// ---------------------------------------------------------------------------
// Every prompt, top to bottom.
//
// The timeline answers "when". This answers "what, in order", and it is where
// you come back to. One row per prompt, its image, its words, its look — the
// only view that shows you at a glance which shots you never wrote.
// ---------------------------------------------------------------------------

import { SINGS, blockSkin, secs, timecode } from "@/lib/seedance/constants";
import { deckSummary, mergedCinema, overrideCount, posterOf } from "@/lib/seedance/prompt";
import type { PlacedPrompt, Reel } from "@/lib/seedance/types";
import { Icon } from "../icons";

export function ShotList({
  reel,
  placed,
  selectedId,
  playheadSec,
  onSelect,
  onRender,
  onAdd,
}: {
  reel: Reel;
  placed: PlacedPrompt[];
  selectedId: string | null;
  playheadSec: number;
  onSelect: (id: string) => void;
  onRender: (index: number) => void;
  onAdd: () => void;
}) {
  const unwritten = placed.filter((p) => !p.block.prompt.trim()).length;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">Prompts</h2>
        <span className="text-[10px] tabular-nums text-ink-muted">{placed.length}</span>
        {unwritten > 0 && (
          <span className="text-[10px] text-ink-faint">{unwritten} still unwritten</span>
        )}
        <button
          onClick={onAdd}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[10px] font-medium text-ink-muted transition hover:border-accent hover:text-accent"
        >
          <Icon.Plus width={11} height={11} />
          Add prompt
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="text-[9px] uppercase tracking-[0.08em] text-ink-faint">
              <Th className="w-10 text-right">#</Th>
              <Th className="w-12" />
              <Th className="w-20">In</Th>
              <Th className="w-14 text-right">Runs</Th>
              <Th className="w-20">Audio</Th>
              <Th>Prompt</Th>
              <Th className="hidden w-[28%] xl:table-cell">Look</Th>
              <Th className="w-20 text-right">Render</Th>
            </tr>
          </thead>
          <tbody>
            {placed.map((p) => {
              const skin = blockSkin(p.lipSynced);
              const on = selectedId === p.block.id;
              const live = playheadSec >= p.startSec && playheadSec < p.startSec + p.durationSec;
              const look = deckSummary(mergedCinema(reel, p.block));
              const own = overrideCount(p.block);
              const poster = posterOf(p.block);
              return (
                <tr
                  key={p.block.id}
                  onClick={() => onSelect(p.block.id)}
                  className={
                    "cursor-pointer border-t border-line-soft transition-colors " +
                    (on ? "bg-panel-2" : "hover:bg-panel-2/60")
                  }
                >
                  <Td className="text-right tabular-nums text-ink-faint">
                    {String(p.index + 1).padStart(2, "0")}
                  </Td>
                  <Td>
                    <span
                      className="flex h-7 w-10 items-center justify-center overflow-hidden rounded border border-line-soft"
                      style={{ background: poster ? undefined : skin.fill }}
                    >
                      {poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={poster} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Icon.Image width={11} height={11} className="text-ink-faint" />
                      )}
                    </span>
                  </Td>
                  <Td className="tabular-nums">
                    <span className={live ? "text-accent" : "text-ink-muted"}>
                      {timecode(p.startSec, true)}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums text-ink-muted">{secs(p.durationSec)}</Td>
                  <Td>
                    {p.lipSynced ? (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium"
                        style={{ color: SINGS.text }}
                      >
                        <Icon.Mic width={10} height={10} />
                        Lip sync
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-faint">Under music</span>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={
                        "line-clamp-1 text-[12px] " +
                        (p.block.prompt.trim() ? "text-ink" : "text-ink-faint")
                      }
                    >
                      {p.block.prompt.trim() || "Not written yet"}
                    </span>
                  </Td>
                  <Td className="hidden xl:table-cell">
                    <span className="line-clamp-1 text-[11px] text-ink-muted">
                      {look || "Follows the film"}
                      {own > 0 && <span className="text-ink-faint"> · {own} own</span>}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <RenderCell status={p.block.status} onRender={() => onRender(p.index)} />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RenderCell({ status, onRender }: { status: string; onRender: () => void }) {
  if (status === "generating") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-accent">
        <Icon.Refresh width={10} height={10} className="animate-spin" />…
      </span>
    );
  }
  if (status === "done") return <span className="text-[10px] text-ink-muted">done</span>;
  if (status === "error") return <span className="text-[10px] text-red-400">failed</span>;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onRender();
      }}
      className="rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-muted transition hover:border-accent hover:text-accent"
    >
      Render
    </button>
  );
}

const Th = ({ className = "", children }: { className?: string; children?: React.ReactNode }) => (
  <th className={"px-3 py-1.5 font-semibold " + className}>{children}</th>
);

const Td = ({ className = "", children }: { className?: string; children: React.ReactNode }) => (
  <td className={"max-w-0 px-3 py-1.5 align-middle " + className}>{children}</td>
);
