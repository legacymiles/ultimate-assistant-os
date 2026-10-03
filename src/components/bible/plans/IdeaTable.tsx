"use client";

// ---------------------------------------------------------------------------
// Build Plans — the room.
//
// It owns the store and nothing else: one `BibleStore` in state, every write
// through a pure reducer and then one save. The three screens it switches
// between — the vault, the brief, one open idea — all read from that.
//
// A table rather than a card grid, deliberately: this is a ledger of ideas with
// four numbers against each one, and a grid of cards would turn four numbers
// into four paragraphs.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../../icons";
import { uid } from "@/lib/bible/ids";
import {
  currentPlan,
  deleteIdea,
  isSeedId,
  loadRaw,
  resolve,
  saveStore,
  upsertIdea,
} from "@/lib/bible/store";
import { fmtMoney, progress, totals } from "@/lib/bible/totals";
import {
  emptyBrief,
  emptyStore,
  type BibleStore,
  type Brief,
  type HomeBase,
  type Idea,
  type IdeaStatus,
  type Scale,
  type Skill,
} from "@/lib/bible/types";
import { OpenIdea } from "./PlanSheet";

const STATUSES: IdeaStatus[] = ["idea", "planning", "building", "built", "parked"];

type SortKey = "title" | "status" | "cost" | "progress" | "touched";

