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
  // Content Studio only. The CSP is report-only for now: it logs what it would
  // block in the browser console without breaking anything; enforce it later.
  async headers() {
    const studio = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      {
        key: 'Content-Security-Policy-Report-Only',
        value:
          "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      },
    ];
    return [
      { source: '/studio/:path*', headers: studio },
      { source: '/api/studio', headers: studio },
    ];
  },
};

module.exports = nextConfig;
