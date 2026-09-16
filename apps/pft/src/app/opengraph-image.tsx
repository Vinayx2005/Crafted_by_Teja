import { ImageResponse } from 'next/og';

// Auto-served by Next at /opengraph-image and picked up as the OG/Twitter
// card image — no manual openGraph.images entry needed in layout.tsx.
// Kept in code (vs a static PNG) so brand color/tagline stay in one place.
export const alt = 'Personal FT — Know where your money goes';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OG() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#F37335',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px 100px',
          color: 'white',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 700,
            letterSpacing: -1,
            opacity: 0.9,
            marginBottom: 20,
          }}
        >
          Personal FT
        </div>
        <div
          style={{
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          Know where
        </div>
        <div
          style={{
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          your money goes.
        </div>
        <div
          style={{
            fontSize: 32,
            fontWeight: 500,
            marginTop: 40,
            opacity: 0.85,
          }}
        >
          pft.craftedbyteja.com
        </div>
      </div>
    ),
    { ...size }
  );
}