export function PlansRoom({ homeBase }: { homeBase: HomeBase | null }) {
  const [store, setStore] = useState<BibleStore>(emptyStore);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("touched");

  useEffect(() => {
    setStore(loadRaw());
  }, []);

  /** Every write goes through here, so there is exactly one save path. */
  const write = useCallback((next: BibleStore) => {
    setStore(next);
    saveStore(next);
  }, []);

  const view = useMemo(() => resolve(store), [store]);
  const open = openId ? view.ideas.find((i) => i.id === openId) ?? null : null;

  const saveIdea = useCallback((idea: Idea) => write(upsertIdea(loadRaw(), idea)), [write]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? view.ideas.filter((i) =>
          [i.title, i.oneLiner, ...i.tags].join(" ").toLowerCase().includes(q))
      : view.ideas;

    const value = (i: Idea): number | string => {
      const plan = currentPlan(i);
      switch (sort) {
        case "title": return i.title.toLowerCase();
        case "status": return STATUSES.indexOf(i.status);
        case "cost": return plan ? totals(plan).cost?.low ?? -1 : -1;
        case "progress": {
          if (!plan) return -1;
          const p = progress(plan);
          return p.total ? p.done / p.total : -1;
        }
        default: return i.updatedAt;
      }
    };

    return [...matched].sort((a, b) => {
      // Pinned first, always: a pin is the owner saying "this one".
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const av = value(a);
      const bv = value(b);
      if (typeof av === "string" || typeof bv === "string") {
        return sort === "title"
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av)); // touched: newest first
      }
      return bv - av;
    });
  }, [view.ideas, query, sort]);

  if (creating) {
    return (
      <NewIdea
        homeBase={homeBase}
        onCancel={() => setCreating(false)}
        onCreate={(idea) => {
          saveIdea(idea);
          setCreating(false);
          setOpenId(idea.id);
        }}
      />
    );
  }

  if (open) {
    return (
      <OpenIdea
        idea={open}
        homeBase={homeBase}
        onIdea={saveIdea}
        onBack={() => setOpenId(null)}
        onDelete={() => {
          if (!window.confirm(`Delete "${open.title}" and its plans? This cannot be undone.`)) return;
          write(deleteIdea(loadRaw(), open.id, isSeedId(open.id)));
          setOpenId(null);
        }}
      />
    );
  }

  return (
    <>
      <header className="bible-vault-head">
        <div>
          <h1>Build Plans</h1>
          <p>
            Every idea, and the ordered, costed list of what you actually do to make it exist. Open one
            to argue with it.
          </p>
        </div>
        <div className="bible-vault-tools">
          <label className="bible-search">
            <Icon.Search width={14} height={14} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search ideas, tags"
              aria-label="Search ideas"
            />
          </label>
          <button type="button" className="bb" data-tone="go" onClick={() => setCreating(true)}>
            New idea
          </button>
        </div>
      </header>

      <div className="bible-table-wrap">
        <table className="bible-table">
          <thead>
            <tr>
              <Th k="title" sort={sort} set={setSort}>Idea</Th>
              <Th k="status" sort={sort} set={setSort}>Status</Th>
              <th>Plan</th>
              <Th k="cost" sort={sort} set={setSort}>Cost</Th>
              <Th k="progress" sort={sort} set={setSort}>Progress</Th>
              <Th k="touched" sort={sort} set={setSort}>Touched</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((idea) => {
              const plan = currentPlan(idea);
              const sum = plan ? totals(plan) : null;
              const done = plan ? progress(plan) : null;
              return (
                <tr key={idea.id} onClick={() => setOpenId(idea.id)}>
                  <td>
                    <div className="bible-idea-title">
                      {idea.pinned && <span className="bible-pin" title="Pinned">★</span>}
                      {idea.title}
                    </div>
                    {idea.oneLiner && <div className="bible-idea-line">{idea.oneLiner}</div>}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      className="bible-status"
                      data-s={idea.status}
                      value={idea.status}
                      aria-label={`Status of ${idea.title}`}
                      onChange={(e) => saveIdea({ ...idea, status: e.target.value as IdeaStatus })}
                    >
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="bible-num">
                    {plan ? `v${plan.version}` : <span className="bible-muted">—</span>}
                  </td>
                  <td className="bible-num">
                    {sum?.mixed
                      ? <span className="bible-muted">two currencies</span>
                      : sum?.cost
                        ? fmtMoney(sum.cost)
                        : <span className="bible-muted">—</span>}
                  </td>
                  <td>
                    {done && done.total ? (
                      <>
                        <div className="bible-bar" aria-hidden="true">
                          <i style={{ width: `${(done.done / done.total) * 100}%` }} />
                        </div>
                        <span className="bible-num" style={{ fontSize: 11.5 }}>
                          {done.done}/{done.total}
                        </span>
                      </>
                    ) : <span className="bible-muted">—</span>}
                  </td>
                  <td className="bible-num bible-muted">{ago(idea.updatedAt)}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} style={{ padding: 26, textAlign: "center" }}>
                  <span className="bible-muted">
                    {query ? "Nothing matches that." : "No ideas yet. Start with the thing you keep thinking about."}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Th({
  k,
  sort,
  set,
  children,
}: {
  k: SortKey;
  sort: SortKey;
  set: (k: SortKey) => void;
  children: React.ReactNode;
}) {
  return (
    <th data-sorted={sort === k} onClick={() => set(k)} scope="col">
      {children}
    </th>
  );
}

/** Short, human, and never "Invalid Date" for a value somebody hand-edited. */
function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(then).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// The brief.
//
// Five questions, and the reason each one is here: scale stops a garage plan
// reading like a factory, skill decides whether a step is "cut a 45° mitre" or
// how to hold the stock, tools-owned stops it telling you to buy a saw you own,
// and the budget ceiling turns "cheaper" into a constraint rather than a mood.
// ---------------------------------------------------------------------------

const SCALES: { id: Scale; label: string }[] = [
  { id: "one-off", label: "One for myself" },
  { id: "a-few", label: "A few to sell" },
  { id: "side-income", label: "A steady side income" },
  { id: "product-line", label: "A real product line" },
];

const SKILLS: { id: Skill; label: string }[] = [
  { id: "none", label: "Never done anything like this" },
  { id: "handy", label: "Handy" },
  { id: "pro", label: "Trained / pro" },
];

function NewIdea({
  homeBase,
  onCreate,
  onCancel,
}: {
  homeBase: HomeBase | null;
  onCreate: (idea: Idea) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [brief, setBrief] = useState<Brief>(emptyBrief);
  const [ceiling, setCeiling] = useState("");
  const [elsewhere, setElsewhere] = useState(false);
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");

  const currency = homeBase?.currency ?? "USD";
  const ready = title.trim() && brief.what.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const ceil = Number(ceiling);
    const now = new Date().toISOString();
    onCreate({
      id: uid("idea"),
      title: title.trim(),
      oneLiner: oneLiner.trim(),
      brief: {
        ...brief,
        what: brief.what.trim(),
        toolsOwned: brief.toolsOwned?.trim() || undefined,
        budgetCeiling: Number.isFinite(ceil) && ceil > 0
          ? { low: 0, high: ceil, currency }
          : undefined,
        locationOverride: elsewhere && city.trim()
          ? { city: city.trim(), region: region.trim(), country: homeBase?.country ?? "US", currency }
          : undefined,
      },
      status: "planning",
      tags: [],
      pinned: false,
      plans: [],
      chat: [],
      createdAt: now,
      updatedAt: now,
    });
  };

  return (
    <form className="bible-form" onSubmit={submit}>
      <h2>New idea</h2>
      <p>Enough for a plan that fits your garage rather than somebody else&apos;s factory.</p>

      <div className="bible-field">
        <label htmlFor="bi-title">Name it</label>
        <input
          id="bi-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Picture frames"
        />
      </div>

      <div className="bible-field">
        <label htmlFor="bi-line">One line <em>optional</em></label>
        <input
          id="bi-line"
          type="text"
          value={oneLiner}
          onChange={(e) => setOneLiner(e.target.value)}
          placeholder="Ten frames from pine moulding, sold at a local market"
        />
      </div>

      <div className="bible-field">
        <label htmlFor="bi-what">What are you building?</label>
        <textarea
          id="bi-what"
          rows={3}
          value={brief.what}
          onChange={(e) => setBrief({ ...brief, what: e.target.value })}
          placeholder="Handmade wooden picture frames in two standard sizes, sold locally."
        />
      </div>

      <div className="bible-field">
        <label>How far are you taking it?</label>
        <div className="bible-choice">
          {SCALES.map((s) => (
            <label key={s.id}>
              <input
                type="radio"
                name="scale"
                checked={brief.scale === s.id}
                onChange={() => setBrief({ ...brief, scale: s.id })}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="bible-field">
        <label>How much of this have you done before?</label>
        <div className="bible-choice">
          {SKILLS.map((s) => (
            <label key={s.id}>
              <input
                type="radio"
                name="skill"
                checked={brief.skill === s.id}
                onChange={() => setBrief({ ...brief, skill: s.id })}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>

      <div className="bible-field">
        <label htmlFor="bi-tools">Tools and space you already have <em>optional</em></label>
        <textarea
          id="bi-tools"
          rows={2}
          value={brief.toolsOwned ?? ""}
          onChange={(e) => setBrief({ ...brief, toolsOwned: e.target.value })}
          placeholder="drill, clamps, a garage — no mitre saw"
        />
      </div>

      <div className="bible-field bible-row-2">
        <div style={{ flex: "0 0 200px" }}>
          <label htmlFor="bi-ceiling">Budget ceiling <em>optional, {currency}</em></label>
          <input
            id="bi-ceiling"
            type="number"
            min={0}
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
            placeholder="400"
          />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label>Where</label>
          <div className="bible-choice">
            <label>
              <input type="radio" name="where" checked={!elsewhere} onChange={() => setElsewhere(false)} />
              {homeBase ? `Home base — ${homeBase.city}` : "No location set"}
            </label>
            <label>
              <input type="radio" name="where" checked={elsewhere} onChange={() => setElsewhere(true)} />
              Somewhere else
            </label>
          </div>
        </div>
      </div>

      {elsewhere && (
        <div className="bible-field bible-row-2">
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="City"
            aria-label="City for this idea"
            style={{ flex: "0 0 200px" }}
          />
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="State / region"
            aria-label="Region for this idea"
            style={{ flex: "0 0 200px" }}
          />
        </div>
      )}

      <div className="bible-form-actions">
        <button type="submit" className="bb" data-tone="go" disabled={!ready}>
          Create and write the plan
        </button>
        <button type="button" className="bb" data-tone="ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
