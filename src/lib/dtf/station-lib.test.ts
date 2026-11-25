// Tests for the print station's pure helpers (tools/dtf-print-station/lib.mjs).
// They live here, not beside the .mjs, because vitest.config.ts only collects
// src/** (plus tools/jarvis-bridge) — so these run with `npx vitest run src/lib/dtf`.

import path from "node:path";
import { describe, expect, it } from "vitest";
import * as L from "../../../tools/dtf-print-station/lib.mjs";
import { LANCELOT_M1630_PRO } from "./printers";

type Entry = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function view(over: Record<string, unknown> = {}) {
  return {
    orderId: "ord_abcd1234",
    jobId: "job_front1",
    orderNumber: "DTF-24117",
    orderCreatedAt: "2026-11-20T09:00:00.000Z",
    customerName: "Sam Rivera",
    customerNote: "",
    garment: "Studio Tee",
    colorName: "Black",
    colorHex: "#111111",
    size: "L",
    quantity: 2,
    side: "front",
    sideLabel: "Front",
    zone: "full-front",
    zoneLabel: "Full front",
    artworkWidthCm: 28,
    artworkHeightCm: 31.5,
    pressTopCm: 8,
    pressCenterOffsetCm: 0,
    file: { widthPx: 3307, heightPx: 3720, dpi: 300, widthCm: 28, heightCm: 31.5, bytes: 1_200_000, upsampled: false, minSourceDpi: 312 },
    status: "queued",
    statusLabel: "In station queue",
    productionNotes: "Press 15 s at 160 °C",
    suggestedFilename: "DTF-24117_front_28.0x31.5cm_300dpi.png",
    ...over,
  };
}

describe("ripOwns copy", () => {
  it("matches the printer profile the website uses", () => {
    expect(L.DEFAULT_RIP_OWNS).toEqual(LANCELOT_M1630_PRO.ripOwns);
  });
});

describe("file names", () => {
  it("keeps a good name", () => {
    expect(L.sanitizeFilename("DTF-24117_front_28.0x31.5cm_300dpi.png")).toBe("DTF-24117_front_28.0x31.5cm_300dpi.png");
  });

  it("strips Windows-reserved characters and traversal", () => {
    expect(L.sanitizeSegment("..\\..\\Windows")).toBe(".._.._Windows");
    expect(L.sanitizeSegment('a<b>c:d"e/f\\g|h?i*j')).toBe("a_b_c_d_e_f_g_h_i_j");
    expect(L.sanitizeSegment("..")).toBe("untitled");
    expect(L.sanitizeSegment("name. ")).toBe("name");
    expect(L.sanitizeSegment("CON")).toBe("_CON");
    expect(L.sanitizeSegment("nul.png")).toBe("_nul.png");
    expect(L.sanitizeSegment("")).toBe("untitled");
    expect(L.sanitizeSegment("x".repeat(300)).length).toBeLessThanOrEqual(120);
  });

  it("always ends in .png", () => {
    expect(L.sanitizeFilename("weird name")).toBe("weird name.png");
    expect(L.sanitizeFilename("")).toBe("print.png");
  });
});

describe("folder layout", () => {
  const root = path.resolve("/dtf/Print Jobs");

  it("files each job under its order number", () => {
    const p = L.jobPaths(root, view());
    expect(p.dir).toBe(path.join(root, "DTF-24117"));
    expect(p.png).toBe(path.join(root, "DTF-24117", "DTF-24117_front_28.0x31.5cm_300dpi.png"));
    expect(p.jobJson).toBe(path.join(root, "DTF-24117", "job.json"));
    expect(p.production).toBe(path.join(root, "DTF-24117", "PRODUCTION.txt"));
    expect(L.isInside(root, p.png)).toBe(true);
  });

  it("cannot be steered outside the export folder", () => {
    const p = L.jobPaths(root, view({ orderNumber: "../../etc", suggestedFilename: "../../x.png" }));
    expect(L.isInside(root, p.png)).toBe(true);
  });

  it("isInside rejects siblings and parents", () => {
    expect(L.isInside("C:\\DTF\\Print Jobs", "C:\\DTF\\Print Jobs2\\a.png", true)).toBe(false);
    expect(L.isInside("C:\\DTF\\Print Jobs", "C:\\DTF\\a.png", true)).toBe(false);
    expect(L.isInside("C:\\DTF\\Print Jobs", "c:\\dtf\\print jobs\\X\\a.png", true)).toBe(true);
    expect(L.isInside("/a/b", "/a/b/../c", false)).toBe(false);
    expect(L.isInside("/a/b", "/a/b/..x/c", false)).toBe(true);
  });
});

