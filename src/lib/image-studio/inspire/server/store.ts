// ---------------------------------------------------------------------------
// Inspire's single door to persistence.
//
// With SUPABASE_SERVICE_ROLE_KEY set, rows live in the inspire_* tables and
// image bytes in the private `inspire-images` bucket. Without it, everything is
// a JSON file or a binary under `.data/inspire/`, so local use needs no
// account. Same split as DTF Studio (src/lib/dtf/server/store.ts).
//
// The routes check ownership before every read and write (./access.ts). The
// tables ALSO carry row-level security (supabase/migrations/…_inspire.sql) so
// the public anon key can only ever read public images and a member's own
// rows — defence in depth, not the primary gate.
// ---------------------------------------------------------------------------

import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deleteBlob, ensureBucket, getBlob, putBlob } from "@/lib/server/blobStore";
import type { Collection, InspireImage, LibraryItem } from "../types";

export const BUCKET = "inspire-images";
const ROOT = path.join(process.cwd(), ".data", "inspire");
const BLOBS = path.join(ROOT, "blobs");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function remoteConfigured(): boolean {
  return Boolean(SUPABASE_URL && SERVICE_KEY);
}

let client: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (!remoteConfigured()) return null;
  if (!client) client = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export class SetupError extends Error {
  constructor() {
    super("Inspire's database tables are not set up yet. Run supabase/migrations/20261124000000_image_studio_inspire.sql in the Supabase SQL editor.");
  }
}

function check(error: { code?: string; message?: string } | null): void {
  if (!error) return;
  if (error.code === "42P01" || /relation .* does not exist|Could not find the table/i.test(error.message ?? "")) throw new SetupError();
  throw new Error(error.message ?? "Database error");
}

// ----- local files ---------------------------------------------------------

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

async function listJsonDir<T>(dir: string): Promise<T[]> {
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".json"));
    const rows = await Promise.all(names.map((n) => readJsonFile<T>(path.join(dir, n))));
    return rows.filter((r): r is Awaited<T> => r !== null) as T[];
  } catch {
    return [];
  }
}

/** Ids reach the filesystem and object keys; refuse anything but a plain token. */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(id)) throw new Error("Bad id");
  return id;
}

// ----- images --------------------------------------------------------------

function searchText(img: InspireImage): string {
  return [img.title, img.description, img.creator, img.prompt, img.style, img.subject, img.category, ...img.chips.map((c) => c.text)]
    .join(" ")
    .toLowerCase()
    .slice(0, 6000);
}

export async function putImage(img: InspireImage): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.from("inspire_images").upsert({
      id: safeId(img.id),
      owner_id: img.ownerId,
      visibility: img.visibility,
      category: img.category,
      style: img.style,
      subject: img.subject,
      source: img.source,
      search: searchText(img),
      data: img,
      created_at: img.createdAt,
    });
    check(error);
    return;
  }
  await writeJsonFile(path.join(ROOT, "images", `${safeId(img.id)}.json`), img);
}

export async function getImage(id: string): Promise<InspireImage | null> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("inspire_images").select("data").eq("id", safeId(id)).maybeSingle();
    check(error);
    return (data?.data as InspireImage) ?? null;
  }
  return readJsonFile<InspireImage>(path.join(ROOT, "images", `${safeId(id)}.json`));
}

