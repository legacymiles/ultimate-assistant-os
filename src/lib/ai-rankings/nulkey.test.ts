import { describe, expect, it } from "vitest";

// leafKey is module-private, so this asserts the property it relies on: the
// escape produces the same byte the raw character did, and that separator
// still does the job it was chosen for.
describe("the leaf key separator", () => {
  const key = (group: string, category: string) => `${group}\u0000${category}`;

  it("is the same string the raw NUL produced", () => {
    expect(key("AI", "Chat")).toBe(`AI${String.fromCharCode(0)}Chat`);
    expect(key("AI", "Chat").charCodeAt(2)).toBe(0);
    expect(key("AI", "Chat")).toHaveLength(7);
  });

  it("cannot be forged by a name containing the obvious separators", () => {
    // The whole reason it is not a space or a colon.
    expect(key("AI", "Tools Chat")).not.toBe(key("AI Tools", "Chat"));
    expect(key("AI", "Tools:Chat")).not.toBe(key("AI:Tools", "Chat"));
    expect(key("AI", "Tools-Chat")).not.toBe(key("AI-Tools", "Chat"));
  });

  it("still groups two tools from the same leaf together", () => {
    const a = { group: "Video", category: "Editors" };
    const b = { group: "Video", category: "Editors" };
    expect(key(a.group, a.category)).toBe(key(b.group, b.category));
  });
});