describe("transition guards", () => {
  it("mirrors the website's station moves", () => {
    expect(L.canStationReport("queued", "downloaded")).toBe(true);
    expect(L.canStationReport("queued", "printed")).toBe(false);
    expect(L.canStationReport("queued", "opened")).toBe(false);
    expect(L.canStationReport("downloaded", "opened")).toBe(true);
    expect(L.canStationReport("downloaded", "printed")).toBe(true);
    expect(L.canStationReport("opened", "opened")).toBe(true);
    expect(L.canStationReport("opened", "printed")).toBe(true);
    expect(L.canStationReport("printed", "failed")).toBe(false);
    expect(L.canStationReport("withdrawn", "printed")).toBe(false);
    expect(L.canStationReport("failed", "downloaded")).toBe(false);
  });
});

describe("state merge", () => {
  const T0 = "2026-11-21T10:00:00.000Z";
  const T1 = "2026-11-21T10:01:00.000Z";

  it("adds new jobs with the website's status", () => {
    const s = L.mergeServerJobs(L.emptyState(), [view()], T0);
    const e = s.jobs["ord_abcd1234/job_front1"] as Entry;
    expect(e.status).toBe("queued");
    expect(e.serverStatus).toBe("queued");
    expect(L.needsDownload(e)).toBe(true);
  });

  it("keeps the local status while a report is still unsent", () => {
    let s = L.mergeServerJobs(L.emptyState(), [view()], T0);
    const e = s.jobs["ord_abcd1234/job_front1"] as Entry;
    e.local = { file: "x.png" };
    e.pending.push({ status: "downloaded", at: T0 });
    e.status = "downloaded";
    s = L.mergeServerJobs(s, [view()], T1);
    const e2 = s.jobs["ord_abcd1234/job_front1"] as Entry;
    expect(e2.status).toBe("downloaded");
    expect(e2.local.file).toBe("x.png");
    expect(L.needsDownload(e2)).toBe(false);
  });

  it("marks a job the website dropped as withdrawn, unless it was finished here", () => {
    let s = L.mergeServerJobs(L.emptyState(), [view(), view({ jobId: "job_back1", side: "back" })], T0);
    (s.jobs["ord_abcd1234/job_back1"] as Entry).status = "printed";
    s = L.mergeServerJobs(s, [], T1);
    expect((s.jobs["ord_abcd1234/job_front1"] as Entry).status).toBe("withdrawn");
    expect((s.jobs["ord_abcd1234/job_back1"] as Entry).status).toBe("printed");
    expect(L.needsDownload(s.jobs["ord_abcd1234/job_front1"] as Entry)).toBe(false);
  });

  it("brings a re-queued job back and fetches it again", () => {
    let s = L.mergeServerJobs(L.emptyState(), [view({ status: "opened" })], T0);
    const e = s.jobs["ord_abcd1234/job_front1"] as Entry;
    e.local = { file: "x.png" };
    e.status = "failed";
    s = L.mergeServerJobs(s, [], T1);
    expect((s.jobs["ord_abcd1234/job_front1"] as Entry).status).toBe("failed");
    s = L.mergeServerJobs(s, [view({ status: "queued" })], T1);
    const back = s.jobs["ord_abcd1234/job_front1"] as Entry;
    expect(back.status).toBe("queued");
    expect(L.needsDownload(back)).toBe(true);
  });

  it("re-downloads a downloaded job only when this PC has no copy", () => {
    const s = L.mergeServerJobs(L.emptyState(), [view({ status: "downloaded" })], T0);
    const e = s.jobs["ord_abcd1234/job_front1"] as Entry;
    expect(L.needsDownload(e)).toBe(true);
    e.local = { file: "x.png" };
    expect(L.needsDownload(e)).toBe(false);
    e.local.redownload = true;
    expect(L.needsDownload(e)).toBe(true);
  });

  it("prunes old finished jobs but never ones with unsent reports", () => {
    let s = L.mergeServerJobs(L.emptyState(), [view(), view({ jobId: "job_2" })], T0);
    (s.jobs["ord_abcd1234/job_front1"] as Entry).status = "printed";
    const keep = s.jobs["ord_abcd1234/job_2"] as Entry;
    keep.status = "printed";
    keep.pending.push({ status: "printed", at: T0 });
    s = L.pruneState(s, Date.parse(T0) + 8 * 24 * 3600_000);
    expect(Object.keys(s.jobs)).toEqual(["ord_abcd1234/job_2"]);
  });

  it("survives a garbage state file", () => {
    expect(L.normalizeState("nope").jobs).toEqual({});
    expect(L.normalizeState({ jobs: { a: { nojob: true } }, localKey: 5 }).localKey).toBe("");
  });
});

