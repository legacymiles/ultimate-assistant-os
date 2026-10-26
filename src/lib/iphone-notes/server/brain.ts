import "server-only";

// ---------------------------------------------------------------------------
// Reading one note: the AI's proposals with a confidence each, or the simple
// keyword version when there is no key, the call fails, or the daily cap is
// spent. Never throws — a bad network can't strand a note in "reading".
// ---------------------------------------------------------------------------

import { aiEndpoint, aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import { applyRead, dayIn, localItems, parseItems, spendDaily, systemPrompt, userPrompt, type Note, type NoteItem } from "../engine";
import { readNotes, updateNotes } from "./store";

async function aiRead(note: Note, today: string, examples: Parameters<typeof systemPrompt>[1]): Promise<{ items: NoteItem[]; warning?: string }> {
  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.1,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(today, examples) },
          { role: "user", content: userPrompt(note) },
        ],
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) return { items: localItems(note), warning: await describeFailure(res) };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices?.[0]?.message?.content ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const items = parseItems(JSON.parse(text), "ai");
    // A model that found nothing to propose still has to leave the owner a choice.
    return { items: items.length ? items : localItems(note) };
  } catch (e) {
    return { items: localItems(note), warning: e instanceof Error ? e.message : "The read failed." };
  }
}

/** Read one note and store the proposals. Safe to call twice; the newest read wins. */
export async function readNote(uid: string, noteId: string): Promise<void> {
  const doc = await readNotes(uid);
  const note = doc.notes.find((n) => n.id === noteId);
  if (!note) return;
  const spent = spendDaily(doc);
  const useAi = Boolean(aiEndpoint()) && spent.allowed;
  const today = dayIn(doc.tz);
  const { items, warning } = useAi ? await aiRead(note, today, doc.examples) : { items: localItems(note), warning: undefined };
  if (warning) console.error("[iphone-notes] read fell back to simple mode:", warning);
  await updateNotes(uid, (fresh) => {
    // The note may have changed while the model thought: only apply to the same text.
    const still = fresh.notes.find((n) => n.id === noteId);
    if (!still || still.hash !== note.hash || still.instruction !== note.instruction) return { doc: fresh, out: null };
    const counted = useAi ? { ...fresh, daily: spent.doc.daily } : fresh;
    return { doc: applyRead(counted, noteId, items), out: null };
  });
}
