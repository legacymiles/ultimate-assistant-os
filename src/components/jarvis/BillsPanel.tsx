"use client";

// ---------------------------------------------------------------------------
// The Calendar's Bills tab — every bill Jarvis knows about, in one ledger.
//
// Built to the "Bold" mockup the owner picked (2026-11-22): a profile filter
// bar of avatar pills, a big "still to pay" statement, the unpaid bills as
// confirm cards, then every bill as a wide row with a 36px tick and a large
// tabular amount. The month strip under it is the Calendar's own grid, which
// carries the same amount chips.
//
// The tick is the whole point of the tab, so it never acts on one click: a
// click asks, and only the answer writes the paid mark. Marking rent paid by
// brushing a thumb past it would be worse than not having the button.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import { SheetPortal } from "../new-jarvis/Widgets";
import { money, totalsOf, whenLabel, type OwnerFilter } from "@/lib/bills/view";
import { CADENCE_LABEL, SORTS, type Bill, type DueBill, type SortMode } from "@/lib/bills/types";
import type { BillsStore } from "@/lib/bills/useBills";
import type { Day } from "@/lib/finance/types";

const btn =
  "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition hover:bg-panel-2 hover:text-ink disabled:opacity-50";
const field =
  "w-full rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none";
const pill =
  "inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:bg-panel-2 hover:text-ink";
const pillOn = "border-ink-faint bg-panel-2 text-ink";

/** What the ledger shows: everything, what is left, or only what is late. */
export type ShowFilter = "all" | "unpaid" | "late";

const SHOWS: { id: ShowFilter; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "unpaid", label: "Still to pay" },
  { id: "late", label: "Late only" },
];

