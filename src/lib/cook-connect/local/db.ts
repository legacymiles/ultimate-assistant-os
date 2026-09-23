"use client";

// The storage and query half of Cook Connect's demo backend.
//
// When Supabase is not configured the app talks to this instead: a
// PostgREST-shaped query builder over localStorage. Every view and hook keeps
// calling `cook.from(...)` exactly as it would against the real database, so
// this directory is the only thing that differs between the two modes.

import { scopedKey } from "@/lib/sync/identity";

export type Row = Record<string, unknown>;
export type Result<T = unknown> = { data: T; error: { message: string; code?: string } | null };
type DB = Record<string, Row[]>;

// v2 abandons anything stored under v1. The first build seeded a demo world
// into this key; the owner asked for an app that is empty until they put
// something in it, so browsers that already hold that seed start over rather
// than carrying it forever.
export const DB_KEY = "cook_connect_local_db_v2";

/** Fires after any write, so the realtime shim can tell other tabs. */
export type ChangeListener = (table: string, event: "INSERT" | "UPDATE" | "DELETE", row: Row) => void;
const listeners = new Set<ChangeListener>();

export function onLocalChange(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(table: string, event: "INSERT" | "UPDATE" | "DELETE", row: Row) {
  for (const fn of listeners) {
    try { fn(table, event, row); } catch { /* a bad listener must not break a write */ }
  }
}

export function loadDB(): DB {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(scopedKey(DB_KEY)) || "{}") as DB; } catch { return {}; }
}

export function saveDB(db: DB) {
  try { localStorage.setItem(scopedKey(DB_KEY), JSON.stringify(db)); } catch { /* quota — stay in memory */ }
}

export function uuid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}${Date.now()}`;
}

export const nowIso = () => new Date().toISOString();

/** A stable id per email, so demo data survives signing out and back in. */
export function userIdForEmail(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) >>> 0;
  return `local-${h.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

type Filter = (row: Row) => boolean;

export class QueryBuilder<T = unknown> implements PromiseLike<Result<T>> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private filters: Filter[] = [];
  private orders: { col: string; asc: boolean }[] = [];
  private _limit: number | null = null;
  private _single = false;
  private _maybe = false;
  private wantsRows = false;
  private wantsCount = false;
  private payload: unknown = null;
  private conflictKeys: string[] = [];

  constructor(private table: string) {}

  select(_cols?: string, opts?: { count?: "exact" }) {
    if (this.op === "select") this.wantsRows = true;
    else this.wantsRows = true; // insert/update/delete ... .select()
    if (opts?.count) this.wantsCount = true;
    return this;
  }
  insert(payload: unknown) { this.op = "insert"; this.payload = payload; return this; }
  update(payload: unknown) { this.op = "update"; this.payload = payload; return this; }
  upsert(payload: unknown, opts?: { onConflict?: string }) {
    this.op = "upsert";
    this.payload = payload;
    this.conflictKeys = opts?.onConflict?.split(",").map((s) => s.trim()) ?? ["id"];
    return this;
  }
  delete() { this.op = "delete"; return this; }

  eq(col: string, val: unknown) { this.filters.push((r) => r[col] === val); return this; }
  neq(col: string, val: unknown) { this.filters.push((r) => r[col] !== val); return this; }
  is(col: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) === val); return this; }
  in(col: string, vals: unknown[]) { this.filters.push((r) => vals.includes(r[col])); return this; }
  gt(col: string, val: string | number) { this.filters.push((r) => (r[col] as number) > (val as number)); return this; }
  gte(col: string, val: string | number) { this.filters.push((r) => (r[col] as number) >= (val as number)); return this; }
  lt(col: string, val: string | number) { this.filters.push((r) => (r[col] as number) < (val as number)); return this; }
  not(col: string, _op: string, val: unknown) { this.filters.push((r) => (r[col] ?? null) !== val); return this; }

  /** Supports the `col.op.value` list PostgREST uses, for eq / is / ilike. */
  or(expr: string) {
    const preds = expr.split(",").map((part) => {
      const [col, op, ...rest] = part.split(".");
      const raw = rest.join(".");
      return (r: Row) => {
        const v = r[col];
        if (op === "is") return (v ?? null) === (raw === "null" ? null : raw);
        if (op === "ilike") {
          const needle = raw.replace(/%/g, "").toLowerCase();
          return String(v ?? "").toLowerCase().includes(needle);
        }
        return String(v ?? "") === raw;
      };
    });
    this.filters.push((r) => preds.some((p) => p(r)));
    return this;
  }

  /** Case-insensitive contains, which is all the app uses ilike for. */
  ilike(col: string, pattern: string) {
    const needle = pattern.replace(/%/g, "").toLowerCase();
    this.filters.push((r) => String(r[col] ?? "").toLowerCase().includes(needle));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }
  limit(n: number) { this._limit = n; return this; }
  single() { this._single = true; this.wantsRows = true; return this; }
  maybeSingle() { this._maybe = true; this.wantsRows = true; return this; }

  then<R1 = Result<T>, R2 = never>(
    onfulfilled?: ((value: Result<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(r: Row): boolean {
    return this.filters.every((f) => f(r));
  }

  private shape(rows: Row[]): Result<T> {
    if (this._single || this._maybe) {
      const first = rows[0] ?? null;
      const error = this._single && !first
        ? { message: "No rows found", code: "PGRST116" }
        : null;
      return { data: first as T, error };
    }
    return { data: rows as T, error: null };
  }

  private async run(): Promise<Result<T>> {
    const db = loadDB();
    const rows = (db[this.table] ||= []);

    if (this.op === "insert" || this.op === "upsert") {
      const arr = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
      const written: Row[] = [];
      for (const p of arr) {
        const existing = this.op === "upsert"
          ? rows.find((r) => this.conflictKeys.every((k) => r[k] === p[k]))
          : undefined;
        if (existing) {
          Object.assign(existing, p, { updated_at: nowIso() });
          written.push(existing);
          emit(this.table, "UPDATE", existing);
        } else {
          const row: Row = { id: uuid(), created_at: nowIso(), updated_at: nowIso(), ...p };
          if (!row.id) row.id = uuid();
          rows.push(row);
          written.push(row);
          emit(this.table, "INSERT", row);
        }
      }
      saveDB(db);
      return this.wantsRows ? this.shape(written) : { data: null as T, error: null };
    }

    const hits = rows.filter((r) => this.matches(r));

    if (this.op === "update") {
      hits.forEach((r) => {
        Object.assign(r, this.payload as Row);
        emit(this.table, "UPDATE", r);
      });
      saveDB(db);
      return this.wantsRows ? this.shape(hits) : { data: null as T, error: null };
    }

    if (this.op === "delete") {
      db[this.table] = rows.filter((r) => !hits.includes(r));
      saveDB(db);
      hits.forEach((r) => emit(this.table, "DELETE", r));
      return this.wantsRows ? this.shape(hits) : { data: null as T, error: null };
    }

    let result = hits;
    for (const { col, asc } of [...this.orders].reverse()) {
      result = [...result].sort((a, b) => {
        const av = a[col] as string | number, bv = b[col] as string | number;
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * (asc ? 1 : -1);
      });
    }
    if (this._limit !== null) result = result.slice(0, this._limit);
    const shaped = this.shape(result);
    if (this.wantsCount) return { ...shaped, count: hits.length } as Result<T>;
    return shaped;
  }
}
