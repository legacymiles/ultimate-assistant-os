import "server-only";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { readDoc, writeDoc } from "@/lib/server/docStore";
import { ensureBucket, getBlob, putBlob, deleteBlob } from "@/lib/server/blobStore";
import {
  addGame,
  addMessage,
  addScreenshot,
  applyProgress,
  normaliseSkills,
  claimNext,
  failGame,
  removeGame,
  requestLaunch,
  retryGame,
  takeLaunches,
  takePendingMessages,
} from "./reducer";
import type { BuildSkill, BuilderSkills, Game, GameMessage, LaunchAction, ProgressUpdate, TemplateId } from "./types";

// ---------------------------------------------------------------------------
// Game Creator persistence.
//
// One server document holds every owner's games plus the hashed builder
// tokens. It is server-owned (public.server_docs, service role) rather than
// app_state because the builder on the PC writes to it with a token, not a
// browser session, and must never be able to read or touch another owner's
// games.
//
// Writes are serialised within a process. The builder posts progress every
// couple of seconds while a browser may be creating or deleting a game; two
// read-modify-write cycles overlapping would silently drop one of them.
// ---------------------------------------------------------------------------

const DOC = "game-creator";
const BUCKET = "game-shots";
export const MAX_SHOT_BYTES = 8 * 1024 * 1024;

interface GameCreatorDoc {
  /** uid -> sha256 of that owner's builder token. */
  tokens: Record<string, string>;
  /** uid -> when that owner's builder last asked for work. */
  lastSeen: Record<string, string>;
  /** uid -> games, newest first. */
  games: Record<string, Game[]>;
  /** uid -> the game-building skills that owner's PC last reported. */
  skills: Record<string, BuilderSkills>;
}

function dataDir(): string {
  return process.env.GAME_CREATOR_DATA_DIR || path.resolve(".data");
}

async function load(): Promise<GameCreatorDoc> {
  const doc = await readDoc<GameCreatorDoc>(DOC, dataDir());
  return { tokens: doc?.tokens ?? {}, lastSeen: doc?.lastSeen ?? {}, games: doc?.games ?? {}, skills: doc?.skills ?? {} };
}

let chain: Promise<unknown> = Promise.resolve();

/** Run one read-modify-write against the document, one at a time. */
function mutate<T>(fn: (doc: GameCreatorDoc) => T | Promise<T>): Promise<{ value: T; saved: boolean }> {
  const run = chain.then(async () => {
    const doc = await load();
    const value = await fn(doc);
    const saved = await writeDoc(DOC, dataDir(), doc);
    return { value, saved };
  });
  chain = run.catch(() => undefined);
  return run;
}

const now = () => new Date().toISOString();

// ----- tokens ----------------------------------------------------------------

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Mint or rotate the owner's builder token. Shown once; only the hash is kept. */
export async function mintToken(uid: string): Promise<string | null> {
  const token = `gc_${randomBytes(24).toString("base64url")}`;
  const { saved } = await mutate((doc) => {
    doc.tokens[uid] = hash(token);
  });
  return saved ? token : null;
}

export async function builderInfo(
  uid: string,
): Promise<{ linked: boolean; lastSeen: string | null; skills: BuildSkill[]; defaultSkill: string | null }> {
  const doc = await load();
  const s = doc.skills[uid];
  return {
    linked: Boolean(doc.tokens[uid]),
    lastSeen: doc.lastSeen[uid] ?? null,
    skills: s?.skills ?? [],
    defaultSkill: s?.defaultSkill ?? null,
  };
}


/** The owner a builder token belongs to, or null. Constant time per candidate. */
export async function uidForToken(token: string): Promise<string | null> {
  if (!token) return null;
  const want = Buffer.from(hash(token), "hex");
  const doc = await load();
  for (const [uid, stored] of Object.entries(doc.tokens)) {
    const got = Buffer.from(stored, "hex");
    if (got.length === want.length && timingSafeEqual(got, want)) return uid;
  }
  return null;
}

// ----- games -------------------------------------------------------------------

export async function listGames(uid: string): Promise<Game[]> {
  return (await load()).games[uid] ?? [];
}

export async function getGame(uid: string, id: string): Promise<Game | null> {
  return (await listGames(uid)).find((g) => g.id === id) ?? null;
}

export async function createGame(uid: string, prompt: string, template: TemplateId, skill?: string): Promise<Game | null> {
  const id = randomUUID();
  const { value, saved } = await mutate((doc) => {
    // One skill per game: the one asked for if this PC offers it, else the PC's default.
    const offered = doc.skills[uid];
    const pick =
      skill && (!offered?.skills.length || offered.skills.some((x) => x.name === skill))
        ? skill
        : (offered?.defaultSkill ?? undefined);
    doc.games[uid] = addGame(doc.games[uid] ?? [], { id, ownerId: uid, prompt, template, skill: pick, now: now() });
    return doc.games[uid][0];
  });
  return saved ? value : null;
}

