"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons";
import { Modal } from "../Modal";
import { Onboarding } from "./Onboarding";
import { loadLocal, saveSynced } from "@/lib/sync/appState";
import { useRemotePull } from "@/lib/sync/useSync";
import { MECHANISMS } from "@/lib/new-dashboard/questions";
import { OWNER_CAPABILITIES, OWNER_ROUTINES, OWNER_SUGGESTED_INTAKE } from "@/lib/new-dashboard/known";
import { STORE_KEY, dayPlan, emptyStore, fourCs, inferConnections, newProfile, today, uid } from "@/lib/new-dashboard/model";
import { bundle, coerceProfile, exportFiles } from "@/lib/new-dashboard/export";
import { heuristicFocus, type FocusResult } from "@/lib/new-dashboard/focus";
import type { DashboardStore, Intake, Mechanism, Profile } from "@/lib/new-dashboard/types";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink";
const input =
  "w-full rounded-md border border-line bg-panel-2 px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none";
const card = "rounded-xl border border-line bg-panel";

function download(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function NewDashboard() {
  const [store, setStore] = useState<DashboardStore>(emptyStore);
  const [ready, setReady] = useState(false);
  const [onboarding, setOnboarding] = useState<{ suggested: boolean } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    setStore(loadLocal<DashboardStore>(STORE_KEY, emptyStore()));
    setReady(true);
  }, []);
  useEffect(reload, [reload]);
  useRemotePull(STORE_KEY, reload);

  const commit = (next: DashboardStore) => {
    setStore(next);
    saveSynced(STORE_KEY, next);
  };

  const active = store.profiles.find((p) => p.id === store.activeId) ?? store.profiles[0] ?? null;

  const update = (fn: (p: Profile) => Profile) => {
    if (!active) return;
    const next = { ...fn(active), updatedAt: new Date().toISOString() };
    commit({ ...store, profiles: store.profiles.map((p) => (p.id === active.id ? next : p)) });
  };

  const addProfile = (name: string, useKnown: boolean) => {
    const p = newProfile(name);
    if (useKnown) {
      p.intake = { ...OWNER_SUGGESTED_INTAKE, q2: ["", ""] };
      p.capabilities = OWNER_CAPABILITIES.map((c) => ({ ...c, id: uid() }));
      p.routines = OWNER_ROUTINES.map((r) => ({ ...r, id: uid() }));
    }
    commit({ ...store, profiles: [...store.profiles, p], activeId: p.id });
    setAdding(false);
    setOnboarding({ suggested: useKnown });
  };

  const saveIntake = (intake: Intake, finished: boolean) => {
    update((p) => ({
      ...p,
      intake,
      onboarded: p.onboarded || finished,
      connections: inferConnections(intake, p.connections),
    }));
    if (finished) setOnboarding(null);
  };

  const importJson = async (file: File) => {
    try {
      const p = coerceProfile(JSON.parse(await file.text()));
      if (!p) return alert("That file isn't a New Dashboard profile (it needs at least a name).");
      commit({ ...store, profiles: [...store.profiles, p], activeId: p.id });
    } catch {
      alert("Couldn't read that file as JSON.");
    }
  };

  const removeActive = () => {
    if (!active || !confirm(`Delete ${active.name}'s dashboard? Export it first if you want a copy.`)) return;
    const profiles = store.profiles.filter((p) => p.id !== active.id);
    commit({ ...store, profiles, activeId: profiles[0]?.id ?? null });
  };

  if (!ready) return <div className="min-h-dvh" />;

  const topBar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2.5 sm:px-4">
      <Link href="/" className={btn} aria-label="Back to hub">
        <Icon.ArrowLeft width={14} height={14} />
        <span className="hidden sm:inline">Hub</span>
      </Link>
      <span className="ml-1 text-sm font-semibold text-ink">New Dashboard</span>
      <span className="hidden text-xs text-ink-faint sm:inline">· your AI Operating System</span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {store.profiles.length > 0 && (
          <select
            aria-label="Whose dashboard"
            value={active?.id ?? ""}
            onChange={(e) => commit({ ...store, activeId: e.target.value })}
            className="rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink"
          >
            {store.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className={btn} onClick={() => setAdding(true)}>
          <Icon.Users width={14} height={14} /> Onboard someone
        </button>
        <button className={btn} onClick={() => fileRef.current?.click()}>
          <Icon.Upload width={14} height={14} /> Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = "";
          }}
        />
        {active && (
          <button className={btn} onClick={() => setExporting(true)}>
            <Icon.Download width={14} height={14} /> Export AI OS files
          </button>
        )}
      </div>
    </div>
  );

  const addModal = (
    <AddPersonModal
      open={adding || (!active && !onboarding)}
      firstRun={!store.profiles.length}
      onClose={() => setAdding(false)}
      onAdd={addProfile}
      onImport={() => fileRef.current?.click()}
    />
  );

  if (onboarding && active) {
    return (
      <div className="min-h-dvh">
        {topBar}
        <Onboarding
          key={active.id}
          name={active.name}
          initial={active.intake}
          suggested={onboarding.suggested}
          onSave={saveIntake}
          onCancel={() => setOnboarding(null)}
        />
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      {topBar}
      {addModal}
      {active && (
        <>
          <Dashboard
            p={active}
            update={update}
            onEdit={() => setOnboarding({ suggested: false })}
            onDelete={removeActive}
          />
          <ExportModal open={exporting} p={active} onClose={() => setExporting(false)} />
        </>
      )}
    </div>
  );
}

