/**
 * Muffin purple bakery design tokens.
 *
 * Flat-design, kawaii-doodle bakery aesthetic: a warm cream "dough" background,
 * a confident purple "frosting" primary, blueberry accents, and soft rounded
 * "muffin" radii. Colors are exposed as CSS variables (see src/global.css) so we
 * can theme light/dark without duplicating the Tailwind scale.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand purple ("frosting") — the hero color.
        frosting: {
          50: '#F6F1FE',
          100: '#ECE3FD',
          200: '#D7C6FB',
          300: '#BCA0F6',
          400: '#9D72EF',
          500: '#7C4DE0', // primary
          600: '#6838C6',
          700: '#542CA0',
          800: '#43257E',
          900: '#382163',
        },
        // Blueberry accent (the muffin's berries).
        blueberry: {
          400: '#5B6CF0',
          500: '#3F4BD6',
          600: '#2F38AD',
        },
        // Bakery surfaces.
        dough: '#FBF7FF', // app background (light)
        crust: '#F1E9FB', // raised surface (light)
        // Semantic signal colors (buy/sell/hold etc).
        bullish: '#28A56B',
        bearish: '#E2526B',
        neutral: '#C9A23A',
      },
      borderRadius: {
        muffin: '20px',
        bun: '28px',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        rounded: ['var(--font-rounded)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
};
