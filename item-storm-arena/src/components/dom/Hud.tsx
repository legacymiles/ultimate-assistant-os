"use client";
/**
 * AAA-menu style HUD: orbit count, banked coins, combo discoveries,
 * and the event toast when a secret combo fires. Entirely pointer-events-none
 * so it never steals a launch click.
 */
import { useEffect, useState } from "react";
import { useArena } from "@/lib/store";
import { COMBOS } from "@/lib/combos";

export function Hud() {
  const collected = useArena((s) => s.collected);
  const score = useArena((s) => s.score);
  const totalHits = useArena((s) => s.totalHits);
  const eventLabel = useArena((s) => s.eventLabel);
  const discovered = useArena((s) => s.discovered);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!eventLabel) return;
    setToast(eventLabel);
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [eventLabel]);

  return (
    <div className="pointer-events-none fixed inset-0 z-20 select-none" aria-hidden>
      {/* top bar */}
      <div className="flex items-start justify-between p-5 sm:p-7">
        <div className="hud-panel">
          <span className="text-[10px] tracking-[0.3em] opacity-60">ITEM STORM</span>
          <span className="font-display text-lg leading-none tracking-wide">ARENA&nbsp;//&nbsp;01</span>
        </div>
        <div className="flex gap-3">
          <div className="hud-panel items-end">
            <span className="text-[10px] tracking-[0.3em] opacity-60">ORBIT</span>
            <span className="font-display text-lg leading-none tabular-nums">{collected}</span>
          </div>
          <div className="hud-panel items-end">
            <span className="text-[10px] tracking-[0.3em] opacity-60">COINS</span>
            <span className="font-display text-lg leading-none tabular-nums">{score}</span>
          </div>
          <div className="hud-panel items-end max-sm:hidden">
            <span className="text-[10px] tracking-[0.3em] opacity-60">SECRETS</span>
            <span className="font-display text-lg leading-none tabular-nums">
              {discovered.length}/{COMBOS.length}
            </span>
          </div>
        </div>
      </div>

      {/* combo toast */}
      <div
        className={`absolute left-1/2 top-24 -translate-x-1/2 transition-all duration-500 ${
          toast ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"
        }`}
      >
        {toast && (
          <div className="rounded-full border border-white/20 bg-black/50 px-6 py-2 backdrop-blur-md">
            <span className="font-display text-sm tracking-[0.25em] text-amber-200">{toast}</span>
          </div>
        )}
      </div>

      {/* bottom hint — earns its keep, then gets out of the way */}
      {totalHits < 4 && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-center">
          <p className="text-xs tracking-[0.25em] uppercase opacity-50">
            {collected === 0 ? "drift near the storm — it notices you" : "click to launch everything at the kart"}
          </p>
        </div>
      )}
    </div>
  );
}
