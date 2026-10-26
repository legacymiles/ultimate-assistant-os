"use client";

// ---------------------------------------------------------------------------
// EA World › Replay — watch a bot trade a real past session, tick by tick.
//
// The market is shut at weekends; the tape from Friday is not. Pick a symbol,
// a day and a New York window, pick a bot, press play. Real Dukascopy ticks
// (real bid AND ask, so the real spread) are fed through a simulated MT4
// broker with latency, slippage, stop level and commission, and the bot's
// orders are drawn on the chart as they move.
//
// Speeds run from 1x (real time — what the EA would see live) to 300x, plus
// "max" for a straight run. Seeking backwards replays from the start, so
// whatever you scrub to is exactly what a straight run would have reached.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { ChartController } from "./chartController";
import { BotBench } from "./BotBench";
import { FingerprintPanel } from "./FingerprintPanel";
import { applySuggestions, type Suggestion } from "@/lib/ea-replay/statement";
import { HFT_SECRET_V2 } from "@/lib/ea-replay/strategies";
import { DEFAULT_BROKER, type BrokerConfig } from "@/lib/ea-replay/broker";
import { compileCustom, type CustomBot } from "@/lib/ea-replay/custom";
import { parseTickCsv } from "@/lib/ea-replay/csv";
import { demoTicks } from "@/lib/ea-replay/demo";
import { ReplayEngine } from "@/lib/ea-replay/engine";
import { INSTRUMENTS, instrumentById, type Instrument } from "@/lib/ea-replay/instruments";
import { SESSION_PRESETS, formatNy, nyClock, nyToUtc, recentSessionDates } from "@/lib/ea-replay/session";
import { computeStats } from "@/lib/ea-replay/stats";
import { defaultParams, type ParamSpec, type Params, type StrategyDef } from "@/lib/ea-replay/strategy";
import { BUILTIN_STRATEGIES } from "@/lib/ea-replay/strategies";
import { decodeTicks, indexAtOrAfter, type TickPayload, type TickSeries } from "@/lib/ea-replay/types";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import "./replay.css";

const BOTS_KEY = "ea-replay:bots";
const PREFS_KEY = "ea-replay:prefs";
// 45 minutes before the window: enough M1 bars for a 34-period channel (v2's
// wave filter) to be formed by the time the window opens.
const WARMUP_MS = 45 * 60_000;
const SPEEDS = [1, 5, 20, 60, 300, 0] as const; // 0 = max
const TIMEFRAMES = [
  { sec: 5, label: "5s" },
  { sec: 15, label: "15s" },
  { sec: 60, label: "1m" },
  { sec: 300, label: "5m" },
];

interface Prefs {
  symbol: string;
  preset: string;
  customStart: number;
  customEnd: number;
  botId: string;
  tf: number;
  speed: number;
}
const DEFAULT_PREFS: Prefs = { symbol: "US30", preset: "ny-open", customStart: 930, customEnd: 1130, botId: "hft-secret-v2", tf: 15, speed: 20 };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* a convenience, never a requirement */
  }
}

type TapeState =
  | { kind: "idle" }
  | { kind: "loading"; label: string }
  | { kind: "ready"; ticks: TickSeries; missing?: string[] }
  | { kind: "error"; message: string; missing?: string[] };

type Tab = "trades" | "working" | "events" | "stats" | "log";

