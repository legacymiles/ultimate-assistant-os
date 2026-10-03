import { describe, expect, it } from "vitest";
import { coerceRecord } from "./coerce";
import {
  addFile,
  anySensitive,
  dataUrlBytes,
  describeFile,
  droppedBy,
  evidenceFor,
  fileById,
  formatBytes,
  looksLikeDocument,
  MAX_FILES,
  provesWhat,
  removeFile,
  type RecordFile,
} from "./files";
import { emptyRecord } from "./types";

const file = (patch: Partial<RecordFile> = {}): RecordFile => ({
  id: "f1",
  label: "Insurance card",
  mime: "image/jpeg",
  bytes: 240_000,
  addedAt: "2026-10-02T12:00:00.000Z",
  source: "jarvis",
  origin: "read off your screen",
  evidenceFor: ["insurance_carrier", "insurance_member_id"],
  sensitive: true,
  where: "synced",
  ...patch,
});

describe("only documents are worth keeping", () => {
  it("knows an insurance card when it sees one", () => {
    const g = looksLikeDocument(["insurance_carrier", "insurance_member_id", "insurance_group"]);
    expect(g?.label).toBe("Insurance card");
  });

  it("will not call a name and a date of birth an identity document", () => {
    // They are on nearly every page the owner will ever scan. Place of birth
    // is what a passport shows and a web form does not ask for.
    expect(looksLikeDocument(["legal_first", "legal_last", "dob"])).toBeNull();
    expect(looksLikeDocument(["legal_first", "legal_last", "dob", "birthplace"])?.label).toBe("Identity document");
  });

  it("offers NOTHING for an ordinary page", () => {
    // The whole feature turns into a camera roll nobody opens if this returns
    // a document for a page that merely had a name and an email on it.
    expect(looksLikeDocument(["legal_first", "email"])).toBeNull();
    expect(looksLikeDocument([])).toBeNull();
    expect(looksLikeDocument(["desired_title", "schedule"])).toBeNull();
  });

  it("does not call one stray field a document", () => {
    // A blood type mentioned on a page is a sentence; a blood type AND an
    // allergy list is a medical record.
    expect(looksLikeDocument(["blood_type"])).toBeNull();
    expect(looksLikeDocument(["blood_type", "allergies"])?.label).toBe("Medical record");
  });

  it("makes an exception only for keys that appear on the card and nowhere else", () => {
    expect(looksLikeDocument(["ssn"])?.label).toBe("Social Security card");
    expect(looksLikeDocument(["medicaid_id"])?.label).toBe("Medicaid card");
  });

  it("calls a card that yields a blood type an insurance card, not a medical record", () => {
    // Most specific wins. The ordering of the table IS the ranking.
    const g = looksLikeDocument(["insurance_member_id", "blood_type", "allergies"]);
    expect(g?.label).toBe("Insurance card");
  });

  it("credits the picture with everything on it, not just the keys that identified it", () => {
    const g = looksLikeDocument(["insurance_carrier", "insurance_member_id", "blood_type"]);
    expect(g?.keys).toContain("blood_type");
  });

  it("reads group keys too", () => {
    expect(looksLikeDocument(["jobs.employer", "monthly_gross", "pay_frequency"])?.label).toBe("Pay stub");
  });
});

describe("the picture inherits the worst secret on it", () => {
  it("is sensitive when any value read off it is", () => {
    // A member ID is masked in the Record. A photograph of the card that
    // rendered openly beside the masked field would make the masking theatre.
    expect(looksLikeDocument(["insurance_carrier", "insurance_member_id"])?.sensitive).toBe(true);
  });

  it("is not sensitive when nothing on it is", () => {
    expect(looksLikeDocument(["blood_type", "allergies"])?.sensitive).toBe(false);
  });

  it("treats an unknown key as sensitive rather than as safe", () => {
    expect(anySensitive(["not_a_real_key"])).toBe(true);
    expect(anySensitive(["blood_type"])).toBe(false);
  });
});

