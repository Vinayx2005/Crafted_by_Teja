/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    unoptimized: true,
  },
  // Standalone HTML tools live in public/<name>/index.html and are served
  // at tools.craftedbyteja.com/<name>.
  async rewrites() {
    return [{ source: '/name-picker', destination: '/name-picker/index.html' }];
  },
};

module.exports = nextConfig;
