// ---------------------------------------------------------------------------
// DTF Studio's single door to persistence.
//
// Two backends behind one interface, chosen the way the rest of the hub
// chooses (src/lib/server/docStore.ts): with SUPABASE_SERVICE_ROLE_KEY set,
// rows live in the dtf_* tables and bytes in the private `dtf-assets` bucket;
// without it, everything is a JSON file or a binary under `.data/dtf/` so
// local development needs no account.
//
// Why the service role and not the visitor's own session: orders are read by
// three parties (the customer, the owner, the print station) and written by
// four (those plus Stripe). The rules about who may see what live in the route
// layer (./access.ts) and every route checks ownership before it reads. The
// tables ALSO carry row-level security (see the migration), so the public
// anon key can only ever see a customer's own rows — defence in depth, not the
// primary gate.
//
// Server-only. Never import from a client component.
// ---------------------------------------------------------------------------

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getBlob, putBlob, deleteBlob, ensureBucket, signedBlobUrl } from "@/lib/server/blobStore";
import { DEFAULT_SETTINGS, clampSettings, type ProductionSettings } from "../printers";
import type { DesignProject, Order, StoredAsset } from "../types";

export const BUCKET = "dtf-assets";
const LOCAL_ROOT = path.join(process.cwd(), ".data", "dtf");
const BLOB_DIR = path.join(LOCAL_ROOT, "blobs");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function remoteConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

let client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!remoteConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

/** A Postgres error that means "the migration has not been applied yet". */
export class SetupError extends Error {
  constructor() {
    super(
      "DTF Studio's database tables are not set up yet. Run supabase/migrations/20261123000000_dtf_studio.sql in the Supabase SQL editor.",
    );
  }
}

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01" || /relation .* does not exist|Could not find the table/i.test(error.message ?? "")) {
    throw new SetupError();
  }
  throw new Error(error.message ?? "Database error");
}

// ----- local file helpers ------------------------------------------------------

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

async function listJson<T>(dir: string): Promise<T[]> {
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
    const rows = await Promise.all(names.map((n) => readJson<T>(path.join(dir, n))));
    return rows.filter((r) => r !== null) as T[];
  } catch {
    return [];
  }
}

/** Ids reach the filesystem; refuse anything that is not a plain token. */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error("Bad id");
  return id;
}

// One lock per order id so two writers in this process never interleave a
// read-modify-write. (The remote backend uses optimistic concurrency instead.)
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(key, run.catch(() => undefined));
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

// ----- projects ------------------------------------------------------------------

export async function listProjects(userId: string): Promise<DesignProject[]> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("dtf_projects").select("data").eq("user_id", userId).order("updated_at", { ascending: false }).limit(200);
    check(error);
    return (data ?? []).map((r) => r.data as DesignProject);
  }
  const rows = await listJson<DesignProject>(path.join(LOCAL_ROOT, "projects", safeId(userId)));
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getProject(userId: string, id: string): Promise<DesignProject | null> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("dtf_projects").select("data").eq("user_id", userId).eq("id", safeId(id)).maybeSingle();
    check(error);
    return (data?.data as DesignProject) ?? null;
  }
  return readJson<DesignProject>(path.join(LOCAL_ROOT, "projects", safeId(userId), `${safeId(id)}.json`));
}

export async function putProject(userId: string, project: DesignProject): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.from("dtf_projects").upsert({
      id: safeId(project.id),
      user_id: userId,
      name: project.name.slice(0, 120),
      data: project,
      updated_at: project.updatedAt,
    });
    check(error);
    return;
  }
  await writeJson(path.join(LOCAL_ROOT, "projects", safeId(userId), `${safeId(project.id)}.json`), project);
}

export async function deleteProject(userId: string, id: string): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.from("dtf_projects").delete().eq("user_id", userId).eq("id", safeId(id));
    check(error);
    return;
  }
  await fs.rm(path.join(LOCAL_ROOT, "projects", safeId(userId), `${safeId(id)}.json`), { force: true });
}

// ----- assets ----------------------------------------------------------------------

