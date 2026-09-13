import { describe, expect, it } from "vitest";
import {
  coerceEntry,
  digestHtml,
  findSourceLinks,
  guessName,
  heuristicEntry,
  linksBlock,
  oneLine,
  parseRepoUrl,
  scriptSources,
} from "./analyzeLink";
import type { SiteRead } from "./analyzeLink";

const AUK_HTML = `<!doctype html><html><head>
<title>AuK — An Open-Source Foundational Model for Speech Generation and Editing</title>
<meta name="description" content="AuK is an open-source foundational model that unifies speech generation, content editing, and separation behind a single natural-language interface." />
<script type="module" crossorigin src="./assets/index-pxlL0ca-.js"></script>
<script src="https://cdn.example.com/lib.js"></script>
</head><body><h1>AuK</h1><p>Zero-shot voice cloning and speech editing.</p></body></html>`;

const AUK_BUNDLE =
  'const l=[{label:"Paper",href:"https://arxiv.org/abs/2609.08936"},{label:"Code",href:"https://github.com/Tencent-Hunyuan/AuK"},' +
  '{href:"https://huggingface.co/tencent/AuK"},{href:"https://huggingface.co/tencent/AuK-Flash"},' +
  '{href:"https://github.com/features/copilot"},{href:"https://huggingface.co/datasets/x/y"}]';

function aukSite(over: Partial<SiteRead> = {}): SiteRead {
  const url = new URL("https://auk-project.github.io/");
  const page = digestHtml(AUK_HTML, url);
  return {
    url: url.href,
    source: "page",
    readPage: true,
    ...page,
    links: findSourceLinks(AUK_BUNDLE),
    repo: {
      slug: "Tencent-Hunyuan/AuK",
      description: "AuK: An Open-Source Foundational Model for Speech Generation and Editing",
      stars: 1234,
      license: "MIT",
      topics: ["tts", "speech"],
      archived: false,
      readme: "",
    },
    model: {
      slug: "tencent/AuK",
      pipeline: "text-to-speech",
      tags: ["voice-cloning", "speech-editing"],
      license: "mit",
      readme: "",
    },
    ...over,
  };
}

describe("reading a project page", () => {
  it("finds code, weights and paper links in a script bundle, skipping GitHub's own pages", () => {
    const links = findSourceLinks(AUK_BUNDLE);
    expect(links.github).toEqual(["Tencent-Hunyuan/AuK"]);
    expect(links.huggingface).toEqual(["tencent/AuK", "tencent/AuK-Flash"]);
    expect(links.arxiv).toEqual(["2609.08936"]);
  });

  it("names the product, not the tagline", () => {
    expect(digestHtml(AUK_HTML, new URL("https://auk-project.github.io/")).name).toBe("AuK");
    expect(guessName({}, "", new URL("https://www.linear.app/"))).toBe("Linear");
    expect(guessName({ "og:site_name": "Figma" }, "Figma: the collaborative interface design tool", new URL("https://figma.com"))).toBe("Figma");
  });

  it("only scans same-origin bundles", () => {
    expect(scriptSources(AUK_HTML, new URL("https://auk-project.github.io/"))).toEqual([
      "https://auk-project.github.io/assets/index-pxlL0ca-.js",
    ]);
  });

  it("recognises a direct repo or model link", () => {
    expect(parseRepoUrl(new URL("https://github.com/comfyanonymous/ComfyUI/tree/master"))).toEqual({
      kind: "github",
      slug: "comfyanonymous/ComfyUI",
    });
    expect(parseRepoUrl(new URL("https://huggingface.co/tencent/AuK"))?.kind).toBe("huggingface");
    expect(parseRepoUrl(new URL("https://github.com/features/actions"))).toBeNull();
    expect(parseRepoUrl(new URL("https://auk-project.github.io/"))).toBeNull();
  });

  it("cuts a summary at the first sentence", () => {
    expect(oneLine("One model for speech. It also edits.")).toBe("One model for speech.");
  });
});

describe("building an entry without an AI key", () => {
  it("files an open speech model as a free, self-hosted open-source voice tool", () => {
    const e = heuristicEntry(aukSite());
    expect(e.name).toBe("AuK");
    expect(e.group).toBe("AI");
    expect(e.category).toBe("Voice");
    expect(e.openSource).toBe(true);
    expect(e.access).toBe("free");
    expect(e.hosting).toBe("self-host");
    expect(e.tags).toContain("open-source");
    expect(e.features).toContain("Voice cloning");
    expect(e.notes).toContain("Code: https://github.com/Tencent-Hunyuan/AuK · ★ 1.2k · MIT");
    expect(e.notes).toContain("Paper: https://arxiv.org/abs/2609.08936");
  });

  it("keeps owner/repo as the name for a GitHub link", () => {
    const e = heuristicEntry(aukSite({ source: "github", url: "https://github.com/Tencent-Hunyuan/AuK" }));
    expect(e.name).toBe("Tencent-Hunyuan/AuK");
  });

  it("writes no links section when nothing was found", () => {
    expect(linksBlock(aukSite({ repo: null, model: null, links: { github: [], huggingface: [], spaces: [], arxiv: [] } }))).toBe("");
  });
});

describe("trusting the model's answer", () => {
  it("lets a licence from the API overrule a model that says closed", () => {
    const site = aukSite();
    const e = coerceEntry(
      { name: "AuK", notes: "A 1.5B speech model from Tencent Hunyuan.", openSource: false, group: "AI", category: "Voice" },
      heuristicEntry(site),
      site,
    );
    expect(e.openSource).toBe(true);
    expect(e.notes.startsWith("A 1.5B speech model from Tencent Hunyuan.")).toBe(true);
    expect(e.notes).toContain("Weights: https://huggingface.co/tencent/AuK");
    expect(e.url).toBe("https://auk-project.github.io/");
  });
});
