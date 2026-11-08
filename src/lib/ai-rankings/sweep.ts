// ---------------------------------------------------------------------------
// AI Rankings — the daily new-release sweep.
//
// Reads Hugging Face's trending list for each category's pipeline tags and
// turns the genuinely new, genuinely noticed releases into inbox suggestions.
// It never touches the public board: the owner approves each one.
//
// The filter is the whole job. Trending is full of quantisations, fine-tunes
// and re-uploads of last month's model, and an inbox of forty GGUFs gets
// ignored by day three. So a suggestion has to be (a) an original — no
// base_model:quantized/finetune/adapter/merge tag, no quant suffix — (b) made
// in the last 45 days, (c) past the category's likes bar, and (d) not already
// on the board, in the inbox, or dismissed.
// ---------------------------------------------------------------------------

import { CATEGORIES, findExisting } from "./leaderboard";
import type { InboxItem, PublicBoard } from "./leaderboard";

/** The fields of an HF /api/models list item this uses. */
export interface HfModel {
  id: string;
  likes?: number;
  downloads?: number;
  trendingScore?: number;
  createdAt?: string;
  tags?: string[];
  pipeline_tag?: string;
  private?: boolean;
}

export const SWEEP_MAX_AGE_DAYS = 45;
const PER_PIPELINE = 60;

const DERIVED_TAG = /^base_model:(quantized|finetune|adapter|merge):/;
const QUANT_NAME = /(gguf|gptq|awq|exl2|mlx|bnb|[-_.](int|q)?[2-8]bit|[-_.]fp8|[-_.]nf4|lora)\b/i;
const QUANT_OWNERS = new Set(["mlx-community", "unsloth", "thebloke", "bartowski", "lmstudio-community"]);

/**
 * A lab tuning ITS OWN earlier model (Audio8-TTS-Realistic on top of
 * Audio8-TTS-Preview, same org) is a new release, not a copy — only a
 * derivative of someone else's model is skipped.
 */
export function isOriginal(m: HfModel): boolean {
  if (m.private) return false;
  const [owner, repo = ""] = m.id.split("/");
  const me = owner.toLowerCase();
  for (const t of m.tags ?? []) {
    if (!DERIVED_TAG.test(t)) continue;
    const baseOwner = t.replace(DERIVED_TAG, "").split("/")[0]?.toLowerCase();
    if (baseOwner !== me) return false;
  }
  if (QUANT_OWNERS.has(me)) return false;
  return !QUANT_NAME.test(repo);
}

export function licenseOf(tags: string[] | undefined): string | undefined {
  const t = (tags ?? []).find((x) => x.startsWith("license:"));
  return t ? t.slice("license:".length) : undefined;
}

export function hfUrl(pipeline: string): string {
  const q = new URLSearchParams({
    pipeline_tag: pipeline,
    sort: "trendingScore",
    direction: "-1",
    limit: String(PER_PIPELINE),
  });
  // expand[] is repeated, so it is appended rather than set.
  for (const f of ["likes", "downloads", "trendingScore", "createdAt", "tags", "pipeline_tag"]) {
    q.append("expand[]", f);
  }
  return `https://huggingface.co/api/models?${q}`;
}

/**
 * Turn one pipeline's trending list into new inbox items. Pure: everything it
 * needs is passed in, so it is tested against recorded responses.
 */
export function suggestionsFrom(
  list: HfModel[],
  pipeline: string,
  categoryId: string,
  board: PublicBoard,
  now: number,
  seen: Set<string>,
): InboxItem[] {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return [];
  const dismissed = new Set(board.dismissed.map((d) => d.toLowerCase()));
  const inInbox = new Set(board.inbox.map((i) => i.hfId.toLowerCase()));
  const out: InboxItem[] = [];

  for (const m of list) {
    const key = m.id.toLowerCase();
    if (seen.has(key) || dismissed.has(key) || inInbox.has(key)) continue;
    if (!isOriginal(m)) continue;
    if ((m.likes ?? 0) < cat.minLikes) continue;
    const created = m.createdAt ? new Date(m.createdAt).getTime() : NaN;
    if (Number.isNaN(created) || now - created > SWEEP_MAX_AGE_DAYS * 864e5) continue;
    const [maker, repo] = m.id.split("/");
    const url = `https://huggingface.co/${m.id}`;
    if (findExisting(board.models, { hfId: m.id, url, name: repo })) continue;

    seen.add(key);
    out.push({
      id: `hf:${m.id}`,
      hfId: m.id,
      name: repo ?? m.id,
      maker: maker ?? "",
      category: categoryId,
      url,
      releasedAt: new Date(created).toISOString().slice(0, 10),
      likes: m.likes ?? 0,
      downloads: m.downloads ?? 0,
      license: licenseOf(m.tags),
      pipeline,
      foundAt: new Date(now).toISOString(),
    });
  }
  return out;
}

export interface SweepResult {
  added: InboxItem[];
  /** Pipelines that could not be read, so the note can say so. */
  failed: string[];
  checked: number;
}

/** Fetch every category's feeds and collect new suggestions. */
export async function runSweep(
  board: PublicBoard,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<SweepResult> {
  const seen = new Set<string>();
  const added: InboxItem[] = [];
  const failed: string[] = [];
  let checked = 0;

  const jobs = CATEGORIES.flatMap((c) => c.hfPipelines.map((p) => ({ c, p })));
  const results = await Promise.all(
    jobs.map(async ({ c, p }) => {
      try {
        const res = await fetcher(hfUrl(p), {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(String(res.status));
        return { c, p, list: (await res.json()) as HfModel[] };
      } catch {
        return { c, p, list: null };
      }
    }),
  );

  // Processed in category order, after every fetch is back, so one model
  // listed under two pipelines lands in the first category that claims it.
  for (const { c, p, list } of results) {
    if (!list || !Array.isArray(list)) {
      failed.push(p);
      continue;
    }
    checked += list.length;
    added.push(...suggestionsFrom(list, p, c.id, board, now, seen));
  }
  return { added, failed, checked };
}

/** Newest release first, and never more than this many waiting. */
export const INBOX_CAP = 120;

export function mergeInbox(board: PublicBoard, added: InboxItem[]): InboxItem[] {
  return [...added, ...board.inbox]
    .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt) || b.likes - a.likes)
    .slice(0, INBOX_CAP);
}