/** Two letters for an avatar pill: "Northside Prints" → NP, "Girlfriend" → GI. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0]?.slice(0, 2) ?? "?").toUpperCase();
}

/** A profile's own colour when it has one, otherwise a stable one from its id. */
function hueOf(id: string, hue?: number): number {
  if (typeof hue === "number") return hue;
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

function Avatar({ id, name, hue }: { id: string; name: string; hue?: number }) {
  return (
    <span
      aria-hidden
      className="grid h-[18px] w-[18px] place-items-center rounded-full text-[8px] font-bold text-[#0b0d13]"
      style={{ background: `hsl(${hueOf(id, hue)} 70% 72%)` }}
    >
      {initials(name)}
    </span>
  );
}

function NoProfileMark() {
  return (
    <span
      aria-hidden
      className="grid h-[18px] w-[18px] place-items-center rounded-full bg-elevated text-[9px] text-ink-faint"
    >
      —
    </span>
  );
}

/** The grey ring that turns green. Big, because it is what the tab is for. */
function Tick({
  size,
  paid,
  label,
  onClick,
}: {
  size: 36 | 44;
  paid: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={paid}
      title={label}
      className={`grid shrink-0 place-items-center rounded-full border-2 transition ${
        paid
          ? "border-green-500 bg-green-500/20 text-green-400"
          : "border-[#3b4257] bg-panel-2 text-[#4e5771] hover:scale-105 hover:border-ink-muted hover:text-ink-muted"
      }`}
      style={{ width: size, height: size }}
    >
      <Icon.Check width={size === 44 ? 22 : 18} height={size === 44 ? 22 : 18} />
    </button>
  );
}

/** What a click on a tick, or on "not a bill", is waiting to be told. */
type Asking =
  | { kind: "paid"; due: DueBill }
  | { kind: "unpaid"; due: DueBill }
  | { kind: "drop"; bill: Bill }
  | { kind: "day"; bill: Bill };

export function BillsPanel({
  store,
  month,
  monthLabel,
  list,
  all,
  owner,
  onOwner,
  sort,
  onSort,
  show,
  onShow,
}: {
  store: BillsStore;
  month: { from: Day; to: Day };
  monthLabel: string;
  /** The month's bills, already filtered and sorted. */
  list: DueBill[];
  /** The month's bills before the profile filter — the pills count these. */
  all: DueBill[];
  owner: OwnerFilter;
  onOwner: (o: OwnerFilter) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  show: ShowFilter;
  onShow: (s: ShowFilter) => void;
}) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const [dayDraft, setDayDraft] = useState("1");
  const [adding, setAdding] = useState(false);

  const totals = useMemo(() => totalsOf(list), [list]);
  const noProfileCount = useMemo(() => all.filter((d) => !d.bill.ownerId).length, [all]);
  // The pills count THIS month, like every other figure on the tab. Counting
  // every bill the profile has ever had would disagree with "All bills".
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of all) if (d.bill.ownerId) map.set(d.bill.ownerId, (map.get(d.bill.ownerId) ?? 0) + 1);
    return map;
  }, [all]);
  // A profile with nothing this month drops off — unless it is the one being
  // filtered on, which would leave no way back to it.
  const pills = useMemo(
    () => store.profiles.filter((p) => (counts.get(p.id) ?? 0) > 0 || p.id === owner),
    [store.profiles, counts, owner],
  );
  const unpaid = useMemo(() => list.filter((d) => !d.paid), [list]);
  const next = useMemo(() => unpaid.find((d) => d.dueIn >= 0) ?? unpaid[0], [unpaid]);
  const fromProfiles = useMemo(
    () => new Set(list.filter((d) => d.bill.source === "profiles").map((d) => d.bill.id)).size,
    [list],
  );

  const confirm = () => {
    if (!asking) return;
    if (asking.kind === "paid") store.confirmPaid(asking.due.bill.id, asking.due.due, true);
    if (asking.kind === "unpaid") store.confirmPaid(asking.due.bill.id, asking.due.due, false);
    if (asking.kind === "drop") store.remove(asking.bill);
    if (asking.kind === "day") {
      const n = Math.min(31, Math.max(1, Number(dayDraft) || 1));
      store.correct(asking.bill.id, { dayOfMonth: n });
    }
    setAsking(null);
  };

  return (
    <div>
      {/* ---- who the bills belong to ------------------------------------ */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-2.5">
        <button
          type="button"
          onClick={() => onOwner("all")}
          className={`${pill} ${owner === "all" ? pillOn : ""}`}
        >
          All bills <em className="not-italic text-[10px] text-ink-faint">{all.length}</em>
        </button>
        {pills.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOwner(p.id)}
            className={`${pill} ${owner === p.id ? pillOn : ""}`}
          >
            <Avatar id={p.id} name={p.name} hue={p.hue} />
            {p.name}{" "}
            <em className="not-italic text-[10px] text-ink-faint">{counts.get(p.id) ?? 0}</em>
          </button>
        ))}
        {(noProfileCount > 0 || owner === "none") && (
          <button
            type="button"
            onClick={() => onOwner("none")}
            className={`${pill} ${owner === "none" ? pillOn : ""}`}
            title="Bills that are not filed in any profile"
          >
            <NoProfileMark />
            No profile <em className="not-italic text-[10px] text-ink-faint">{noProfileCount}</em>
          </button>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as SortMode)}
            aria-label="Order"
            className="rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            value={show}
            onChange={(e) => onShow(e.target.value as ShowFilter)}
            aria-label="Show"
            className="rounded-full border border-line bg-panel-2 px-3 py-1.5 text-xs text-ink"
          >
            {SHOWS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button className={btn} onClick={() => setAdding((v) => !v)}>
            <Icon.Plus width={13} height={13} /> Add a bill
          </button>
        </span>
      </div>

      {adding && (
        <AddBill
          store={store}
          month={month}
          onClose={() => setAdding(false)}
        />
      )}

      {/* ---- what is still owed ----------------------------------------- */}
      <div
        className="mb-3 grid gap-5 rounded-2xl border border-line bg-panel p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
        style={{
          backgroundImage:
            "radial-gradient(900px 300px at 0% 0%, rgba(99,102,241,0.14), transparent 60%)",
        }}
      >
        <div>
          <span className="text-[11px] uppercase tracking-[0.14em] text-ink-faint">
            Still to pay in {monthLabel}
          </span>
          <p className="my-1 text-[44px] font-semibold leading-none tracking-tight tabular-nums sm:text-[56px]">
            {money(totals.left)}
          </p>
          <p className="text-xs text-ink-muted">
            {unpaid.length} {unpaid.length === 1 ? "bill" : "bills"} left of {list.length}
            {totals.overdueCount > 0 && (
              <>
                {" · "}
                <b className="font-semibold text-rose-500">
                  {money(totals.overdue)} is already late
                </b>
              </>
            )}
            {totals.paid > 0 && ` · ${money(totals.paid)} confirmed paid`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Stat label="Due this month" value={money(totals.total)} />
          <Stat label="From profiles" value={`${fromProfiles} ${fromProfiles === 1 ? "bill" : "bills"}`} />
          <Stat
            label="Next up"
            value={next ? new Date(`${next.due}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
          />
        </div>
      </div>

      {/* ---- the unpaid ones, as confirm cards --------------------------- */}
      {unpaid.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {unpaid.slice(0, 3).map((d) => (
            <div
              key={`${d.bill.id}-${d.due}`}
              className={`flex items-center gap-3.5 rounded-2xl border bg-panel p-4 ${
                d.overdue ? "border-rose-500/40 shadow-[inset_3px_0_0_#f43f5e]" : "border-line"
              }`}
            >
              <Tick
                size={44}
                paid={false}
                label={`Confirm ${d.bill.name} paid`}
                onClick={() => setAsking({ kind: "paid", due: d })}
              />
              <span className="min-w-0">
                <b className="block truncate text-sm font-semibold">{d.bill.name}</b>
                <span className="mt-0.5 block truncate text-[10.5px] text-ink-faint">
                  {d.bill.where || "No profile"}
                </span>
              </span>
              <span className="ml-auto shrink-0 text-right">
                <b className="block text-[22px] font-semibold tracking-tight tabular-nums">
                  {money(d.amount, d.bill.currency)}
                </b>
                <span className={`mt-0.5 block text-[10px] ${d.overdue ? "text-rose-500" : "text-ink-faint"}`}>
                  {whenLabel(d)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- the ledger -------------------------------------------------- */}
      <section className="overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="hidden items-center gap-3 border-b border-line bg-panel-2 px-4 py-2 text-[10px] uppercase tracking-[0.09em] text-ink-faint sm:flex">
          <span className="w-9">Paid</span>
          <span className="w-12">Due</span>
          <span className="min-w-0 flex-1">Bill</span>
          <span className="w-36">Whose</span>
          <span className="w-28 text-right">Amount</span>
          <span className="w-5" />
        </div>

        {list.length === 0 ? (
          <p className="px-4 py-6 text-xs text-ink-muted">
            {all.length === 0
              ? "No bills in this month yet. Bills filed in a profile show up here by themselves — or add one above."
              : "Nothing matches this filter."}
          </p>
        ) : (
          <ul>
            {list.map((d) => (
              <li
                key={`${d.bill.id}-${d.due}`}
                className={`flex items-center gap-2.5 border-b border-line-soft px-3 py-3 last:border-b-0 sm:gap-3 sm:px-4 ${
                  d.overdue ? "bg-rose-500/[0.06] shadow-[inset_3px_0_0_#f43f5e]" : d.paid ? "bg-green-500/[0.035]" : ""
                }`}
              >
                <Tick
                  size={36}
                  paid={d.paid}
                  label={
                    d.paid
                      ? `${d.bill.name} is paid — mark it unpaid`
                      : `Mark ${d.bill.name} paid`
                  }
                  onClick={() => setAsking({ kind: d.paid ? "unpaid" : "paid", due: d })}
                />
                {/* The date has its own column on a laptop; on a phone it
                    moves into the line under the name, where the bill's own
                    name matters more than a tidy grid. */}
                <span className="hidden w-12 shrink-0 tabular-nums sm:block">
                  <b className="block text-[17px] font-semibold leading-none">
                    {Number(d.due.slice(8, 10))}
                  </b>
                  <span className="mt-0.5 block text-[10px] uppercase tracking-[0.06em] text-ink-faint">
                    {new Date(`${d.due}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <b className={`block truncate text-sm font-medium ${d.paid ? "text-ink-muted" : ""}`}>
                    {d.bill.name}
                  </b>
                  <span className="mt-0.5 block truncate text-[10.5px] text-ink-faint">
                    <span className="sm:hidden">
                      {new Date(`${d.due}T12:00:00`).toLocaleDateString(undefined, {
                        weekday: "short",
                        day: "numeric",
                      })}
                      {" · "}
                    </span>
                    {CADENCE_LABEL[d.bill.cadence].toLowerCase()}
                    {d.bill.dayOfMonth && d.bill.cadence !== "one_off"
                      ? ` on the ${d.bill.dayOfMonth === 31 ? "last day" : ordinal(d.bill.dayOfMonth)}`
                      : ""}
                    {d.bill.autopay ? " · autopay" : ""}
                    {d.bill.source === "profiles" ? " · from Profiles" : ""}
                    <span className="sm:hidden"> · {d.bill.ownerName ?? "No profile"}</span>
                    {d.bill.dayGuessed && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="underline decoration-dotted hover:text-ink"
                          onClick={() => {
                            setDayDraft(String(d.bill.dayOfMonth ?? 1));
                            setAsking({ kind: "day", bill: d.bill });
                          }}
                        >
                          day not set
                        </button>
                      </>
                    )}
                  </span>
                </span>
                <span className="hidden w-36 shrink-0 items-center gap-2 text-xs text-ink-muted sm:flex">
                  {d.bill.ownerId ? (
                    <>
                      <Avatar id={d.bill.ownerId} name={d.bill.ownerName ?? "Profile"} />
                      <span className="truncate">{d.bill.profileName ?? d.bill.ownerName}</span>
                    </>
                  ) : (
                    <>
                      <NoProfileMark />
                      <span>No profile</span>
                    </>
                  )}
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums sm:w-28">
                  <b
                    className={`block text-base font-semibold tracking-tight sm:text-[22px] ${
                      d.paid ? "text-ink-muted" : ""
                    }`}
                  >
                    {money(d.amount, d.bill.currency)}
                  </b>
                  <span
                    className={`mt-0.5 block text-[10px] ${
                      d.paid ? "text-green-400" : d.overdue ? "text-rose-500" : "text-ink-faint"
                    }`}
                  >
                    {d.paid && d.paidAt
                      ? `paid ${new Date(d.paidAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                      : whenLabel(d)}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setAsking({ kind: "drop", bill: d.bill })}
                  aria-label={
                    d.bill.source === "profiles"
                      ? `Take ${d.bill.name} off the bills list`
                      : `Delete ${d.bill.name}`
                  }
                  title={
                    d.bill.source === "profiles"
                      ? "Not a bill — take it off this list (the row stays in the profile)"
                      : "Delete this bill"
                  }
                  className="w-5 shrink-0 text-ink-faint transition hover:text-ink"
                >
                  <Icon.Close width={12} height={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line bg-panel-2 px-4 py-3 text-xs text-ink-muted">
          <span>
            {list.length} {list.length === 1 ? "bill" : "bills"} in {monthLabel}
            {fromProfiles > 0 && ` · ${fromProfiles} of them from your profiles`}
          </span>
          <span className="ml-auto">Still to pay</span>
          <b className="text-lg font-semibold tabular-nums text-ink">{money(totals.left)}</b>
        </div>
      </section>

      {asking && (
        <ConfirmBill
          asking={asking}
          dayDraft={dayDraft}
          onDayDraft={setDayDraft}
          onConfirm={confirm}
          onCancel={() => setAsking(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[104px] rounded-xl border border-line bg-panel-2 px-3.5 py-2.5">
      <span className="block text-[10px] uppercase tracking-[0.08em] text-ink-faint">{label}</span>
      <b className="mt-0.5 block text-[17px] font-semibold tabular-nums">{value}</b>
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Nothing is marked paid on a stray click. The question says the bill, the
 * amount and the day, because a tick on the wrong month's rent is a lie the
 * owner would only find at the bank.
 */
function ConfirmBill({
  asking,
  dayDraft,
  onDayDraft,
  onConfirm,
  onCancel,
}: {
  asking: Asking;
  dayDraft: string;
  onDayDraft: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const title =
    asking.kind === "paid"
      ? "Confirm this is paid"
      : asking.kind === "unpaid"
        ? "Mark this unpaid again"
        : asking.kind === "drop"
          ? asking.bill.source === "profiles"
            ? "Take this off the bills list"
            : "Delete this bill"
          : "Which day is it due?";

  const body =
    asking.kind === "paid" || asking.kind === "unpaid" ? (
      <>
        <b className="text-ink">{asking.due.bill.name}</b> ·{" "}
        {money(asking.due.amount, asking.due.bill.currency)} · due{" "}
        {new Date(`${asking.due.due}T12:00:00`).toLocaleDateString(undefined, {
          day: "numeric",
          month: "long",
        })}
        {asking.kind === "paid"
          ? ". Only this one is marked — next month stays as it is."
          : ". The green tick goes back to grey."}
      </>
    ) : asking.kind === "drop" ? (
      <>
        <b className="text-ink">{asking.bill.name}</b>
        {asking.bill.source === "profiles"
          ? " stays in its profile — it just stops showing here. You can bring it back from the profile row."
          : " is removed, along with its paid marks. This cannot be undone."}
      </>
    ) : (
      <>
        <b className="text-ink">{asking.bill.name}</b> came from Profiles without a due day, so it
        is shown on the 1st. Which day of the month is it really due?
      </>
    );

  // Drawn on Jarvis's root, not here: the Dashboard's blurred scroll pane
  // makes a `fixed` child stick to the pane instead of the screen, so a
  // dialog left in place renders somewhere nobody can see it.
  return (
    <SheetPortal>
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-4 shadow-2xl">
        <h3 className="mb-1.5 text-sm font-semibold text-ink">{title}</h3>
        <p className="text-xs leading-relaxed text-ink-muted">{body}</p>
        {asking.kind === "day" && (
          <input
            type="number"
            min={1}
            max={31}
            value={dayDraft}
            onChange={(e) => onDayDraft(e.target.value)}
            aria-label="Day of the month"
            className={`${field} mt-3`}
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className={btn} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`${btn} border-ink-faint text-ink`}
            onClick={onConfirm}
            autoFocus
          >
            {asking.kind === "paid"
              ? "Yes, it is paid"
              : asking.kind === "unpaid"
                ? "Mark unpaid"
                : asking.kind === "drop"
                  ? asking.bill.source === "profiles"
                    ? "Take it off"
                    : "Delete it"
                  : "Save the day"}
          </button>
        </div>
      </div>
    </div>
    </SheetPortal>
  );
}

/** Bills that are not filed in any profile get typed here. */
function AddBill({
  store,
  month,
  onClose,
}: {
  store: BillsStore;
  month: { from: Day; to: Day };
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    name: "",
    amount: "",
    cadence: "monthly" as Bill["cadence"],
    day: "1",
    date: month.from,
    profile: "",
  });

  const save = () => {
    if (!draft.name.trim()) return;
    const profile = store.profiles.find((p) => p.id === draft.profile);
    const day = Math.min(31, Math.max(1, Number(draft.day) || 1));
    const oneOff = draft.cadence === "one_off";
    store.add({
      name: draft.name,
      amount: Number(draft.amount) || 0,
      cadence: draft.cadence,
      dayOfMonth: oneOff ? null : day,
      firstDue: oneOff
        ? draft.date
        : `${month.from.slice(0, 8)}${String(day).padStart(2, "0")}`,
      profileId: profile?.id ?? null,
      profileName: profile?.name ?? null,
      ownerId: profile?.id ?? null,
      ownerName: profile?.name ?? null,
      where: profile?.name,
    });
    onClose();
  };

  return (
    <div className="mb-3 rounded-xl border border-line bg-panel p-3">
      <h3 className="mb-2 text-xs font-semibold text-ink">A bill of your own</h3>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="What is it?"
          aria-label="Bill name"
          className={field}
        />
        <input
          value={draft.amount}
          onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
          placeholder="$0.00"
          inputMode="decimal"
          aria-label="Amount"
          className={field}
        />
        <select
          value={draft.cadence}
          onChange={(e) => setDraft({ ...draft, cadence: e.target.value as Bill["cadence"] })}
          aria-label="How often"
          className={field}
        >
          {(Object.keys(CADENCE_LABEL) as Bill["cadence"][]).map((c) => (
            <option key={c} value={c}>
              {CADENCE_LABEL[c]}
            </option>
          ))}
        </select>
        {draft.cadence === "one_off" ? (
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            aria-label="Due date"
            className={field}
          />
        ) : (
          <input
            type="number"
            min={1}
            max={31}
            value={draft.day}
            onChange={(e) => setDraft({ ...draft, day: e.target.value })}
            aria-label="Day of the month"
            className={field}
          />
        )}
        <select
          value={draft.profile}
          onChange={(e) => setDraft({ ...draft, profile: e.target.value })}
          aria-label="Whose bill"
          className={field}
        >
          <option value="">No profile</option>
          {store.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button className={btn} onClick={save} disabled={!draft.name.trim()}>
          <Icon.Plus width={13} height={13} /> Add it
        </button>
        <button className={btn} onClick={onClose}>
          Cancel
        </button>
        <span className="text-[10px] text-ink-faint">
          Most bills are better filed in the profile they belong to — they turn up here on their own.
        </span>
      </div>
    </div>
  );
}
