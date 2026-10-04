/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    unoptimized: true,
  },
  // /about used to be the author profile; that Person markup now lives on the
  // home page. Permanent so search engines move any indexed link over.
  async redirects() {
    return [{ source: '/about', destination: '/', permanent: true }];
  },
};

module.exports = nextConfig;