// --- add person ---------------------------------------------------------------

function AddPersonModal({
  open,
  firstRun,
  onClose,
  onAdd,
  onImport,
}: {
  open: boolean;
  firstRun: boolean;
  onClose: () => void;
  onAdd: (name: string, useKnown: boolean) => void;
  onImport: () => void;
}) {
  const [name, setName] = useState("");
  const [useKnown, setUseKnown] = useState(firstRun);
  useEffect(() => setUseKnown(firstRun), [firstRun]);

  return (
    <Modal open={open} title={firstRun ? "Set up your AI OS" : "Onboard someone new"} onClose={onClose}>
      <div className="space-y-4 p-5 text-sm">
        <p className="text-ink-muted">
          Seven quick questions turn into a dashboard of the Four Cs — <b className="text-ink">Context</b>,{" "}
          <b className="text-ink">Connections</b>, <b className="text-ink">Capabilities</b>, <b className="text-ink">Cadence</b> — plus the
          files that make Claude Code know this person from the first message.
        </p>
        <input
          autoFocus
          className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-ink focus:outline-none"
          placeholder={firstRun ? "Your first name" : "Their first name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && onAdd(name, useKnown)}
        />
        <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={useKnown} onChange={(e) => setUseKnown(e.target.checked)} className="mt-0.5" />
          <span>
            <b className="text-ink">Pre-fill with what Claude knows about me</b> — your apps, skills and tools, as editable suggestions.
            Leave off when onboarding someone else.
          </span>
        </label>
        <div className="flex items-center justify-between gap-2">
          <button onClick={onImport} className={btn}>
            <Icon.Upload width={14} height={14} /> Import a profile JSON
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => onAdd(name, useKnown)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition hover:bg-accent-2 disabled:opacity-40"
          >
            Start onboarding
          </button>
        </div>
      </div>
    </Modal>
  );
}

// --- the dashboard ------------------------------------------------------------

function Dashboard({
  p,
  update,
  onEdit,
  onDelete,
}: {
  p: Profile;
  update: (fn: (p: Profile) => Profile) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const layers = useMemo(() => fourCs(p), [p]);
  const total = layers.reduce((s, l) => s + l.score, 0);
  const plan = dayPlan(p);
  const priorities = p.intake.q3.map((s, n) => ({ s, n })).filter(({ s }) => s.trim());

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-3 py-5 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{/^me$/i.test(p.name) ? "My" : `${p.name}'s`} AI OS</h1>
          <p className="text-xs text-ink-faint">
            Day {plan.day} · updated {new Date(p.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button className={btn} onClick={onEdit}>
            <Icon.Edit width={14} height={14} /> {p.onboarded ? "Edit answers" : "Finish onboarding"}
          </button>
          <button className={btn} onClick={onDelete} aria-label="Delete this dashboard">
            <Icon.Trash width={14} height={14} />
          </button>
        </div>
      </div>

      {/* Four Cs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className={`${card} col-span-2 flex flex-col justify-between p-4 lg:col-span-1`}>
          <div className="text-xs uppercase tracking-wide text-ink-faint">Setup coverage</div>
          <div className="text-4xl font-bold text-ink">
            {total}
            <span className="text-base text-ink-faint">/100</span>
          </div>
          <p className="text-[11px] leading-snug text-ink-faint">
            How much is set up — not proof it works. Run <code>/audit</code> in Claude Code for the evidence score.
          </p>
        </div>
        {layers.map((l) => (
          <div key={l.key} className={`${card} p-4`} title={l.test}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink">{l.label}</span>
              <span className="text-xs text-ink-muted">{l.score}/25</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(l.score / 25) * 100}%` }} />
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              <span className="text-ink-faint">Next: </span>
              {l.next}
            </p>
          </div>
        ))}
      </div>

      {/* Plan strip */}
      <div className={`${card} flex flex-wrap gap-x-5 gap-y-2 px-4 py-3 text-xs`}>
        {plan.steps.map((s) => (
          <span key={s.day} className={s.done ? "text-ink-faint line-through" : plan.day >= s.day ? "text-ink" : "text-ink-faint"}>
            <span className="mr-1 inline-block w-12 text-ink-faint">Day {s.day}</span>
            {s.done ? "✓ " : ""}
            {s.label}
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Context */}
        <section className={`${card} p-4 lg:col-span-2`}>
          <h2 className="mb-2 text-sm font-semibold text-ink">Context</h2>
          <p className="whitespace-pre-wrap text-sm text-ink-muted">{p.intake.q1 || "Not answered yet."}</p>
          <h3 className="mb-1 mt-4 text-xs uppercase tracking-wide text-ink-faint">90-day priorities</h3>
          <ul className="space-y-1">
            {priorities.length === 0 && <li className="text-sm text-ink-faint">None set.</li>}
            {priorities.map(({ s, n }) => {
              const done = p.prioritiesDone.includes(n);
              return (
                <li key={n}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={done}
                      onChange={() =>
                        update((x) => ({
                          ...x,
                          prioritiesDone: done ? x.prioritiesDone.filter((k) => k !== n) : [...x.prioritiesDone, n],
                        }))
                      }
                    />
                    <span className={done ? "text-ink-faint line-through" : "text-ink"}>{s}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <div className="uppercase tracking-wide text-ink-faint">What eats the week</div>
              <p className="mt-1 text-ink-muted">{p.intake.q7 || "—"}</p>
            </div>
            <div>
              <div className="uppercase tracking-wide text-ink-faint">Voice samples</div>
              <p className="mt-1 text-ink-muted">
                {p.intake.q2.filter((s) => s.trim()).length}/2 pasted
                {p.intake.q2.filter((s) => s.trim()).length < 2 && (
                  <button onClick={onEdit} className="ml-2 text-accent hover:underline">
                    add
                  </button>
                )}
              </p>
            </div>
          </div>
        </section>

        <FocusCard p={p} />
      </div>

      <ConnectionsTable p={p} update={update} />

      <div className="grid gap-4 lg:grid-cols-2">
        <CapabilitiesList p={p} update={update} />
        <RoutinesList p={p} update={update} />
      </div>

      <DecisionsLog p={p} update={update} />

      <p className="pb-6 text-center text-[11px] text-ink-faint">
        Built on the AIS-OS kit (github.com/nateherkai/AIS-OS, MIT). The Four Cs of an AI OS™ is a trademark of Nate Herk.
      </p>
    </div>
  );
}

function FocusCard({ p }: { p: Profile }) {
  const [focus, setFocus] = useState<FocusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState("");

  const ask = async () => {
    setBusy(true);
    setWarning("");
    try {
      const res = await fetch("/api/new-dashboard/focus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFocus(data);
      if (data.warning) setWarning(data.warning);
    } catch {
      setFocus(heuristicFocus(p));
      setWarning("Offline — answered from your priorities directly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} flex flex-col p-4`}>
      <h2 className="text-sm font-semibold text-ink">What should I focus on this week?</h2>
      {!focus ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 py-4">
          <p className="text-xs text-ink-muted">Answered only from this dashboard — your priorities, your voice, your open gaps.</p>
          <button
            onClick={ask}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-black transition hover:bg-accent-2 disabled:opacity-50"
          >
            <Icon.Sparkles width={14} height={14} /> {busy ? "Thinking…" : "Ask my AI OS"}
          </button>
        </div>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-4 text-ink">
            {focus.bullets.map((b, n) => (
              <li key={n}>{b}</li>
            ))}
          </ul>
          <p className="text-ink-muted">{focus.monday}</p>
          {focus.shift && <p className="text-xs italic text-accent">{focus.shift}</p>}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-ink-faint">{focus.ai ? "AI answer" : "Offline answer"}</span>
            <button onClick={ask} disabled={busy} className="text-xs text-ink-muted hover:text-ink">
              {busy ? "…" : "Ask again"}
            </button>
          </div>
        </div>
      )}
      {warning && <p className="mt-2 text-[11px] text-amber-400">{warning}</p>}
    </section>
  );
}

function ConnectionsTable({ p, update }: { p: Profile; update: (fn: (p: Profile) => Profile) => void }) {
  const set = (n: number, patch: Partial<Profile["connections"][number]>) =>
    update((x) => ({ ...x, connections: x.connections.map((c, k) => (k === n ? { ...c, ...patch } : c)) }));
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">Connections</h2>
        <span className="text-[11px] text-ink-faint">What your AI OS can reach. Wired + checked in the last 30 days = full marks.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="text-left text-ink-faint">
            <tr className="border-b border-line-soft">
              <th className="px-4 py-2 font-medium">Domain</th>
              <th className="px-2 py-2 font-medium">Tool</th>
              <th className="px-2 py-2 font-medium">Mechanism</th>
              <th className="px-2 py-2 font-medium">Last checked</th>
            </tr>
          </thead>
          <tbody>
            {p.connections.map((c, n) => (
              <tr key={c.domain} className="border-b border-line-soft last:border-0">
                <td className="px-4 py-1.5 text-ink">{c.domain}</td>
                <td className="px-2 py-1.5">
                  <input className={input} value={c.tool} placeholder="—" onChange={(e) => set(n, { tool: e.target.value })} />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    className={input}
                    value={c.mechanism}
                    onChange={(e) => set(n, { mechanism: e.target.value as Mechanism })}
                  >
                    {MECHANISMS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`w-20 ${c.lastChecked ? "text-ink-muted" : "text-ink-faint"}`}>{c.lastChecked || "never"}</span>
                    <button
                      className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:text-ink disabled:opacity-40"
                      disabled={c.mechanism === "not-connected"}
                      onClick={() => set(n, { lastChecked: today() })}
                      title="Mark as seen working today"
                    >
                      Works today
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CapabilitiesList({ p, update }: { p: Profile; update: (fn: (p: Profile) => Profile) => void }) {
  const [draft, setDraft] = useState({ name: "", trigger: "", output: "" });
  const [scanNote, setScanNote] = useState("");

  const importSkills = async () => {
    setScanNote("Scanning…");
    try {
      const res = await fetch("/api/skills/scan");
      const data: { available: boolean; skills: { slug: string; origin: string; overview?: string }[] } = await res.json();
      if (!data.available) return setScanNote("Skill scan only works on the computer running Claude Code.");
      const have = new Set(p.capabilities.map((c) => c.name.replace(/^\//, "")));
      const mine = data.skills.filter((s) => s.origin === "Personal" && !have.has(s.slug));
      update((x) => ({
        ...x,
        capabilities: [
          ...x.capabilities,
          ...mine.map((s) => ({ id: uid(), name: `/${s.slug}`, trigger: "", output: (s.overview ?? "").slice(0, 120) })),
        ],
      }));
      setScanNote(mine.length ? `Added ${mine.length} of your Claude Code skills.` : "All your skills are already listed.");
    } catch {
      setScanNote("Couldn't reach the skill scanner.");
    }
  };

  return (
    <section className={`${card} p-4`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Capabilities</h2>
        <button className={btn} onClick={importSkills}>
          <Icon.Refresh width={12} height={12} /> Pull my Claude skills
        </button>
      </div>
      {scanNote && <p className="mb-2 text-[11px] text-ink-faint">{scanNote}</p>}
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {p.capabilities.length === 0 && <li className="text-xs text-ink-faint">None yet — add a skill or workflow you rely on.</li>}
        {p.capabilities.map((c) => (
          <li key={c.id} className="group flex items-start gap-2 rounded-md px-1 py-1 text-xs hover:bg-panel-2">
            <code className="shrink-0 text-accent">{c.name}</code>
            <span className="flex-1 text-ink-muted">
              {c.trigger && <>&ldquo;{c.trigger}&rdquo; → </>}
              {c.output}
            </span>
            <button
              aria-label={`Remove ${c.name}`}
              className="text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100"
              onClick={() => update((x) => ({ ...x, capabilities: x.capabilities.filter((k) => k.id !== c.id) }))}
            >
              <Icon.Close width={12} height={12} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 grid grid-cols-[1fr_1fr_1fr_auto] gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          update((x) => ({ ...x, capabilities: [...x.capabilities, { id: uid(), ...draft }] }));
          setDraft({ name: "", trigger: "", output: "" });
        }}
      >
        <input className={input} placeholder="/skill-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className={input} placeholder="trigger phrase" value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })} />
        <input className={input} placeholder="produces…" value={draft.output} onChange={(e) => setDraft({ ...draft, output: e.target.value })} />
        <button className={btn} aria-label="Add capability">
          <Icon.Plus width={12} height={12} />
        </button>
      </form>
    </section>
  );
}

function RoutinesList({ p, update }: { p: Profile; update: (fn: (p: Profile) => Profile) => void }) {
  const [draft, setDraft] = useState({ name: "", schedule: "" });
  return (
    <section className={`${card} p-4`}>
      <h2 className="mb-2 text-sm font-semibold text-ink">Cadence</h2>
      <p className="mb-2 text-[11px] text-ink-faint">Things that run without being asked. Only a logged run counts as proof.</p>
      <ul className="space-y-1">
        {p.routines.length === 0 && <li className="text-xs text-ink-faint">Nothing scheduled yet. Don&apos;t automate a workflow that doesn&apos;t work by hand first.</li>}
        {p.routines.map((r) => (
          <li key={r.id} className="group flex items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-panel-2">
            <span className="flex-1 text-ink">
              {r.name} <span className="text-ink-faint">· {r.schedule || "no schedule"}</span>
            </span>
            <span className={r.lastRun ? "text-ink-muted" : "text-ink-faint"}>{r.lastRun ? `ran ${r.lastRun}` : "unproven"}</span>
            <button
              className="rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:text-ink"
              onClick={() => update((x) => ({ ...x, routines: x.routines.map((k) => (k.id === r.id ? { ...k, lastRun: today() } : k)) }))}
            >
              Ran today
            </button>
            <button
              aria-label={`Remove ${r.name}`}
              className="text-ink-faint opacity-0 hover:text-ink group-hover:opacity-100"
              onClick={() => update((x) => ({ ...x, routines: x.routines.filter((k) => k.id !== r.id) }))}
            >
              <Icon.Close width={12} height={12} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 grid grid-cols-[2fr_1fr_auto] gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.name.trim()) return;
          update((x) => ({ ...x, routines: [...x.routines, { id: uid(), ...draft, lastRun: "" }] }));
          setDraft({ name: "", schedule: "" });
        }}
      >
        <input className={input} placeholder="e.g. Morning brief to inbox" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className={input} placeholder="Weekdays 7am" value={draft.schedule} onChange={(e) => setDraft({ ...draft, schedule: e.target.value })} />
        <button className={btn} aria-label="Add routine">
          <Icon.Plus width={12} height={12} />
        </button>
      </form>
    </section>
  );
}

function DecisionsLog({ p, update }: { p: Profile; update: (fn: (p: Profile) => Profile) => void }) {
  const [draft, setDraft] = useState({ title: "", decision: "", why: "" });
  const sorted = [...p.decisions].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <section className={`${card} p-4`}>
      <h2 className="mb-1 text-sm font-semibold text-ink">Decisions log</h2>
      <p className="mb-3 text-[11px] text-ink-faint">Append-only. Capture the why, not just the what.</p>
      <form
        className="mb-3 grid gap-1.5 sm:grid-cols-[1fr_2fr_2fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.title.trim()) return;
          update((x) => ({ ...x, decisions: [...x.decisions, { id: uid(), date: today(), ...draft }] }));
          setDraft({ title: "", decision: "", why: "" });
        }}
      >
        <input className={input} placeholder="Short title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <input className={input} placeholder="What was decided" value={draft.decision} onChange={(e) => setDraft({ ...draft, decision: e.target.value })} />
        <input className={input} placeholder="Why" value={draft.why} onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
        <button className={btn}>
          <Icon.Plus width={12} height={12} /> Log
        </button>
      </form>
      <ul className="divide-y divide-line-soft">
        {sorted.length === 0 && <li className="text-xs text-ink-faint">No decisions yet.</li>}
        {sorted.map((d) => (
          <li key={d.id} className="py-2 text-xs">
            <span className="mr-2 text-ink-faint">{d.date}</span>
            <b className="text-ink">{d.title}</b>
            {d.decision && <span className="text-ink-muted"> — {d.decision}</span>}
            {d.why && <div className="mt-0.5 pl-[5.2rem] text-ink-faint">Why: {d.why}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- export --------------------------------------------------------------------

function ExportModal({ open, p, onClose }: { open: boolean; p: Profile; onClose: () => void }) {
  const files = useMemo(() => exportFiles(p), [p]);
  const [sel, setSel] = useState(0);
  const [copied, setCopied] = useState("");
  const f = files[sel];
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(""), 1500);
  };

  return (
    <Modal
      open={open}
      wide
      title="Export AI OS files"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button className={btn} onClick={() => download(`${slug}-ai-os-profile.json`, JSON.stringify(p, null, 2), "application/json")}>
            <Icon.Database width={12} height={12} /> Profile JSON
          </button>
          <button className={btn} onClick={() => download(`${slug}-ai-os.md`, bundle(files))}>
            <Icon.Download width={12} height={12} /> All files (one .md)
          </button>
        </div>
      }
    >
      <div className="p-5 text-xs">
        <p className="mb-3 text-ink-muted">
          Drop these into a Claude Code folder and every session starts knowing {p.name}. Or tell Claude:{" "}
          <i>&ldquo;use the ai-os-dashboard skill to install this export here&rdquo;</i>.
        </p>
        <div className="mb-2 flex flex-wrap gap-1">
          {files.map((x, n) => (
            <button
              key={x.path}
              onClick={() => setSel(n)}
              className={`rounded-md border px-2 py-1 font-mono text-[11px] ${n === sel ? "border-accent text-ink" : "border-line text-ink-muted hover:text-ink"}`}
            >
              {x.path}
            </button>
          ))}
        </div>
        <pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-panel-2 p-3 font-mono text-[11px] text-ink-muted">
          {f.content}
        </pre>
        <div className="mt-2 flex gap-2">
          <button className={btn} onClick={() => copy(f.content, f.path)}>
            <Icon.Copy width={12} height={12} /> {copied === f.path ? "Copied" : "Copy"}
          </button>
          <button className={btn} onClick={() => download(f.path.split("/").pop()!, f.content)}>
            <Icon.Download width={12} height={12} /> Download
          </button>
        </div>
      </div>
    </Modal>
  );
}
