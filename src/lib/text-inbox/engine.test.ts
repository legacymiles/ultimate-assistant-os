import { describe, expect, it } from "vitest";
import {
  addPushSub,
  applyDraft,
  approve,
  claimReady,
  cleanAddress,
  cleanDraft,
  looksAutomated,
  decline,
  emptyDoc,
  ingest,
  normalizeDoc,
  prune,
  readIncoming,
  redo,
  sendAgain,
  simpleDraft,
  spendDaily,
  stuck,
  systemPrompt,
  threadOf,
  unapprove,
  userPrompt,
  viewItems,
  DAILY_AI_CAP,
  TextError,
  type TextDoc,
} from "./engine";

const T0 = new Date("2026-10-27T20:00:00Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

function withText(doc: TextDoc, text: string, from = "Mom", to = "+16145550100", at = T0) {
  return ingest(doc, { from, to, text }, at);
}

describe("readIncoming", () => {
  it("reads the Shortcut's JSON fields", () => {
    expect(readIncoming({ text: "you up?", from: "Mom", number: "+1 (614) 555-0100" })).toEqual({ from: "Mom", to: "+16145550100", text: "you up?", at: undefined });
  });
  it("takes the first number when Shortcuts sends a list or several lines", () => {
    expect(readIncoming({ text: "hi", from: "Al", number: ["+1 614 555 0101", "+1 614 555 0102"] })?.to).toBe("+16145550101");
    expect(readIncoming({ text: "hi", from: "Al", number: "+1 614 555 0101\n+1 614 555 0102" })?.to).toBe("+16145550101");
  });
  it("uses the sender as the address when it is a number or email", () => {
    expect(readIncoming({ text: "hi", from: "(614) 555-0199" })?.to).toBe("6145550199");
    expect(readIncoming({ text: "hi", from: "Sam@Mail.com" })?.to).toBe("sam@mail.com");
  });
  it("accepts plain text and rejects empty", () => {
    expect(readIncoming("hey")?.text).toBe("hey");
    expect(readIncoming({ text: "   " })).toBeNull();
    expect(readIncoming(null)).toBeNull();
  });
});

describe("cleanAddress", () => {
  it("keeps the + and digits", () => expect(cleanAddress("+1 (614) 555-0100")).toBe("+16145550100"));
  it("leaves a name alone", () => expect(cleanAddress("Mom")).toBe("Mom"));
});

describe("ingest", () => {
  it("adds a new text as drafting, newest first", () => {
    const a = withText(emptyDoc(), "first");
    const b = withText(a.doc, "second", "Mom", "+16145550100", later(1000));
    expect(b.out.kind).toBe("new");
    expect(b.doc.items.map((i) => i.text)).toEqual(["second", "first"]);
    expect(b.doc.items[0].status).toBe("drafting");
    expect(b.doc.lastPushAt).toBeTruthy();
  });
  it("never makes a duplicate when the Shortcut fires twice", () => {
    const a = withText(emptyDoc(), "same words");
    const b = withText(a.doc, "same words", "Mom", "+16145550100", later(30_000));
    expect(b.out.kind).toBe("same");
    expect(b.doc.items).toHaveLength(1);
  });
  it("the same words much later are a new text", () => {
    const a = withText(emptyDoc(), "ok");
    const b = withText(a.doc, "ok", "Mom", "+16145550100", later(60 * 60_000));
    expect(b.doc.items).toHaveLength(2);
  });
});

describe("drafting", () => {
  it("applyDraft moves drafting → waiting", () => {
    const { doc, out } = withText(emptyDoc(), "dinner at 7?");
    const next = applyDraft(doc, out.item.id, { draft: "Yes! See you then", by: "ai" });
    expect(next.items[0]).toMatchObject({ status: "waiting", draft: "Yes! See you then", draftBy: "ai" });
  });
  it("a draft that never came back is stuck after a while", () => {
    const { doc } = withText(emptyDoc(), "hi");
    expect(stuck(doc, T0.getTime() + 10_000)).toHaveLength(0);
    expect(stuck(doc, T0.getTime() + 5 * 60_000)).toHaveLength(1);
  });
  it("redo keeps the user's words for the next draft", () => {
    const { doc, out } = withText(emptyDoc(), "can you lend me $50");
    const waiting = applyDraft(doc, out.item.id, { draft: "Sure", by: "ai" });
    const again = redo(waiting, out.item.id, "say no but nicely");
    expect(again.items[0]).toMatchObject({ status: "drafting", instruction: "say no but nicely" });
    expect(userPrompt(again, again.items[0])).toContain("say no but nicely");
  });
  it("cleanDraft strips labels and quotes, and spots NO_REPLY", () => {
    expect(cleanDraft('Reply: "On my way!"')).toEqual({ draft: "On my way!", noReply: false });
    expect(cleanDraft("NO_REPLY")).toEqual({ draft: "", noReply: true });
  });
  it("a no-reply message is skipped straight to declined", () => {
    const { doc, out } = withText(emptyDoc(), "Your code is 482913");
    const next = applyDraft(doc, out.item.id, { draft: "", by: "ai", noReply: true });
    expect(next.items[0]).toMatchObject({ status: "declined", draft: "" });
  });
  it("looksAutomated spots codes, short codes and ads but not people", () => {
    expect(looksAutomated({ text: "Your verification code is 482913", to: "", from: "Bank" })).toBe(true);
    expect(looksAutomated({ text: "482913 is your security code", to: "", from: "Bank" })).toBe(true);
    expect(looksAutomated({ text: "hey", to: "72975", from: "72975" })).toBe(true);
    expect(looksAutomated({ text: "50% off today! Reply STOP to opt out", to: "+16145550111", from: "Store" })).toBe(true);
    expect(looksAutomated({ text: "what's the door code? 1234 didn't work", to: "+16145550100", from: "Mom" })).toBe(false);
    expect(looksAutomated({ text: "you coming at 7?", to: "+16145550100", from: "Mom" })).toBe(false);
    expect(looksAutomated({ text: "call me at 6145550100", to: "+16145550100", from: "Mom" })).toBe(false);
  });
  it("simpleDraft is short and safe", () => {
    const { out } = withText(emptyDoc(), "are you coming?");
    expect(simpleDraft(out.item)).toMatch(/get back/);
  });
  it("the daily cap stops AI drafts", () => {
    let doc = emptyDoc();
    for (let i = 0; i < DAILY_AI_CAP; i++) doc = spendDaily(doc, "UTC", T0).doc;
    expect(spendDaily(doc, "UTC", T0).allowed).toBe(false);
    expect(spendDaily(doc, "UTC", later(86_400_000)).allowed).toBe(true);
  });
});

describe("the conversation", () => {
  it("threadOf gives the earlier back-and-forth with the same person", () => {
    let doc = emptyDoc();
    const a = withText(doc, "you home?");
    doc = approve(applyDraft(a.doc, a.out.item.id, { draft: "yeah", by: "ai" }), a.out.item.id, "yeah", "phone", later(1000));
    doc = claimReady(doc, later(2000)).doc;
    const other = withText(doc, "unrelated", "Boss", "+16145550999", later(3000));
    const b = withText(other.doc, "bring milk", "Mom", "+16145550100", later(4000));
    expect(threadOf(b.doc, b.out.item)).toEqual([
      { who: "them", text: "you home?" },
      { who: "me", text: "yeah" },
    ]);
  });
  it("the system prompt carries the user's tone and rewrites", () => {
    const p = systemPrompt({ tone: "short, no emojis", examples: [{ them: "hey", draft: "Hello there!", sent: "yo" }] });
    expect(p).toContain("short, no emojis");
    expect(p).toContain("yo");
  });
});

describe("approve / decline / send", () => {
  const ready = () => {
    const { doc, out } = withText(emptyDoc(), "dinner at 7?");
    return { doc: applyDraft(doc, out.item.id, { draft: "Yes!", by: "ai" }), id: out.item.id };
  };

  it("approve moves to ready and remembers which device", () => {
    const { doc, id } = ready();
    const next = approve(doc, id, "Yes!", "computer", later(5000));
    expect(next.items[0]).toMatchObject({ status: "ready", reply: "Yes!", approvedOn: "computer", edited: false });
    expect(next.examples).toHaveLength(0);
  });
  it("an edited approve teaches the style", () => {
    const { doc, id } = ready();
    const next = approve(doc, id, "ya see u then", "phone");
    expect(next.items[0].edited).toBe(true);
    expect(next.examples).toEqual([{ them: "dinner at 7?", draft: "Yes!", sent: "ya see u then" }]);
  });
  it("an empty reply can't be approved", () => {
    const { doc, id } = ready();
    expect(() => approve(doc, id, "   ", "phone")).toThrow(TextError);
  });
  it("can't approve twice", () => {
    const { doc, id } = ready();
    const once = approve(doc, id, "Yes!", "phone");
    expect(() => approve(once, id, "Yes!", "phone")).toThrow(/already/);
  });
  it("decline and unapprove", () => {
    const { doc, id } = ready();
    expect(decline(doc, id).items[0].status).toBe("declined");
    const back = unapprove(approve(doc, id, "Yes!", "phone"), id);
    expect(back.items[0]).toMatchObject({ status: "waiting", draft: "Yes!" });
  });
  it("claimReady hands each reply over once, oldest approval first, and marks it sent", () => {
    let doc = emptyDoc();
    const a = withText(doc, "one", "A", "+1111");
    const b = withText(a.doc, "two", "B", "+2222", later(1000));
    doc = applyDraft(applyDraft(b.doc, a.out.item.id, { draft: "1", by: "ai" }), b.out.item.id, { draft: "2", by: "ai" });
    doc = approve(doc, b.out.item.id, "2", "phone", later(2000));
    doc = approve(doc, a.out.item.id, "1", "phone", later(3000));
    const first = claimReady(doc, later(4000));
    expect(first.out.map((m) => m.text)).toEqual(["2", "1"]);
    expect(first.out[0]).toMatchObject({ to: "+2222", name: "B" });
    expect(first.doc.items.every((i) => i.status === "sent")).toBe(true);
    expect(first.doc.lastCheckInAt).toBe(later(4000).toISOString());
    expect(claimReady(first.doc, later(5000)).out).toHaveLength(0);
    const again = sendAgain(first.doc, a.out.item.id);
    expect(claimReady(again).out.map((m) => m.text)).toEqual(["1"]);
  });
  it("can't unapprove once sent", () => {
    const { doc, id } = ready();
    const sent = claimReady(approve(doc, id, "Yes!", "phone")).doc;
    expect(() => unapprove(sent, id)).toThrow(/Too late/);
  });
});

describe("housekeeping", () => {
  it("prune forgets old finished texts but never waiting ones", () => {
    const old = withText(emptyDoc(), "old waiting");
    const done = withText(old.doc, "old done", "B", "+2", later(1));
    let doc = decline(done.doc, done.out.item.id);
    doc = prune(doc, later(40 * 86_400_000));
    expect(doc.items.map((i) => i.text)).toEqual(["old waiting"]);
  });
  it("normalizeDoc survives junk", () => {
    expect(normalizeDoc(null).items).toEqual([]);
    expect(normalizeDoc({ items: [{ nope: 1 }], settings: { notifyNew: false } }).settings).toEqual({ notifyNew: false, notifyReady: true });
  });
  it("push subscriptions are checked and deduped", () => {
    const sub = { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" } };
    const doc = addPushSub(addPushSub(emptyDoc(), sub), sub);
    expect(doc.pushSubs).toHaveLength(1);
    expect(() => addPushSub(emptyDoc(), { endpoint: "http://x" })).toThrow(TextError);
  });
  it("viewItems hides the hash", () => {
    const { doc } = withText(emptyDoc(), "hi");
    expect("hash" in viewItems(doc)[0]).toBe(false);
  });
});