export function ReplayStudio({ embedded = false }: { embedded?: boolean }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [date, setDate] = useState<string>("");
  const [tape, setTape] = useState<TapeState>({ kind: "idle" });
  const [bots, setBots] = useState<CustomBot[]>([]);
  const [params, setParams] = useState<Params>({});
  const [broker, setBroker] = useState<BrokerConfig>(DEFAULT_BROKER);
  const [playing, setPlaying] = useState(false);
  const [, setUi] = useState(0);
  const [tab, setTab] = useState<Tab>("trades");
  const [benchOpen, setBenchOpen] = useState(false);
  const [fpOpen, setFpOpen] = useState(false);
  const [csvOffset, setCsvOffset] = useState(0);

  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartController | null>(null);
  const engineRef = useRef<ReplayEngine | null>(null);
  const simRef = useRef(0);
  const lastUi = useRef(0);
  const csvInput = useRef<HTMLInputElement>(null);
  // Every tape action takes a number; a fetch that comes back after a newer
  // action (a demo tape, a CSV, another load) is dropped instead of winning.
  const tapeSeq = useRef(0);

  const inst = instrumentById(prefs.symbol) ?? INSTRUMENTS[0];
  const window_ = useMemo(() => {
    const p = SESSION_PRESETS.find((s) => s.id === prefs.preset);
    return p ? { start: p.start, end: p.end } : { start: prefs.customStart, end: prefs.customEnd };
  }, [prefs.preset, prefs.customStart, prefs.customEnd]);

  // ---- bots: built-in plus the ones you brought ---------------------------
  const strategies = useMemo(() => {
    const custom: StrategyDef[] = [];
    for (const b of bots) {
      try {
        custom.push(compileCustom(b));
      } catch {
        /* a broken bot stays in the bench to be fixed, but cannot be picked */
      }
    }
    return [...BUILTIN_STRATEGIES, ...custom];
  }, [bots]);
  const def = strategies.find((s) => s.id === prefs.botId) ?? strategies[0];

  const reloadBots = useCallback(() => setBots(loadLocal<CustomBot[]>(BOTS_KEY, [])), []);
  useRemotePull(BOTS_KEY, reloadBots);
  const saveBots = (next: CustomBot[]) => {
    setBots(next);
    saveSynced(BOTS_KEY, next);
  };

  // ---- prefs -------------------------------------------------------------
  useEffect(() => {
    setPrefs(readJson(PREFS_KEY, DEFAULT_PREFS));
    reloadBots();
    setPrefsLoaded(true);
  }, [reloadBots]);
  useEffect(() => {
    if (prefsLoaded) writeJson(PREFS_KEY, prefs);
  }, [prefs, prefsLoaded]);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  const dates = useMemo(
    () => recentSessionDates(Date.now(), 10, window_.end, !!inst.weekends),
    [window_.end, inst.weekends],
  );
  useEffect(() => {
    if (!date || !dates.includes(date)) {
      if (dates.length && (!date || date > dates[0])) setDate(dates[0]);
    }
  }, [dates, date]);

  // Params follow the bot and the symbol, remembered per pair.
  const paramsKey = `ea-replay:params:${def.id}:${inst.id}`;
  useEffect(() => {
    setParams(readJson<Params>(paramsKey, defaultParams(def, inst.id)));
  }, [paramsKey, def, inst.id]);
  const setParam = (k: string, v: Params[string]) =>
    setParams((p) => {
      const next = { ...p, [k]: v };
      writeJson(paramsKey, next);
      return next;
    });
  // Fingerprint › Apply: measured inputs land on v2 for the symbol the original traded.
  const applyFingerprint = (instrumentId: string | null, s: Suggestion[]) => {
    const symbol = instrumentId ?? inst.id;
    const key = `ea-replay:params:${HFT_SECRET_V2.id}:${symbol}`;
    const merged = applySuggestions(readJson<Params>(key, defaultParams(HFT_SECRET_V2, symbol)), s);
    writeJson(key, merged);
    setPrefs((p) => ({ ...p, symbol, botId: HFT_SECRET_V2.id }));
    if (def.id === HFT_SECRET_V2.id && symbol === inst.id) setParams(merged);
    setFpOpen(false);
  };

  const resetParams = () => {
    const d = defaultParams(def, inst.id);
    setParams(d);
    writeJson(paramsKey, d);
  };

  const sessionStart = date ? nyToUtc(date, window_.start) : 0;
  const sessionEnd = date ? nyToUtc(date, window_.end) : 0;

  // ---- tape --------------------------------------------------------------
  const loadTape = useCallback(async () => {
    if (!date) return;
    setPlaying(false);
    const seq = ++tapeSeq.current;
    const from = nyToUtc(date, window_.start) - WARMUP_MS;
    let to = nyToUtc(date, window_.end);
    if (to <= from) to += 24 * 3_600_000;
    setTape({ kind: "loading", label: `Fetching ${inst.label} ticks for ${date}` });
    try {
      const res = await fetch(`/api/ea-replay/ticks?symbol=${inst.id}&from=${from}&to=${to}`);
      const body = await res.json().catch(() => ({}));
      if (seq !== tapeSeq.current) return;
      if (!res.ok) {
        setTape({ kind: "error", message: body.error ?? `The tick service answered ${res.status}`, missing: body.missing });
        return;
      }
      const ticks = decodeTicks(body as TickPayload);
      setTape({ kind: "ready", ticks, missing: (body as TickPayload).missing });
    } catch (e) {
      if (seq !== tapeSeq.current) return;
      setTape({ kind: "error", message: e instanceof Error ? e.message : "Could not reach the tick service" });
    }
  }, [date, window_.start, window_.end, inst.id, inst.label]);

  // First visit: load the newest NY session straight away.
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (!autoLoaded.current && prefsLoaded && date) {
      autoLoaded.current = true;
      void loadTape();
    }
  }, [prefsLoaded, date, loadTape]);

  const loadDemo = () => {
    tapeSeq.current++;
    const from = (date ? nyToUtc(date, window_.start) : Date.now() - 4 * 3_600_000) - WARMUP_MS;
    const to = date ? nyToUtc(date, window_.end) : Date.now();
    setTape({ kind: "ready", ticks: demoTicks(inst, from, to, from % 997) });
  };

  const onCsv = async (file: File) => {
    tapeSeq.current++;
    try {
      const text = await file.text();
      const { series } = parseTickCsv(text, inst.id, csvOffset);
      setTape({ kind: "ready", ticks: series });
      const first = nyClock(series.time[0]);
      setDate(first.date);
    } catch (e) {
      setTape({ kind: "error", message: e instanceof Error ? e.message : "That file could not be read" });
    }
  };

  // ---- engine ------------------------------------------------------------
  const ticks = tape.kind === "ready" ? tape.ticks : null;

  const buildEngine = useCallback((): ReplayEngine | null => {
    if (!ticks) return null;
    return new ReplayEngine({ ticks, instrument: inst, strategy: def, params, broker });
  }, [ticks, inst, def, params, broker]);

  const startAt = useCallback(
    (eng: ReplayEngine) => {
      // Warm-up ticks are played instantly so the bot has history; the replay begins at the window.
      const t0 = ticks && ticks.source !== "csv" ? sessionStart : ticks ? ticks.time[0] : 0;
      eng.advanceTo(t0 - 1);
      simRef.current = Math.max(t0, eng.time);
    },
    [ticks, sessionStart],
  );

  useEffect(() => {
    if (!hostRef.current) return;
    const c = new ChartController(hostRef.current);
    chartRef.current = c;
    return () => {
      c.destroy();
      chartRef.current = null;
    };
  }, []);

  // Any change to tape, bot, params or broker starts the bot over from the window's start.
  useEffect(() => {
    setPlaying(false);
    const eng = buildEngine();
    engineRef.current = eng;
    const chart = chartRef.current;
    if (!eng || !chart) return;
    chart.reset(inst, prefs.tf);
    startAt(eng);
    chart.sync(eng);
    setUi((x) => x + 1);
  }, [buildEngine, startAt, inst, prefs.tf]);

  const bump = (force = false) => {
    const now = performance.now();
    if (force || now - lastUi.current > 120) {
      lastUi.current = now;
      setUi((x) => x + 1);
    }
  };

  // The play loop: one engine advance and one chart sync per animation frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const eng = engineRef.current;
      const chart = chartRef.current;
      if (!eng || !chart) return;
      const dt = Math.min(now - last, 250);
      last = now;
      if (prefs.speed === 0) {
        eng.advanceTicks(2500);
        simRef.current = eng.time;
      } else {
        simRef.current += dt * prefs.speed;
        eng.advanceTo(simRef.current);
      }
      chart.sync(eng);
      if (eng.done) {
        setPlaying(false);
        bump(true);
        return;
      }
      bump();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, prefs.speed]);

  const seek = useCallback(
    (t: number) => {
      let eng = engineRef.current;
      const chart = chartRef.current;
      if (!eng || !chart || !ticks) return;
      if (t < eng.time) {
        eng = buildEngine();
        if (!eng) return;
        engineRef.current = eng;
      }
      eng.advanceTo(t);
      simRef.current = Math.max(t, eng.time);
      chart.sync(eng);
      bump(true);
    },
    [buildEngine, ticks],
  );

  const restart = () => {
    const eng = buildEngine();
    const chart = chartRef.current;
    if (!eng || !chart) return;
    setPlaying(false);
    engineRef.current = eng;
    chart.reset(inst, prefs.tf);
    startAt(eng);
    chart.sync(eng);
    bump(true);
  };

  const stepTick = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.advanceTicks(1);
    simRef.current = eng.time;
    chartRef.current?.sync(eng);
    bump(true);
  };

  const nextFill = () => {
    const eng = engineRef.current;
    if (!eng) return;
    const count = () => eng.broker.events.filter((e) => e.kind === "filled" || e.kind === "closed").length;
    const before = count();
    let guard = 0;
    while (!eng.done && count() === before && guard++ < 2_000_000) eng.advanceTicks(1);
    simRef.current = eng.time;
    chartRef.current?.sync(eng);
    bump(true);
  };

  const runToEnd = () => {
    const eng = engineRef.current;
    if (!eng) return;
    setPlaying(false);
    eng.runToEnd();
    simRef.current = eng.time;
    chartRef.current?.sync(eng);
    bump(true);
  };

  // Space = play/pause, → = one tick, Shift+→ = next trade event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (benchOpen || fpOpen) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p && !!engineRef.current && !engineRef.current.done);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) nextFill();
        else stepTick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- derived view ------------------------------------------------------
  const eng = engineRef.current;
  const b = eng?.broker;
  const t0 = ticks ? ticks.time[0] : 0;
  const t1 = ticks ? ticks.time[ticks.time.length - 1] : 1;
  const now = eng?.time ?? t0;
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - t0) / Math.max(1, t1 - t0)) * 100))}%`;
  const closed = b ? b.history.filter((o) => o.status === "closed") : [];
  const stats = b && eng ? computeStats(b.history, eng.equity, broker.balance, inst.point) : null;
  const equity = b?.equity() ?? broker.balance;
  const pnl = equity - broker.balance;
  const spreadNow = b ? Math.round((b.ask - b.bid) / inst.point) : 0;

  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubTo = (clientX: number) => {
    const el = scrubRef.current;
    if (!el || !ticks) return;
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    seek(t0 + f * (t1 - t0));
  };

  const fillsForScrub = useMemo(() => {
    if (!b) return [];
    return b.events.filter((e) => e.kind === "closed").slice(-400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b, closed.length]);

  const sourceLabel =
    tape.kind === "ready"
      ? tape.ticks.note ?? tape.ticks.source
      : tape.kind === "loading"
        ? tape.label
        : tape.kind === "error"
          ? "No tape loaded"
          : "No tape loaded";

  return (
    <div className={`rpl${embedded ? " rpl--embedded" : ""}`}>
      {/* ---- what to replay ---- */}
      <header className="rpl-top">
        <div className="rpl-title">
          <h1>Replay</h1>
          {!embedded && <Link href="/apps/trading-studio">Trading Studio</Link>}
        </div>
        <label className="rpl-field">
          <span>Symbol</span>
          <select value={inst.id} onChange={(e) => set("symbol", e.target.value)}>
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="rpl-field">
          <span>Day (New York)</span>
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
              </option>
            ))}
            {date && !dates.includes(date) && <option value={date}>{date}</option>}
          </select>
        </label>
        <label className="rpl-field">
          <span>Older day</span>
          <input type="date" value={date} max={dates[0]} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="rpl-field">
          <span>Window (NY time)</span>
          <select value={prefs.preset} onChange={(e) => set("preset", e.target.value)}>
            {SESSION_PRESETS.map((s) => (
              <option key={s.id} value={s.id} title={s.hint}>
                {s.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </label>
        {prefs.preset === "custom" && (
          <>
            <label className="rpl-field">
              <span>From HHMM</span>
              <input type="number" style={{ width: 70 }} value={prefs.customStart} onChange={(e) => set("customStart", Number(e.target.value))} />
            </label>
            <label className="rpl-field">
              <span>To HHMM</span>
              <input type="number" style={{ width: 70 }} value={prefs.customEnd} onChange={(e) => set("customEnd", Number(e.target.value))} />
            </label>
          </>
        )}
        <button className="rpl-btn rpl-btn--primary" onClick={() => void loadTape()} disabled={!date || tape.kind === "loading"} style={{ alignSelf: "end" }}>
          {tape.kind === "loading" ? "Loading…" : "Load tape"}
        </button>
        <div className="rpl-source" role="status">
          <span className={`rpl-dot ${ticks?.source === "dukascopy" ? "rpl-dot--real" : ticks?.source === "demo" ? "rpl-dot--demo" : ""}`} />
          {ticks?.source === "demo" ? <span className="rpl-demo-flag">{sourceLabel}</span> : <span>{sourceLabel}</span>}
        </div>
      </header>

      {/* ---- chart + rail ---- */}
      <div className="rpl-mid">
        <div className="rpl-stage">
          <div className="rpl-chart">
            <div className="rpl-chart-host" ref={hostRef} />
            {ticks && b && (
              <>
                <div className="rpl-hud">
                  <span>
                    bid <b>{b.bid.toFixed(inst.digits)}</b>
                  </span>
                  <span>
                    ask <b>{b.ask.toFixed(inst.digits)}</b>
                  </span>
                  <span>
                    spread <b>{spreadNow}</b> pts
                  </span>
                  <span>
                    tf
                    {TIMEFRAMES.map((t) => (
                      <button
                        key={t.sec}
                        className="rpl-speed"
                        style={{ pointerEvents: "auto" }}
                        aria-pressed={prefs.tf === t.sec}
                        onClick={() => set("tf", t.sec)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </span>
                  <button className="rpl-speed" style={{ pointerEvents: "auto" }} onClick={() => chartRef.current?.followNow()}>
                    follow
                  </button>
                </div>
                <div className="rpl-legend">
                  <span className="buy">
                    <i />
                    buy stop
                  </span>
                  <span className="sell">
                    <i />
                    sell stop
                  </span>
                  <span className="loss">
                    <i />
                    stop loss
                  </span>
                  <span className="win">
                    <i />
                    trailing stop in profit
                  </span>
                </div>
              </>
            )}
            {!ticks && (
              <div className="rpl-empty">
                {tape.kind === "loading" ? (
                  <>
                    <h2>{tape.label}</h2>
                    <p>Each hour is a separate file from Dukascopy. A three-hour window is usually under ten seconds.</p>
                  </>
                ) : tape.kind === "error" ? (
                  <>
                    <h2>No tape for that window</h2>
                    <p className="rpl-error">{tape.message}</p>
                    {tape.missing?.length ? <p className="faint mono">{tape.missing.join(" · ")}</p> : null}
                    <TapeFallbacks onRetry={() => void loadTape()} onDemo={loadDemo} onCsv={() => csvInput.current?.click()} csvOffset={csvOffset} setCsvOffset={setCsvOffset} />
                  </>
                ) : (
                  <>
                    <h2>Pick a day and load its tape</h2>
                    <p>
                      Real ticks from a past New York session, with the real spread. Then pick a bot and press play — or press space.
                    </p>
                    <TapeFallbacks onRetry={() => void loadTape()} onDemo={loadDemo} onCsv={() => csvInput.current?.click()} csvOffset={csvOffset} setCsvOffset={setCsvOffset} retryLabel="Load tape" />
                  </>
                )}
              </div>
            )}
          </div>

          {/* ---- transport ---- */}
          <div className="rpl-transport">
            <div className="rpl-keys">
              <button className="rpl-key" onClick={restart} disabled={!eng} title="Back to the start of the window" aria-label="Restart">
                <Icon.Rewind />
              </button>
              <button
                className="rpl-key rpl-key--play"
                onClick={() => setPlaying((p) => !p)}
                disabled={!eng || eng.done}
                aria-label={playing ? "Pause" : "Play"}
                title="Play / pause (space)"
              >
                {playing ? <Icon.Pause /> : <Icon.Play />}
              </button>
              <button className="rpl-key" onClick={stepTick} disabled={!eng || eng.done} title="One tick (→)" aria-label="Step one tick">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </button>
              <button className="rpl-key" onClick={nextFill} disabled={!eng || eng.done} title="Jump to the next fill or exit (Shift+→)" aria-label="Next trade">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="m6 6 6 6-6 6M14 6v12" />
                </svg>
              </button>
              <div className="rpl-speeds" role="group" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button key={s} className="rpl-speed" aria-pressed={prefs.speed === s} onClick={() => set("speed", s)}>
                    {s === 0 ? "max" : `${s}x`}
                  </button>
                ))}
              </div>
              <button className="rpl-btn" style={{ marginLeft: 6 }} onClick={runToEnd} disabled={!eng || eng.done}>
                Run to end
              </button>
            </div>

            <div
              className="rpl-scrub"
              ref={scrubRef}
              onPointerDown={(e) => {
                (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                scrubTo(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) scrubTo(e.clientX);
              }}
              role="slider"
              aria-label="Replay position"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(((now - t0) / Math.max(1, t1 - t0)) * 100)}
              tabIndex={0}
            >
              <div className="rpl-scrub-track" />
              {ticks && <div className="rpl-scrub-session" style={{ left: pct(sessionStart), width: `calc(${pct(sessionEnd)} - ${pct(sessionStart)})` }} />}
              <div className="rpl-scrub-done" style={{ width: pct(now) }} />
              {fillsForScrub.map((e, i) => (
                <span key={i} className="rpl-scrub-mark" style={{ left: pct(e.time), background: (e.profit ?? 0) >= 0 ? "var(--rpl-win)" : "var(--rpl-loss)" }} />
              ))}
              <div className="rpl-scrub-head" style={{ left: pct(now) }} />
            </div>

            <div className="rpl-clock">
              <b>{ticks ? formatNy(now) : "--:--:--"}</b>
              <span>
                New York · {date || "no day"} · {ticks ? `${(eng?.cursor ?? 0).toLocaleString()} / ${ticks.time.length.toLocaleString()} ticks` : ""}
              </span>
            </div>
          </div>
        </div>

        {/* ---- rail ---- */}
        <aside className="rpl-rail">
          <section className="rpl-sec" aria-label="Account">
            <h3>Account</h3>
            <div className={`rpl-big ${pnl > 0.004 ? "win" : pnl < -0.004 ? "loss" : ""}`}>
              {pnl >= 0 ? "+" : ""}
              {pnl.toFixed(2)}
            </div>
            <Spark points={eng?.equity ?? []} base={broker.balance} />
            <dl className="rpl-kv" style={{ marginTop: 8 }}>
              <dt>Equity</dt>
              <dd>{equity.toFixed(2)}</dd>
              <dt>Balance</dt>
              <dd>{(b?.balance ?? broker.balance).toFixed(2)}</dd>
              <dt>Closed trades</dt>
              <dd>{closed.length}</dd>
              <dt>Win rate</dt>
              <dd>{stats && stats.trades ? `${stats.winRate.toFixed(0)}%` : "–"}</dd>
              <dt>Max drawdown</dt>
              <dd>{stats ? `${stats.maxDrawdown.toFixed(2)} (${stats.maxDrawdownPct.toFixed(1)}%)` : "–"}</dd>
            </dl>
          </section>

          <section className="rpl-sec" aria-label="Bot">
            <h3>
              Bot
              <span className="rpl-spacer" />
              <button className="rpl-speed" onClick={() => setFpOpen(true)} title="Measure the original EA from its MT4 statement or tester report">
                Fingerprint
              </button>
              <button className="rpl-speed" onClick={() => setBenchOpen(true)}>
                Bring a bot
              </button>
            </h3>
            <select value={def.id} onChange={(e) => set("botId", e.target.value)} style={{ width: "100%" }}>
              <optgroup label="Built in">
                {strategies.filter((s) => s.origin === "builtin").map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
              {strategies.some((s) => s.origin === "custom") && (
                <optgroup label="Yours">
                  {strategies.filter((s) => s.origin === "custom").map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <p className="rpl-bot-sum" style={{ marginTop: 8 }}>
              {def.summary}
            </p>
            <div className="rpl-row" style={{ marginBottom: 8 }}>
              {def.mq4 && (
                <a className="rpl-btn" href={def.mq4} download>
                  Download .mq4
                </a>
              )}
              <button className="rpl-btn" onClick={resetParams}>
                Reset inputs
              </button>
              {def.suggestedSession && def.suggestedSession !== prefs.preset && (
                <button className="rpl-btn" onClick={() => set("preset", def.suggestedSession!)}>
                  Use its window
                </button>
              )}
            </div>
            {eng?.crashed && <div className="rpl-crash">Bot stopped: {eng.crashed}</div>}
            <ParamForm specs={def.params} values={params} onChange={setParam} />
            <p className="rpl-note">Changing an input restarts the replay from the start of the window.</p>
          </section>

          <section className="rpl-sec" aria-label="Broker">
            <h3>Broker</h3>
            <div className="rpl-params">
              <BrokerField label="Balance (USD)" value={broker.balance} onChange={(v) => setBroker((x) => ({ ...x, balance: v }))} />
              <BrokerField label="Leverage 1:" value={broker.leverage} onChange={(v) => setBroker((x) => ({ ...x, leverage: v }))} />
              <BrokerField label="Commission / lot (round turn)" value={broker.commissionPerLot} step={0.5} onChange={(v) => setBroker((x) => ({ ...x, commissionPerLot: v }))} />
              <BrokerField label="Latency (ms)" value={broker.latencyMs} onChange={(v) => setBroker((x) => ({ ...x, latencyMs: v }))} />
              <BrokerField label="Stop slippage (pts)" value={broker.slippagePts} onChange={(v) => setBroker((x) => ({ ...x, slippagePts: v }))} />
              <BrokerField label="Stop level (pts)" value={broker.stopLevelPts} onChange={(v) => setBroker((x) => ({ ...x, stopLevelPts: v }))} />
            </div>
            <p className="rpl-note">
              An HFT bot is mostly a bet on these six numbers. Set latency to your VPS ping to the broker and commission to what your account charges.
            </p>
          </section>

          <section className="rpl-sec" aria-label="Tape">
            <h3>Your own ticks</h3>
            <p className="rpl-note" style={{ marginTop: 0 }}>
              Load a tick CSV — a Dukascopy export, an MT5 tick export (Ctrl+U › Ticks › Export) or plain time,bid,ask.
            </p>
            <div className="rpl-param" style={{ marginTop: 6 }}>
              <label htmlFor="rpl-csv-off">MT5 server offset (h)</label>
              <input id="rpl-csv-off" type="number" value={csvOffset} onChange={(e) => setCsvOffset(Number(e.target.value))} />
            </div>
            <button className="rpl-btn" style={{ marginTop: 6 }} onClick={() => csvInput.current?.click()}>
              Load CSV…
            </button>
            <button className="rpl-btn" style={{ marginTop: 6, marginLeft: 6 }} onClick={loadDemo}>
              Demo tape
            </button>
          </section>
        </aside>
      </div>

      {/* ---- ledgers ---- */}
      <section className="rpl-bottom" aria-label="Ledgers">
        <div className="rpl-tabs" role="tablist">
          {(
            [
              ["trades", "Trades", closed.length],
              ["working", "Working", b?.live.size ?? 0],
              ["events", "Events", b?.events.length ?? 0],
              ["stats", "Stats", null],
              ["log", "Bot log", eng?.logs.length ?? 0],
            ] as [Tab, string, number | null][]
          ).map(([id, label, n]) => (
            <button key={id} role="tab" className="rpl-tab" aria-selected={tab === id} onClick={() => setTab(id)}>
              {label}
              {n != null && <span className="n">{n}</span>}
            </button>
          ))}
        </div>
        <div className="rpl-ledger">
          {tab === "trades" && <TradesTable eng={eng} inst={inst} onJump={seek} />}
          {tab === "working" && <WorkingTable eng={eng} inst={inst} />}
          {tab === "events" && <EventsTable eng={eng} inst={inst} />}
          {tab === "stats" && <StatsGrid stats={stats} spreadAvg={avgSpread(ticks, inst, sessionStart, sessionEnd)} />}
          {tab === "log" && <LogList eng={eng} />}
        </div>
      </section>

      <input
        ref={csvInput}
        type="file"
        accept=".csv,.txt,.tsv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onCsv(f);
          e.target.value = "";
        }}
      />

      {fpOpen && <FingerprintPanel onApply={applyFingerprint} onClose={() => setFpOpen(false)} />}

      {benchOpen && (
        <BotBench
          bots={bots}
          onSave={(next) => saveBots(next)}
          onUse={(id) => {
            set("botId", id);
            setBenchOpen(false);
          }}
          onClose={() => setBenchOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TapeFallbacks(props: {
  onRetry: () => void;
  onDemo: () => void;
  onCsv: () => void;
  csvOffset: number;
  setCsvOffset: (n: number) => void;
  retryLabel?: string;
}) {
  return (
    <div className="rpl-row">
      <button className="rpl-btn rpl-btn--primary" onClick={props.onRetry}>
        {props.retryLabel ?? "Try again"}
      </button>
      <button className="rpl-btn" onClick={props.onCsv}>
        Load a tick CSV
      </button>
      <button className="rpl-btn" onClick={props.onDemo}>
        Use a demo tape
      </button>
    </div>
  );
}

function ParamForm({ specs, values, onChange }: { specs: ParamSpec[]; values: Params; onChange: (k: string, v: Params[string]) => void }) {
  const groups = new Map<string, ParamSpec[]>();
  for (const s of specs) {
    const g = s.group ?? "Inputs";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }
  if (!specs.length) return <p className="rpl-note">This bot has no inputs.</p>;
  return (
    <div className="rpl-params">
      {[...groups].map(([g, list]) => (
        <fieldset key={g}>
          <legend>{g}</legend>
          {list.map((s) => {
            const id = `rpl-p-${s.key}`;
            const v = values[s.key] ?? s.default;
            return (
              <div className="rpl-param" key={s.key} title={s.hint}>
                <label htmlFor={id}>{s.label}</label>
                {s.type === "bool" ? (
                  <input id={id} type="checkbox" checked={v === true || v === "true"} onChange={(e) => onChange(s.key, e.target.checked)} />
                ) : s.type === "select" ? (
                  <select id={id} value={String(v)} onChange={(e) => onChange(s.key, e.target.value)}>
                    {(s.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <CommitNumber id={id} value={Number(v)} step={s.step ?? (s.type === "int" ? 1 : 0.01)} min={s.min} max={s.max} onCommit={(n) => onChange(s.key, s.type === "int" ? Math.round(n) : n)} />
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

/** A number box that only reports when you finish typing, so a restart is not triggered per keystroke. */
function CommitNumber({ id, value, step, min, max, onCommit }: { id: string; value: number; step?: number; min?: number; max?: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n !== value) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      id={id}
      type="number"
      value={text}
      step={step}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}

function BrokerField({ label, value, step, onChange }: { label: string; value: number; step?: number; onChange: (n: number) => void }) {
  const id = `rpl-b-${label.replace(/\W+/g, "")}`;
  return (
    <div className="rpl-param">
      <label htmlFor={id}>{label}</label>
      <CommitNumber id={id} value={value} step={step ?? 1} onCommit={onChange} />
    </div>
  );
}

function Spark({ points, base }: { points: { time: number; equity: number }[]; base: number }) {
  if (points.length < 2) return <svg className="rpl-spark" aria-hidden />;
  const step = Math.max(1, Math.floor(points.length / 300));
  const pts = points.filter((_, i) => i % step === 0 || i === points.length - 1);
  let lo = base;
  let hi = base;
  for (const p of pts) {
    lo = Math.min(lo, p.equity);
    hi = Math.max(hi, p.equity);
  }
  const span = hi - lo || 1;
  const x0 = pts[0].time;
  const xs = pts[pts.length - 1].time - x0 || 1;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(((p.time - x0) / xs) * 300).toFixed(1)},${(44 - ((p.equity - lo) / span) * 40 - 2).toFixed(1)}`).join("");
  const baseY = 44 - ((base - lo) / span) * 40 - 2;
  const last = pts[pts.length - 1].equity;
  return (
    <svg className="rpl-spark" viewBox="0 0 300 44" preserveAspectRatio="none" aria-label="Equity during the replay">
      <line x1="0" x2="300" y1={baseY} y2={baseY} stroke="#262a38" strokeDasharray="3 3" />
      <path d={d} fill="none" stroke={last >= base ? "#22c55e" : "#f87171"} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const reasonText: Record<string, string> = { sl: "stop", trail: "trailing stop", tp: "target", close: "closed by bot", stopout: "stop-out", end: "end of tape" };

function TradesTable({ eng, inst, onJump }: { eng: ReplayEngine | null; inst: Instrument; onJump: (t: number) => void }) {
  const rows = eng ? eng.broker.history.filter((o) => o.status === "closed") : [];
  if (!rows.length) return <div className="rpl-blank">No closed trades yet. Press play, or Shift+→ to jump to the first one.</div>;
  return (
    <table className="rpl-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Side</th>
          <th className="num">Lots</th>
          <th>Opened (NY)</th>
          <th className="num">Entry</th>
          <th className="num">Exit</th>
          <th>Exit by</th>
          <th className="num">Held</th>
          <th className="num">Pts</th>
          <th className="num">Best / worst</th>
          <th className="num">P/L</th>
        </tr>
      </thead>
      <tbody>
        {[...rows].reverse().map((o) => {
          const pts = ((o.closePrice! - o.openPrice) / inst.point) * (o.type === "buy" ? 1 : -1);
          return (
            <tr key={o.ticket} data-click onClick={() => o.openTime && onJump(o.openTime - 15_000)} title="Replay from just before this entry">
              <td className="mono faint">{o.ticket}</td>
              <td className={o.type === "buy" ? "buy" : "sell"}>{o.type}</td>
              <td className="num mono">{o.lots.toFixed(2)}</td>
              <td className="mono">{o.openTime ? formatNy(o.openTime) : ""}</td>
              <td className="num mono">{o.openPrice.toFixed(inst.digits)}</td>
              <td className="num mono">{o.closePrice!.toFixed(inst.digits)}</td>
              <td className="muted">{reasonText[o.closeReason === "sl" && pts > 0 ? "trail" : (o.closeReason ?? "close")]}</td>
              <td className="num mono">{o.openTime && o.closeTime ? `${((o.closeTime - o.openTime) / 1000).toFixed(1)}s` : ""}</td>
              <td className={`num mono ${pts >= 0 ? "win" : "loss"}`}>{pts.toFixed(0)}</td>
              <td className="num mono faint">
                {o.mfePts.toFixed(0)} / {o.maePts.toFixed(0)}
              </td>
              <td className={`num mono ${(o.profit ?? 0) >= 0 ? "win" : "loss"}`}>{(o.profit ?? 0).toFixed(2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function WorkingTable({ eng, inst }: { eng: ReplayEngine | null; inst: Instrument }) {
  const rows = eng ? [...eng.broker.live.values()] : [];
  if (!rows.length) return <div className="rpl-blank">Nothing working. The bot has no pending orders or open positions right now.</div>;
  const b = eng!.broker;
  return (
    <table className="rpl-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Type</th>
          <th className="num">Lots</th>
          <th className="num">Price</th>
          <th className="num">SL</th>
          <th className="num">TP</th>
          <th className="num">Distance</th>
          <th className="num">Floating</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((o) => {
          const buy = o.type.startsWith("buy");
          const mark = buy ? b.ask : b.bid;
          const dist = Math.round(Math.abs(o.openPrice - mark) / inst.point);
          const fl = o.status === "open" ? ((buy ? b.bid - o.openPrice : o.openPrice - b.ask) / inst.point) : null;
          return (
            <tr key={o.ticket}>
              <td className="mono faint">{o.ticket}</td>
              <td className={buy ? "buy" : "sell"}>{o.type}</td>
              <td className="num mono">{o.lots.toFixed(2)}</td>
              <td className="num mono">{o.openPrice.toFixed(inst.digits)}</td>
              <td className="num mono">{o.sl ? o.sl.toFixed(inst.digits) : "–"}</td>
              <td className="num mono">{o.tp ? o.tp.toFixed(inst.digits) : "–"}</td>
              <td className="num mono">{o.status === "pending" ? `${dist} pts away` : "open"}</td>
              <td className={`num mono ${fl == null ? "" : fl >= 0 ? "win" : "loss"}`}>{fl == null ? "" : `${fl.toFixed(0)} pts`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function EventsTable({ eng, inst }: { eng: ReplayEngine | null; inst: Instrument }) {
  const rows = eng ? eng.broker.events.slice(-300).reverse() : [];
  if (!rows.length) return <div className="rpl-blank">No broker events yet.</div>;
  return (
    <table className="rpl-table">
      <thead>
        <tr>
          <th>Time (NY)</th>
          <th>Event</th>
          <th>#</th>
          <th>Type</th>
          <th className="num">Price</th>
          <th className="num">SL</th>
          <th>Detail</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e, i) => (
          <tr key={i}>
            <td className="mono">{formatNy(e.time)}</td>
            <td className={e.kind === "rejected" || e.kind === "stopout" ? "loss" : e.kind === "filled" ? "" : "muted"}>{e.kind}</td>
            <td className="mono faint">{e.ticket || ""}</td>
            <td className={e.type?.startsWith("buy") ? "buy" : e.type ? "sell" : ""}>{e.type ?? ""}</td>
            <td className="num mono">{e.price != null ? e.price.toFixed(inst.digits) : ""}</td>
            <td className="num mono">{e.sl ? e.sl.toFixed(inst.digits) : ""}</td>
            <td className={e.profit != null ? ((e.profit ?? 0) >= 0 ? "win mono" : "loss mono") : "muted"}>
              {e.profit != null ? e.profit.toFixed(2) : e.message ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function avgSpread(ticks: TickSeries | null, inst: Instrument, from: number, to: number): number {
  if (!ticks) return 0;
  const a = indexAtOrAfter(ticks, from);
  const z = Math.min(indexAtOrAfter(ticks, to), ticks.time.length);
  if (z <= a) return 0;
  let s = 0;
  for (let i = a; i < z; i++) s += ticks.ask[i] - ticks.bid[i];
  return s / (z - a) / inst.point;
}

function StatsGrid({ stats, spreadAvg }: { stats: ReturnType<typeof computeStats> | null; spreadAvg: number }) {
  if (!stats || !stats.trades) return <div className="rpl-blank">Stats appear once the bot has closed a trade. Run to end for the whole window.</div>;
  const pf = Number.isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : "∞";
  const thin = stats.avgWinPts > 0 && stats.avgWinPts < spreadAvg * 2;
  const items: [string, string, string?, string?][] = [
    ["Net", stats.net.toFixed(2), stats.net >= 0 ? "win" : "loss"],
    ["Trades", String(stats.trades), "", `${stats.wins} won · ${stats.losses} lost`],
    ["Win rate", `${stats.winRate.toFixed(1)}%`],
    ["Profit factor", pf],
    ["Expectancy / trade", stats.expectancy.toFixed(2), stats.expectancy >= 0 ? "win" : "loss"],
    ["Average win", `${stats.avgWin.toFixed(2)}`, "", `${stats.avgWinPts.toFixed(1)} pts`],
    ["Average loss", `${stats.avgLoss.toFixed(2)}`, "", `${stats.avgLossPts.toFixed(1)} pts`],
    ["Average spread", `${spreadAvg.toFixed(1)} pts`, thin ? "loss" : "", thin ? "Average win is under 2× the spread — this edge is thin" : "in the window"],
    ["Commission", stats.commission.toFixed(2), stats.commissionShare > 0.4 ? "loss" : "", `${(stats.commissionShare * 100).toFixed(0)}% of gross profit`],
    ["Max drawdown", stats.maxDrawdown.toFixed(2), "", `${stats.maxDrawdownPct.toFixed(2)}% from peak`],
    ["Longest losing run", String(stats.longestLosingStreak)],
    ["Average hold", `${stats.avgHoldSec.toFixed(1)}s`],
    ["Exits", Object.entries(stats.byReason).map(([k, v]) => `${reasonText[k] ?? k} ${v}`).join(", ")],
  ];
  return (
    <dl className="rpl-stats">
      {items.map(([k, v, cls, sub]) => (
        <div className="rpl-stat" key={k}>
          <dt>{k}</dt>
          <dd className={cls}>{v}</dd>
          {sub && <small>{sub}</small>}
        </div>
      ))}
    </dl>
  );
}

function LogList({ eng }: { eng: ReplayEngine | null }) {
  const rows = eng ? eng.logs.slice(-300).reverse() : [];
  if (!rows.length) return <div className="rpl-blank">The bot has not logged anything. Bots write here with c.log(…).</div>;
  return (
    <table className="rpl-table">
      <tbody>
        {rows.map((l, i) => (
          <tr key={i}>
            <td className="mono" style={{ width: 110 }}>
              {formatNy(l.time)}
            </td>
            <td>{l.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
