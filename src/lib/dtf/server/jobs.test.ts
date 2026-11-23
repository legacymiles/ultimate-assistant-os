import { describe, expect, it } from "vitest";
import type { Order, PrintJob, PrintJobStatus } from "../types";
import { applyJobStatus, canJobMove, stationJobsFrom, stationJobView, suggestedFilename } from "./jobs";
import { HttpError } from "./access";

const ALL: PrintJobStatus[] = ["awaiting_approval", "file_ready", "queued", "downloaded", "opened", "printed", "failed"];

const ALLOWED = new Set([
  "file_ready>queued",
  "file_ready>printed",
  "queued>file_ready",
  "queued>downloaded",
  "queued>failed",
  "downloaded>opened",
  "downloaded>printed",
  "downloaded>failed",
  "opened>printed",
  "opened>failed",
  "failed>queued",
]);

function job(over: Partial<PrintJob> = {}): PrintJob {
  return {
    id: "job_front1",
    orderId: "ord_abcd1234",
    orderNumber: "DTF-24117",
    itemId: "item_1",
    side: "front",
    zoneId: "full-front",
    artworkWidthCm: 28,
    artworkHeightCm: 31.5,
    pressTopCm: 8,
    pressCenterOffsetCm: 0,
    status: "queued",
    file: {
      key: "production/ord_abcd1234/job_front1.png",
      widthPx: 3307,
      heightPx: 3720,
      dpi: 300,
      widthCm: 28,
      heightCm: 31.5,
      bytes: 1_200_000,
      createdAt: "2026-11-20T10:00:00.000Z",
      upsampled: false,
      minSourceDpi: 312,
    },
    ...over,
  };
}

function order(jobs: PrintJob[], over: Partial<Order> = {}): Order {
  return {
    id: "ord_abcd1234",
    number: "DTF-24117",
    userId: "u1",
    email: "a@b.c",
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    status: "print_ready",
    payment: { state: "paid", method: "manual", amountCents: 3000, currency: "usd" },
    items: [
      {
        id: "item_1",
        project: {} as Order["items"][number]["project"],
        garmentId: "tee",
        colorId: "black",
        size: "L",
        quantity: 2,
        unitCents: 1500,
        mockups: {},
      },
    ],
    jobs,
    shipping: { method: "pickup", name: "Sam Rivera" },
    productionNotes: "Press 15 s",
    history: [],
    ...over,
  };
}

describe("canJobMove", () => {
  it("allows exactly the documented transitions", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canJobMove(from, to), `${from} -> ${to}`).toBe(ALLOWED.has(`${from}>${to}`));
      }
    }
  });

  it("never lets software skip straight from queue to printed", () => {
    expect(canJobMove("queued", "printed")).toBe(false);
    expect(canJobMove("queued", "opened")).toBe(false);
  });

  it("treats printed as final", () => {
    for (const to of ALL) expect(canJobMove("printed", to)).toBe(false);
  });
});

