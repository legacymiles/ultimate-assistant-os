import { describe, expect, it } from "vitest";

import { buildRequest, missingKeyMessage, runDevopsTool, shapeResponse, type DevopsSettings } from "./devops";

const settings: DevopsSettings = { defaultRepo: "legacymiles/ultimate-assistant-os" };

describe("github requests", () => {
  it("reads a file at a branch, with the path escaped", () => {
    const req = buildRequest("github", "read_file", { path: "src/app/(hub)/page.tsx", branch: "main" }, settings);
    expect(req.method).toBe("GET");
    expect(req.url).toContain("/repos/legacymiles/ultimate-assistant-os/contents/src/app/(hub)/page.tsx");
    expect(req.url).toContain("ref=main");
  });

  it("base64-encodes a write so one odd character cannot break the body", () => {
    const req = buildRequest("github", "write_file", { path: "a.txt", content: "héllo 🌍" }, settings);
    expect(req.method).toBe("PUT");
    const body = req.body as { content: string };
    expect(Buffer.from(body.content, "base64").toString("utf8")).toBe("héllo 🌍");
  });

  it("refuses a pull request with no branch to come from", () => {
    expect(() => buildRequest("github", "create_pull", { title: "Add dark mode" }, settings)).toThrow(/head/);
  });

  it("accepts a full GitHub URL where a repo belongs", () => {
    const req = buildRequest("github", "repo", { repo: "https://github.com/owner/name.git" }, settings);
    expect(req.url).toBe("https://api.github.com/repos/owner/name");
  });

  it("names the actions it has instead of guessing", () => {
    expect(() => buildRequest("github", "deploy", {}, settings)).toThrow(/is not one Jarvis has/);
  });
});

describe("vercel requests", () => {
  it("scopes a deployment list to the team when there is one", () => {
    const req = buildRequest("vercel", "deployments", { project: "my-site" }, { ...settings, vercelTeam: "team_1" });
    expect(req.url).toContain("projectId=my-site");
    expect(req.url).toContain("teamId=team_1");
  });

  it("requires a deployment before reading its logs", () => {
    expect(() => buildRequest("vercel", "logs", {}, settings)).toThrow(/Which deployment/);
  });
});

describe("supabase requests", () => {
  it("sends SQL to the project's own query endpoint", () => {
    const req = buildRequest("supabase", "sql", { project: "abcd", sql: "select 1" }, settings);
    expect(req.url).toBe("https://api.supabase.com/v1/projects/abcd/database/query");
    expect(req.body).toEqual({ query: "select 1" });
  });

  it("requires a project ref", () => {
    expect(() => buildRequest("supabase", "tables", {}, settings)).toThrow(/ref/);
  });
});

describe("shapeResponse", () => {
  it("turns a GitHub commits payload into the four fields worth reading", () => {
    const out = shapeResponse("github", "commits", [
      { sha: "abcdef123456", commit: { message: "Dark mode\n\nlong body", author: { date: "2026-11-09T00:00:00Z" } }, author: { login: "legacymiles" } },
    ]);
    expect(out.commits).toEqual([
      { sha: "abcdef1", message: "Dark mode", at: "2026-11-09T00:00:00Z", author: "legacymiles" },
    ]);
  });

  it("decodes a file read rather than making the model decode base64 itself", () => {
    const out = shapeResponse("github", "read_file", {
      path: "a.txt",
      sha: "s",
      encoding: "base64",
      content: Buffer.from("hello").toString("base64"),
    });
    expect(out.text).toBe("hello");
  });

  it("lists a folder instead of pretending it is a file", () => {
    const out = shapeResponse("github", "read_file", [{ name: "src", path: "src", type: "dir" }]);
    expect(out.entries).toHaveLength(1);
    expect(String(out.note)).toContain("folder");
  });

  it("keeps only the public anon key", () => {
    const out = shapeResponse("supabase", "api_keys", [
      { name: "anon", api_key: "public" },
      { name: "service_role", api_key: "secret" },
    ]);
    expect(out.keys).toEqual([{ name: "anon", key: "public" }]);
    expect(JSON.stringify(out)).not.toContain("secret");
  });

  it("reports SQL rows and how many there were", () => {
    const out = shapeResponse("supabase", "sql", [{ id: 1 }, { id: 2 }]);
    expect(out.rows).toHaveLength(2);
    expect(out.count).toBe(2);
  });
});

describe("missingKeyMessage", () => {
  it("names the variable and where to get one", () => {
    const said = missingKeyMessage("vercel");
    expect(said).toContain("VERCEL_TOKEN");
    expect(said).toContain("vercel.com");
  });
});

describe("runDevopsTool", () => {
  it("posts the kind, the action and the arguments to the website", async () => {
    const seen: unknown[] = [];
    const fake = (async (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ repos: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await runDevopsTool("github", { action: "repos" }, fake);
    expect(seen[0]).toEqual({ kind: "github", action: "repos", args: { action: "repos" } });
    expect(out.repos).toEqual([]);
  });

  it("hands a service error back to the model instead of throwing the turn away", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ error: "GitHub says that does not exist (404)." }), { status: 200 })) as unknown as typeof fetch;
    const out = await runDevopsTool("github", { action: "repo" }, fake);
    expect(out.error).toContain("404");
  });
});
