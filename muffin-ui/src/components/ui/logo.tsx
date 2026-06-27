import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

/**
 * Muffin mascot — a flat-design blueberry muffin in the brand purple.
 * Placeholder until a final illustrated asset lands (tracked in ROADMAP M1
 * follow-ups). Drawn with SVG so it scales crisply on every platform.
 */
export function MuffinLogo({ size = 64 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Defs>
        <LinearGradient id="top" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#9D72EF" />
          <Stop offset="1" stopColor="#7C4DE0" />
        </LinearGradient>
        <LinearGradient id="cup" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F1E9FB" />
          <Stop offset="1" stopColor="#D7C6FB" />
        </LinearGradient>
      </Defs>
      {/* Muffin top (the frosted dome) */}
      <Path
        d="M14 30c0-11 8-18 18-18s18 7 18 18c0 2-1 3-3 3H17c-2 0-3-1-3-3z"
        fill="url(#top)"
      />
      {/* Blueberries */}
      <Circle cx="25" cy="26" r="2.4" fill="#2F38AD" />
      <Circle cx="34" cy="22" r="2.4" fill="#3F4BD6" />
      <Circle cx="40" cy="28" r="2.4" fill="#2F38AD" />
      {/* Muffin cup / wrapper */}
      <Path d="M17 33h30l-3 16a4 4 0 0 1-4 3H24a4 4 0 0 1-4-3l-3-16z" fill="url(#cup)" />
      {/* Wrapper pleats */}
      <Path d="M27 34l-1.5 18M37 34l1.5 18M32 34v18" stroke="#BCA0F6" strokeWidth="1.5" />
    </Svg>
  );
}
