/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The standalone translator was retired; old links land on the book studio.
  async redirects() {
    return [
      { source: '/translator', destination: '/', permanent: true },
      { source: '/translator.html', destination: '/', permanent: true },
    ];
  },
};

module.exports = nextConfig;
