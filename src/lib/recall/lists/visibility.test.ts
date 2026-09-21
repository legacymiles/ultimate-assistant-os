import { describe, expect, it } from "vitest";
import {
  canSee,
  findVisible,
  patchVerdict,
  visibleItems,
  type ListItem,
  type Viewer,
} from "./types";

// The private/public rule is enforced in the store by these pure helpers, so
// testing them tests the enforcement — without the file/Supabase doc store.

const ADMIN: Viewer = { isAdmin: true, memberId: "admin" };
const MUM: Viewer = { isAdmin: false, memberId: "mem_mum" };
const KID: Viewer = { isAdmin: false, memberId: "mem_kid" };

function item(id: string, authorId: string, priv?: boolean): ListItem {
  return {
    id,
    listId: "todo",
    text: id,
    priority: null,
    done: false,
    authorId,
    ...(priv === undefined ? {} : { private: priv }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const board = [
  item("mum-public", "mem_mum", false),
  item("mum-private", "mem_mum", true),
  item("admin-public", "admin", false),
  item("admin-private", "admin", true),
  item("legacy", "mem_kid"), // written before the field existed
];

const ids = (v: Viewer) => visibleItems(board, v).map((i) => i.id);

describe("owner rule 1 — a member can hide their own entry from other members", () => {
  it("the author still sees it", () => {
    expect(ids(MUM)).toContain("mum-private");
  });
  it("other members do not", () => {
    expect(ids(KID)).not.toContain("mum-private");
    expect(canSee(board[1], KID)).toBe(false);
  });
});

describe("owner rule 2 — the admin always sees everything", () => {
  it("including members' private entries", () => {
    expect(ids(ADMIN)).toEqual(board.map((i) => i.id));
  });
});

describe("owner rule 3 — an admin-private entry is seen by no one else", () => {
  it("hidden from every member", () => {
    expect(ids(MUM)).not.toContain("admin-private");
    expect(ids(KID)).not.toContain("admin-private");
  });
  it("visible to the admin", () => {
    expect(ids(ADMIN)).toContain("admin-private");
  });
});

describe("owner rule 4 — admin entries can be public", () => {
  it("members see a public admin entry", () => {
    expect(ids(MUM)).toContain("admin-public");
    expect(ids(KID)).toContain("admin-public");
  });
});

describe("legacy items with no `private` field", () => {
  it("are public to everyone", () => {
    for (const v of [ADMIN, MUM, KID]) expect(ids(v)).toContain("legacy");
  });
});

describe("full view per member", () => {
  it("a member sees public items plus their own private ones", () => {
    expect(ids(KID)).toEqual(["mum-public", "admin-public", "legacy"]);
    expect(ids(MUM)).toEqual(["mum-public", "mum-private", "admin-public", "legacy"]);
  });
});

describe("mutating an item you cannot see", () => {
  it("findVisible treats an invisible item as missing", () => {
    expect(findVisible(board, "mum-private", KID)).toBeUndefined();
    expect(findVisible(board, "admin-private", MUM)).toBeUndefined();
    expect(findVisible(board, "mum-private", ADMIN)?.id).toBe("mum-private");
    expect(findVisible(board, "nope", ADMIN)).toBeUndefined();
  });

  it("ticking someone else's private item is 'gone' (404), not allowed", () => {
    expect(patchVerdict(board[1], ["done"], KID)).toBe("gone");
    expect(patchVerdict(board[3], ["done"], MUM)).toBe("gone");
  });

  it("editing or un-privating someone else's private item is 'gone', not 'forbidden'", () => {
    // 'forbidden' would confirm the row exists; 'gone' reveals nothing.
    expect(patchVerdict(board[1], ["private"], KID)).toBe("gone");
    expect(patchVerdict(board[1], ["text"], KID)).toBe("gone");
  });

  it("a missing item is 'gone'", () => {
    expect(patchVerdict(undefined, ["done"], ADMIN)).toBe("gone");
  });
});

describe("patch permissions on visible items", () => {
  it("anyone who can see an item may tick it", () => {
    expect(patchVerdict(board[0], ["done"], KID)).toBe("ok");
    expect(patchVerdict(board[2], ["done"], MUM)).toBe("ok");
  });

  it("only the author or admin may change `private`", () => {
    expect(patchVerdict(board[0], ["private"], KID)).toBe("forbidden");
    expect(patchVerdict(board[0], ["private"], MUM)).toBe("ok");
    expect(patchVerdict(board[0], ["private"], ADMIN)).toBe("ok");
    // `done` plus `private` is not a done-only patch.
    expect(patchVerdict(board[0], ["done", "private"], KID)).toBe("forbidden");
  });

  it("the admin may act on a member's private item", () => {
    expect(patchVerdict(board[1], ["text", "private"], ADMIN)).toBe("ok");
  });

  it("an empty patch from a non-owner is forbidden", () => {
    expect(patchVerdict(board[0], [], KID)).toBe("forbidden");
  });
});

describe("admin making a member's item private", () => {
  it("the author keeps seeing it; other members do not", () => {
    const flipped = { ...board[0], private: true };
    expect(canSee(flipped, MUM)).toBe(true);
    expect(canSee(flipped, KID)).toBe(false);
  });
});
