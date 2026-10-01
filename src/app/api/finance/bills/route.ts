import { NextResponse } from "next/server";
import { financeContext } from "@/lib/finance/server/context";
import { billToRow, toBill } from "@/lib/finance/server/rows";
import type { Bill } from "@/lib/finance/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The plan ledger — the half of this feature that needs no bank at all.
 *
 * With no connection and no keys, a bill typed here still drives the calendar,
 * the reminders and the due-date email. That is why the form is a first-class
 * input rather than a fallback.
 */
export async function GET() {
  const ctx = await financeContext();
  if (!ctx.available) return NextResponse.json({ available: false, reason: ctx.reason, bills: [] });
  const { data, error } = await ctx.db.from("finance_bills").select("*").order("first_due");
  if (error) {
    return NextResponse.json({ available: false, reason: error.message, bills: [] });
  }
  return NextResponse.json({ available: true, bills: (data ?? []).map(toBill) });
}

type BillInput = Partial<Omit<Bill, "id">> & { id?: string };

/** Sensible, explicit defaults so a half-filled form still saves something real. */
function normalize(input: BillInput): Omit<Bill, "id"> {
  const name = String(input.name ?? "").trim() || "Untitled bill";
  return {
    name,
    // A bill with no matcher can never be reconciled, so fall back to its name.
    matchers:
      Array.isArray(input.matchers) && input.matchers.length > 0 ? input.matchers : [name],
    amountExpected: Number(input.amountExpected ?? 0),
    amountTolerance: Number(input.amountTolerance ?? 1),
    amountTolerancePct: Number(input.amountTolerancePct ?? 5),
    currency: String(input.currency ?? "GBP"),
    accountId: input.accountId ?? null,
    autopay: input.autopay === true,
    cadence: input.cadence ?? "monthly",
    dayOfMonth: input.dayOfMonth ?? null,
    weekday: input.weekday ?? null,
    monthOfYear: input.monthOfYear ?? null,
    firstDue: String(input.firstDue ?? ""),
    endDate: input.endDate ?? null,
    graceDays: Number(input.graceDays ?? 3),
    reminders: Array.isArray(input.reminders) ? input.reminders : [1440],
    paused: input.paused === true,
    origin: input.origin === "detected" ? "detected" : "typed",
  };
}

export async function POST(req: Request) {
  const ctx = await financeContext();
  if (!ctx.available) return NextResponse.json({ ok: false, reason: ctx.reason }, { status: 401 });

  let input: BillInput;
  try {
    input = (await req.json()) as BillInput;
  } catch {
    return NextResponse.json({ ok: false, reason: "Body must be JSON." }, { status: 400 });
  }

  const bill = normalize(input);
  if (!bill.firstDue) {
    return NextResponse.json({ ok: false, reason: "A bill needs a first due date." }, { status: 400 });
  }

  const row = billToRow(bill, ctx.userId);
  const q = input.id
    ? ctx.db.from("finance_bills").update(row).eq("id", input.id).select("*").single()
    : ctx.db.from("finance_bills").insert(row).select("*").single();
  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, bill: toBill(data) });
}

export async function DELETE(req: Request) {
  const ctx = await financeContext();
  if (!ctx.available) return NextResponse.json({ ok: false, reason: ctx.reason }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, reason: "Need an id." }, { status: 400 });
  const { error } = await ctx.db.from("finance_bills").delete().eq("id", id);
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
