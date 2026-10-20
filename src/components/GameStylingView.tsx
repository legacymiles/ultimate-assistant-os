"use client";

// Projects Timeline › Folders › Game Play Design Styling.
//
// The one place to change how the spades table looks and feels: which theme
// is on, which holidays switch themselves on, and every word, colour and
// attack in each theme. Saves as you type and syncs to every device; the
// table picks the change up the next time it loads.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  PRESETS, duplicateTheme, isMonthDay, resetTheme,
  type AttackKind, type GameStyleDoc, type GameTheme, type SuitKey,
} from "@/lib/cook-connect/gameStyle";
import { useGameStyle } from "@/lib/cook-connect/hooks/useGameStyle";
import { APP_EDITS, GAME_STYLING_FOLDER } from "@/lib/timeline/appEdits";
import { PlayingCard } from "./cook-connect/play/PlayingCard";
import { Burst, FxStage, clashStyle, type Banner, type Clash } from "./cook-connect/play/SpadesFx";
import { cn } from "@/lib/utils";

const SUITS: { key: SuitKey; label: string; sym: string }[] = [
  { key: "S", label: "Spades", sym: "♠" },
  { key: "H", label: "Hearts", sym: "♥" },
  { key: "D", label: "Diamonds", sym: "♦" },
  { key: "C", label: "Clubs", sym: "♣" },
];
const KINDS: { id: AttackKind; label: string }[] = [
  { id: "slash", label: "Slash" },
  { id: "fire", label: "Fire" },
  { id: "shards", label: "Shards" },
  { id: "quake", label: "Quake" },
];
const MOMENTS: { key: "spadesBroken" | "trumpSteal" | "nilShield" | "set" | "renege" | "boston"; label: string; when: string }[] = [
  { key: "spadesBroken", label: "Spades broken", when: "The first spade of a hand. Table goes dark, thunder cracks." },
  { key: "trumpSteal", label: "Trump steal", when: "A spade cuts a trick and takes down a Q, K or A. The biggest hype." },
  { key: "nilShield", label: "Nil shield", when: "Shield around a nil bidder. Pulses on every dodge, shatters if they take one." },
  { key: "set", label: "Getting set", when: "A team misses its bid. Knockout stamp, their score crumbles." },
  { key: "renege", label: "Renig call", when: "Someone calls renig, which ends the game. First words: the call was right. Second: a wrong call." },
  { key: "boston", label: "Boston", when: "One team takes all 13 tricks." },
];

