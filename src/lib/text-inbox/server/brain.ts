import "server-only";

// ---------------------------------------------------------------------------
// Writing one draft, and telling the user's phone.
//
// The draft is the AI's reply in the user's voice (their tone + the replies
// they rewrote), or a short safe starter when there is no key, the daily cap
// is spent, or the call fails. Never throws — a bad network can't strand a
// text in "drafting". Nothing here sends a text: only the iPhone does that,
// after the user's Approve.
// ---------------------------------------------------------------------------

import { aiEndpoint, aiFetch, describeFailure, DEFAULT_MODEL } from "@/lib/ai/provider";
import { sendWebPush } from "@/lib/client-review/push";
import { applyDraft, cleanDraft, dropPushSubs, simpleDraft, spendDaily, systemPrompt, userPrompt, type TextDoc, type TextItem } from "../engine";
import { readTexts, updateTexts } from "./store";

const PAGE = "/apps/text-inbox";

async function aiDraft(doc: TextDoc, item: TextItem): Promise<{ draft: string; noReply: boolean; warning?: string }> {
  try {
    const res = await aiFetch({
      method: "POST",
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.5,
        max_tokens: 220,
        messages: [
          { role: "system", content: systemPrompt(doc) },
          { role: "user", content: userPrompt(doc, item) },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { draft: simpleDraft(item), noReply: false, warning: await describeFailure(res) };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const { draft, noReply } = cleanDraft(data.choices?.[0]?.message?.content ?? "");
    if (!draft && !noReply) return { draft: simpleDraft(item), noReply: false, warning: "The AI came back empty." };
    return { draft, noReply };
  } catch (e) {
    return { draft: simpleDraft(item), noReply: false, warning: e instanceof Error ? e.message : "The draft failed." };
  }
}

/** Push to every device the user allowed; drops dead subscriptions. Never throws. */
export async function notify(uid: string, message: { title: string; body: string; url: string; tag?: string }): Promise<number> {
  try {
    const doc = await readTexts(uid);
    if (!doc.pushSubs.length) return 0;
    const { sent, gone } = await sendWebPush(doc.pushSubs, message);
    if (gone.length) await updateTexts(uid, (d) => ({ doc: dropPushSubs(d, gone), out: null }));
    return sent;
  } catch (e) {
    console.error("[text-inbox] push failed:", e);
    return 0;
  }
}

/** Draft one text and store it. Safe to call twice; only a text still drafting is changed. */
export async function draftText(uid: string, id: string, opts: { tz?: string; announce?: boolean } = {}): Promise<void> {
  const doc = await readTexts(uid);
  const item = doc.items.find((i) => i.id === id);
  if (!item || item.status !== "drafting") return;
  const spent = spendDaily(doc, opts.tz);
  const useAi = Boolean(aiEndpoint()) && spent.allowed;
  const result = useAi
    ? await aiDraft(doc, item)
    : { draft: simpleDraft(item), noReply: false, warning: aiEndpoint() ? "Daily AI drafts used up — simple drafts until tomorrow." : undefined };
  if (result.warning) console.error("[text-inbox] simple draft:", result.warning);
  const note = !useAi
    ? aiEndpoint()
      ? "Simple draft — today's AI drafts are used up."
      : "Simple draft — add an AI key in Profile › Connections for drafts in your voice."
    : result.warning
      ? "Simple draft — the AI didn't answer this time. Tap Redo to try again."
      : undefined;
  const { doc: after } = await updateTexts(uid, (fresh) => {
    const counted = useAi ? { ...fresh, daily: spent.doc.daily } : fresh;
    return { doc: applyDraft(counted, id, { draft: result.draft, by: useAi && !result.warning ? "ai" : "simple", note, noReply: result.noReply }), out: null };
  });
  if (opts.announce && after.settings.notifyNew && !result.noReply) {
    const words = result.draft ? `Draft: “${result.draft.slice(0, 90)}”` : "Open Jarvis to reply.";
    await notify(uid, { title: `Text from ${item.from}`, body: `${item.text.slice(0, 80)}\n${words}`, url: PAGE, tag: `text-${id}` });
  }
}

/** Approved on the computer: buzz the phone so one tap sends it. */
export async function notifyReady(uid: string, names: string[]): Promise<number> {
  const doc = await readTexts(uid);
  if (!doc.settings.notifyReady || !names.length) return 0;
  const who = names.length === 1 ? names[0] : `${names.length} people`;
  return notify(uid, { title: "Reply ready to send", body: `Tap to send your reply to ${who}.`, url: `${PAGE}?send=1`, tag: "text-ready" });
}
