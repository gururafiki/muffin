import { View } from 'react-native';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';

import { palette } from '@/theme/colors';
import { changeTone, REGIONS, type Region } from './taxonomy';

const VB_W = 360;
const VB_H = 200;

// Rough, friendly placements (not geographically exact — matches the brand).
const PLACEMENT: Record<string, { cx: number; cy: number; rx: number; ry: number; seed: number }> = {
  'north-america': { cx: 70, cy: 62, rx: 38, ry: 34, seed: 7 },
  'latin-america': { cx: 96, cy: 150, rx: 24, ry: 36, seed: 12 },
  europe: { cx: 168, cy: 54, rx: 22, ry: 20, seed: 3 },
  mea: { cx: 182, cy: 122, rx: 30, ry: 40, seed: 21 },
  'greater-china': { cx: 268, cy: 70, rx: 30, ry: 24, seed: 5 },
  'asia-pacific': { cx: 290, cy: 138, rx: 40, ry: 32, seed: 9 },
};

const toneFill: Record<'bullish' | 'bearish' | 'neutral', string> = {
  bullish: '#3FBE86',
  bearish: '#E8748A',
  neutral: '#C9A23A',
};

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth closed blob path from jittered points around an ellipse (Catmull-Rom → Bézier). */
function blobPath(cx: number, cy: number, rx: number, ry: number, seed: number, n = 9): string {
  const rand = mulberry(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const j = 0.78 + rand() * 0.4;
    pts.push([cx + Math.cos(ang) * rx * j, cy + Math.sin(ang) * ry * j]);
  }
  const p = (i: number) => pts[(i + n) % n];
  let d = `M ${p(0)[0].toFixed(1)} ${p(0)[1].toFixed(1)} `;
  for (let i = 0; i < n; i++) {
    const p0 = p(i - 1);
    const p1 = p(i);
    const p2 = p(i + 1);
    const p3 = p(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)} `;
  }
  return d + 'Z';
}

function RegionBlob({
  region,
  selected,
  onPress,
}: {
  region: Region;
  selected: boolean;
  onPress: () => void;
}) {
  const place = PLACEMENT[region.id];
  if (!place) return null;
  const d = blobPath(place.cx, place.cy, place.rx, place.ry, place.seed);
  const fill = toneFill[changeTone(region.changePct)];

  return (
    <G onPress={onPress} opacity={selected ? 1 : 0.92}>
      <Path
        d={d}
        fill={fill}
        stroke={selected ? palette.frosting[700] : palette.white}
        strokeWidth={selected ? 2.5 : 1.5}
      />
      <SvgText
        x={place.cx}
        y={place.cy + 6}
        fontSize={18}
        textAnchor="middle">
        {region.emoji}
      </SvgText>
    </G>
  );
}

/** Stylized, tappable world map of investment regions. */
export function WorldMap({
  onSelectRegion,
  selectedId,
}: {
  onSelectRegion: (id: string) => void;
  selectedId?: string | null;
}) {
  return (
    <View className="overflow-hidden rounded-bun bg-frosting-100 dark:bg-[#2E2042]" style={{ width: '100%', aspectRatio: VB_W / VB_H }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${VB_W} ${VB_H}`}>
        {REGIONS.map((r) => (
          <RegionBlob
            key={r.id}
            region={r}
            selected={selectedId === r.id}
            onPress={() => onSelectRegion(r.id)}
          />
        ))}
      </Svg>
    </View>
  );
}
