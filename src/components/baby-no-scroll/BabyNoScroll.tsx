"use client";

// ---------------------------------------------------------------------------
// Baby No Scroll — hand over the screen, not the device.
//
// The app is two screens that could not look less alike, and that is deliberate.
//
// The CONSOLE is the parent's: hub-dark, dense, every switch labelled with what
// it actually does and what it cannot do. It is read once, standing up, usually
// one-handed, usually in a hurry.
//
// The NURSERY is the child's: one video or one game, filling the screen, with no
// text, no menu, no tab bar and no button anywhere — except the padlock, which
// is the only thing in the app that answers to a touch.
//
// Pressing Hand it over crosses between them. Dragging the padlock the width of
// the screen crosses back.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRemotePull } from "@/lib/sync/useSync";
import {
  KEY,
  loadSettings,
  removeShow,
  saveSettings,
  sortedShows,
  touchShow,
  upsertShow,
} from "@/lib/baby-no-scroll/store";
import { DEFAULT_SETTINGS, type Mode, type Settings, type Target } from "@/lib/baby-no-scroll/types";
import { GAMES } from "@/lib/baby-no-scroll/games";
import { describeTarget, parseYouTube } from "@/lib/baby-no-scroll/youtube";
import { useScreenLock } from "@/lib/baby-no-scroll/useScreenLock";
import { CORNERS } from "@/lib/baby-no-scroll/lock";
import type { Corner } from "@/lib/baby-no-scroll/types";
import { Padlock } from "./Padlock";
import { GameStage, gameHue } from "./GameStage";
import { YouTubeStage } from "./YouTubeStage";
import "./baby-no-scroll.css";

