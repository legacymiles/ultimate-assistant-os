"use client";

// ---------------------------------------------------------------------------
// First-run onboarding.
//
// Opens by itself the first time New Jarvis loads for someone who has never
// finished it, and again from "Finish setup" on the Deck or in Profile. Every
// step can be skipped; "Finish later" closes it and leaves the open items on
// the Profile checklist.
//
// Each step writes where that fact already lives:
//   about    → the Profile's name, and Jarvis memory (source "profile")
//   accounts → real connections through the existing Composio connectors
//   iPhone   → the Photos tab's iPhone setup (the Shortcut + token)
//   habits   → Camera Autopilot rules, so photos sort the owner's way at once
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Icon } from "../icons";
import "./deck.css";
import { GOALS, getOnboarding, saveOnboarding } from "@/lib/new-jarvis/onboarding";
import { PRESET_RULES, addRule } from "@/lib/recall/photos/autopilot";
import { addMemory } from "@/lib/jarvis/memoryClient";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { STORE_KEY, emptyStore, newProfile } from "@/lib/new-dashboard/model";
import type { DashboardStore } from "@/lib/new-dashboard/types";
import type { JarvisStore } from "@/lib/jarvis/types";
import type { SetupStatus } from "@/lib/new-jarvis/useSetup";
import { SyncStatusPanel } from "../jarvis/SyncStatusPanel";

export type OnboardingStep = "welcome" | "about" | "accounts" | "habits" | "devices" | "ready";
const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "welcome", label: "Welcome" },
  { id: "about", label: "You" },
  { id: "accounts", label: "Connect" },
  { id: "habits", label: "Camera" },
  { id: "devices", label: "Devices" },
  { id: "ready", label: "Ready" },
];

interface Props {
  start?: OnboardingStep;
  onClose: () => void;
  go: (tab: string) => void;
  store: JarvisStore | null;
  commit: (next: JarvisStore) => void;
  onProfileChanged: () => void;
  setup: SetupStatus;
}

