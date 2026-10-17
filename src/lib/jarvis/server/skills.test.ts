import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const saved: unknown[] = [];
vi.mock("./memory", () => ({
  saveMemories: vi.fn(async (_ctx: unknown, inputs: unknown[]) => {
    saved.push(...inputs);
    return { saved: inputs.length, skipped: 0, embedded: false };
  }),
}));

import { getSkill, listSkills, nameFromKey, saveSkill, skillKey, SkillError } from "./skills";
import { hashSkill } from "../skillFormat.mjs";

const BODY = "---\nname: phone-made\ndescription: Made from the phone.\n---\n# Phone made\nSteps.\n";

/** A tiny stand-in for the Supabase query builder: records filters, returns canned rows. */
function fakeDb(rows: Record<string, unknown>[]) {
  const q = {
    filters: {} as Record<string, unknown>,
    select() {
      return q;
    },
    eq(k: string, v: unknown) {
      q.filters[k] = v;
      return q;
    },
    order() {
      return Promise.resolve({ data: rows, error: null });
    },
    maybeSingle() {
      const hit = rows.find((r) => r.external_id === q.filters.external_id) ?? null;
      return Promise.resolve({ data: hit, error: null });
    },
  };
  return { from: () => q };
}

const ctx = (rows: Record<string, unknown>[] = []) => ({ available: true as const, userId: "u1", profileId: "owner", db: fakeDb(rows) });

beforeEach(() => {
  saved.length = 0;
});

describe("skill store", () => {
  it("saves ONE canonical row per skill, keyed like the master-folder sync", async () => {
    const r = await saveSkill(ctx(), { name: "phone-made", body: BODY, files: { "references/a.md": "A", "references/../x.md": "no" }, origin: "claude-code-phone" });
    expect(r).toMatchObject({ name: "phone-made", changed: true });
    const row = saved[0] as { source: string; externalId: string; meta: { hash: string; body: string; files: object; updatedFrom: string } };
    expect(row.source).toBe("skill");
    expect(row.externalId).toBe("~/.claude/skills/phone-made");
    expect(row.meta.body).toBe(BODY);
    expect(row.meta.files).toEqual({ "references/a.md": "A" });
    expect(row.meta.hash).toBe(hashSkill(BODY, { "references/a.md": "A" }));
    expect(row.meta.updatedFrom).toBe("claude-code-phone");
  });

  it("refuses unsafe names and bodies without frontmatter, with a reason", async () => {
    await expect(saveSkill(ctx(), { name: "../evil", body: BODY })).rejects.toBeInstanceOf(SkillError);
    await expect(saveSkill(ctx(), { name: "ok", body: "# no frontmatter" })).rejects.toThrow(/frontmatter/);
    await expect(saveSkill(ctx(), { name: "ok", body: "   " })).rejects.toThrow(/empty/);
    expect(saved).toHaveLength(0);
  });

  it("lists skills without bodies, marking old summary-only rows incomplete", async () => {
    const list = await listSkills(
      ctx([
        { external_id: skillKey("phone-made"), content: 'Skill "phone-made": Made from the phone.', updated_at: "2026-10-16T00:00:00Z", hash: "h1", updated_from: "claude-code-phone", description: "Made from the phone." },
        { external_id: skillKey("old-one"), content: "Skill: old-one summary", updated_at: "2026-09-01T00:00:00Z", hash: null },
        { external_id: "~/.claude/skills/../bad", content: "", updated_at: "", hash: "x" },
      ]),
    );
    expect(list.map((s) => [s.name, s.complete])).toEqual([
      ["phone-made", true],
      ["old-one", false],
    ]);
    expect(list[0].updatedFrom).toBe("claude-code-phone");
  });

  it("gets the full body and references back", async () => {
    const meta = { body: BODY, files: { "references/a.md": "A" }, hash: "h", updatedFrom: "phone", description: "Made from the phone." };
    const sk = await getSkill(ctx([{ external_id: skillKey("phone-made"), content: "summary", updated_at: "t", meta }]), "phone-made");
    expect(sk).toMatchObject({ name: "phone-made", complete: true, body: BODY, files: { "references/a.md": "A" } });
    expect(await getSkill(ctx([]), "missing")).toBeNull();
    expect(await getSkill(ctx([]), "../etc")).toBeNull();
    expect(nameFromKey("~/.claude/skills/rea")).toBe("rea");
  });
});
