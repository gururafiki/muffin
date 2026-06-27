/**
 * JS-side mirror of the Tailwind palette (tailwind.config.js).
 *
 * NativeWind `className` covers most styling, but some APIs need raw color
 * values (navigation theme, status bar, SVG fills, chart libs). Keep this in
 * sync with tailwind.config.js.
 */
export const palette = {
  frosting: {
    50: '#F6F1FE',
    100: '#ECE3FD',
    200: '#D7C6FB',
    300: '#BCA0F6',
    400: '#9D72EF',
    500: '#7C4DE0',
    600: '#6838C6',
    700: '#542CA0',
    800: '#43257E',
    900: '#382163',
  },
  blueberry: { 400: '#5B6CF0', 500: '#3F4BD6', 600: '#2F38AD' },
  dough: '#FBF7FF',
  crust: '#F1E9FB',
  bullish: '#28A56B',
  bearish: '#E2526B',
  neutral: '#C9A23A',
  white: '#FFFFFF',
  black: '#1A1126',
} as const;

export const theme = {
  light: {
    background: palette.dough,
    surface: palette.white,
    surfaceMuted: palette.crust,
    text: palette.black,
    textMuted: '#6B5E7E',
    primary: palette.frosting[500],
    border: palette.frosting[100],
  },
  dark: {
    background: '#1A1126',
    surface: '#241834',
    surfaceMuted: '#2E2042',
    text: '#F6F1FE',
    textMuted: '#B9A9D1',
    primary: palette.frosting[400],
    border: '#3A2B52',
  },
} as const;

export type ThemeMode = keyof typeof theme;
