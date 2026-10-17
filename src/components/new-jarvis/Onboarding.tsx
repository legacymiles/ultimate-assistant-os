"use client";

// ---------------------------------------------------------------------------
// First-run onboarding.
//
// Opens by itself the first time New Jarvis loads for someone who has never
// finished or skipped it. After that it is always one click away: the Setup
// button in the top bar, typing "setup" in the chat, the #setup link, and the
// "Finish setup" checklist in Profile. It reopens on the step it was closed on.
//
// Every step can be skipped, the whole thing can be skipped on the first
// screen, and every answer is a tap where a tap will do.
//
// Each step writes where that fact already lives:
//   about    → the Profile's name, and Jarvis memory (source "profile")
//   keys     → .env.local on the PC via the local agent, or the chat agent
//              goes and gets the key in the browser
//   accounts → real connections through the existing Composio connectors
//   iPhone   → the Photos tab's iPhone setup (the Shortcut + token)
//   habits   → Camera Autopilot rules, so photos sort the owner's way at once
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import "./deck.css";
import { GOALS, ROLES, callSuggestions, getOnboarding, saveOnboarding, splitList } from "@/lib/new-jarvis/onboarding";
import { KEY_SOURCES, agentTaskForKeys, checkKey, keyRows, upsertEnvLine, type KeyRow } from "@/lib/new-jarvis/keySetup";
import { PRESET_RULES, addRule } from "@/lib/recall/photos/autopilot";
import { addMemory } from "@/lib/jarvis/memoryClient";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { STORE_KEY, emptyStore, newProfile } from "@/lib/new-dashboard/model";
import type { DashboardStore } from "@/lib/new-dashboard/types";
import type { JarvisStore } from "@/lib/jarvis/types";
import type { SetupItem } from "@/lib/new-jarvis/onboarding";
import type { SetupStatus } from "@/lib/new-jarvis/useSetup";

export type OnboardingStep = "welcome" | "about" | "keys" | "accounts" | "habits" | "ready";
const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "about", label: "You" },
  { id: "keys", label: "Keys" },
  { id: "accounts", label: "Connect" },
  { id: "habits", label: "Camera" },
  { id: "ready", label: "Ready" },
];

/** Which step a checklist item is finished on. */
const STEP_FOR: Partial<Record<SetupItem["id"], OnboardingStep>> = {
  about: "about",
  keys: "keys",
  accounts: "accounts",
  iphone: "accounts",
  habits: "habits",
};

function isStep(s: string): s is OnboardingStep {
  return STEPS.some((x) => x.id === s);
}

/**
 * Where reopening should land: the step they closed it on, else the first
 * thing still open, else the start.
 */
export function resumeStep(lastStep: string, items: SetupItem[]): OnboardingStep {
  if (isStep(lastStep) && lastStep !== "ready" && lastStep !== "welcome") return lastStep;
  const open = items.find((i) => !i.done && STEP_FOR[i.id]);
  return open ? STEP_FOR[open.id]! : "welcome";
}

