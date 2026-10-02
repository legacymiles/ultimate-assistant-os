import { describe, expect, it } from "vitest";
import {
  asList,
  basename,
  dirname,
  excerpt,
  extractLinks,
  extractTags,
  firstHeading,
  noteName,
  normalizePath,
  parseFrontmatter,
  parseNote,
  pathKey,
  splitLinkTarget,
  stripExtension,
} from "./parse";

describe("paths", () => {
  it("flattens every spelling a scanner might hand back to one", () => {
    expect(normalizePath("Notes\\A.md")).toBe("Notes/A.md");
    expect(normalizePath("./Notes/A.md")).toBe("Notes/A.md");
    expect(normalizePath("/Notes//A.md")).toBe("Notes/A.md");
    expect(normalizePath("Notes/sub/")).toBe("Notes/sub");
  });

  it("normalises decomposed unicode, so a macOS filename matches a typed one", () => {
    // "é" as e + combining acute, which is what a macOS readdir returns.
    const decomposed = "Notes/Café.md";
    expect(normalizePath(decomposed)).toBe("Notes/Café.md");
    expect(normalizePath(decomposed)).toBe(normalizePath("Notes/Café.md"));
  });

  it("collides case variants in the comparison key but keeps the owner's casing in the path", () => {
    // Windows treats these as one file, so the sweep must too — but the stored
    // path has to be openable, which means it keeps the real casing.
    expect(pathKey("Notes/A.md")).toBe(pathKey("notes/a.md"));
    expect(normalizePath("Notes/A.md")).toBe("Notes/A.md");
  });

  it("splits a path without losing a dot that is part of the name", () => {
    expect(basename("people/Robert Michaels.md")).toBe("Robert Michaels.md");
    expect(dirname("people/Robert Michaels.md")).toBe("people");
    expect(dirname("index.md")).toBe("");
    expect(stripExtension("v1.2 notes.md")).toBe("v1.2 notes");
    expect(noteName("topics/Ozone Therapy.md")).toBe("Ozone Therapy");
  });
});

