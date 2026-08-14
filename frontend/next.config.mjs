/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output traces the minimal set of files/deps this app
  // actually needs at runtime into .next/standalone — the Docker image
  // (Dockerfile.frontend) copies just that instead of the full
  // node_modules tree, same "lean production image" reasoning as the
  // backend's multi-stage build.
  output: 'standalone',
};

export default nextConfig;