describe("the record's files", () => {
  it("adds, finds and removes", () => {
    let r = addFile(emptyRecord(), file());
    expect(fileById(r, "f1")?.label).toBe("Insurance card");
    r = removeFile(r, "f1");
    expect(r.files).toHaveLength(0);
  });

  it("puts the newest first and never duplicates an id", () => {
    let r = addFile(emptyRecord(), file({ id: "a" }));
    r = addFile(r, file({ id: "b", label: "Pay stub" }));
    r = addFile(r, file({ id: "a", label: "Insurance card v2" }));
    expect(r.files!.map((f) => f.id)).toEqual(["a", "b"]);
    expect(r.files![0].label).toBe("Insurance card v2");
  });

  it("caps the pile, and says which bytes are now orphaned", () => {
    let r = emptyRecord();
    for (let i = 0; i < MAX_FILES; i += 1) r = addFile(r, file({ id: `f${i}` }));
    expect(r.files).toHaveLength(MAX_FILES);

    // Without this the bytes of a dropped file would sit in storage forever,
    // paid for and unreachable.
    const before = addFile(r, file({ id: "newest" }));
    expect(droppedBy(r, before).map((f) => f.id)).toEqual(["f0"]);
  });

  it("answers 'says who?' for a field", () => {
    const r = addFile(addFile(emptyRecord(), file({ id: "a" })), file({ id: "b", evidenceFor: ["blood_type"] }));
    expect(evidenceFor(r, "insurance_member_id").map((f) => f.id)).toEqual(["a"]);
    expect(evidenceFor(r, "legal_last")).toEqual([]);
  });
});

describe("reading a stored record back without trusting it", () => {
  it("keeps a good file", () => {
    const r = coerceRecord({ files: [file()] });
    expect(r.files).toHaveLength(1);
    expect(r.files![0].evidenceFor).toEqual(["insurance_carrier", "insurance_member_id"]);
  });

  it("drops junk rather than crashing", () => {
    const r = coerceRecord({ files: [null, { id: "" }, { id: "x", mime: "application/pdf" }, "nope", file()] });
    expect(r.files!.map((f) => f.id)).toEqual(["f1"]);
  });

  it("treats a file of unknown sensitivity as sensitive", () => {
    // The failure modes are not symmetric: hiding one that did not need it
    // costs a click, revealing one that did is the whole point of the flag.
    expect(coerceRecord({ files: [{ ...file(), sensitive: undefined }] }).files![0].sensitive).toBe(true);
  });

  it("drops evidence keys that no longer name anything", () => {
    const r = coerceRecord({ files: [file({ evidenceFor: ["insurance_carrier", "retired_key"] })] });
    expect(r.files![0].evidenceFor).toEqual(["insurance_carrier"]);
  });

  it("reads a record written before files existed", () => {
    expect(coerceRecord({ fields: {}, groups: {} }).files).toEqual([]);
  });
});

describe("words", () => {
  it("names what a picture proves, in the Record's own labels", () => {
    expect(provesWhat(file())).toBe("Insurance carrier, Member ID");
  });

  it("stops listing rather than running off the row", () => {
    const many = file({ evidenceFor: ["insurance_carrier", "insurance_member_id", "insurance_group", "insurance_plan", "blood_type"] });
    expect(provesWhat(many, 3)).toContain("and 2 more");
  });

  it("says where the bytes are, because it varies", () => {
    expect(describeFile(file())).toBe("read off your screen · 234 KB · on your account");
    expect(describeFile(file({ where: "device" }))).toContain("this device only");
  });

  it("sizes", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(240_000)).toBe("234 KB");
    expect(formatBytes(2_400_000)).toBe("2.3 MB");
  });

  it("measures a data URL without decoding it", () => {
    const bytes = dataUrlBytes("data:image/jpeg;base64,AAAA");
    expect(bytes).toBe(3);
    expect(dataUrlBytes("nonsense")).toBe(0);
  });
});
