import { KNOWLEDGE_KIND_LABELS, type KnowledgeKind, type Project } from "./types";
import { formatDate } from "./utils";

// ---------------------------------------------------------------------------
// Super Prompt generator.
//
// Synthesises everything Projects Timeline knows about a project — overview,
// core/supporting features, version history and the entire Knowledge Inbox —
// into a single, richly structured build prompt optimised for an agentic
// coding LLM (e.g. Claude Code) to read once and build the project end to end.
// Deterministic and instant; no API call required.
// ---------------------------------------------------------------------------

export function buildSuperPrompt(project: Project): string {
  const L: string[] = [];
  const push = (s = "") => L.push(s);

  const core = project.features.filter((f) => f.group === "core");
  const supporting = project.features.filter((f) => f.group === "supporting");
  const versions = [...project.versions].sort(
    (a, b) => +new Date(b.created_at) - +new Date(a.created_at),
  );
  const latest = versions[0];

  // ---- Role + objective ---------------------------------------------------
  push(`# Build Prompt — ${project.name}`);
  push();
  push(
    "You are Claude Code, an elite autonomous software engineer. Build the " +
      "project specified below to a polished, production-ready standard. This " +
      "document is the single source of truth: it captures what the project is, " +
      "every feature it must have, how it has evolved, and all accumulated " +
      "context and decisions. Read it fully before writing any code.",
  );
  push();

  // ---- Snapshot -----------------------------------------------------------
  push("## 1. Project Snapshot");
  push();
  push(`- **Name:** ${project.name}`);
  if (project.one_liner) push(`- **In one line:** ${project.one_liner}`);
  if (latest) push(`- **Current version:** v${latest.number}`);
  push(
    `- **Scope signals:** ${core.length} core feature${plural(core.length)}, ` +
      `${supporting.length} supporting feature${plural(supporting.length)}, ` +
      `${versions.length} version${plural(versions.length)}, ` +
      `${project.knowledge.length} knowledge entr${project.knowledge.length === 1 ? "y" : "ies"}.`,
  );
  push();

  // ---- Overview -----------------------------------------------------------
  if (project.overview) {
    push(`## ${section(project, "overview")}. Overview`);
    push();
    push(project.overview);
    push();
  }

  // ---- Detailed explanation ----------------------------------------------
  if (project.detailed) {
    push(`## ${section(project, "detailed")}. Detailed Explanation`);
    push();
    push("The full specification — every important detail. Treat this as authoritative.");
    push();
    push(project.detailed);
    push();
  }

  // ---- Core features ------------------------------------------------------
  push(`## ${section(project, "core")}. Core Features — MUST be implemented`);
  push();
  push(
    "These define the product. They are non-negotiable and should be built " +
      "first, fully working, before any supporting work.",
  );
  push();
  if (core.length) {
    core.forEach((f, i) => {
      push(`${i + 1}. **${f.title}**`);
      if (f.description) push(`   - ${f.description}`);
    });
  } else {
    push("_No core features captured yet — clarify the primary purpose with the user first._");
  }
  push();

  // ---- Supporting features ------------------------------------------------
  push(`## ${section(project, "supporting")}. Supporting Features — enhancements & refinements`);
  push();
  push(
    "Secondary functionality: improvements, visual upgrades, quality-of-life " +
      "features and bug fixes. Implement after the core is solid.",
  );
  push();
  if (supporting.length) {
    supporting.forEach((f) => {
      push(`- **${f.title}**${f.description ? ` — ${f.description}` : ""}`);
    });
  } else {
    push("_None captured yet._");
  }
  push();

  // ---- Version history ----------------------------------------------------
  if (versions.length) {
    push(`## ${section(project, "versions")}. Version History (newest first)`);
    push();
    push("How the project evolved. Use this to understand intent and trajectory.");
    push();
    versions.forEach((v) => {
      push(`- **v${v.number}** _(${formatDate(v.created_at)})_ — ${v.summary || "No summary."}`);
      if (v.files.length) {
        push(`  - Artifacts: ${v.files.map((f) => f.name).join(", ")}`);
      }
    });
    push();
  }

  // ---- Knowledge inbox ----------------------------------------------------
  if (project.knowledge.length) {
    push(`## ${section(project, "knowledge")}. Project Knowledge & Context`);
    push();
    push(
      "The project's accumulated memory — notes, ideas, decisions, bug reports " +
        "and conversations. Honour these; they encode real requirements and lessons.",
    );
    push();
    const byKind = groupByKind(project);
    for (const [kind, entries] of byKind) {
      push(`### ${KNOWLEDGE_KIND_LABELS[kind]}`);
      entries
        .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
        .forEach((k) => {
          push(`- **${k.title || KNOWLEDGE_KIND_LABELS[kind]}** _(${formatDate(k.created_at)})_`);
          k.content
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => push(`  - ${line}`));
        });
      push();
    }
  }

  // ---- Build approach -----------------------------------------------------
  const n = section(project, "approach");
  push(`## ${n}. How to Build It`);
  push();
  push(
    "1. **Confirm scope.** Restate the objective and list assumptions; ask only " +
      "if genuinely blocked.",
  );
  push(
    "2. **Choose a sensible stack** appropriate to the project type and justify it briefly.",
  );
  push("3. **Scaffold** the project and get a trivial version running first.");
  push("4. **Build the core features** in order, each one fully working and verified.");
  push("5. **Layer in supporting features** without regressing the core.");
  push(
    "6. **Verify end to end** — run it, test the happy paths and edge cases, and " +
      "confirm it behaves as described above.",
  );
  push("7. **Document** setup and usage in a README.");
  push();

  // ---- Quality bar --------------------------------------------------------
  push(`## ${n + 1}. Constraints & Quality Bar`);
  push();
  push("- Production-ready: clean, typed, readable code that matches its own conventions.");
  push("- Every core feature must actually work — no stubs or TODOs in the critical path.");
  push("- Handle errors and empty states gracefully.");
  push("- Prefer reusing existing, well-supported libraries over bespoke implementations.");
  push("- Leave the project in a runnable, verified state with clear run instructions.");
  push();

  // ---- Definition of done -------------------------------------------------
  push(`## ${n + 2}. Definition of Done`);
  push();
  push("- All core features implemented and demonstrably working.");
  push("- Supporting features implemented or explicitly deferred with reasons.");
  push("- App/build runs cleanly; basic tests or a manual verification pass completed.");
  push("- README explains how to run and use it.");
  push();
  push("---");
  push(
    `_Generated by Projects Timeline from the live record of "${project.name}" ` +
      `on ${formatDate(new Date().toISOString())}._`,
  );

  return L.join("\n");
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

function groupByKind(project: Project): [KnowledgeKind, Project["knowledge"]][] {
  const map = new Map<KnowledgeKind, Project["knowledge"]>();
  for (const k of project.knowledge) {
    const arr = map.get(k.kind) ?? [];
    arr.push(k);
    map.set(k.kind, arr);
  }
  return Array.from(map.entries());
}

// Section numbering adapts to which sections are present so headings stay sequential.
function section(project: Project, which: string): number {
  const hasOverview = Boolean(project.overview);
  const hasDetailed = Boolean(project.detailed);
  const hasVersions = project.versions.length > 0;
  const hasKnowledge = project.knowledge.length > 0;
  let n = 1; // snapshot is always 1
  const order: { id: string; present: boolean }[] = [
    { id: "overview", present: hasOverview },
    { id: "detailed", present: hasDetailed },
    { id: "core", present: true },
    { id: "supporting", present: true },
    { id: "versions", present: hasVersions },
    { id: "knowledge", present: hasKnowledge },
    { id: "approach", present: true },
  ];
  for (const o of order) {
    if (!o.present) continue;
    n += 1;
    if (o.id === which) return n;
  }
  return n;
}