export function Onboarding({ start = "welcome", onClose, go, store, commit, onProfileChanged, setup }: Props) {
  const [step, setStep] = useState<OnboardingStep>(start);
  const [about, setAbout] = useState(() => getOnboarding().about);
  const [habits, setHabits] = useState<string[]>(() => {
    const chosen = getOnboarding().photoHabits;
    return chosen.length ? chosen : ["songs", "repos"];
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") later();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const idx = STEPS.findIndex((s) => s.id === step);
  const next = () => {
    saveOnboarding({ seen: [...new Set([...getOnboarding().seen, step])] });
    setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)].id);
  };
  const later = () => {
    if (getOnboarding().status !== "done") saveOnboarding({ status: "later" });
    onClose();
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
    saveOnboarding({ status: "done" });
    onClose();
  };

  const field = "min-h-[40px] w-full rounded-lg border border-line bg-panel-2 px-3 text-[13px] text-ink placeholder:text-ink-faint";

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
            <p className="deck-kicker">Jarvis setup</p>
            <ol className="mt-1 flex flex-wrap gap-1">
              {STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setStep(s.id)}
                    aria-current={s.id === step ? "step" : undefined}
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                      s.id === step ? "bg-elevated text-ink" : i < idx ? "text-[var(--hud)]" : "text-ink-faint"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")} {s.label}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <button type="button" onClick={later} className="text-[11.5px] text-ink-muted hover:text-ink">
            Finish later in Profile
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {step === "welcome" && (
            <div className="space-y-4">
              <h2 className="text-[26px] font-semibold leading-tight text-ink">Let&apos;s set up your Jarvis.</h2>
              <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
                About three minutes. I&apos;ll learn who you are, connect the accounts you choose, and learn how you like the photos
                in your camera roll sorted. Skip anything — it waits for you in Profile.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  ["I ask first", "I suggest, you approve. Nothing is filed, sent or deleted on my own."],
                  ["I learn you", "Every yes and every correction makes my next guess better."],
                  ["You're in control", "Disconnect anything or switch off any rule, any time."],
                ].map(([t, d]) => (
                  <div key={t} className="deck-stat">
                    <p className="text-[13px] font-semibold text-ink">{t}</p>
                    <p className="mt-1 text-[11.5px] leading-snug text-ink-muted">{d}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "about" && (
            <div className="space-y-4">
              <h2 className="text-[20px] font-semibold text-ink">The basics</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="ob-name" label="Your name">
                  <input id="ob-name" className={field} value={about.name} autoComplete="name" onChange={(e) => setAbout({ ...about, name: e.target.value })} />
                </Field>
                <Field id="ob-call" label="What should I call you?">
                  <input id="ob-call" className={field} value={about.call} placeholder="First name, nickname, Boss…" onChange={(e) => setAbout({ ...about, call: e.target.value })} />
                </Field>
                <Field id="ob-role" label="What do you do?">
                  <input id="ob-role" className={field} value={about.role} placeholder="e.g. funding broker, producer, contractor" onChange={(e) => setAbout({ ...about, role: e.target.value })} />
                </Field>
                <Field id="ob-biz" label="Your businesses or projects">
                  <input id="ob-biz" className={field} value={about.businesses} placeholder="Separate with commas" onChange={(e) => setAbout({ ...about, businesses: e.target.value })} />
                </Field>
              </div>
              <div>
                <p className="mb-1.5 text-[12px] text-ink-muted">What do you want help with most?</p>
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

          {step === "accounts" && (
            <div className="space-y-4">
              <h2 className="text-[20px] font-semibold text-ink">Connect your world</h2>
              <p className="text-[12.5px] text-ink-muted">Each one opens that service&apos;s own sign-in. I only read what I need, and I ask before acting.</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                <ConnectRow
                  name="iPhone camera roll"
                  detail="Sends new photos to Camera Autopilot (iCloud has no public API, so an iOS Shortcut pushes them)"
                  done={setup.iphoneLinked}
                  action={
                    <button type="button" className="deck-btn deck-btn--go" onClick={() => { later(); go("photos"); }}>
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
                  Account connections aren&apos;t switched on for this site yet: {setup.connectors.reason || "the connector key is missing"}.
                </p>
              )}
              <button type="button" className="text-[11.5px] text-ink-muted hover:text-ink" onClick={setup.refresh}>
                <Icon.Refresh width={11} height={11} className="mr-1 inline" aria-hidden />
                I connected one — check again
              </button>
            </div>
          )}

          {step === "habits" && (
            <div className="space-y-4">
              <h2 className="text-[20px] font-semibold text-ink">How should I sort your camera roll?</h2>
              <p className="text-[12.5px] text-ink-muted">
                Pick what&apos;s true for you. These become rules I use on every new photo — I&apos;ll still ask before filing, and I keep
                learning from what you approve.
              </p>
              <ul className="grid gap-2">
                {PRESET_RULES.map((r) => {
                  const on = habits.includes(r.id);
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => setHabits(on ? habits.filter((x) => x !== r.id) : [...habits, r.id])}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
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
                Photos of people always ask first. Anything else, just tell me on the Dashboard — &ldquo;screenshots of houses go to Real Estate&rdquo;.
              </p>
            </div>
          )}

          {step === "devices" && (
            <div className="space-y-4">
              <h2 className="text-[20px] font-semibold text-ink">Your memory and skills, on every device</h2>
              <p className="text-[12.5px] text-ink-muted">
                Tell Claude something on your phone and your computer knows it. Make a skill anywhere and it&apos;s everywhere. Here&apos;s
                what&apos;s set up, and the one thing to do on the device you&apos;re holding.
              </p>
              <SyncStatusPanel />
              <p className="text-[11px] text-ink-faint">
                The full setup — token, commands for each computer — is in Dashboard › Memory › Skills everywhere, and this stays on your
                Finish setup checklist until it&apos;s done.
              </p>
            </div>
          )}

          {step === "ready" && (
            <div className="space-y-4">
              <h2 className="text-[24px] font-semibold text-ink">{about.call || about.name ? `You're live, ${about.call || about.name}.` : "You're live."}</h2>
              <ul className="grid gap-1.5">
                {setup.items.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 text-[12.5px]">
                    <span className={`h-2 w-2 rounded-full ${i.done ? "bg-[var(--hud-green)]" : "bg-[var(--hud-amber)]"}`} aria-hidden />
                    <span className={i.done ? "text-ink-muted line-through" : "text-ink"}>{i.label}</span>
                  </li>
                ))}
              </ul>
              {setup.left > 0 && <p className="text-[12px] text-ink-muted">Anything still open waits on the checklist in Dashboard › Profile.</p>}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
          <button type="button" className="deck-btn" disabled={idx === 0} onClick={() => setStep(STEPS[Math.max(0, idx - 1)].id)}>
            Back
          </button>
          <div className="flex gap-1.5">
            {step !== "ready" && step !== "welcome" && (
              <button type="button" className="deck-btn" onClick={next}>
                Skip
              </button>
            )}
            {step === "welcome" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={next}>
                Let&apos;s go
              </button>
            )}
            {step === "about" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={saveAbout}>
                Save & continue
              </button>
            )}
            {step === "accounts" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={next}>
                Continue
              </button>
            )}
            {step === "habits" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={saveHabits}>
                Save {habits.length} habit{habits.length === 1 ? "" : "s"}
              </button>
            )}
            {step === "devices" && (
              <button type="button" className="deck-btn deck-btn--go" onClick={next}>
                Continue
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

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11.5px] text-ink-muted">
        {label}
      </label>
      {children}
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

/** The Profile's "Finish setup" checklist. */
export function FinishSetup({ setup, onOpen, go }: { setup: SetupStatus; onOpen: (step: OnboardingStep) => void; go: (tab: string) => void }) {
  if (!setup.left) return null;
  const stepFor: Record<string, OnboardingStep> = { about: "about", accounts: "accounts", habits: "habits", iphone: "accounts" };
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
          <button type="button" className="deck-btn deck-btn--go" onClick={() => onOpen("welcome")}>
            Run guided setup
          </button>
        </div>
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {setup.items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                disabled={i.done}
                onClick={() => (i.id === "favorites" ? go("plugins") : i.id === "iphone" ? go("photos") : i.id === "sync" ? go("skills") : onOpen(stepFor[i.id] ?? "welcome"))}
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
