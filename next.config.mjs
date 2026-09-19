/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A second dev server or a build sharing .next with a running one corrupts it
  // (EINVAL readlink, then blanket 500s). NEXT_DIST_DIR gives each its own.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Heavy Node-only parsers — keep them out of the webpack bundle.
  serverExternalPackages: ["pdf-parse", "mammoth"],
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