describe("frontmatter", () => {
  it("reads scalars, dash lists and inline lists", () => {
    const { frontmatter, body } = parseFrontmatter(
      ["---", "title: My Note", "confidence: 0.92", "people:", "  - Robert", "  - Joe", "tags: [a, b]", "---", "", "Body here."].join(
        "\n",
      ),
    );
    expect(frontmatter.title).toBe("My Note");
    expect(frontmatter.confidence).toBe("0.92");
    expect(frontmatter.people).toEqual(["Robert", "Joe"]);
    expect(frontmatter.tags).toEqual(["a", "b"]);
    expect(body.trim()).toBe("Body here.");
  });

  it("leaves a mid-document rule alone, because --- is only frontmatter at the very top", () => {
    const raw = "# Heading\n\nSome prose.\n\n---\n\nMore prose.\n";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it("strips quotes and survives CRLF, a BOM and a comment line", () => {
    const { frontmatter } = parseFrontmatter('﻿---\r\n# a comment\r\ntitle: "Quoted"\r\nstatus: \'ok\'\r\n---\r\nBody');
    expect(frontmatter.title).toBe("Quoted");
    expect(frontmatter.status).toBe("ok");
  });

  it("keeps an empty key rather than dropping it, so a list with no items is still a key", () => {
    const { frontmatter } = parseFrontmatter("---\ntags:\n---\nBody");
    expect(frontmatter.tags).toBe("");
    expect(asList(frontmatter.tags)).toEqual([]);
  });

  it("returns the whole file as body rather than throwing on malformed frontmatter", () => {
    // An unterminated fence is a real thing a half-saved file does.
    const raw = "---\ntitle: broken\nBody that never closed the fence";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });
});

describe("links", () => {
  it("reads every link form and strips the alias and anchor, which are display only", () => {
    const links = extractLinks(
      "See [[Ideas]], [[Ozone Therapy|the therapy]], [[Notes#Summary]], [[Notes#^abc123]] and [prose](./topics/Other.md).",
    );
    const targets = links.map((l) => l.target);
    expect(targets).toContain("Ideas");
    expect(targets).toContain("Ozone Therapy");
    expect(targets).toContain("./topics/Other.md");
    expect(links.find((l) => l.target === "Ozone Therapy")?.alias).toBe("the therapy");
    // Both anchored forms point at the SAME note, so they are one edge.
    expect(targets.filter((t) => t === "Notes")).toHaveLength(1);
  });

  it("tells an embed apart from a reference, because they say different things", () => {
    const links = extractLinks("![[Diagram]] and also [[Diagram]]");
    expect(links.map((l) => l.kind).sort()).toEqual(["embed", "wiki"]);
  });

  it("does not invent an edge from a link inside a code block", () => {
    // A note documenting the syntax must not link to a note called "Example".
    const body = ["Prose with [[Real]].", "", "```md", "[[Example]]", "```", "", "Inline `[[AlsoNot]]` too.", "    [[IndentedNot]]"].join(
      "\n",
    );
    expect(extractLinks(body).map((l) => l.target)).toEqual(["Real"]);
  });

  it("ignores links that point outside the vault", () => {
    const links = extractLinks("[site](https://example.com/a.md) [mail](mailto:a@b.c) [app](obsidian://open?file=x) [frag](#here)");
    expect(links).toEqual([]);
  });

  it("ignores a markdown link to something that is not a note", () => {
    // An image or a PDF is an attachment, not a graph node.
    expect(extractLinks("![pic](attachments/photo.png) [doc](attachments/form.pdf)")).toEqual([]);
  });

  it("counts a link repeated five times as one edge", () => {
    expect(extractLinks("[[A]] [[A]] [[A]] [[A]] [[A]]")).toHaveLength(1);
  });

  it("ignores a bare anchor, which points inside this same note", () => {
    expect(extractLinks("jump to [[#Summary]]")).toEqual([]);
  });

  it("decodes a percent-encoded path and keeps a malformed one rather than losing the link", () => {
    expect(extractLinks("[a](./My%20Note.md)").map((l) => l.target)).toEqual(["./My Note.md"]);
    expect(extractLinks("[a](./100%.md)").map((l) => l.target)).toEqual(["./100%.md"]);
  });

  it("splits a target into its parts", () => {
    expect(splitLinkTarget("Note#Heading|Alias")).toEqual({ target: "Note", anchor: "Heading", alias: "Alias" });
    expect(splitLinkTarget("Plain")).toEqual({ target: "Plain", anchor: undefined, alias: undefined });
  });
});

describe("tags", () => {
  it("reads body tags and keeps the ones with a letter in them", () => {
    expect(extractTags("#testimonial and #anti-aging and #area/sub")).toEqual(["testimonial", "anti-aging", "area/sub"]);
  });

  it("refuses the three things that look like a tag and are not", () => {
    // A heading, a number, and a colour. Each of these turning into a node is
    // how a graph fills with junk nobody typed.
    expect(extractTags("# Heading\n\n#2026 and #1/2 and a colour #fff is")).toEqual(["fff"]);
    expect(extractTags("# Heading only")).toEqual([]);
  });

  it("does not read a URL fragment as a tag", () => {
    expect(extractTags("see https://example.com/page#section for more")).toEqual([]);
  });

  it("ignores a tag inside a code block", () => {
    expect(extractTags("```\n#notatag\n```\n\n#real")).toEqual(["real"]);
  });
});

describe("parseNote", () => {
  it("prefers the frontmatter title, then a heading, then the filename", () => {
    expect(parseNote("a.md", "---\ntitle: From Front\n---\n# From Heading").title).toBe("From Front");
    expect(parseNote("a.md", "# From Heading\n\nbody").title).toBe("From Heading");
    expect(parseNote("people/Robert Michaels.md", "just prose").title).toBe("Robert Michaels");
    expect(parseNote("", "").title).toBe("Untitled");
  });

  it("treats a frontmatter wikilink as a real edge, because the researched vault files people that way", () => {
    const note = parseNote("videos/clip.md", ["---", "people:", '  - "[[Robert Michaels]]"', "---", "", "Body with [[Ozone Therapy]]."].join("\n"));
    expect(note.links.map((l) => l.target)).toEqual(["Robert Michaels", "Ozone Therapy"]);
  });

  it("normalises the three ways a frontmatter tag gets written", () => {
    const note = parseNote("a.md", ["---", "tags: [#Testimonial, plain, '[[CPI-Interview]]']", "---", "#body-tag"].join("\n"));
    expect(note.tags).toEqual(["testimonial", "plain", "cpi-interview", "body-tag"]);
  });

  it("does not count the same note twice when it is linked in both frontmatter and body", () => {
    const note = parseNote("a.md", ["---", 'people: ["[[Robert]]"]', "---", "", "and [[robert]] again"].join("\n"));
    expect(note.links).toHaveLength(1);
  });

  it("works on a body that has never been written to disk, which is what phone capture hands it", () => {
    const note = parseNote("inbox/2026-10-02-1423-idea.md", "A thought about [[Jarvis]].");
    expect(note.title).toBe("2026-10-02-1423-idea");
    expect(note.links.map((l) => l.target)).toEqual(["Jarvis"]);
  });

  it("finds a note that links to itself without treating it as special", () => {
    // Harmless, but the resolver needs to see it to drop the self-edge.
    expect(parseNote("A.md", "[[A]]").links.map((l) => l.target)).toEqual(["A"]);
  });
});

describe("excerpt", () => {
  it("gives the prose, not the scaffolding", () => {
    const body = ["# Heading", "", "## Summary", "", "- a bullet", "", "The actual **prose** with [[A Link|an alias]] in it."].join("\n");
    expect(excerpt(body)).toBe("a bullet The actual prose with an alias in it.");
  });

  it("truncates with an ellipsis rather than mid-decision", () => {
    const out = excerpt("x".repeat(400), 50);
    expect(out).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("is empty for a note that is only a heading, rather than echoing the heading", () => {
    expect(excerpt("# Just A Title")).toBe("");
  });
});

describe("firstHeading", () => {
  it("reads the first heading at any level and strips closing hashes", () => {
    expect(firstHeading("### Deep ###")).toBe("Deep");
    expect(firstHeading("no heading here")).toBe("");
  });

  it("ignores a heading inside a code block", () => {
    expect(firstHeading("```\n# Not A Heading\n```\n\n# Real One")).toBe("Real One");
  });
});