describe("applyJobStatus", () => {
  const now = new Date("2026-11-21T12:00:00.000Z");

  it("stamps the download path and logs it", () => {
    const o = order([job()]);
    const r = applyJobStatus(o, "job_front1", "downloaded", "station", { path: "C:\\DTF\\Print Jobs\\DTF-24117\\a.png" }, now);
    expect(r.changed).toBe(true);
    expect(r.job.status).toBe("downloaded");
    expect(r.job.exportedAt).toBe(now.toISOString());
    expect(r.job.stationPath).toBe("C:\\DTF\\Print Jobs\\DTF-24117\\a.png");
    expect(o.history.at(-1)?.message).toMatch(/saved on the print station/);
  });

  it("moves the order to printing when a job is opened, and to heat transfer when all are printed", () => {
    const o = order([job({ status: "downloaded" })]);
    applyJobStatus(o, "job_front1", "opened", "station", {}, now);
    expect(o.status).toBe("printing");
    expect(o.history.some((e) => e.kind === "status")).toBe(true);
    applyJobStatus(o, "job_front1", "printed", "station", {}, now);
    expect(o.status).toBe("heat_transfer");
    expect(o.jobs[0].printedAt).toBe(now.toISOString());
  });

  it("is a no-op for a repeated report", () => {
    const o = order([job({ status: "opened" })]);
    const r = applyJobStatus(o, "job_front1", "opened", "station", {}, now);
    expect(r.changed).toBe(false);
    expect(o.history).toHaveLength(0);
  });

  it("refuses an illegal move with a 409", () => {
    const o = order([job({ status: "queued" })]);
    expect(() => applyJobStatus(o, "job_front1", "printed", "station")).toThrow(HttpError);
    try {
      applyJobStatus(o, "job_front1", "printed", "station");
    } catch (e) {
      expect((e as HttpError).status).toBe(409);
    }
  });

  it("404s an unknown job", () => {
    const o = order([job()]);
    expect(() => applyJobStatus(o, "nope", "downloaded", "station")).toThrow(/no print job/);
  });

  it("records the problem text and clears it on re-queue", () => {
    const o = order([job({ status: "opened", openedAt: "x" })]);
    applyJobStatus(o, "job_front1", "failed", "station", { error: "Head strike\non white" }, now);
    expect(o.jobs[0].error).toBe("Head strike on white");
    applyJobStatus(o, "job_front1", "queued", "owner", {}, now);
    expect(o.jobs[0].status).toBe("queued");
    expect(o.jobs[0].error).toBeUndefined();
    expect(o.jobs[0].openedAt).toBeUndefined();
  });

  it("will not queue a job that has no file", () => {
    const o = order([job({ status: "file_ready", file: undefined })]);
    expect(() => applyJobStatus(o, "job_front1", "queued", "owner")).toThrow(/no print file/);
  });

  it("closes a cancelled order's jobs except to fail or unqueue them", () => {
    const o = order([job({ status: "queued" })], { status: "cancelled" });
    expect(() => applyJobStatus(o, "job_front1", "downloaded", "station")).toThrow(/cancelled/);
    expect(applyJobStatus(o, "job_front1", "file_ready", "owner").changed).toBe(true);
  });
});

describe("station views", () => {
  it("names the file like DTF-24117_front_28.0x31.5cm_300dpi.png", () => {
    const o = order([job()]);
    expect(suggestedFilename(o, o.jobs[0])).toBe("DTF-24117_front_28.0x31.5cm_300dpi.png");
  });

  it("numbers twins so one print never overwrites another", () => {
    const o = order([job(), job({ id: "job_front2", itemId: "item_2" })]);
    expect(suggestedFilename(o, o.jobs[0])).toBe("DTF-24117_front_28.0x31.5cm_300dpi_1.png");
    expect(suggestedFilename(o, o.jobs[1])).toBe("DTF-24117_front_28.0x31.5cm_300dpi_2.png");
  });

  it("flattens garment, colour and press data", () => {
    const o = order([job()]);
    const v = stationJobView(o, o.jobs[0]);
    expect(v.customerName).toBe("Sam Rivera");
    expect(v.garment).toBe("Studio Tee");
    expect(v.colorHex).toMatch(/^#/);
    expect(v.zoneLabel).toBe("Full front");
    expect(v.sideLabel).toBe("Front");
    expect(v.quantity).toBe(2);
    expect(v.file?.dpi).toBe(300);
    expect(v).not.toHaveProperty("file.key");
  });

  it("lists only active jobs on live orders, oldest first", () => {
    const newer = order([job({ id: "job_n" })], { id: "ord_newer123", number: "DTF-24120", createdAt: "2026-11-21T00:00:00.000Z" });
    const older = order([job({ id: "job_o", status: "opened" }), job({ id: "job_p", status: "printed" })], { createdAt: "2026-11-19T00:00:00.000Z" });
    const dead = order([job({ id: "job_c" })], { id: "ord_cancel12", status: "cancelled" });
    const ids = stationJobsFrom([newer, dead, older]).map((v) => v.jobId);
    expect(ids).toEqual(["job_o", "job_n"]);
  });
});
