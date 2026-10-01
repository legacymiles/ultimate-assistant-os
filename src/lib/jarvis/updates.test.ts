import { describe, expect, it } from "vitest";
import {
  actionUpdates,
  calendarUpdates,
  coerceUpdates,
  collectUpdates,
  defaultUpdateSettings,
  dismissUpdate,
  emptyUpdateState,
  listUpdates,
  markAllRead,
  photoUpdates,
  recordNotified,
  spendUpdates,
  toNotify,
  until,
  localDay,
  money,
  type SpendCall,
  type SpendFeed,
  type UpdateInputs,
} from "./updates";
import type { BoardPayload, ListItem } from "@/lib/recall/lists/types";
import type { CalendarEvent } from "@/lib/recall/calendar/types";
import type { Item } from "@/lib/recall/types";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");
const iso = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

function board(items: Partial<ListItem>[]): BoardPayload {
  return {
    me: { id: "me", name: "You", colour: "sky", role: "admin", joinedAt: iso(9999) },
    isAdmin: true,
    members: [
      { id: "me", name: "You", colour: "sky", role: "admin", joinedAt: iso(9999) },
      { id: "mum", name: "Mum", colour: "rose", role: "member", joinedAt: iso(9999) },
    ],
    lists: [{ id: "shopping", name: "Shopping", icon: "Cart", builtIn: true, hidden: false, order: 0 }],
    items: items.map((i, n) => ({
      id: `i${n}`,
      listId: "shopping",
      text: "milk",
      priority: null,
      done: false,
      authorId: "mum",
      createdAt: iso(10),
      updatedAt: iso(10),
      ...i,
    })) as ListItem[],
    invites: [],
    persistent: true,
  };
}

