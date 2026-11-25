import { describe, expect, it } from "vitest";
import {
  DEFAULT_IDLE_STOP_MINUTES,
  costSoFar,
  elapsedHours,
  formatElapsed,
  formatRate,
  formatUsd,
  minutesUntilAutoStop,
  projectedCost,
  shouldAutoStop,
} from "./cost";

const HOUR = 3_600_000;
const MIN = 60_000;

describe("elapsedHours", () => {
  it("counts hours", () => {
    expect(elapsedHours(0, 2 * HOUR)).toBe(2);
    expect(elapsedHours(HOUR, 2.5 * HOUR)).toBe(1.5);
  });

  it("never goes negative when the clocks disagree", () => {
    expect(elapsedHours(5 * HOUR, HOUR)).toBe(0);
  });
});

describe("costSoFar", () => {
  it("multiplies the rate by the hours", () => {
    expect(costSoFar(0.44, 0, HOUR)).toBeCloseTo(0.44);
    expect(costSoFar(0.44, 0, 30 * MIN)).toBeCloseTo(0.22);
  });

  it("is zero when the rate is unknown, rather than NaN on the banner", () => {
    expect(costSoFar(0, 0, HOUR)).toBe(0);
    expect(costSoFar(Number.NaN, 0, HOUR)).toBe(0);
    expect(costSoFar(-1, 0, HOUR)).toBe(0);
  });
});

describe("projectedCost", () => {
  it("quotes what the confirm gate promises", () => {
    expect(projectedCost(0.44, 60)).toBeCloseTo(0.44);
    expect(projectedCost(0.44, 15)).toBeCloseTo(0.11);
    expect(projectedCost(2.0, 90)).toBeCloseTo(3.0);
  });

  it("treats negative minutes as none", () => {
    expect(projectedCost(0.44, -10)).toBe(0);
  });
});

describe("formatUsd", () => {
  it("says '<$0.01' rather than '$0.00' for real but tiny spend", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
  });

  it("shows exact zero as zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("rounds to cents", () => {
    expect(formatUsd(1.236)).toBe("$1.24");
  });

  it("does not print NaN at the owner", () => {
    expect(formatUsd(Number.NaN)).toBe("$0.00");
    expect(formatUsd(-5)).toBe("$0.00");
  });
});

describe("formatRate", () => {
  it("formats a known rate", () => {
    expect(formatRate(0.44)).toBe("$0.44/hr");
  });

  it("admits when it does not know", () => {
    expect(formatRate(0)).toBe("rate unknown");
    expect(formatRate(Number.NaN)).toBe("rate unknown");
  });
});

describe("formatElapsed", () => {
  it("shows minutes under an hour", () => {
    expect(formatElapsed(0, 7 * MIN)).toBe("7m");
  });

  it("pads the minutes past an hour", () => {
    expect(formatElapsed(0, HOUR + 4 * MIN)).toBe("1h 04m");
  });

  it("starts at zero", () => {
    expect(formatElapsed(HOUR, 0)).toBe("0m");
  });
});

describe("shouldAutoStop", () => {
  it("fires once the idle window has passed", () => {
    expect(shouldAutoStop(0, 15 * MIN, 15)).toBe(true);
    expect(shouldAutoStop(0, 16 * MIN, 15)).toBe(true);
  });

  it("holds while the window is open", () => {
    expect(shouldAutoStop(0, 14 * MIN, 15)).toBe(false);
  });

  it("defaults to the shared window", () => {
    expect(shouldAutoStop(0, DEFAULT_IDLE_STOP_MINUTES * MIN)).toBe(true);
  });

  it("refuses to auto-stop on a nonsense window instead of stopping instantly", () => {
    expect(shouldAutoStop(0, 10 * HOUR, 0)).toBe(false);
    expect(shouldAutoStop(0, 10 * HOUR, Number.NaN)).toBe(false);
  });
});

describe("minutesUntilAutoStop", () => {
  it("counts down", () => {
    expect(minutesUntilAutoStop(0, 0, 15)).toBe(15);
    expect(minutesUntilAutoStop(0, 10 * MIN, 15)).toBe(5);
  });

  it("floors at zero rather than going negative", () => {
    expect(minutesUntilAutoStop(0, 30 * MIN, 15)).toBe(0);
  });
});
