import { describe, expect, it } from "vitest";
import { appOf, CORE_TOOLS, isReadOnly, summarise, toApiTools } from "./tools";

describe("read-only classification", () => {
  it("lets look-only tools run without asking", () => {
    for (const name of [
      "gmail.find_email",
      "googlecalendar.list_events",
      "slack.search_messages",
      "jarvis.get_profile",
      "outlook.fetch-messages",
    ]) {
      expect(isReadOnly({ name })).toBe(true);
    }
  });

  it("makes anything that acts wait for a yes", () => {
    for (const name of [
      "gmail.send_email",
      "googlecalendar.create_event",
      "slack.post_message",
      "googlecalendar.delete_event",
      "linkedin.share_post",
    ]) {
      expect(isReadOnly({ name })).toBe(false);
    }
  });

  it("treats an unrecognised tool as an action, not as safe", () => {
    expect(isReadOnly({ name: "someapp.frobnicate_thing" })).toBe(false);
    expect(isReadOnly({ name: "weird" })).toBe(false);
  });

  it("believes the connector when it states the answer", () => {
    // A tool named like a write but declared read-only, and the reverse.
    expect(isReadOnly({ name: "gmail.send_email", readOnlyHint: true })).toBe(true);
    expect(isReadOnly({ name: "gmail.list_email", readOnlyHint: false })).toBe(false);
  });

  it("is not fooled by a read verb buried later in the name", () => {
    expect(isReadOnly({ name: "gmail.send_and_get_receipt" })).toBe(false);
  });
});

describe("naming and summaries", () => {
  it("names the app from the tool or its prefix", () => {
    expect(appOf({ name: "gmail.send_email" })).toBe("gmail");
    expect(appOf({ name: "search_memory", app: "jarvis" })).toBe("jarvis");
    expect(appOf({ name: "search_memory" })).toBe("jarvis");
  });

  it("says in plain words what a calendar write would do", () => {
    expect(summarise("googlecalendar.create_event", { title: "Dentist", start: "2026-09-22 11:00" })).toBe(
      'Add "Dentist" to your calendar on 2026-09-22 11:00.',
    );
  });

  it("says who a message would go to", () => {
    expect(summarise("gmail.send_email", { to: "sam@example.com", subject: "Invoice" })).toBe(
      'Send a message to sam@example.com — "Invoice".',
    );
  });

  it("falls back to naming the tool rather than guessing", () => {
    expect(summarise("someapp.frobnicate", {})).toBe("Run someapp.frobnicate.");
  });
});

describe("core tools", () => {
  it("exposes memory search and memory proposal, both safe to run", () => {
    expect(CORE_TOOLS.map((t) => t.name)).toEqual(["search_memory", "propose_memory"]);
    expect(CORE_TOOLS.every(isReadOnly)).toBe(true);
  });

  it("converts to the shape both AI providers accept", () => {
    const api = toApiTools(CORE_TOOLS) as { type: string; function: { name: string } }[];
    expect(api[0].type).toBe("function");
    expect(api[0].function.name).toBe("search_memory");
  });
});