export function BabyNoScroll({ initialMode }: { initialMode?: Mode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  // localStorage is only there after mount, so the first paint is the defaults
  // and this is the correction. Same shape as every other app in the hub.
  useEffect(() => {
    const s = loadSettings();
    setSettings(initialMode ? { ...s, mode: initialMode } : s);
    setReady(true);
  }, [initialMode]);

  useRemotePull(KEY, () => {
    if (!locked) setSettings(loadSettings());
  });

  const patch = useCallback((p: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...p };
      saveSettings(next);
      return next;
    });
  }, []);

  const typed = useMemo(() => parseYouTube(link), [link]);
  const shows = useMemo(() => sortedShows(settings.shows), [settings.shows]);
  const pickedShow = useMemo(() => shows.find((s) => s.id === picked) ?? null, [picked, shows]);

  // What will actually go on. A freshly pasted link wins over a saved one,
  // because typing is the more recent intention.
  const target: Target | null = typed ?? pickedShow?.target ?? null;
  const canLock = settings.mode === "games" || !!target;

  const lockState = useScreenLock({
    active: locked,
    fullscreen: settings.fullscreen,
    keepAwake: settings.keepAwake,
  });

  const handOver = () => {
    if (!canLock) return;
    if (settings.mode === "youtube" && target) {
      // Putting something on is also how it gets remembered, so a parent never
      // has to think about saving.
      const label = name.trim() || pickedShow?.name || describeTarget(target);
      const nextShows = pickedShow && !typed
        ? touchShow(settings.shows, pickedShow.id)
        : upsertShow(settings.shows, label, target);
      patch({ shows: nextShows });
      setName("");
    }
    setLocked(true);
  };

  // --- the nursery ---------------------------------------------------------
  if (locked) {
    const hue = settings.mode === "games" ? gameHue(settings.game) : 330;
    return (
      <div
        className={`bns-nursery ${settings.mode === "youtube" ? "is-video" : ""}`}
        style={{ ["--bns-hue" as string]: hue }}
        // Fullscreen can only be re-entered inside a user gesture, and on a
        // locked screen every gesture is the baby's. So the baby repairs it,
        // without knowing, with the next thing they touch.
        onPointerDownCapture={() => {
          if (settings.fullscreen && !lockState.isFullscreen) lockState.restoreFullscreen();
        }}
      >
        {settings.mode === "youtube" && target ? (
          <YouTubeStage
            target={target}
            loop={settings.loop}
            onShieldTap={() => {
              if (settings.fullscreen && !lockState.isFullscreen) lockState.restoreFullscreen();
            }}
          />
        ) : (
          <GameStage game={settings.game} />
        )}

        <Padlock
          corner={settings.corner}
          size={settings.lockSize}
          holdToConfirm={settings.holdToConfirm}
          onMoveCorner={(c) => patch({ corner: c })}
          onUnlock={() => setLocked(false)}
        />
      </div>
    );
  }

  // --- the console --------------------------------------------------------
  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Baby No Scroll</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-muted">
              Put one video or one game on the whole screen and take everything else away. The only
              thing left that answers to a touch is a padlock in the corner, and it opens by being
              dragged the width of the screen — which is a gesture a baby does not make.
            </p>
          </div>
          <a
            href="/apps/new-jarvis#plugins"
            className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink-muted transition hover:border-ink-faint hover:text-ink"
          >
            ← Jarvis
          </a>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ---- what goes on the screen ---- */}
          <section className="rounded-xl border border-line bg-panel">
            <div className="flex border-b border-line" role="tablist" aria-label="What to lock onto">
              {(
                [
                  ["youtube", "YouTube", "A video or a playlist"],
                  ["games", "Games", `${GAMES.length} things to touch`],
                ] as const
              ).map(([id, label, sub]) => (
                <button
                  key={id}
                  role="tab"
                  type="button"
                  aria-selected={settings.mode === id}
                  className={`bns-tab flex-1 px-4 py-3 text-left transition ${
                    settings.mode === id ? "bg-panel-2" : "hover:bg-panel-2/60"
                  }`}
                  onClick={() => patch({ mode: id })}
                >
                  <span
                    className={`block text-sm font-semibold ${
                      settings.mode === id ? "text-ink" : "text-ink-muted"
                    }`}
                  >
                    {label}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">{sub}</span>
                </button>
              ))}
            </div>

            {settings.mode === "youtube" ? (
              <div className="p-4">
                <label className="block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  Paste a link
                </label>
                <input
                  value={link}
                  onChange={(e) => {
                    setLink(e.target.value);
                    setPicked(null);
                  }}
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="youtube.com/watch?v=… · youtu.be/… · a /playlist?list=… · or just the id"
                  className="mt-1.5 w-full rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[12px] text-ink outline-none transition placeholder:text-ink-faint/70 focus:border-ink-faint"
                />
                <p className="mt-1.5 min-h-[18px] text-[11px]">
                  {link.trim() === "" ? (
                    <span className="text-ink-faint">
                      A playlist is the better choice for a long sit: it does not run out.
                    </span>
                  ) : typed ? (
                    <span className="font-mono text-core">✓ {describeTarget(typed)}</span>
                  ) : (
                    <span className="text-amber-400">
                      Not a YouTube link this can read. A watch, youtu.be, Shorts, live or playlist
                      link all work.
                    </span>
                  )}
                </p>

                {typed && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Call it something — “bedtime songs”"
                      className="min-w-[200px] flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[12px] outline-none transition focus:border-ink-faint"
                    />
                    <span className="text-[11px] text-ink-faint">saved when you hand it over</span>
                  </div>
                )}

                <div className="mt-5">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Saved
                    </h2>
                    <span className="text-[11px] text-ink-faint">
                      {shows.length === 0 ? "nothing yet" : `${shows.length} · most recent first`}
                    </span>
                  </div>
                  {shows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[11px] text-ink-faint">
                      Whatever you put on is kept here, so the second night is one tap.
                    </p>
                  ) : (
                    <ul className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line">
                      {shows.map((s) => {
                        const on = picked === s.id && !typed;
                        return (
                          <li
                            key={s.id}
                            className={`flex items-center gap-3 px-3 py-2 transition ${
                              on ? "bg-elevated" : "bg-panel-2/40 hover:bg-panel-2"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setPicked(s.id);
                                setLink("");
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    on ? "bg-amber-400" : "bg-ink-faint/40"
                                  }`}
                                />
                                <span className="truncate text-[13px] font-medium text-ink">
                                  {s.name}
                                </span>
                              </span>
                              <span className="mt-0.5 block truncate pl-3.5 font-mono text-[10px] text-ink-faint">
                                {describeTarget(s.target)}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                patch({ shows: removeShow(settings.shows, s.id) });
                                if (picked === s.id) setPicked(null);
                              }}
                              className="shrink-0 rounded px-2 py-1 text-[11px] text-ink-faint transition hover:bg-canvas hover:text-ink"
                              aria-label={`Forget ${s.name}`}
                            >
                              Forget
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4">
                <p className="mb-3 text-[11px] text-ink-faint">
                  One game, locked on. No menu on the locked screen — a switcher would be a second
                  thing to press, and the first one a baby finds.
                </p>
                <ul className="divide-y divide-line-soft overflow-hidden rounded-lg border border-line">
                  {GAMES.map((g) => {
                    const on = settings.game === g.id;
                    return (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => patch({ game: g.id })}
                          aria-pressed={on}
                          className={`flex w-full items-start gap-3 px-3 py-3 text-left transition ${
                            on ? "bg-elevated" : "bg-panel-2/40 hover:bg-panel-2"
                          }`}
                        >
                          <span
                            className="mt-0.5 h-8 w-8 shrink-0 rounded-lg"
                            style={{
                              background: `radial-gradient(70% 70% at 35% 30%, hsl(${g.hue} 90% 72%), hsl(${g.hue} 80% 42%))`,
                              boxShadow: on ? `0 0 0 2px hsl(${g.hue} 80% 60% / .5)` : "none",
                            }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className="text-[13px] font-semibold text-ink">{g.name}</span>
                              <span className="font-mono text-[10px] text-ink-faint">
                                from {g.from}
                              </span>
                              {on && (
                                <span className="ml-auto rounded border border-amber-400/40 px-1.5 py-px text-[9px] uppercase tracking-wide text-amber-400">
                                  on
                                </span>
                              )}
                            </span>
                            <span className="mt-1 block text-[11px] leading-snug text-ink-muted">
                              {g.line}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>

          {/* ---- the lock ---- */}
          <aside className="space-y-4">
            <section className="rounded-xl border border-line bg-panel p-4">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Where the lock sits
              </h2>
              <p className="mt-1 text-[11px] text-ink-faint">
                Triple-tap it on the locked screen to move it without unlocking.
              </p>
              <div className="bns-corner-pick mt-3">
                {CORNERS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={settings.corner === c}
                    aria-label={CORNER_LABEL[c]}
                    onClick={() => patch({ corner: c })}
                    style={{
                      left: c === "tl" || c === "bl" ? 0 : undefined,
                      right: c === "tr" || c === "br" ? 0 : undefined,
                      top: c === "tl" || c === "tr" ? 0 : undefined,
                      bottom: c === "bl" || c === "br" ? 0 : undefined,
                    }}
                  >
                    <span />
                  </button>
                ))}
              </div>

              <div className="mt-4 space-y-3">
                <Choice
                  label="Lock size"
                  hint="Big is easier to drag one-handed; small is easier to ignore."
                  value={settings.lockSize}
                  options={[
                    ["large", "Big"],
                    ["small", "Small"],
                  ]}
                  onChange={(v) => patch({ lockSize: v as Settings["lockSize"] })}
                />
                <Toggle
                  label="Hold at the end"
                  hint="After the drag, the lock must be held on the latch for a second. A thumb can cross a phone by luck; it will not then sit still."
                  on={settings.holdToConfirm}
                  onChange={(v) => patch({ holdToConfirm: v })}
                />
              </div>
            </section>

            <section className="rounded-xl border border-line bg-panel p-4">
              <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                While it is locked
              </h2>
              <div className="mt-3 space-y-3">
                <Toggle
                  label="Fullscreen"
                  hint="The only thing that really hides the address bar and the tabs. If it gets lost, the next touch anywhere puts it back."
                  on={settings.fullscreen}
                  onChange={(v) => patch({ fullscreen: v })}
                />
                <Toggle
                  label="Keep the screen awake"
                  hint="Where the browser allows it. Safari does not, and the screen will dim on its own schedule there."
                  on={settings.keepAwake}
                  onChange={(v) => patch({ keepAwake: v })}
                />
                <Toggle
                  label="Loop forever"
                  hint="Repeat the video or the playlist instead of letting YouTube pick what comes next — which is the setting that matters most, because what comes next is chosen by a machine that has never met your child."
                  on={settings.loop}
                  onChange={(v) => patch({ loop: v })}
                />
              </div>
            </section>

            <button
              type="button"
              onClick={handOver}
              disabled={!canLock || !ready}
              className="bns-handover w-full rounded-xl px-4 py-3.5 text-sm font-semibold disabled:cursor-not-allowed"
            >
              {settings.mode === "youtube" && !target ? "Paste a link first" : "Hand it over"}
            </button>

            <p className="text-[11px] leading-relaxed text-ink-faint">
              <strong className="text-ink-muted">What this cannot do.</strong> A web page cannot
              disable the home button, the power button or the gesture that switches apps, and it
              cannot stop Escape leaving fullscreen. For a device you walk away from, turn on{" "}
              <span className="text-ink-muted">Guided Access</span> on an iPhone or iPad, or{" "}
              <span className="text-ink-muted">Screen Pinning</span> on Android, and this on top of
              it. Everything else — scrolling, pinching, the back gesture, the keyboard, long-press
              menus, YouTube&rsquo;s own controls and its wall of next videos — is already gone.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}

const CORNER_LABEL: Record<Corner, string> = {
  tl: "Top left",
  tr: "Top right",
  br: "Bottom right",
  bl: "Bottom left",
};

function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition ${
          on ? "border-amber-400/50 bg-amber-400/30" : "border-line bg-elevated"
        }`}
      >
        <span
          className={`block h-3.5 w-3.5 rounded-full bg-ink transition-transform ${
            on ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </button>
      <label className="min-w-0 flex-1 cursor-pointer" onClick={() => onChange(!on)}>
        <span className="block text-[12px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ink-faint">{hint}</span>
      </label>
    </div>
  );
}

function Choice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-ink">{label}</span>
        <div className="flex overflow-hidden rounded-lg border border-line">
          {options.map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              aria-pressed={value === v}
              className={`px-2.5 py-1 text-[11px] transition ${
                value === v ? "bg-elevated text-ink" : "text-ink-faint hover:text-ink"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{hint}</p>
    </div>
  );
}
