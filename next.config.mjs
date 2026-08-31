/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A second dev server or a build sharing .next with a running one corrupts it
  // (EINVAL readlink, then blanket 500s). NEXT_DIST_DIR gives each its own.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Heavy Node-only parsers — keep them out of the webpack bundle.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
