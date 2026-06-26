/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Heavy Node-only parsers — keep them out of the webpack bundle.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
