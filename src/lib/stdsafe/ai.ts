// ---------------------------------------------------------------------------
// STD Safe — optional AI assist for reading a report.
//
// The heuristic parser in parse.ts is the default path and works with no key.
// The model is here for the case the parser genuinely cannot cover: a phone
// photo or a screenshot, which has no text layer to read at all.
//
// Everything this returns still lands on the review screen. The model is a
// faster first draft, never an authority — the same rule the parser follows.
//
// Node runtime only.
// ---------------------------------------------------------------------------

import { INFECTIONS, type InfectionId, type Outcome, type Result } from "./types";
import { DEFAULT_MODEL, aiKey as providerKey, aiUrl } from "@/lib/ai/provider";
import { emptyDraft, toIsoDate, type ParsedDraft } from "./parse";

const GATEWAY = aiUrl();

/** Re-exported so existing callers keep their import. */
export function aiKey(): string {
  return providerKey();
}

const INSTRUCTIONS = [
  "You transcribe STD/STI lab reports into JSON. Transcribe only — never infer a",
  "result that is not printed, and never fill a gap with a plausible value.",
  "",
  "Return ONLY a JSON object:",
  '{"lab":string,"panelName":string,"collectedAt":"YYYY-MM-DD","reportedAt":"YYYY-MM-DD",',
  '"results":[{"infection":ID,"outcome":"negative"|"positive"|"indeterminate","value":string}]}',
  "",
  `Valid ID values: ${INFECTIONS.map((i) => i.id).join(", ")}.`,
  "",
  "Rules:",
  "- Read the RESULT column, never the reference range. A row reading",
  '  "REACTIVE ... Reference Range: Non Reactive" is POSITIVE.',
  '- "Non-reactive" / "Not detected" / "Negative" -> negative.',
  '- "Reactive" / "Detected" / "Positive" -> positive.',
  '- "Equivocal" / "Indeterminate" / "Invalid" -> indeterminate.',
  "- collectedAt is the date the SAMPLE was taken, not the print or birth date.",
  "- Omit any infection the report does not test. An omitted test is correct;",
  "  a guessed one is not.",
  '- value is the literal words printed, e.g. "Non Reactive".',
].join("\n");

/** Strip a ```json fence if the model added one. */
function readJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : content).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

const VALID_IDS = new Set<string>(INFECTIONS.map((i) => i.id));
const VALID_OUTCOMES = new Set<string>(["negative", "positive", "indeterminate"]);

/**
 * Keep only rows that name a real infection and a real outcome.
 *
 * A model that invents an eleventh test or an outcome of "maybe" should lose
 * that row, not poison the draft.
 */
function cleanResults(raw: unknown): Result[] {
  if (!Array.isArray(raw)) return [];
  const out: Result[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const infection = String(r.infection ?? "");
    const outcome = String(r.outcome ?? "");
    if (!VALID_IDS.has(infection) || !VALID_OUTCOMES.has(outcome) || seen.has(infection)) continue;
    seen.add(infection);
    out.push({
      infection: infection as InfectionId,
      outcome: outcome as Outcome,
      value: typeof r.value === "string" ? r.value.slice(0, 60) : undefined,
    });
  }
  return out;
}

async function callGateway(messages: unknown[], key: string): Promise<ParsedDraft | null> {
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, messages }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const parsed = readJson(String(data?.choices?.[0]?.message?.content ?? ""));
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const collectedAt = toIsoDate(String(obj.collectedAt ?? ""));
  const reportedAt = toIsoDate(String(obj.reportedAt ?? ""));
  return {
    lab: typeof obj.lab === "string" ? obj.lab.slice(0, 60) : "",
    panelName: typeof obj.panelName === "string" ? obj.panelName.slice(0, 60) : "",
    collectedAt,
    reportedAt: reportedAt && reportedAt !== collectedAt ? reportedAt : undefined,
    results: cleanResults(obj.results),
    ambiguous: [],
    source: "vision",
  };
}

/** Read a photo or screenshot of a report. Null when there is no key or it fails. */
export async function visionDraft(file: File): Promise<ParsedDraft | null> {
  const key = aiKey();
  if (!key) return null;
  try {
    const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const dataUrl = `data:${file.type || "image/jpeg"};base64,${b64}`;
    return await callGateway(
      [
        { role: "system", content: INSTRUCTIONS },
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this lab report." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      key,
    );
  } catch {
    return null;
  }
}

/**
 * Second pass over PDF text the heuristic parser struggled with.
 *
 * Only worth spending a call on when the parser came back thin, so the caller
 * decides. Returns null on any failure, and the heuristic draft stands.
 */
export async function textDraft(text: string): Promise<ParsedDraft | null> {
  const key = aiKey();
  if (!key) return null;
  try {
    return await callGateway(
      [
        { role: "system", content: INSTRUCTIONS },
        { role: "user", content: `Lab report text:\n\n${text.slice(0, 24_000)}` },
      ],
      key,
    );
  } catch {
    return null;
  }
}

/** Merge an AI draft over a heuristic one, preferring whichever read more. */
export function mergeDrafts(base: ParsedDraft, extra: ParsedDraft | null): ParsedDraft {
  if (!extra) return base;
  const merged: ParsedDraft = {
    lab: base.lab || extra.lab,
    panelName: base.panelName || extra.panelName,
    collectedAt: base.collectedAt || extra.collectedAt,
    reportedAt: base.reportedAt || extra.reportedAt,
    results: [...base.results],
    ambiguous: base.ambiguous,
    source: base.results.length >= extra.results.length ? base.source : extra.source,
  };
  // The heuristic read the actual characters on the page, so where both saw a
  // test, the heuristic wins. The model only fills gaps.
  for (const row of extra.results) {
    if (!merged.results.some((r) => r.infection === row.infection)) merged.results.push(row);
  }
  return merged;
}

export { emptyDraft };
