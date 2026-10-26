/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A second dev server or a build sharing .next with a running one corrupts it
  // (EINVAL readlink, then blanket 500s). NEXT_DIST_DIR gives each its own.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Heavy Node-only parsers — keep them out of the webpack bundle.
  serverExternalPackages: ["pdf-parse", "mammoth", "ffmpeg-static", "lzma"],
  // Music Creator converts saved songs to MP3 with ffmpeg; the binary is not
  // imported, only spawned, so it must be traced into that route explicitly.
  outputFileTracingIncludes: {
    "/api/music-creator/library": ["./node_modules/ffmpeg-static/ffmpeg*"],
    // Jarvis reads the owner's master folder at request time, so those files
    // have to travel with the deployment — nothing imports them, so tracing
    // cannot infer it.
    "/api/jarvis/**": ["./CLAUDE.md", "./aios/**/*.md", "./src/lib/studio/skills/*.md"],
    // The Skills Library and In Queue list the committed skills by reading the
    // folders at request time: the owner's mirror in skills/ and the
    // super-board pack in .claude/skills/.
    "/api/skills/scan": ["./skills/*/SKILL.md", "./.claude/skills/*/SKILL.md"],
    "/api/new-jarvis/queue": ["./skills/**/*.md"],
    // The Record extension is zipped up and handed to the browser at request
    // time, so its source has to travel with the deployment too.
    "/api/jarvis/record/extension": ["./extension/jarvis-record/*"],
    // LZMA-JS loads its worker with a computed require path, which tracing
    // cannot follow; EA World Replay needs it to unpack Dukascopy tick files.
    "/api/ea-replay/ticks": ["./node_modules/lzma/**"],
  },
  // Pod Play Connect is a prebuilt Vite SPA in public/pod-play-connect (rebuild:
  // POD_BASE=/pod-play-connect/ vite build in its repo). Real files are served
  // first; every other path under it falls back to its index.html.
  // Apps merged into a studio home whose old page cannot live in this repo:
  // src/app/apps/ea-world/page.tsx and src/app/apps/ea-lab/ hold uncommitted
  // work on the owner's PC, and a file at either path would block his pull.
  // Exact paths only — /apps/ea-world/replay and /terminals are pages of their
  // own (redirect pages) and must not be swallowed by a wildcard. Temporary,
  // so a browser forgets them the day EA World's real page is committed.
  async redirects() {
    return [
      { source: "/apps/ea-world", destination: "/apps/trading-studio?section=world", permanent: false },
      { source: "/apps/ea-lab", destination: "/apps/trading-studio?section=lab", permanent: false },
    ];
  },
  async rewrites() {
    return [
      { source: "/pod-play-connect", destination: "/pod-play-connect/index.html" },
      { source: "/pod-play-connect/:path*", destination: "/pod-play-connect/index.html" },
    ];
  },
};

export default nextConfig;
