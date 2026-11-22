// ---------------------------------------------------------------------------
// Which app a file belongs to. Shared by scripts/timeline-log.mjs (an edit to
// these files is an edit to that app) and scripts/app-records.mjs (an app's
// record is scanned from these folders). One map, so the two never disagree.
// ---------------------------------------------------------------------------

/** Code folders whose name differs from the app's slug (see CLAUDE.md). */
export const FOLDER_TO_SLUG = {
  "new-jarvis": "jarvis",
  jarvis: "jarvis",
  "jarvis-profile": "jarvis",
  "memory-map": "jarvis",
  "site-errors": "jarvis",
  studio: "jarvis",
  "new-dashboard": "jarvis",
  hub: "jarvis",
  recall: "dashboard",
  dashboard: "dashboard",
  blueprint: "prompt-architect",
  // Dance Vault became Viral Studio Content (Oct 2026); its history moves with it.
  dances: "viral-studio-content",
  "dance-studio": "viral-studio-content",
  "tiktok-dances": "viral-studio-content",
  "viral-studio": "viral-studio-content",
  reveal: "fire-reveal",
  studio3d: "3d-studio",
  cookbook: "cookbook-genie",
  "gods-eye": "gods-eye-view",
  kart: "kart-showcase",
  calculator: "multi-order-calculator",
  stdsafe: "std-safe",
  ea: "ea-world",
  "ea-features": "ea-world",
  "ea-replay": "ea-world",
  "ea-feature-list": "ea-world",
  redesigner: "website-redesigner",
  seedance: "seedance-studio",
  "smart-shot": "smart-shot-videos",
  "video-studio": "video-studio-arena",
  skills: "skills-library",
  "mp3-download": "jarvis-audio-studio",
  "music-classified": "jarvis-audio-studio",
  "music-creator": "jarvis-audio-studio",
  slippery: "slippery-escape",
  // Studio homes (Oct 2026): the shells. The merged apps keep their own
  // folders and their own history; edits to the home itself land on the home.
  "studio-home": "jarvis",
  "trading-studio": "trading-studio",
  "game-studio": "game-studio",
  "item-storm-arena": "item-storm-arena",
  "social-personas": "personas-studio",
  bible: "financial-bible",
  repo: "projects-timeline",
  timeline: "projects-timeline",
  regenerate: "projects-timeline",
  "timeline-unlock": "projects-timeline",
  "recall-unlock": "dashboard",
  "social-import": "dashboard",
  fno: "friends-night-out",
  "h3-lab": "h3-experiments",
  redesign: "website-redesigner",
  finance: "jarvis",
  bills: "jarvis",
  armory: "jarvis",
  telephony: "jarvis",
  passwords: "jarvis",
  // The centralized search service. Its code folders are `search` (the service
  // itself: src/lib/search, src/app/api/search) and `search-infra` (the
  // console's components), neither of which matches the app's slug.
  search: "search-infrastructure",
  "search-infra": "search-infrastructure",
};

/** Files at the top of src/components and src/lib that belong to the timeline. */
export const TIMELINE_FILES = /^src\/(components\/(AppShell|ProjectView|VersionTimeline|FeaturesSection|AppEditsSection|AppRecordSection|Sidebar|KnowledgeInbox|AIPanel)\.tsx|lib\/(store|seed|analyst|types)\.ts)$/;

/** Folders that are plumbing, not an app. */
export const SKIP = new Set(["ai", "sync", "supabase", "server", "ui", "icons", "modals", "utils", "auteur", "ingest", "tts", "auth"]);

export const slugOf = (folder) => FOLDER_TO_SLUG[folder] ?? folder;

/** Apps a commit touched, by the files it changed. */
export function appsTouched(files) {
  const apps = new Set();
  for (const f of files) {
    if (TIMELINE_FILES.test(f)) { apps.add("projects-timeline"); continue; }
    // Seed content is filed per app: src/lib/seed-content/<app>.ts or <app>/…
    const seed = f.match(/^src\/lib\/seed-content\/([^/.]+)/);
    if (seed) { apps.add(slugOf(seed[1])); continue; }
    const m = f.match(/^src\/(?:app\/apps|app\/api|components|lib)\/([^/]+)\//);
    if (!m || SKIP.has(m[1])) continue;
    apps.add(slugOf(m[1]));
  }
  return [...apps];
}

/** Every code folder name that belongs to an app: its slug plus each folder mapped to it. */
export function foldersOf(slug) {
  const out = new Set([slug]);
  for (const [folder, owner] of Object.entries(FOLDER_TO_SLUG)) if (owner === slug) out.add(folder);
  return [...out].filter((f) => !SKIP.has(f)).sort();
}