describe("config", () => {
  it("fills defaults and trims the site address", () => {
    // The defaults are a Windows station's (C:\DTF\Print Jobs); pin win so this
    // passes on Linux CI too, where path.isAbsolute("C:\\…") is false.
    const { config, errors } = L.normalizeConfig({ siteUrl: "https://shop.example/", token: " t " }, true);
    expect(errors).toEqual([]);
    expect(config.siteUrl).toBe("https://shop.example");
    expect(config.token).toBe("t");
    expect(config.exportDir).toBe("C:\\DTF\\Print Jobs");
    expect(config.openMode).toBe("reveal");
    expect(config.pollSeconds).toBe(15);
    expect(config.port).toBe(7316);
  });

  it("explains what is wrong in plain English", () => {
    const { errors, warnings } = L.normalizeConfig({ siteUrl: "shop", openMode: "argument", port: 80, exportDir: "relative" });
    expect(errors.join(" ")).toMatch(/siteUrl/);
    expect(errors.join(" ")).toMatch(/port/);
    expect(errors.join(" ")).toMatch(/colorboxRipPath/);
    expect(errors.join(" ")).toMatch(/exportDir/);
    expect(L.normalizeConfig({ siteUrl: "http://shop.example" }).warnings[0]).toMatch(/unencrypted/);
    expect(warnings).toEqual([]);
  });

  it("checks exportDir with the station's own path rules", () => {
    const site = { siteUrl: "https://a.b" };
    expect(L.normalizeConfig({ ...site, exportDir: "C:\\DTF\\Print Jobs" }, true).errors).toEqual([]);
    expect(L.normalizeConfig({ ...site, exportDir: "/srv/dtf/jobs" }, false).errors).toEqual([]);
    expect(L.normalizeConfig({ ...site, exportDir: "C:\\DTF\\Print Jobs" }, false).errors.join(" ")).toMatch(/starts with \//);
    expect(L.normalizeConfig({ ...site, exportDir: "relative" }, true).errors.join(" ")).toMatch(/drive letter/);
  });

  it("clamps the poll interval", () => {
    expect(L.normalizeConfig({ siteUrl: "https://a.b", pollSeconds: 1 }).config.pollSeconds).toBe(5);
    expect(L.normalizeConfig({ siteUrl: "https://a.b", pollSeconds: 9999 }).config.pollSeconds).toBe(300);
  });
});

describe("backoff", () => {
  it("doubles from the poll interval and caps at five minutes", () => {
    expect(L.backoffMs(0, 15_000)).toBe(15_000);
    expect(L.backoffMs(1, 15_000)).toBe(30_000);
    expect(L.backoffMs(2, 15_000)).toBe(60_000);
    expect(L.backoffMs(10, 15_000)).toBe(300_000);
  });
});

describe("PRODUCTION.txt", () => {
  it("has everything for the printer and the press, and the RIP checklist", () => {
    const e = { job: view({ file: { ...view().file, upsampled: true }, pressCenterOffsetCm: -9.5, customerNote: "Gift" }), local: { file: "C:\\x\\a.png" } };
    const txt = L.productionText([e], LANCELOT_M1630_PRO.ripOwns, "2026-11-21T10:00:00.000Z");
    expect(txt).toContain("DTF-24117");
    expect(txt).toContain("Studio Tee");
    expect(txt).toContain("Black (#111111)");
    expect(txt).toContain("Quantity:        2");
    expect(txt).toContain("28.0 × 31.5 cm");
    expect(txt).toContain("3307 × 3720 px at 300 DPI");
    expect(txt).toContain("UPSAMPLED");
    expect(txt).toContain("9.5 cm left of centre");
    expect(txt).toContain("Press 15 s at 160 °C");
    expect(txt).toContain("Gift");
    for (const r of LANCELOT_M1630_PRO.ripOwns) expect(txt).toContain(`[ ] ${r}`);
    expect(txt).toContain("Verify the profile, white, mirror and ink limits");
    expect(txt.includes("\r\n")).toBe(true);
  });
});

describe("local page guards", () => {
  it("only answers loopback hosts on its own port", () => {
    expect(L.isLoopbackHost("127.0.0.1:7316", 7316)).toBe(true);
    expect(L.isLoopbackHost("localhost:7316", 7316)).toBe(true);
    expect(L.isLoopbackHost("evil.example:7316", 7316)).toBe(false);
    expect(L.isLoopbackHost("127.0.0.1:80", 7316)).toBe(false);
    expect(L.isLoopbackHost(undefined, 7316)).toBe(false);
  });

  it("parses cookies and checks PNG magic", () => {
    expect(L.parseCookies("a=1; dtf_station_key=abc%3D")).toEqual({ a: "1", dtf_station_key: "abc=" });
    expect(L.isPng(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(L.isPng(Buffer.from("GIF89a....."))).toBe(false);
  });

  it("percent-encodes header values Windows paths might break", () => {
    expect(L.headerSafe("C:\\DTF\\Print Jobs")).toBe("C:\\DTF\\Print Jobs");
    expect(L.headerSafe("C:\\Drucke\\Aufträge")).toBe(encodeURIComponent("C:\\Drucke\\Aufträge"));
  });
});
