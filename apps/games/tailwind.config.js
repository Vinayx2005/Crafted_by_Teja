/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand
        '18-orange':    '#F37335',
        '18-yellow':    '#FFF392',
        // Semantic — flipped for dark theme.
        // Rule of thumb: bg-* = surfaces/backgrounds, text-* = text.
        '18-bg':        '#0A0A0A', // page background (near-black)
        '18-surface':   '#141414', // card / elevated surface
        '18-surface-2': '#1C1C1C', // slightly higher elevation
        '18-charcoal':  '#141414', // legacy alias — still dark, used as sidebar bg
        '18-black':     '#000000',
        '18-white':     '#FFFFFF', // primary text on dark
        '18-dark-text': '#B0B0B0', // muted text on dark
        '18-border':    '#2A2A2A', // subtle border on dark
        // Legacy — kept so nothing crashes
        'dark-text':    '#B0B0B0',
        orange:         '#F37335',
        'orange-600':   '#E5601F',
      },
      backgroundImage: {
        // Warm orange radial glows for hero sections (matches the reference look)
        'glow-hero':
          'radial-gradient(1200px 500px at 20% -10%, rgba(243,115,53,0.35) 0%, transparent 60%), radial-gradient(1000px 400px at 85% 5%, rgba(255,180,80,0.25) 0%, transparent 55%)',
        'glow-soft':
          'radial-gradient(700px 300px at 50% -20%, rgba(243,115,53,0.20) 0%, transparent 65%)',
      },
      fontFamily: {
        lato: ['Lato', 'sans-serif'],
        poppins: ['Poppins', 'sans-serif'],
      },
      borderRadius: {
        '18-md': '16px',
        '18-sm': '10px',
      },
      spacing: {
        '18-xs': '4px',
        '18-sm': '8px',
        '18-md': '16px',
        '18-lg': '24px',
        '18-xl': '32px',
        '18-2xl': '48px',
      },
    },
  },
  plugins: [],
};