const field = "w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";
const fmtMD = (md: string) => {
  const [m, d] = md.split("-").map(Number);
  return new Date(2026, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function GameStylingView() {
  const { doc, save, theme: live, scheduled } = useGameStyle();
  const [editingId, setEditingId] = useState<string>(live.id);
  const editing = doc.themes.find((t) => t.id === editingId) ?? doc.themes[0];
  const history = useMemo(() => APP_EDITS.filter((e) => e.slug === "cook-connect").slice(0, 6), []);

  const updateTheme = (patch: (t: GameTheme) => GameTheme) =>
    save({ ...doc, themes: doc.themes.map((t) => (t.id === editing.id ? patch(t) : t)) });
  const setDoc = (patch: Partial<GameStyleDoc>) => save({ ...doc, ...patch });

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-5 sm:px-6 sm:py-7">
      <header>
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Folder</div>
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{GAME_STYLING_FOLDER.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          How the spades table in{" "}
          <Link href="/apps/cook-connect" className="text-brand underline-offset-2 hover:underline">Cook Connect</Link>{" "}
          looks and feels. Everything saves as you change it and syncs to your other devices.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm">
          <span className="text-lg leading-none">{live.icon}</span>
          <span className="text-ink">
            Showing now: <b>{live.name}</b>
          </span>
          <span className="text-ink-faint">
            {scheduled ? `· scheduled ${fmtMD(scheduled.from)} – ${fmtMD(scheduled.to)}` : "· picked by you"}
          </span>
        </div>
      </header>

      {/* Themes */}
      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Themes</h2>
          <button
            onClick={() => { const next = duplicateTheme(doc, editing.id, `${editing.name} copy`); save(next); setEditingId(next.themes.at(-1)!.id); }}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-panel-2 hover:text-ink"
          >
            + New from “{editing.name}”
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {doc.themes.map((t) => {
              const preset = PRESETS.some((p) => p.id === t.id);
              return (
                <tr
                  key={t.id}
                  className={cn("border-b border-line/60 last:border-0", t.id === editing.id && "bg-brand/10")}
                >
                  <td className="w-8 py-2 pl-4 text-lg">{t.icon}</td>
                  <td className="py-2">
                    <button onClick={() => setEditingId(t.id)} className="text-left font-semibold text-ink hover:underline">
                      {t.name}
                    </button>
                    <div className="mt-1 flex gap-1">
                      {SUITS.map((s) => (
                        <span key={s.key} title={`${s.label}: ${t.suits[s.key].attack}`}
                          className="h-3 w-3 rounded-sm" style={{ background: t.suits[s.key].color }} />
                      ))}
                      <span className="ml-1 h-3 w-6 rounded-sm" title="Table felt"
                        style={{ background: `linear-gradient(90deg, ${t.felt[0]}, ${t.felt[1]})` }} />
                    </div>
                  </td>
                  <td className="py-2 text-xs text-ink-faint">
                    {doc.schedule.filter((e) => e.themeId === t.id).map((e) => `${fmtMD(e.from)}–${fmtMD(e.to)}`).join(", ")}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      {live.id === t.id ? (
                        <span className="rounded-lg bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-400">On now</span>
                      ) : (
                        <button onClick={() => setDoc({ activeId: t.id, scheduleOn: scheduled ? false : doc.scheduleOn })}
                          title={scheduled ? "Use this now (turns the holiday schedule off)" : "Use this theme"}
                          className="rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:bg-panel-2 hover:text-ink">
                          Use now
                        </button>
                      )}
                      {preset ? (
                        <button onClick={() => confirm(`Put ${t.name} back the way it shipped?`) && save(resetTheme(doc, t.id))}
                          className="rounded-lg border border-line px-2 py-1 text-xs text-ink-faint hover:text-ink">Reset</button>
                      ) : (
                        <button onClick={() => {
                          if (!confirm(`Delete ${t.name}?`)) return;
                          const themes = doc.themes.filter((x) => x.id !== t.id);
                          save({ ...doc, themes, activeId: doc.activeId === t.id ? themes[0].id : doc.activeId,
                            schedule: doc.schedule.filter((e) => e.themeId !== t.id) });
                          if (editingId === t.id) setEditingId(themes[0].id);
                        }} className="rounded-lg border border-line px-2 py-1 text-xs text-ink-faint hover:text-red-400">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* Holiday schedule */}
      <section className="rounded-2xl border border-line bg-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Holidays & events</h2>
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" checked={doc.scheduleOn} onChange={(e) => setDoc({ scheduleOn: e.target.checked })} />
            Switch themes on by date
          </label>
        </div>
        <div className={cn("space-y-1.5 p-3", !doc.scheduleOn && "opacity-50")}>
          {doc.schedule.map((e, i) => (
            <div key={i} className="grid grid-cols-[1fr_88px_88px_auto] items-center gap-2">
              <select className={field} value={e.themeId}
                onChange={(ev) => setDoc({ schedule: doc.schedule.map((x, j) => (j === i ? { ...x, themeId: ev.target.value } : x)) })}>
                {doc.themes.map((t) => <option key={t.id} value={t.id}>{t.icon} {t.name}</option>)}
              </select>
              <DateBox value={e.from} onChange={(v) => setDoc({ schedule: doc.schedule.map((x, j) => (j === i ? { ...x, from: v } : x)) })} />
              <DateBox value={e.to} onChange={(v) => setDoc({ schedule: doc.schedule.map((x, j) => (j === i ? { ...x, to: v } : x)) })} />
              <button onClick={() => setDoc({ schedule: doc.schedule.filter((_, j) => j !== i) })}
                className="rounded-lg px-2 py-1 text-xs text-ink-faint hover:text-red-400" aria-label="Remove">✕</button>
            </div>
          ))}
          <button onClick={() => setDoc({ schedule: [...doc.schedule, { themeId: editing.id, from: "01-01", to: "01-01" }] })}
            className="mt-1 rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-ink-muted hover:text-ink">
            + Add a date range (month-day, e.g. 11-20 to 11-28)
          </button>
        </div>
      </section>

      {/* Editor + live preview */}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="space-y-4 rounded-2xl border border-line bg-panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Editing: {editing.icon} {editing.name}</h2>
          </div>

          <div className="grid grid-cols-[64px_1fr] gap-2">
            <Labeled label="Icon"><input className={field} value={editing.icon} onChange={(e) => updateTheme((t) => ({ ...t, icon: e.target.value }))} /></Labeled>
            <Labeled label="Name"><input className={field} value={editing.name} onChange={(e) => updateTheme((t) => ({ ...t, name: e.target.value }))} /></Labeled>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Labeled label="Felt (centre)"><ColorBox value={editing.felt[0]} onChange={(v) => updateTheme((t) => ({ ...t, felt: [v, t.felt[1]] }))} /></Labeled>
            <Labeled label="Felt (edge)"><ColorBox value={editing.felt[1]} onChange={(v) => updateTheme((t) => ({ ...t, felt: [t.felt[0], v] }))} /></Labeled>
            <Labeled label="Accent (circuitry, rim, card backs)"><ColorBox value={editing.accent} onChange={(v) => updateTheme((t) => ({ ...t, accent: v }))} /></Labeled>
            <Labeled label="Confetti (emoji, spaces)">
              <input className={field} value={editing.confetti.join(" ")} placeholder="🎃 🦇"
                onChange={(e) => updateTheme((t) => ({ ...t, confetti: e.target.value.split(/\s+/).filter(Boolean) }))} />
            </Labeled>
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-ink">Suit attacks: what a winning card does</h3>
            <div className="space-y-1.5">
              {SUITS.map((s) => {
                const st = editing.suits[s.key];
                const setSuit = (patch: Partial<typeof st>) =>
                  updateTheme((t) => ({ ...t, suits: { ...t.suits, [s.key]: { ...t.suits[s.key], ...patch } } }));
                return (
                  <div key={s.key} className="grid grid-cols-[28px_1fr_96px_48px] items-center gap-2">
                    <span className="text-center text-lg" style={{ color: st.color }} title={s.label}>{s.sym}</span>
                    <input className={field} value={st.attack} onChange={(e) => setSuit({ attack: e.target.value })} aria-label={`${s.label} attack name`} />
                    <select className={field} value={st.kind} onChange={(e) => setSuit({ kind: e.target.value as AttackKind })} aria-label={`${s.label} attack look`}>
                      {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                    <ColorBox value={st.color} onChange={(v) => setSuit({ color: v })} />
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-ink">Every trick is a fight</h3>
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={editing.clash.on} onChange={(e) => updateTheme((t) => ({ ...t, clash: { ...t.clash, on: e.target.checked } }))} />
                Clash animation on every trick
              </label>
              <label className="flex items-center gap-2">
                Intensity
                <select className={cn(field, "w-auto")} value={editing.clash.intensity}
                  onChange={(e) => updateTheme((t) => ({ ...t, clash: { ...t.clash, intensity: Number(e.target.value) as 1 | 2 | 3 } }))}>
                  <option value={1}>Light</option><option value={2}>Medium</option><option value={3}>Heavy</option>
                </select>
              </label>
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-ink">Big moments</h3>
            <div className="divide-y divide-line/60 rounded-xl border border-line">
              {MOMENTS.map((m) => {
                const mo = editing[m.key];
                return (
                  <div key={m.key} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 p-2.5">
                    <input type="checkbox" className="mt-1" checked={mo.on} aria-label={`${m.label} on`}
                      onChange={(e) => updateTheme((t) => ({ ...t, [m.key]: { ...t[m.key], on: e.target.checked } }))} />
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-1">
                        <span className="text-sm font-semibold text-ink">{m.label}</span>
                        <span className="text-[11px] text-ink-faint">{m.when}</span>
                      </div>
                      <div className="flex gap-2">
                        <input className={field} value={mo.text} aria-label={`${m.label} words`}
                          onChange={(e) => updateTheme((t) => ({ ...t, [m.key]: { ...t[m.key], text: e.target.value } }))} />
                        {m.key === "renege" && (
                          <input className={field} value={editing.renege.wrong} aria-label="Wrong call words"
                            onChange={(e) => updateTheme((t) => ({ ...t, renege: { ...t.renege, wrong: e.target.value } }))} />
                        )}
                        {m.key === "nilShield" && (
                          <ColorBox value={editing.nilShield.color} onChange={(v) => updateTheme((t) => ({ ...t, nilShield: { ...t.nilShield, color: v } }))} />
                        )}
                        {m.key === "spadesBroken" && (
                          <label className="flex shrink-0 items-center gap-1 text-xs text-ink-muted">
                            <input type="checkbox" checked={editing.spadesBroken.thunder}
                              onChange={(e) => updateTheme((t) => ({ ...t, spadesBroken: { ...t.spadesBroken, thunder: e.target.checked } }))} />
                            Thunder
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <Preview theme={editing} />
          {history.length > 0 && (
            <section className="rounded-2xl border border-line bg-panel p-4">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Recent game edits</h2>
              <ul className="space-y-1.5 text-xs">
                {history.map((h) => (
                  <li key={h.id} className="flex gap-2">
                    <span className="shrink-0 text-ink-faint">{h.date.slice(5)}</span>
                    <span className="text-ink-muted">{h.title}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

function ColorBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // <input type=color> only speaks #rrggbb.
  const long = /^#[0-9a-f]{3}$/i.test(value) ? `#${value.slice(1).split("").map((c) => c + c).join("")}` : value;
  return (
    <input type="color" value={long} onChange={(e) => onChange(e.target.value)}
      className="h-[34px] w-full min-w-[40px] cursor-pointer rounded-lg border border-line bg-canvas p-0.5" />
  );
}

function DateBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const ok = isMonthDay(text);
  return (
    <input className={cn(field, !ok && "border-red-500/60")} value={text} placeholder="MM-DD" maxLength={5}
      onChange={(e) => { setText(e.target.value); if (isMonthDay(e.target.value)) onChange(e.target.value); }} />
  );
}

// --- live preview -------------------------------------------------------------

const DEMO_TRICK = [
  { seat: 0, card: "QH" },
  { seat: 1, card: "AH" },
  { seat: 2, card: "2S" },
  { seat: 3, card: "7H" },
];
const DEMO_CLASH: Record<SuitKey, { seat: number; card: string }[]> = {
  S: [{ seat: 0, card: "9S" }, { seat: 1, card: "KS" }, { seat: 2, card: "4S" }, { seat: 3, card: "JS" }],
  H: [{ seat: 0, card: "5H" }, { seat: 1, card: "KH" }, { seat: 2, card: "9H" }, { seat: 3, card: "2H" }],
  D: [{ seat: 0, card: "AD" }, { seat: 1, card: "3D" }, { seat: 2, card: "TD" }, { seat: 3, card: "6D" }],
  C: [{ seat: 0, card: "4C" }, { seat: 1, card: "8C" }, { seat: 2, card: "QC" }, { seat: 3, card: "JC" }],
};
const WINNER_OF: Record<SuitKey, number> = { S: 1, H: 1, D: 0, C: 2 };

function Preview({ theme }: { theme: GameTheme }) {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);
  const [nil, setNil] = useState<"" | "is-pulse" | "is-shatter">("");
  const [shake, setShake] = useState("");
  const timers = useRef<number[]>([]);
  const idRef = useRef(1);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  const show = (b: Omit<Banner, "id">) => {
    setBanner({ ...b, id: idRef.current++ });
    if (b.shake) { setShake(b.shake === "big" ? "fx-shake-big" : "fx-shake"); later(760, () => setShake("")); }
    later(b.dur, () => setBanner(null));
  };
  const playClash = (suit: SuitKey | "steal") => {
    const trick = suit === "steal" ? DEMO_TRICK : DEMO_CLASH[suit];
    const winner = suit === "steal" ? 2 : WINNER_OF[suit];
    const steal = suit === "steal" ? { winner: DEMO_TRICK[2], victim: DEMO_TRICK[1], upset: 1 } : null;
    const base = [0, 650, 950, 1250][theme.clash.intensity];
    const dur = steal ? Math.round(base * 1.7 + 300) : base;
    const id = idRef.current++;
    setClash({ id, trick, winner, phase: "clash", dur, steal });
    later(dur + 400, () => setClash((c) => (c?.id === id ? null : c)));
    if (steal) show({ text: theme.trumpSteal.text, sub: "2♠ took down the A♥", color: theme.suits.S.color, dur: 2000, confetti: theme.confetti, shake: "big" });
  };

  const winnerSuit = clash ? (clash.trick.find((t) => t.seat === clash.winner)!.card.slice(-1) as SuitKey) : "S";

  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Live preview</h2>
      <div
        className={cn("relative flex h-[190px] items-center justify-center overflow-hidden rounded-[14px] border border-[#243244]", shake)}
        style={{ background: `radial-gradient(ellipse at center, ${theme.felt[0]} 0%, ${theme.felt[1]} 72%)`, "--hx-accent": theme.accent } as React.CSSProperties}
      >
        <FxStage banner={banner} />
        <div className={cn("fx-nil absolute left-3 top-3 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-white", nil)}
          style={{ "--fx-color": theme.nilShield.color } as React.CSSProperties}>
          {nil !== "is-shatter" && <span className="fx-nil-label">{theme.nilShield.text}</span>}
          Nil bidder
        </div>
        {clash ? (
          <div className="flex items-center gap-1.5">
            {clash.trick.map((play) => {
              const look = clashStyle(clash, play, theme);
              return (
                <div key={play.card} className={look.className} style={look.style}>
                  <PlayingCard card={play.card} size="md" />
                  {look.hit && <span className={look.hit} aria-hidden="true" />}
                  {look.callout && <span className="fx-callout">{look.callout}</span>}
                </div>
              );
            })}
            <div key={clash.id} className="fx-stage" style={{ "--fx-dur": `${clash.dur}ms`, "--fx-color": theme.suits[winnerSuit].color } as React.CSSProperties}>
              <Burst count={6 + theme.clash.intensity * 5} />
            </div>
          </div>
        ) : (
          <span className="text-xs text-white/40">Tap a moment below</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
        {SUITS.map((s) => (
          <PreviewButton key={s.key} onClick={() => playClash(s.key)}>
            <span style={{ color: theme.suits[s.key].color }}>{s.sym}</span> {theme.suits[s.key].attack}
          </PreviewButton>
        ))}
        <PreviewButton onClick={() => playClash("steal")}>Trump steal</PreviewButton>
        <PreviewButton onClick={() => show({ text: theme.spadesBroken.text, color: theme.suits.S.color, dur: 2300, darken: true, thunder: theme.spadesBroken.thunder, confetti: theme.confetti, shake: "big" })}>
          Spades broken
        </PreviewButton>
        <PreviewButton onClick={() => { setNil("is-pulse"); later(950, () => setNil("")); }}>Nil dodge</PreviewButton>
        <PreviewButton onClick={() => { setNil("is-shatter"); show({ text: "SHIELD SHATTERED", sub: "Their nil is broken", color: theme.nilShield.color, dur: 1500, shake: "small" }); later(1300, () => setNil("")); }}>
          Nil shatter
        </PreviewButton>
        <PreviewButton onClick={() => show({ text: theme.set.text, sub: "Team 2 got set", color: "#f87171", stamp: true, dur: 2100, shake: "big" })}>Getting set</PreviewButton>
        <PreviewButton onClick={() => show({ text: theme.renege.text, sub: "You caught Rook. Team 1 wins", color: "#f87171", stamp: true, dur: 2400, shake: "big" })}>Renig caught</PreviewButton>
        <PreviewButton onClick={() => show({ text: theme.renege.wrong, sub: "Rook played fair. Team 2 wins", color: "#f87171", stamp: true, dur: 2400, shake: "big" })}>Wrong call</PreviewButton>
        <PreviewButton onClick={() => show({ text: theme.boston.text, sub: "Team 1 took all 13", color: "#fcd34d", dur: 2400, confetti: theme.confetti.length ? theme.confetti : ["✨"], shake: "big" })}>Boston</PreviewButton>
      </div>
    </section>
  );
}

function PreviewButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="truncate rounded-lg border border-line px-2 py-1.5 text-left text-ink-muted transition hover:bg-panel-2 hover:text-ink">
      {children}
    </button>
  );
}