/** The slice of the local agent this flow uses. */
export interface OnboardingBridge {
  /** Paired, up, and able to read and write files. */
  files: boolean;
  /** Paired, up, and able to drive the browser. */
  browser: boolean;
  run: (route: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

interface Props {
  start?: OnboardingStep;
  onClose: () => void;
  go: (tab: string) => void;
  store: JarvisStore | null;
  commit: (next: JarvisStore) => void;
  onProfileChanged: () => void;
  setup: SetupStatus;
  bridge: OnboardingBridge;
  /** Hand a job to the super-agent chat. Setup closes and remembers its step. */
  ask: (task: string) => void;
}

export function Onboarding({ start = "welcome", onClose, go, store, commit, onProfileChanged, setup, bridge, ask }: Props) {
  const [step, setStep] = useState<OnboardingStep>(start);
  const [about, setAbout] = useState(() => {
    const a = getOnboarding().about;
    if (a.name) return a;
    // Pre-fill from the Profile, so someone who already has one is not asked twice.
    const ds = loadLocal<DashboardStore>(STORE_KEY, emptyStore());
    const p = ds.profiles.find((x) => x.id === ds.activeId) ?? ds.profiles[0];
    return p?.name ? { ...a, name: p.name } : a;
  });
  const [habits, setHabits] = useState<string[]>(() => {
    const chosen = getOnboarding().photoHabits;
    return chosen.length ? chosen : ["songs", "repos"];
  });
  const stepRef = useRef(step);
  stepRef.current = step;

  // Every move is remembered, so closing the tab mid-step still resumes there.
  useEffect(() => {
    saveOnboarding({ lastStep: step });
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") later();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const idx = STEPS.findIndex((s) => s.id === step);
  const seen = getOnboarding().seen;
  const doneSteps = useMemo(() => {
    const d = new Set<OnboardingStep>();
    for (const i of setup.items) if (i.done && STEP_FOR[i.id]) d.add(STEP_FOR[i.id]!);
    return d;
  }, [setup.items]);

  const next = () => {
    saveOnboarding({ seen: [...new Set([...getOnboarding().seen, step])] });
    setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)].id);
  };
  const later = () => {
    const status = getOnboarding().status;
    saveOnboarding({ status: status === "new" ? "later" : status, lastStep: stepRef.current });
    onClose();
  };
  const skipEntirely = () => {
    saveOnboarding({ status: "skipped" });
    onClose();
  };
  const handOff = (task: string) => {
    later();
    ask(task);
  };

  const saveAbout = () => {
    const clean = { ...about, name: about.name.trim(), call: about.call.trim(), role: about.role.trim(), businesses: about.businesses.trim() };
    saveOnboarding({ about: clean });
    // The Profile's name is what the header and greeting read.
    if (clean.name) {
      const ds = loadLocal<DashboardStore>(STORE_KEY, emptyStore());
      const active = ds.profiles.find((p) => p.id === ds.activeId) ?? ds.profiles[0];
      if (active) {
        active.name = clean.name;
        active.updatedAt = new Date().toISOString();
        ds.activeId = active.id;
      } else {
        const p = newProfile(clean.name);
        ds.profiles.push(p);
        ds.activeId = p.id;
      }
      saveSynced(STORE_KEY, ds);
      onProfileChanged();
    }
    // What Jarvis should know, as memories it can search and act on.
    if (store) {
      let s = store;
      const facts: [string, string][] = [
        ["What to call me", clean.call ? `Call me ${clean.call}.` : ""],
        ["What I do", clean.role],
        ["My businesses and projects", clean.businesses],
        ["What I want Jarvis to help with", about.goals.join(", ")],
      ];
      for (const [title, content] of facts) {
        if (content) s = addMemory(s, { source: "profile", title, content, tags: ["onboarding"] });
      }
      if (s !== store) commit(s);
    }
    next();
  };

  const saveHabits = () => {
    for (const id of habits) {
      const r = PRESET_RULES.find((x) => x.id === id);
      if (r) addRule(r.text, "preset");
    }
    saveOnboarding({ photoHabits: habits });
    next();
  };

  const finish = () => {
    saveOnboarding({ status: "done", lastStep: "" });
    onClose();
  };

  const field = "min-h-[40px] w-full rounded-lg border border-line bg-panel-2 px-3 text-[13px] text-ink placeholder:text-ink-faint";
  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      fn();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Set up Jarvis">
      <div className="deck deck-panel deck-panel--live flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden" style={{ minHeight: 0 }}>
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <div className="deck-core" style={{ width: 30, height: 30 }} aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <div className="min-w-0 flex-1">
            <p className="deck-kicker">Jarvis setup · {setup.items.length - setup.left}/{setup.items.length} done</p>
            {/* Every step is a tab: jump straight to the one you came back for. */}
            <ol className="mt-1 flex flex-wrap gap-1">
              {STEPS.map((s, i) => {
                const done = doneSteps.has(s.id) || (seen.includes(s.id) && s.id !== "ready");
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setStep(s.id)}
                      aria-current={s.id === step ? "step" : undefined}
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        s.id === step ? "bg-elevated text-ink" : done ? "text-[var(--hud)]" : "text-ink-faint hover:text-ink"
                      }`}
                    >
                      {done && s.id !== step ? <Icon.Check width={9} height={9} aria-hidden /> : String(i + 1).padStart(2, "0")} {s.label}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <button
            type="button"
            onClick={later}
            title="Close — reopen any time from Setup in the top bar, or type “setup” in the chat"
            aria-label="Close setup"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted hover:bg-panel-2 hover:text-ink"
          >
            <Icon.Close width={14} height={14} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {step === "welcome" && (
            <div className="space-y-4">
              <h2 className="text-[26px] font-semibold leading-tight text-ink">Let&apos;s set up your Jarvis.</h2>
              <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
                About two minutes, mostly taps. Jump to any step from the bar above, skip any of it, or close this and come back —
                the <b className="text-ink">Setup</b> button in the top bar (or typing <span className="font-mono text-ink">setup</span> in the chat)
                brings you back to the step you were on.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ["I ask first", "I suggest, you approve. Nothing is filed, sent or deleted on my own."],
                  ["I can do it for you", "Keys and sign-ups: I open the site in the browser and fill it in, you just approve."],
                  ["You're in control", "Disconnect anything or switch off any rule, any time."],
                ].map(([t, d]) => (
                  <div key={t} className="deck-stat">
                    <p className="text-[13px] font-semibold text-ink">{t}</p>
                    <p className="mt-1 text-[11.5px] leading-snug text-ink-muted">{d}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" className="deck-btn deck-btn--go" onClick={next}>
                  Start setup
                </button>
                <button type="button" className="deck-btn" onClick={later}>
                  Later
                </button>
                <button type="button" className="deck-btn" onClick={skipEntirely}>
                  Skip setup entirely
                </button>
              </div>
              <p className="text-[11px] text-ink-faint">Skipping never pops this up again. It stays under Setup in the top bar if you change your mind.</p>
            </div>
          )}

          {step === "about" && (
            <div className="space-y-4">
              <h2 className="text-[20px] font-semibold text-ink">The basics</h2>
              <p className="-mt-2 text-[12px] text-ink-muted">Tap an answer or type your own. Only your name matters — the rest is optional.</p>

              <Field id="ob-name" label="Your name">
                <input
                  id="ob-name"
                  autoFocus
                  className={field}
                  value={about.name}
                  autoComplete="name"
                  placeholder="First and last"
                  onKeyDown={onEnter(saveAbout)}
                  onChange={(e) => setAbout({ ...about, name: e.target.value })}
                />
              </Field>

              <Field id="ob-call" label="What should I call you?">
                <Chips
                  options={callSuggestions(about.name)}
                  value={about.call}
                  onPick={(v) => setAbout({ ...about, call: about.call === v ? "" : v })}
                />
                <input
                  id="ob-call"
                  className={field}
                  value={about.call}
                  placeholder="…or type it"
                  onKeyDown={onEnter(saveAbout)}
                  onChange={(e) => setAbout({ ...about, call: e.target.value })}
                />
              </Field>

              <Field id="ob-role" label="What do you do?">
                <Chips options={ROLES} value={about.role} onPick={(v) => setAbout({ ...about, role: about.role === v ? "" : v })} />
                <input
                  id="ob-role"
                  className={field}
                  value={about.role}
                  placeholder="…or type it"
                  onKeyDown={onEnter(saveAbout)}
                  onChange={(e) => setAbout({ ...about, role: e.target.value })}
                />
              </Field>

              <Field id="ob-biz" label="Your businesses or projects">
                <TagInput id="ob-biz" className={field} value={splitList(about.businesses)} onChange={(list) => setAbout({ ...about, businesses: list.join(", ") })} />
              </Field>

              <div>
                <p className="mb-1.5 text-[11.5px] text-ink-muted">What do you want help with most? Tap all that fit.</p>
                <div className="flex flex-wrap gap-1.5">
                  {GOALS.map((g) => {
                    const on = about.goals.includes(g);
                    return (
                      <button
                        key={g}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setAbout({ ...about, goals: on ? about.goals.filter((x) => x !== g) : [...about.goals, g] })}
                        className={`deck-btn rounded-full ${on ? "deck-btn--go" : ""}`}
                      >
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === "keys" && <KeysStep keys={setup.keys} bridge={bridge} onRefresh={setup.refresh} onHandOff={handOff} />}

          {step === "accounts" && (
            <div className="space-y-4">
              <h2 className="text-[20px] font-semibold text-ink">Connect your world</h2>
              <p className="text-[12.5px] text-ink-muted">
                Each one opens that service&apos;s own sign-in. I only read what I need, and I ask before acting.
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                <ConnectRow
                  name="iPhone camera roll"
                  detail="New photos arrive in Camera Autopilot by themselves — a 5-minute guide, no app to download"
                  done={setup.iphoneLinked}
                  action={
                    <button type="button" className="deck-btn deck-btn--go" onClick={() => { later(); go("iphone"); }}>
                      Set up
                    </button>
                  }
                />
                <ConnectRow
                  name="Phone & calls"
                  detail="Calls, texts and contacts through Jarvis Calls"
                  done={false}
                  action={
                    <button type="button" className="deck-btn" onClick={() => { later(); go("calls"); }}>
                      Open
                    </button>
                  }
                />
                {(setup.connectors?.apps ?? []).map((a) => (
                  <ConnectRow
                    key={a.slug}
                    name={a.name}
                    detail={a.connected ? "Connected" : "Email, calendar, files or business data"}
                    done={a.connected}
                    action={
                      !a.connected && setup.connectors?.connectUrl ? (
                        <a href={setup.connectors.connectUrl} target="_blank" rel="noreferrer" className="deck-btn deck-btn--go">
                          Connect
                        </a>
                      ) : null
                    }
                  />
                ))}
              </ul>
              {setup.connectors && !setup.connectors.available && (
                <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-[11.5px] text-ink-muted">
                  Account connections aren&apos;t switched on for this site yet: {setup.connectors.reason || "the connector key is missing"}.{" "}
                  <button type="button" className="text-[var(--hud)] underline" onClick={() => setStep("keys")}>
                    Add the Composio key
                  </button>
                </p>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className="text-[11.5px] text-ink-muted hover:text-ink" onClick={setup.refresh}>
                  <Icon.Refresh width={11} height={11} className="mr-1 inline" aria-hidden />
                  I connected one — check again
                </button>
                <button
                  type="button"
                  className="text-[11.5px] text-[var(--hud)] hover:underline"
                  onClick={() =>
                    handOff(
                      "Help me connect my accounts to Jarvis (email, calendar, Google Drive, and my business tools). Ask me which ones I use, then open each sign-in page in the browser and walk me through it. Stop and let me type any password myself.",
                    )
                  }
                >
                  <Icon.Bot width={11} height={11} className="mr-1 inline" aria-hidden />
                  Let Jarvis walk me through it
                </button>
              </div>
            </div>
          )}

          {step === "habits" && (
            <div className="space-y-4">
              <h2 className="text-[20px] font-semibold text-ink">How should I sort your camera roll?</h2>
              <p className="text-[12.5px] text-ink-muted">
                Tap what&apos;s true for you. These become rules I use on every new photo — I&apos;ll still ask before filing, and I keep
                learning from what you approve.
              </p>
              <div className="flex gap-2 text-[11px]">
                <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setHabits(PRESET_RULES.map((r) => r.id))}>
                  Select all
                </button>
                <span className="text-ink-faint">·</span>
                <button type="button" className="text-ink-muted hover:text-ink" onClick={() => setHabits([])}>
                  None
                </button>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {PRESET_RULES.map((r) => {
                  const on = habits.includes(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setHabits(on ? habits.filter((x) => x !== r.id) : [...habits, r.id])}
                        className={`flex h-full w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                          on ? "border-[var(--hud)] bg-[color-mix(in_oklab,var(--hud)_8%,transparent)]" : "border-line bg-panel-2"
                        }`}
                      >
                        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${on ? "border-[var(--hud)] text-[var(--hud)]" : "border-line"}`}>
                          {on && <Icon.Check width={12} height={12} aria-hidden />}
                        </span>
                        <span className="text-[12.5px] text-ink">{r.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-ink-faint">
                Photos of people always ask first. Anything else, just tell me in the chat — &ldquo;screenshots of houses go to Real Estate&rdquo;.
              </p>
            </div>
          )}

          {step === "ready" && (
            <div className="space-y-4">
              <h2 className="text-[24px] font-semibold text-ink">{about.call || about.name ? `You're live, ${about.call || about.name}.` : "You're live."}</h2>
              <ul className="grid gap-1.5">
                {setup.items.map((i) => {
                  const to = STEP_FOR[i.id];
                  return (
                    <li key={i.id} className="flex items-center gap-2 text-[12.5px]">
                      <span className={`h-2 w-2 rounded-full ${i.done ? "bg-[var(--hud-green)]" : "bg-[var(--hud-amber)]"}`} aria-hidden />
                      <span className={i.done ? "text-ink-muted line-through" : "text-ink"}>{i.label}</span>
                      {!i.done && to && (
                        <button type="button" className="text-[11px] text-[var(--hud)] hover:underline" onClick={() => setStep(to)}>
                          do it now
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {setup.left > 0 && <p className="text-[12px] text-ink-muted">Anything still open waits under Setup in the top bar.</p>}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          <div className="flex items-center gap-1.5">
            <button type="button" className="deck-btn" disabled={idx === 0} onClick={() => setStep(STEPS[Math.max(0, idx - 1)].id)}>
              Back
            </button>
            {step !== "welcome" && step !== "ready" && (
              <button type="button" className="px-1 text-[11px] text-ink-faint hover:text-ink" onClick={() => setStep("ready")}>
                Skip the rest
              </button>
            )}
          </div>
          <div className="flex gap-1.5">
            {step !== "ready" && step !== "welcome" && (
              <button type="button" className="deck-btn" onClick={next}>
                Skip
              </button>
            )}
            {step === "about" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={saveAbout}>
                Save & continue
              </button>
            )}
            {(step === "keys" || step === "accounts") && (
              <button type="button" className="deck-btn deck-btn--go" onClick={next}>
                Continue
              </button>
            )}
            {step === "habits" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={saveHabits}>
                Save {habits.length} habit{habits.length === 1 ? "" : "s"}
              </button>
            )}
            {step === "ready" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={finish}>
                Open my Dashboard
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// --- the Keys step ----------------------------------------------------------

const ENV_PATH = "../../.env.local"; // the bridge runs from tools/jarvis-bridge, so this is the repo root

function KeysStep({
  keys,
  bridge,
  onRefresh,
  onHandOff,
}: {
  keys: Record<string, boolean> | null;
  bridge: OnboardingBridge;
  onRefresh: () => void;
  onHandOff: (task: string) => void;
}) {
  const rows = useMemo(() => (keys ? keyRows(keys) : []), [keys]);
  const [open, setOpen] = useState<string | null>(null);
  const missing = rows.filter((r) => r.reading.status !== "live");
  const allMissingKeys = [...new Set(missing.flatMap((r) => r.ask))];

  if (!keys) return <p className="text-[12px] text-ink-muted">Checking which keys are set…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[20px] font-semibold text-ink">Your keys</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Only <b className="text-ink">Thinking</b> is needed — the rest each switch on one feature. For each one: open the site and get it yourself,
          paste one you already have, or let me go and get it in the browser.
        </p>
      </div>

      {allMissingKeys.length > 1 && (
        <button type="button" className="deck-btn deck-btn--go" onClick={() => onHandOff(agentTaskForKeys(allMissingKeys))}>
          <Icon.Bot width={12} height={12} className="mr-1 inline" aria-hidden />
          Jarvis, get all {missing.length} for me
        </button>
      )}

      <ul className="divide-y divide-line-soft rounded-lg border border-line">
        {rows.map((r) => (
          <KeyRowView
            key={r.capability.id}
            row={r}
            open={open === r.capability.id}
            onToggle={() => setOpen(open === r.capability.id ? null : r.capability.id)}
            bridge={bridge}
            onSaved={onRefresh}
            onHandOff={onHandOff}
          />
        ))}
      </ul>

      <p className="text-[11px] leading-relaxed text-ink-faint">
        {bridge.browser
          ? "When I do it, I work in the browser on your PC and stop for you to sign in — I never type passwords. I'll see the key while I copy it across; pasting it yourself keeps it away from the model."
          : "Letting me do it needs the local agent running on your PC (it drives the browser). Without it, open the site and paste the key here."}{" "}
        New keys show as working after the site restarts or redeploys.
      </p>
      <button type="button" className="text-[11.5px] text-ink-muted hover:text-ink" onClick={onRefresh}>
        <Icon.Refresh width={11} height={11} className="mr-1 inline" aria-hidden />
        Check again
      </button>
    </div>
  );
}

function KeyRowView({
  row,
  open,
  onToggle,
  bridge,
  onSaved,
  onHandOff,
}: {
  row: KeyRow;
  open: boolean;
  onToggle: () => void;
  bridge: OnboardingBridge;
  onSaved: () => void;
  onHandOff: (task: string) => void;
}) {
  const { capability, reading, essential, ask } = row;
  const live = reading.status === "live";
  const sites = [...new Map(ask.map((k) => [KEY_SOURCES[k].url, KEY_SOURCES[k]])).values()];
  const [values, setValues] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    const entries = ask.map((k) => [k, (values[k] ?? "").trim()] as const).filter(([, v]) => v);
    if (!entries.length) return setNote({ ok: false, text: "Paste the key first." });
    for (const [k, v] of entries) {
      const why = checkKey(k, v);
      if (why) return setNote({ ok: false, text: `${k}: ${why}` });
    }
    setBusy(true);
    setNote(null);
    const said: string[] = [];
    try {
      if (bridge.files) {
        let text = "";
        try {
          const r = await bridge.run("files/read", { path: ENV_PATH });
          if (r.truncated) throw new Error(".env.local is too big to edit safely here.");
          text = String(r.text ?? "");
        } catch (e) {
          // A missing file is fine — it gets created. Anything else stops the write.
          if (!/ENOENT|no such file|cannot find/i.test(String((e as Error).message))) throw e;
        }
        for (const [k, v] of entries) text = upsertEnvLine(text, k, v);
        const w = await bridge.run("files/write", { path: ENV_PATH, text });
        said.push(`Saved to ${String(w.path ?? ".env.local")} on your PC.`);
      }
      const lines = entries.map(([k, v]) => `${k}=${v}`).join("\n");
      try {
        await navigator.clipboard.writeText(lines);
        said.push("Copied for Vercel — paste it into the project's Settings → Environment Variables, then redeploy.");
      } catch {
        said.push("Add it on Vercel under the project's Settings → Environment Variables, then redeploy.");
      }
      setValues({});
      setNote({ ok: true, text: said.join(" ") });
      onSaved();
    } catch (e) {
      setNote({ ok: false, text: `Couldn't save: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${live ? "bg-[var(--hud-green)]" : reading.status === "partial" ? "bg-[var(--hud-amber)]" : "bg-ink-faint"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink">
            {capability.name}
            {essential && !live && <span className="ml-1.5 font-mono text-[9.5px] tracking-wider text-[var(--hud-amber)]">NEEDED</span>}
          </p>
          <p className="text-[11px] leading-snug text-ink-muted">{capability.what}</p>
        </div>
        {live ? (
          <span className="font-mono text-[10px] tracking-wider text-[var(--hud-green)]">WORKING</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sites.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="deck-btn" title={s.how}>
                Get key{sites.length > 1 ? ` · ${s.site}` : ""}
                <Icon.Launch width={10} height={10} className="ml-1 inline" aria-hidden />
              </a>
            ))}
            <button type="button" className="deck-btn" aria-expanded={open} onClick={onToggle}>
              Paste
            </button>
            <button type="button" className="deck-btn deck-btn--go" onClick={() => onHandOff(agentTaskForKeys(ask))}>
              Jarvis, do it
            </button>
          </div>
        )}
      </div>

      {open && !live && (
        <div className="mt-2.5 space-y-2 rounded-lg border border-line bg-panel-2 p-2.5">
          {ask.map((k) => (
            <div key={k} className="space-y-1">
              <label htmlFor={`key-${k}`} className="flex items-baseline justify-between gap-2 text-[10.5px]">
                <span className="font-mono text-ink-muted">{k}</span>
                <span className="text-ink-faint">{KEY_SOURCES[k].how}</span>
              </label>
              <div className="flex gap-1.5">
                <input
                  id={`key-${k}`}
                  type={show ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  className="min-h-[36px] w-full rounded-md border border-line bg-panel px-2.5 font-mono text-[12px] text-ink placeholder:text-ink-faint"
                  placeholder={KEY_SOURCES[k].prefix ? `${KEY_SOURCES[k].prefix}…` : "Paste the key"}
                  value={values[k] ?? ""}
                  onKeyDown={(e) => e.key === "Enter" && void save()}
                  onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                />
                <button
                  type="button"
                  className="grid w-9 shrink-0 place-items-center rounded-md border border-line text-ink-muted hover:text-ink"
                  aria-label={show ? "Hide key" : "Show key"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <Icon.EyeOff width={13} height={13} aria-hidden /> : <Icon.Eye width={13} height={13} aria-hidden />}
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="deck-btn deck-btn--go" disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : bridge.files ? "Save to my PC" : "Save"}
            </button>
            <span className="text-[10.5px] text-ink-faint">
              {bridge.files ? "Written straight to .env.local — never sent to the AI." : "Your PC isn't linked, so I'll copy it for you to paste on Vercel."}
            </span>
          </div>
        </div>
      )}
      {note && <p className={`mt-1.5 text-[11px] ${note.ok ? "text-[var(--hud-green)]" : "text-[var(--hud-amber)]"}`}>{note.text}</p>}
    </li>
  );
}

// --- small pieces -------------------------------------------------------------

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11.5px] text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

/** One-tap answers. Tapping the chosen one again clears it. */
function Chips({ options, value, onPick }: { options: string[]; value: string; onPick: (v: string) => void }) {
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.trim().toLowerCase() === o.toLowerCase();
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onPick(o)} className={`deck-btn rounded-full ${on ? "deck-btn--go" : ""}`}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** Type a name, press Enter or comma, and it becomes a chip. */
function TagInput({ id, className, value, onChange }: { id: string; className: string; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const items = splitList(raw);
    if (items.length) onChange([...new Set([...value, ...items])]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full border border-[var(--hud)] px-2 py-0.5 text-[11.5px] text-ink">
              {v}
              <button type="button" aria-label={`Remove ${v}`} className="text-ink-muted hover:text-ink" onClick={() => onChange(value.filter((x) => x !== v))}>
                <Icon.Close width={9} height={9} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        id={id}
        className={className}
        value={draft}
        placeholder={value.length ? "Add another…" : "Type one and press Enter"}
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            e.stopPropagation();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}

function ConnectRow({ name, detail, done, action }: { name: string; detail: string; done: boolean; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-line bg-panel-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-semibold text-ink">{name}</p>
        <p className="text-[11px] leading-snug text-ink-muted">{detail}</p>
      </div>
      {done ? <span className="font-mono text-[10px] tracking-wider text-[var(--hud-green)]">CONNECTED</span> : action}
    </li>
  );
}

/** The top-bar button. Always there, so setup is never more than one click away. */
export function SetupButton({ setup, onOpen }: { setup: SetupStatus; onOpen: () => void }) {
  const total = setup.items.length;
  const done = total - setup.left;
  const pct = total ? done / total : 1;
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={setup.left ? `${setup.left} setup step${setup.left === 1 ? "" : "s"} left — pick up where you left off` : "Setup"}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition hover:bg-panel-2 hover:text-ink ${
        setup.left ? "border-[var(--hud)] text-ink" : "border-line text-ink-muted"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="var(--hud)"
          strokeWidth="2"
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 8 8)"
        />
      </svg>
      {setup.left ? (
        <span>
          Setup <span className="text-ink-muted">{done}/{total}</span>
        </span>
      ) : (
        <span>Setup</span>
      )}
    </button>
  );
}

/** The Profile's "Finish setup" checklist. */
export function FinishSetup({ setup, onOpen, go }: { setup: SetupStatus; onOpen: (step: OnboardingStep) => void; go: (tab: string) => void }) {
  if (!setup.left) return null;
  return (
    <section className="deck rounded-xl" aria-labelledby="fs-h">
      <div className="deck-panel deck-panel--live p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="deck-kicker">Finish setup</p>
            <h2 id="fs-h" className="text-[14px] font-semibold text-ink">
              {setup.items.length - setup.left} of {setup.items.length} done — the rest makes Jarvis sharper
            </h2>
          </div>
          <button type="button" className="deck-btn deck-btn--go" onClick={() => onOpen(resumeStep(getOnboarding().lastStep, setup.items))}>
            Resume guided setup
          </button>
        </div>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {setup.items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                disabled={i.done}
                onClick={() => (i.id === "favorites" ? go("plugins") : i.id === "iphone" ? go("iphone") : onOpen(STEP_FOR[i.id] ?? "welcome"))}
                className="flex w-full items-center gap-2.5 rounded-lg border border-line bg-panel-2 px-3 py-2 text-left transition enabled:hover:border-[var(--hud)] disabled:opacity-60"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${i.done ? "bg-[var(--hud-green)]" : "bg-[var(--hud-amber)]"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={`block text-[12px] ${i.done ? "text-ink-muted line-through" : "text-ink"}`}>{i.label}</span>
                  <span className="block text-[10.5px] text-ink-faint">{i.detail}</span>
                </span>
                {!i.done && <Icon.ArrowRight width={12} height={12} className="text-ink-faint" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