/** Public images (newest first), plus the caller's own private ones when given. */
export async function listImages(opts: { publicOnly?: boolean; ownerId?: string | null; limit?: number }): Promise<InspireImage[]> {
  const limit = opts.limit ?? 400;
  const d = db();
  if (d) {
    let q = d.from("inspire_images").select("data").order("created_at", { ascending: false }).limit(limit);
    if (opts.publicOnly) q = q.eq("visibility", "public");
    else if (opts.ownerId) q = q.or(`visibility.eq.public,owner_id.eq.${opts.ownerId}`);
    else q = q.eq("visibility", "public");
    const { data, error } = await q;
    check(error);
    return (data ?? []).map((r) => r.data as InspireImage);
  }
  const all = await listJsonDir<InspireImage>(path.join(ROOT, "images"));
  return all
    .filter((i) => i.visibility === "public" || (!opts.publicOnly && opts.ownerId && i.ownerId === opts.ownerId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Every image a member owns, public or private. */
export async function listOwnImages(ownerId: string): Promise<InspireImage[]> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("inspire_images").select("data").eq("owner_id", ownerId).order("created_at", { ascending: false }).limit(500);
    check(error);
    return (data ?? []).map((r) => r.data as InspireImage);
  }
  const all = await listJsonDir<InspireImage>(path.join(ROOT, "images"));
  return all.filter((i) => i.ownerId === ownerId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteImage(id: string): Promise<void> {
  const d = db();
  await Promise.all([deleteBlob(BUCKET, `img/${safeId(id)}.webp`, BLOBS), deleteBlob(BUCKET, `img/${safeId(id)}-thumb.webp`, BLOBS)]);
  if (d) {
    const { error } = await d.from("inspire_images").delete().eq("id", safeId(id));
    check(error);
    return;
  }
  await fs.rm(path.join(ROOT, "images", `${safeId(id)}.json`), { force: true });
}

export async function putImageBytes(id: string, full: Buffer, thumb: Buffer): Promise<void> {
  if (db()) await ensureBucket(BUCKET);
  const a = await putBlob(BUCKET, `img/${safeId(id)}.webp`, BLOBS, full, "image/webp");
  const b = await putBlob(BUCKET, `img/${safeId(id)}-thumb.webp`, BLOBS, thumb, "image/webp");
  if (!a || !b) throw new Error("Could not store the image. Try again.");
}

export async function getImageBytes(id: string, thumb: boolean): Promise<Buffer | null> {
  return getBlob(BUCKET, `img/${safeId(id)}${thumb ? "-thumb" : ""}.webp`, BLOBS);
}

// ----- library ---------------------------------------------------------------

export async function listLibrary(userId: string): Promise<LibraryItem[]> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("inspire_library").select("data").eq("user_id", userId).order("updated_at", { ascending: false }).limit(2000);
    check(error);
    return (data ?? []).map((r) => r.data as LibraryItem);
  }
  const rows = await listJsonDir<LibraryItem>(path.join(ROOT, "library", safeId(userId)));
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getLibraryItem(userId: string, id: string): Promise<LibraryItem | null> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("inspire_library").select("data").eq("user_id", userId).eq("id", safeId(id)).maybeSingle();
    check(error);
    return (data?.data as LibraryItem) ?? null;
  }
  return readJsonFile<LibraryItem>(path.join(ROOT, "library", safeId(userId), `${safeId(id)}.json`));
}

export async function putLibraryItem(userId: string, item: LibraryItem): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.from("inspire_library").upsert({
      id: safeId(item.id),
      user_id: userId,
      kind: item.kind,
      data: item,
      updated_at: item.updatedAt,
    });
    check(error);
    return;
  }
  await writeJsonFile(path.join(ROOT, "library", safeId(userId), `${safeId(item.id)}.json`), item);
}

export async function deleteLibraryItem(userId: string, id: string): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.from("inspire_library").delete().eq("user_id", userId).eq("id", safeId(id));
    check(error);
    return;
  }
  await fs.rm(path.join(ROOT, "library", safeId(userId), `${safeId(id)}.json`), { force: true });
}

// ----- collections -----------------------------------------------------------

export async function listCollections(userId: string): Promise<Collection[]> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("inspire_collections").select("id, name, created_at").eq("user_id", userId).order("created_at");
    check(error);
    return (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string, createdAt: r.created_at as string }));
  }
  return (await readJsonFile<Collection[]>(path.join(ROOT, "collections", `${safeId(userId)}.json`))) ?? [];
}

export async function saveCollections(userId: string, next: Collection[], removed: string[] = []): Promise<void> {
  const d = db();
  if (d) {
    if (removed.length) {
      const { error } = await d.from("inspire_collections").delete().eq("user_id", userId).in("id", removed.map(safeId));
      check(error);
    }
    if (next.length) {
      const { error } = await d
        .from("inspire_collections")
        .upsert(next.map((c) => ({ id: safeId(c.id), user_id: userId, name: c.name, created_at: c.createdAt })));
      check(error);
    }
    return;
  }
  await writeJsonFile(path.join(ROOT, "collections", `${safeId(userId)}.json`), next);
}

// ----- AI allowance ----------------------------------------------------------

export async function usedToday(userId: string, day: string): Promise<number> {
  const d = db();
  if (d) {
    const { data, error } = await d.from("inspire_usage").select("used").eq("user_id", userId).eq("day", day).maybeSingle();
    check(error);
    return Number(data?.used ?? 0);
  }
  const all = (await readJsonFile<Record<string, number>>(path.join(ROOT, "usage.json"))) ?? {};
  return all[`${userId}:${day}`] ?? 0;
}

export async function addUsage(userId: string, day: string, cost: number): Promise<void> {
  const d = db();
  if (d) {
    const { error } = await d.rpc("inspire_add_usage", { p_user: userId, p_day: day, p_cost: cost });
    check(error);
    return;
  }
  const file = path.join(ROOT, "usage.json");
  const all = (await readJsonFile<Record<string, number>>(file)) ?? {};
  all[`${userId}:${day}`] = (all[`${userId}:${day}`] ?? 0) + cost;
  await writeJsonFile(file, all);
}