export async function putAsset(meta: StoredAsset, bytes: Buffer): Promise<void> {
  const d = db();
  if (d) await ensureBucket(BUCKET);
  const ok = await putBlob(BUCKET, meta.key, BLOB_DIR, bytes, meta.mime);
  if (!ok) throw new Error("Could not store the file.");
  if (d) {
    const { error } = await d.from("dtf_assets").upsert({
      id: safeId(meta.id),
      user_id: meta.userId,
      kind: meta.kind,
      key: meta.key,
      mime: meta.mime,
      bytes: meta.bytes,
      width: meta.width,
      height: meta.height,
      data: meta,
      created_at: meta.createdAt,
    });
    check(error);
    return;
  }
  await writeJson(path.join(LOCAL_ROOT, "assets", `${safeId(meta.id)}.json`), meta);
}

export async function getAsset(id: string): Promise<StoredAsset | null> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("dtf_assets").select("data").eq("id", safeId(id)).maybeSingle();
    check(error);
    return (data?.data as StoredAsset) ?? null;
  }
  return readJson<StoredAsset>(path.join(LOCAL_ROOT, "assets", `${safeId(id)}.json`));
}

export async function listAssets(userId: string): Promise<StoredAsset[]> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("dtf_assets").select("data").eq("user_id", userId).order("created_at", { ascending: false }).limit(500);
    check(error);
    return (data ?? []).map((r) => r.data as StoredAsset);
  }
  const all = await listJson<StoredAsset>(path.join(LOCAL_ROOT, "assets"));
  return all.filter((a) => a.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function assetBytes(asset: StoredAsset): Promise<Buffer | null> {
  return getBlob(BUCKET, asset.key, BLOB_DIR);
}

/** Bytes by storage key — a print job's `file.key` has no StoredAsset row of its own. */
export async function assetBytesByKey(key: string): Promise<Buffer | null> {
  return getBlob(BUCKET, key, BLOB_DIR);
}

/** Store bytes at an exact key (production print files). */
export async function putBytesByKey(key: string, bytes: Buffer, mime: string): Promise<void> {
  if (db()) await ensureBucket(BUCKET);
  const ok = await putBlob(BUCKET, key, BLOB_DIR, bytes, mime);
  if (!ok) throw new Error("Could not store the file.");
}

export async function deleteAssetByKey(key: string): Promise<void> {
  await deleteBlob(BUCKET, key, BLOB_DIR);
}

/** A short-lived direct link on the remote backend; null locally (serve bytes instead). */
export async function assetSignedUrl(asset: StoredAsset, ttlSeconds = 600, downloadAs?: string): Promise<string | null> {
  return signedBlobUrl(BUCKET, asset.key, ttlSeconds, downloadAs);
}

export async function deleteAsset(asset: StoredAsset): Promise<void> {
  await deleteBlob(BUCKET, asset.key, BLOB_DIR);
  const d = db();
  if (d) {
    const { error } = await d.from("dtf_assets").delete().eq("id", safeId(asset.id));
    check(error);
    return;
  }
  await fs.rm(path.join(LOCAL_ROOT, "assets", `${safeId(asset.id)}.json`), { force: true });
}

// ----- orders ------------------------------------------------------------------------

function orderRow(o: Order) {
  return {
    id: safeId(o.id),
    number: o.number,
    user_id: o.userId,
    status: o.status,
    payment_state: o.payment.state,
    stripe_session_id: o.payment.stripeSessionId ?? null,
    data: o,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  };
}

export async function createOrder(order: Order): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.from("dtf_orders").insert(orderRow(order));
    check(error);
    return;
  }
  await writeJson(path.join(LOCAL_ROOT, "orders", `${safeId(order.id)}.json`), order);
}

export async function getOrder(id: string): Promise<Order | null> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("dtf_orders").select("data").eq("id", safeId(id)).maybeSingle();
    check(error);
    return (data?.data as Order) ?? null;
  }
  return readJson<Order>(path.join(LOCAL_ROOT, "orders", `${safeId(id)}.json`));
}

export async function getOrderByStripeSession(sessionId: string): Promise<Order | null> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("dtf_orders").select("data").eq("stripe_session_id", sessionId).maybeSingle();
    check(error);
    return (data?.data as Order) ?? null;
  }
  const all = await listJson<Order>(path.join(LOCAL_ROOT, "orders"));
  return all.find((o) => o.payment.stripeSessionId === sessionId) ?? null;
}