/**
 * The builder asks for work: records that it is alive and which skills it
 * offers, hands over Play/Open requests, and claims the oldest queued game.
 */
export async function claim(
  uid: string,
  reported?: unknown,
): Promise<{ game: Game | null; launches: { gameId: string; action: LaunchAction }[] }> {
  const { value } = await mutate((doc) => {
    doc.lastSeen[uid] = now();
    const skills = normaliseSkills(reported, now());
    if (skills) doc.skills[uid] = skills;
    const taken = takeLaunches(doc.games[uid] ?? [], now());
    const { games, game } = claimNext(taken.games, now());
    doc.games[uid] = games;
    return { game, launches: taken.launches };
  });
  return value;
}

export async function launch(uid: string, id: string, action: LaunchAction): Promise<Game | null> {
  const { value, saved } = await mutate((doc) => {
    doc.games[uid] = requestLaunch(doc.games[uid] ?? [], id, action, now());
    return doc.games[uid].find((g) => g.id === id) ?? null;
  });
  return saved ? value : null;
}

export async function progress(uid: string, id: string, update: ProgressUpdate): Promise<Game | null> {
  const { value } = await mutate((doc) => {
    doc.lastSeen[uid] = now();
    doc.games[uid] = applyProgress(doc.games[uid] ?? [], id, update, now());
    return doc.games[uid].find((g) => g.id === id) ?? null;
  });
  return value;
}

export async function fail(uid: string, id: string, error: string): Promise<Game | null> {
  const { value } = await mutate((doc) => {
    doc.games[uid] = failGame(doc.games[uid] ?? [], id, error.slice(0, 4000), now());
    return doc.games[uid].find((g) => g.id === id) ?? null;
  });
  return value;
}

export async function retry(uid: string, id: string): Promise<Game | null> {
  const { value } = await mutate((doc) => {
    doc.games[uid] = retryGame(doc.games[uid] ?? [], id, now());
    return doc.games[uid].find((g) => g.id === id) ?? null;
  });
  return value;
}

export async function message(uid: string, id: string, text: string): Promise<Game | null> {
  const { value, saved } = await mutate((doc) => {
    doc.games[uid] = addMessage(doc.games[uid] ?? [], id, { id: randomUUID(), text }, now());
    return doc.games[uid].find((g) => g.id === id) ?? null;
  });
  return saved ? value : null;
}

/** The builder collects the owner's pending messages for a game (marks them delivered). */
export async function takeMessages(uid: string, id: string): Promise<GameMessage[]> {
  const { value } = await mutate((doc) => {
    doc.lastSeen[uid] = now();
    const { games, messages } = takePendingMessages(doc.games[uid] ?? [], id, now());
    doc.games[uid] = games;
    return messages;
  });
  return value;
}

export async function remove(uid: string, id: string): Promise<boolean> {
  const game = await getGame(uid, id);
  if (!game) return false;
  for (const shot of game.screenshots) await deleteBlob(BUCKET, shot.key, dataDir());
  const { saved } = await mutate((doc) => {
    doc.games[uid] = removeGame(doc.games[uid] ?? [], id);
  });
  return saved;
}

// ----- screenshots -------------------------------------------------------------

export async function putShot(
  uid: string,
  id: string,
  body: Buffer,
  meta: { file?: string; caption?: string; contentType?: string },
): Promise<Game | null> {
  const game = await getGame(uid, id);
  if (!game) return null;
  if (meta.file && game.screenshots.some((s) => s.file === meta.file)) return game;

  await ensureBucket(BUCKET);
  const key = `${uid}/${id}/${randomBytes(8).toString("hex")}.png`;
  const ok = await putBlob(BUCKET, key, dataDir(), body, meta.contentType || "image/png");
  if (!ok) return null;

  const { value } = await mutate((doc) => {
    doc.games[uid] = addScreenshot(doc.games[uid] ?? [], id, { key, file: meta.file, caption: meta.caption }, now());
    return doc.games[uid].find((g) => g.id === id) ?? null;
  });
  return value;
}

/** Bytes of one screenshot, only if it belongs to one of this owner's games. */
export async function getShot(uid: string, id: string, index: number): Promise<Buffer | null> {
  const game = await getGame(uid, id);
  const shot = game?.screenshots[index];
  if (!shot) return null;
  return getBlob(BUCKET, shot.key, dataDir());
}
