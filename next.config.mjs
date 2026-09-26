/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A second dev server or a build sharing .next with a running one corrupts it
  // (EINVAL readlink, then blanket 500s). NEXT_DIST_DIR gives each its own.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Heavy Node-only parsers — keep them out of the webpack bundle.
  serverExternalPackages: ["pdf-parse", "mammoth", "ffmpeg-static"],
  // Music Creator converts saved songs to MP3 with ffmpeg; the binary is not
  // imported, only spawned, so it must be traced into that route explicitly.
  outputFileTracingIncludes: {
    "/api/music-creator/library": ["./node_modules/ffmpeg-static/ffmpeg*"],
    // Jarvis reads the owner's master folder at request time, so those files
    // have to travel with the deployment — nothing imports them, so tracing
    // cannot infer it.
    "/api/jarvis/**": ["./CLAUDE.md", "./aios/**/*.md", "./src/lib/studio/skills/*.md"],
    // The Record extension is zipped up and handed to the browser at request
    // time, so its source has to travel with the deployment too.
    "/api/jarvis/record/extension": ["./extension/jarvis-record/*"],
  },
  // Pod Play Connect is a prebuilt Vite SPA in public/pod-play-connect (rebuild:
  // POD_BASE=/pod-play-connect/ vite build in its repo). Real files are served
  // first; every other path under it falls back to its index.html.
  async rewrites() {
    return [
      { source: "/pod-play-connect", destination: "/pod-play-connect/index.html" },
      { source: "/pod-play-connect/:path*", destination: "/pod-play-connect/index.html" },
    ];
  },
};

export default nextConfig;
