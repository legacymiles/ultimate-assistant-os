import { describe, expect, it } from "vitest";
import {
  addPerson,
  assignSpeaker,
  attachSummary,
  detectDenial,
  emptyDoc,
  ingest,
  isKeyPoint,
  keywords,
  leadUp,
  normalizeDoc,
  prune,
  receiptText,
  search,
  setConsent,
  stamp,
  stats,
  unnamedVoices,
  type Doc,
} from "./engine";

const T0 = new Date("2026-10-18T19:40:00Z"); // 3:40 PM in New York

function couple(opts: { herConsent?: boolean } = {}): Doc {
  let doc = emptyDoc("America/New_York");
  doc = addPerson(doc, { name: "Miles", isMe: true, consent: true }, T0).doc;
  doc = addPerson(doc, { name: "Jada", consent: opts.herConsent ?? true }, T0).doc;
  return doc;
}

function at(min: number): Date {
  return new Date(T0.getTime() + min * 60_000);
}

function say(doc: Doc, session: string, when: Date, who: "me" | "her" | "other", text: string, start = 0) {
  return ingest(doc, [{ text, is_user: who === "me", speaker: who === "other" ? "SPEAKER_02" : "SPEAKER_01", start, end: start + 2 }], {
    sessionId: session,
    now: when,
  });
}

describe("detectDenial", () => {
  it("reads the owner's example and its slang forms", () => {
    expect(detectDenial("I never called u a girl")).toEqual({ phrase: "u a girl", refersBack: false });
    expect(detectDenial("i didnt say i was leaving")?.phrase).toBe("i was leaving");
    expect(detectDenial("I ain't never told you that")?.refersBack).toBe(true);
    expect(detectDenial("When did I ever say that?")?.refersBack).toBe(true);
    expect(detectDenial("That's not what I said")?.refersBack).toBe(true);
    expect(detectDenial("I don't remember saying you were lazy")?.phrase).toBe("you were lazy");
  });

  it("leaves ordinary lines alone", () => {
    expect(detectDenial("I never go to that store")).toBeNull();
    expect(detectDenial("you said dinner at 8")).toBeNull();
    expect(detectDenial("I said what I said")).toBeNull();
  });
});

describe("keywords", () => {
  it("keeps the words that carry meaning", () => {
    expect(keywords("omg u are acting like a little girl")).toEqual(["act", "little", "girl"]);
    expect(keywords("u a girl")).toEqual(["girl"]);
  });
});

describe("the owner's example, end to end", () => {
  it("catches 'I never called u a girl' with the time and the lead-up", () => {
    let doc = couple();
    doc = say(doc, "s1", at(5), "me", "why are you yelling at me right now", 0).doc;
    doc = say(doc, "s1", at(6), "her", "because you never listen to me", 10).doc;
    doc = say(doc, "s1", at(7.1), "her", "omg u are acting like a little girl", 20).doc;

    const later = say(doc, "s2", at(12), "her", "I never called u a girl");
    expect(later.receipts).toHaveLength(1);
    const r = later.receipts[0];
    expect(r.quote).toBe("omg u are acting like a little girl");
    expect(stamp(r.quoteAt, "America/New_York")).toBe("3:47 PM 10-18-26");
    expect(receiptText(later.doc, r)).toBe(
      "Actually, at 3:47 PM 10-18-26 Jada did say: “omg u are acting like a little girl” Want the back-and-forth that led up to it?",
    );
    const replay = leadUp(later.doc, r.matchLineId).map((l) => l.text);
    expect(replay).toEqual(["why are you yelling at me right now", "because you never listen to me", "omg u are acting like a little girl"]);
  });

  it("is fair: the owner gets caught the same way", () => {
    let doc = couple();
    doc = say(doc, "s1", at(1), "me", "fine I'll pick up the kids friday", 0).doc;
    const r = say(doc, "s1", at(9), "me", "I never said I would pick up the kids", 30);
    expect(r.receipts).toHaveLength(1);
    expect(receiptText(r.doc, r.receipts[0])).toMatch(/^Heads up — at .* you did say/);
    expect(stats(r.doc).find((s) => s.personId === r.doc.people[0].id)?.receipts).toBe(1);
  });

  it("resolves 'I never said that' to what the other person just quoted", () => {
    let doc = couple();
    doc = say(doc, "s1", at(0), "her", "I'll be home by 8 tonight", 0).doc;
    doc = say(doc, "s2", at(60), "me", "you said you'd be home by 8", 0).doc;
    const r = say(doc, "s2", at(61), "her", "I never said that", 5);
    expect(r.receipts).toHaveLength(1);
    expect(r.receipts[0].quote).toBe("I'll be home by 8 tonight");
  });

  it("does not invent a receipt when nothing matches", () => {
    let doc = couple();
    doc = say(doc, "s1", at(0), "her", "you're always on your phone", 0).doc;
    expect(say(doc, "s1", at(2), "her", "I never called you a liar", 10).receipts).toHaveLength(0);
  });

  it("only checks the same person's words", () => {
    let doc = couple();
    doc = say(doc, "s1", at(0), "me", "you're acting like a little girl", 0).doc;
    expect(say(doc, "s1", at(2), "her", "I never called you a girl", 10).receipts).toHaveLength(0);
  });

  it("never writes the same receipt twice when Omi re-sends a piece", () => {
    let doc = couple();
    doc = say(doc, "s1", at(0), "her", "you're acting like a little girl", 0).doc;
    const first = say(doc, "s1", at(2), "her", "I never called you a girl", 10);
    const again = say(first.doc, "s1", at(2), "her", "I never called you a girl", 10);
    expect(again.doc.receipts).toHaveLength(1);
    expect(again.doc.lines).toHaveLength(2);
  });
});

