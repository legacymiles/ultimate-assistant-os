import { describe, expect, it } from "vitest";
import { DESTINATIONS, DESTINATION_ROUTES, destinationPromptBlock } from "./registry";

describe("destination registry", () => {
  it("generates a prompt block naming every destination", () => {
    const block = destinationPromptBlock();
    for (const d of DESTINATIONS) expect(block).toContain(`"${d.id}"`);
  });

  it("puts every declared field into the prompt", () => {
    // The point of generating the prompt is that a field cannot exist in the
    // registry while being invisible to the model.
    const block = destinationPromptBlock();
    for (const d of DESTINATIONS) {
      for (const f of d.fields) expect(block).toContain(f.name);
    }
  });

  it("exposes route ids that match the destination ids", () => {
    expect(DESTINATION_ROUTES).toEqual(DESTINATIONS.map((d) => d.id));
  });
});