/** Newest first. `userId` limits to one customer; omit for the owner's view. */
export async function listOrders(opts: { userId?: string; limit?: number } = {}): Promise<Order[]> {
  const limit = Math.min(opts.limit ?? 300, 1000);
  const d = db();
  if (d) {
    let q = d.from("dtf_orders").select("data").order("created_at", { ascending: false }).limit(limit);
    if (opts.userId) q = q.eq("user_id", opts.userId);
    const { data, error } = await q;
    check(error);
    return (data ?? []).map((r) => r.data as Order);
  }
  const all = await listJson<Order>(path.join(LOCAL_ROOT, "orders"));
  return all
    .filter((o) => !opts.userId || o.userId === opts.userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/**
 * Read-modify-write one order safely. `mutate` gets a copy and returns the
 * new order (or null to abort). Remote: optimistic concurrency on updated_at,
 * retried. Local: an in-process lock.
 */
export async function updateOrder(id: string, mutate: (o: Order) => Order | null | Promise<Order | null>): Promise<Order | null> {
  const d = db();
  if (d) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await d.from("dtf_orders").select("data, updated_at").eq("id", safeId(id)).maybeSingle();
      check(error);
      if (!data) return null;
      const current = data.data as Order;
      const next = await mutate(structuredClone(current));
      if (!next) return current;
      next.updatedAt = new Date(Math.max(Date.now(), Date.parse(String(data.updated_at)) + 1)).toISOString();
      const { data: written, error: werr } = await d
        .from("dtf_orders")
        .update(orderRow(next))
        .eq("id", safeId(id))
        .eq("updated_at", data.updated_at)
        .select("id");
      check(werr);
      if (written && written.length) return next;
    }
    throw new Error("The order changed while saving. Try again.");
  }
  return withLock(`order:${id}`, async () => {
    const file = path.join(LOCAL_ROOT, "orders", `${safeId(id)}.json`);
    const current = await readJson<Order>(file);
    if (!current) return null;
    const next = await mutate(structuredClone(current));
    if (!next) return current;
    next.updatedAt = new Date().toISOString();
    await writeJson(file, next);
    return next;
  });
}

/** The next order sequence number (monotonic, gap-tolerant). */
export async function nextOrderSeq(): Promise<number> {
  const d = db();
  if (d) {
    const { data, error } = await d.rpc("dtf_next_order_seq");
    check(error);
    return Number(data);
  }
  return withLock("seq", async () => {
    const file = path.join(LOCAL_ROOT, "seq.json");
    const cur = (await readJson<{ n: number }>(file))?.n ?? 116;
    await writeJson(file, { n: cur + 1 });
    return cur + 1;
  });
}

// ----- settings (owner) ---------------------------------------------------------------

async function getKv<T>(key: string): Promise<T | null> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("dtf_settings").select("data").eq("key", key).maybeSingle();
    check(error);
    return (data?.data as T) ?? null;
  }
  return readJson<T>(path.join(LOCAL_ROOT, "kv", `${key}.json`));
}

async function putKv(key: string, value: unknown): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.from("dtf_settings").upsert({ key, data: value, updated_at: new Date().toISOString() });
    check(error);
    return;
  }
  await writeJson(path.join(LOCAL_ROOT, "kv", `${key}.json`), value);
}

export async function getSettings(): Promise<ProductionSettings> {
  return clampSettings((await getKv<Partial<ProductionSettings>>("settings")) ?? DEFAULT_SETTINGS);
}

export async function putSettings(s: Partial<ProductionSettings>): Promise<ProductionSettings> {
  const next = clampSettings({ ...(await getSettings()), ...s });
  await putKv("settings", next);
  return next;
}

/** The print station's token, stored only as a SHA-256 hash. */
export interface StationRecord {
  tokenHash: string;
  createdAt: string;
  lastSeenAt?: string;
  lastSeenHost?: string;
  exportDir?: string;
}

export async function getStation(): Promise<StationRecord | null> {
  return getKv<StationRecord>("station");
}

export async function putStation(rec: StationRecord | null): Promise<void> {
  await putKv("station", rec);
}

// ----- AI usage (per-customer daily cap) ------------------------------------------------

export async function bumpAiUsage(userId: string, day: string): Promise<number> {
  const key = `ai-usage-${day}`;
  return withLock(key, async () => {
    const rec = (await getKv<Record<string, number>>(key)) ?? {};
    rec[userId] = (rec[userId] ?? 0) + 1;
    await putKv(key, rec);
    return rec[userId];
  });
}