describe("consent", () => {
  it("keeps nothing from a person who hasn't agreed", () => {
    const doc = couple({ herConsent: false });
    const r = say(doc, "s1", at(0), "her", "hello", 0);
    expect(r.doc.lines.filter((l) => l.personId)).toHaveLength(0);
    expect(r.doc.lines).toHaveLength(0);
  });

  it("withdrawing consent deletes what they said", () => {
    let doc = couple();
    doc = say(doc, "s1", at(0), "her", "you're acting like a little girl", 0).doc;
    doc = say(doc, "s1", at(1), "her", "I never called you a girl", 5).doc;
    const her = doc.people[1].id;
    const after = setConsent(doc, her, false, at(2));
    expect(after.lines.some((l) => l.personId === her)).toBe(false);
    expect(after.receipts).toHaveLength(0);
  });

  it("holds an unnamed voice so it can be named, then checks it", () => {
    let doc = couple();
    doc = addPerson(doc, { name: "Tee", consent: true }, T0).doc; // two others → no auto-assign
    doc = say(doc, "s1", at(0), "other", "you're acting like a little girl", 0).doc;
    doc = say(doc, "s1", at(1), "other", "I never called you a girl", 5).doc;
    const waiting = unnamedVoices(doc);
    expect(waiting).toHaveLength(1);
    const named = assignSpeaker(doc, waiting[0].convoId, "SPEAKER_02", doc.people[2].id, at(3));
    expect(named.receipts).toHaveLength(1);
    expect(unnamedVoices(named.doc)).toHaveLength(0);
  });

  it("drops unnamed voices after two days", () => {
    let doc = couple();
    doc = addPerson(doc, { name: "Tee", consent: true }, T0).doc;
    doc = say(doc, "s1", at(0), "other", "a stranger at the store", 0).doc;
    expect(prune(doc, at(60 * 49)).lines).toHaveLength(0);
  });

  it("recognises a saved Omi speech profile by name", () => {
    let doc = couple();
    doc = addPerson(doc, { name: "Tee", consent: true }, T0).doc;
    const r = ingest(doc, [{ text: "hi", speaker: "SPEAKER_05", speaker_name: "Jada", start: 0 }], { sessionId: "s9", now: at(0) });
    expect(r.doc.lines[0].personId).toBe(doc.people[1].id);
  });
});

describe("the rest", () => {
  it("flags key points", () => {
    expect(isKeyPoint("I promise I'll call you tomorrow")).toBe(true);
    expect(isKeyPoint("you always do this")).toBe(true);
    expect(isKeyPoint("pass the salt")).toBe(false);
  });

  it("searches newest first", () => {
    let doc = couple();
    doc = say(doc, "s1", at(0), "her", "the car payment is due", 0).doc;
    doc = say(doc, "s1", at(5), "her", "did you make the car payment", 30).doc;
    expect(search(doc, "car payment").map((l) => l.text)).toEqual(["did you make the car payment", "the car payment is due"]);
  });

  it("attaches Omi's summary to the conversation it covers", () => {
    let doc = couple();
    doc = say(doc, "s1", at(0), "her", "hello", 0).doc;
    const out = attachSummary(doc, { startedAt: at(-1).toISOString(), finishedAt: at(1).toISOString(), title: "Dinner plans", points: ["Who cooks"] });
    expect(out.convos[0].title).toBe("Dinner plans");
  });

  it("survives junk in storage", () => {
    expect(normalizeDoc(null).people).toEqual([]);
    expect(normalizeDoc({ people: [{ nope: 1 }], settings: { tz: "UTC" } }).settings.tz).toBe("UTC");
  });
});