/** eventStart reads the date as a LOCAL time, so build from a local clock. */
const pad = (n: number) => String(n).padStart(2, "0");
function dentist(minsFromNow: number, id = "e1", title = "Dentist"): CalendarEvent {
  const d = new Date(NOW + minsFromNow * 60_000);
  return {
    id,
    title,
    reminders: [],
    source: "manual",
    createdAt: iso(600),
    updatedAt: iso(600),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function inputs(patch: Partial<UpdateInputs> = {}): UpdateInputs {
  return {
    board: null,
    events: [],
    items: [],
    photoFolderIds: new Set<string>(),
    proposals: [],
    actions: [],
    spend: null,
    ...patch,
  };
}

describe("listUpdates", () => {
  it("names the person who added an item", () => {
    const [u] = listUpdates(board([{ text: "oat milk" }]), false, NOW);
    expect(u.title).toBe("oat milk");
    expect(u.detail).toBe("added to Shopping");
    expect(u.who).toBe("Mum");
    expect(u.colour).toBe("rose");
  });

  it("leaves out what you added yourself unless asked", () => {
    const b = board([{ authorId: "me", text: "bread" }]);
    expect(listUpdates(b, false, NOW)).toHaveLength(0);
    expect(listUpdates(b, true, NOW)[0].who).toBe("you");
  });

  it("names nobody for a tick-off, because the board does not record who did it", () => {
    const b = board([{ done: true, completedAt: iso(5) }]);
    const done = listUpdates(b, false, NOW).find((u) => u.id.startsWith("lists:done:"));
    expect(done?.detail).toBe("ticked off in Shopping");
    expect(done?.who).toBeUndefined();
  });

  it("is stable: the same item always yields the same id", () => {
    const b = board([{ text: "milk" }]);
    expect(listUpdates(b, false, NOW)[0].id).toBe(listUpdates(b, false, NOW + 60_000)[0].id);
  });
});

describe("calendarUpdates", () => {
  const event = dentist;

  it("raises an event once it is inside the look-ahead window", () => {
    const [u] = calendarUpdates([event(40)], 3, NOW);
    expect(u.title).toBe("Dentist");
    expect(u.when).toBe("in 40m");
  });

  it("stays quiet about an event further out than the window", () => {
    expect(calendarUpdates([event(300)], 3, NOW)).toHaveLength(0);
  });

  it("drops an event once it is well underway", () => {
    expect(calendarUpdates([event(-30)], 3, NOW)).toHaveLength(0);
  });

  it("ages from the moment it entered the window, not from the start time", () => {
    // 40 minutes out with a 3h window: it became news 2h20m ago.
    const [u] = calendarUpdates([event(40)], 3, NOW);
    expect(Date.parse(u.at)).toBeLessThan(NOW);
  });
});

describe("photoUpdates", () => {
  const photo = (day: string, n: number): Item =>
    ({
      id: `p${day}${n}`,
      title: "IMG",
      kind: "image",
      folderId: "photos",
      createdAt: `${day}T09:0${n}:00.000Z`,
    }) as Item;

  it("collapses a batch into one row per day", () => {
    const rows = photoUpdates(
      [photo("2026-09-22", 1), photo("2026-09-22", 2), photo("2026-09-21", 3)],
      new Set(["photos"]),
      NOW,
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === "photos:2026-09-22")?.title).toBe("2 photos from your phone");
    expect(rows.find((r) => r.id === "photos:2026-09-21")?.title).toBe("1 photo from your phone");
  });

  it("ignores images outside the photo folders", () => {
    expect(photoUpdates([photo("2026-09-22", 1)], new Set(["other"]), NOW)).toHaveLength(0);
  });
});

describe("collectUpdates", () => {
  it("counts only what is newer than the watermark", () => {
    const state = { ...emptyUpdateState(), seenAt: iso(30) };
    const got = collectUpdates(
      inputs({ board: board([{ createdAt: iso(10) }, { createdAt: iso(90) }]) }),
      defaultUpdateSettings(),
      state,
      NOW,
    );
    expect(got.updates).toHaveLength(2);
    expect(got.unread).toBe(1);
  });

  it("clears the unread count when everything is marked read", () => {
    const before = { ...emptyUpdateState(), seenAt: iso(30) };
    const after = markAllRead(before, NOW);
    const got = collectUpdates(inputs({ board: board([{ createdAt: iso(10) }]) }), defaultUpdateSettings(), after, NOW);
    expect(got.unread).toBe(0);
  });

  it("forgets anything older than the window", () => {
    const got = collectUpdates(
      inputs({ board: board([{ createdAt: iso(20 * 24 * 60) }]) }),
      defaultUpdateSettings(),
      emptyUpdateState(),
      NOW,
    );
    expect(got.updates).toHaveLength(0);
  });

  it("honours a switched-off source", () => {
    const settings = defaultUpdateSettings();
    settings.sources.lists.on = false;
    const got = collectUpdates(inputs({ board: board([{}]) }), settings, emptyUpdateState(), NOW);
    expect(got.updates).toHaveLength(0);
  });

  it("keeps a dismissed row gone", () => {
    const first = collectUpdates(inputs({ board: board([{}]) }), defaultUpdateSettings(), emptyUpdateState(), NOW);
    const state = dismissUpdate(emptyUpdateState(), first.updates[0].id);
    const second = collectUpdates(inputs({ board: board([{}]) }), defaultUpdateSettings(), state, NOW);
    expect(second.updates).toHaveLength(0);
  });

  it("sorts newest first", () => {
    const got = collectUpdates(
      inputs({ board: board([{ createdAt: iso(60) }, { createdAt: iso(5) }]) }),
      defaultUpdateSettings(),
      emptyUpdateState(),
      NOW,
    );
    expect(Date.parse(got.updates[0].at)).toBeGreaterThan(Date.parse(got.updates[1].at));
  });

  it("puts what is about to happen above what already happened", () => {
    const got = collectUpdates(
      inputs({ board: board([{ createdAt: iso(2) }]), events: [dentist(45)] }),
      defaultUpdateSettings(),
      emptyUpdateState(),
      NOW,
    );
    // The list item is two minutes old and the appointment entered the window
    // over two hours ago, so plain recency would bury the appointment.
    expect(got.updates.map((u) => u.source)).toEqual(["calendar", "lists"]);
  });

  it("orders several upcoming things soonest first", () => {
    const got = collectUpdates(
      inputs({ events: [dentist(90, "e-late", "Late"), dentist(20, "e-soon", "Soon")] }),
      defaultUpdateSettings(),
      emptyUpdateState(),
      NOW,
    );
    expect(got.updates.map((u) => u.title)).toEqual(["Soon", "Late"]);
  });

  it("marks unread by the watermark, not by position", () => {
    const state = { ...emptyUpdateState(), seenAt: iso(30) };
    const got = collectUpdates(
      inputs({ board: board([{ createdAt: iso(5) }]), events: [dentist(45)] }),
      defaultUpdateSettings(),
      state,
      NOW,
    );
    // The appointment is pinned to the top but entered the window long before
    // the owner last looked, so only the list item is new.
    expect(got.updates[0].source).toBe("calendar");
    expect(got.unreadIds.has(got.updates[0].id)).toBe(false);
    expect(got.unread).toBe(1);
  });

  it("survives a board that could not be read", () => {
    expect(collectUpdates(inputs(), defaultUpdateSettings(), emptyUpdateState(), NOW).updates).toEqual([]);
  });
});

describe("toNotify", () => {
  const settings = () => {
    const s = defaultUpdateSettings();
    s.sources.lists.popup = true;
    return s;
  };

  it("pops up only for sources that asked for it", () => {
    const state = { ...emptyUpdateState(), seenAt: iso(30) };
    const { updates } = collectUpdates(inputs({ board: board([{ createdAt: iso(5) }]) }), settings(), state, NOW);
    expect(toNotify(updates, settings(), state)).toHaveLength(1);
    expect(toNotify(updates, defaultUpdateSettings(), state)).toHaveLength(0);
  });

  it("fires once and then never again for the same happening", () => {
    const state = { ...emptyUpdateState(), seenAt: iso(30) };
    const { updates } = collectUpdates(inputs({ board: board([{ createdAt: iso(5) }]) }), settings(), state, NOW);
    const after = recordNotified(state, toNotify(updates, settings(), state).map((u) => u.id));
    expect(toNotify(updates, settings(), after)).toHaveLength(0);
  });

  it("stays quiet about anything already seen", () => {
    const state = { ...emptyUpdateState(), seenAt: iso(1) };
    const { updates } = collectUpdates(inputs({ board: board([{ createdAt: iso(5) }]) }), settings(), state, NOW);
    expect(toNotify(updates, settings(), state)).toHaveLength(0);
  });
});

describe("actionUpdates", () => {
  it("shows only the ones still waiting", () => {
    const rows = actionUpdates(
      [
        { id: "a", tool: "t", summary: "Send it", args: {}, app: "gmail", createdAt: iso(3), status: "pending" },
        { id: "b", tool: "t", summary: "Done one", args: {}, app: "gmail", createdAt: iso(3), status: "done" },
      ],
      NOW,
    );
    expect(rows.map((r) => r.title)).toEqual(["Send it"]);
  });
});

describe("coerceUpdates", () => {
  it("gives a store written before this feature a working default", () => {
    const got = coerceUpdates(undefined);
    expect(got.settings.sources.lists.on).toBe(true);
    expect(got.settings.sources.lists.popup).toBe(false);
    expect(got.state.dismissed).toEqual([]);
  });

  it("keeps a saved preference and fills in a source added later", () => {
    const got = coerceUpdates({
      settings: { sources: { lists: { on: false, popup: true } }, includeMine: true, windowDays: 3 },
      state: { seenAt: "2026-09-01T00:00:00.000Z", dismissed: ["x"], notified: ["y"] },
    });
    expect(got.settings.sources.lists).toEqual({ on: false, popup: true });
    expect(got.settings.sources.calendar.on).toBe(true);
    expect(got.settings.includeMine).toBe(true);
    expect(got.settings.windowDays).toBe(3);
    expect(got.state.dismissed).toEqual(["x"]);
  });

  it("refuses a nonsense window rather than emptying the feed", () => {
    expect(coerceUpdates({ settings: { windowDays: 0 } }).settings.windowDays).toBe(1);
    expect(coerceUpdates({ settings: { windowDays: 9999 } }).settings.windowDays).toBe(30);
    expect(coerceUpdates({ settings: { windowDays: "soon" } }).settings.windowDays).toBe(7);
  });

  it("drops a corrupt seen watermark instead of hiding everything", () => {
    expect(Date.parse(coerceUpdates({ state: { seenAt: "nope" } }).state.seenAt)).not.toBeNaN();
  });
});

describe("until", () => {
  it("phrases the near future the way a person would", () => {
    expect(until(NOW + 40 * 60_000, NOW)).toBe("in 40m");
    expect(until(NOW + 3 * 3600_000, NOW)).toBe("in 3h");
    expect(until(NOW - 1000, NOW)).toBe("now");
  });
});

describe("spendUpdates", () => {
  const call = (over: Partial<SpendCall> = {}): SpendCall => ({
    at: new Date(NOW - 60_000).toISOString(),
    model: "qwen/qwen3.8-27b:free",
    cost: 0,
    ...over,
  });
  const feed = (over: Partial<SpendFeed> = {}): SpendFeed => ({ recent: [], account: null, ...over });

  it("says nothing at all when the ledger could not be read", () => {
    expect(spendUpdates(null, NOW)).toEqual([]);
  });

  it("names the expensive model by name, which is the row the owner asked for", () => {
    const rows = spendUpdates(
      feed({ recent: [call({ model: "anthropic/claude-opus-5", cost: 0.42, premium: true, app: "Jarvis chat" })] }),
      NOW,
    );
    const premium = rows.find((r) => r.id.startsWith("spend:premium:"));
    expect(premium?.title).toBe("OpenRouter used Claude Opus 5");
    expect(premium?.detail).toBe("$0.42 · Jarvis chat");
  });

  it("marks an estimated charge as one rather than presenting it as measured", () => {
    const rows = spendUpdates(
      feed({ recent: [call({ model: "anthropic/claude-opus-5", cost: 0.4, premium: true, estimated: true })] }),
      NOW,
    );
    expect(rows.find((r) => r.id.startsWith("spend:premium:"))?.detail).toContain("(estimated)");
  });

  it("summarises a burst instead of filling the feed with it", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      call({ at: new Date(NOW - i * 60_000).toISOString(), model: "anthropic/claude-opus-5", cost: 0.1, premium: true }),
    );
    const rows = spendUpdates(feed({ recent: many }), NOW);
    expect(rows.filter((r) => r.id.startsWith("spend:premium:"))).toHaveLength(6);
    const more = rows.find((r) => r.id.startsWith("spend:premium-more:"));
    expect(more?.title).toBe("4 more calls went to an expensive model");
  });

  it("adds up today's calls and counts the free ones", () => {
    const rows = spendUpdates(
      feed({ recent: [call(), call(), call({ cost: 0.05 }), call({ cost: 0, failed: true })] }),
      NOW,
    );
    const day = rows.find((r) => r.id.startsWith("spend:day:"));
    expect(day?.title).toBe("$0.05 on AI today");
    expect(day?.detail).toBe("4 calls · 2 free · 1 failed");
  });

  it("says so plainly when a whole day cost nothing", () => {
    const day = spendUpdates(feed({ recent: [call(), call()] }), NOW).find((r) => r.id.startsWith("spend:day:"));
    expect(day?.title).toBe("No AI spend today");
  });

  // A failed call is not a free call: it bought nothing.
  it("leaves yesterday's calls out of today's total", () => {
    const rows = spendUpdates(
      feed({ recent: [call({ at: new Date(NOW - 40 * 3600_000).toISOString(), cost: 5 }), call({ cost: 0.01 })] }),
      NOW,
    );
    expect(rows.find((r) => r.id.startsWith("spend:day:"))?.detail).toBe("1 call");
  });

  it("raises the credit row only when the account is nearly or actually empty", () => {
    const rows = (remaining: number) =>
      spendUpdates(feed({ account: { credits: 20, used: 20 - remaining, remaining } }), NOW).map((r) => r.id);
    expect(rows(10)).not.toContain("spend:credit:low");
    expect(rows(1.5)).toContain("spend:credit:low");
    expect(rows(-0.15)).toContain("spend:credit:out");
  });

  it("keeps one stable id per day, so dismissing it sticks while its number moves", () => {
    const first = spendUpdates(feed({ recent: [call({ cost: 0.01 })] }), NOW).find((r) => r.id.startsWith("spend:day:"));
    const later = spendUpdates(feed({ recent: [call({ cost: 0.01 }), call({ cost: 0.02 })] }), NOW).find((r) =>
      r.id.startsWith("spend:day:"),
    );
    expect(first!.id).toBe(later!.id);
    expect(first!.title).not.toBe(later!.title);
  });
});

describe("money and the local day", () => {
  it("shows fractions of a cent, because that is the size of most of these calls", () => {
    expect(money(0)).toBe("$0");
    expect(money(0.0004)).toBe("$0.0004");
    expect(money(0.42)).toBe("$0.42");
    expect(money(0.4257)).toBe("$0.426");
    expect(money(12.5)).toBe("$12.50");
  });

  // The reason the ledger hands over raw calls: a UTC bucket would file an
  // evening call under tomorrow for anyone west of Greenwich.
  it("buckets on the browser's own calendar day", () => {
    const local = new Date(2026, 8, 30, 23, 30);
    expect(localDay(local.toISOString())).toBe("2026-09-30");
  });
});
